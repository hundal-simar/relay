import { writeFileSync } from "fs";
import { randomUUID } from "crypto";
import { claimNextJob } from "./workers/claim";
import { sleep } from "./workers/sleep";
import { pool } from "./db";
import { config } from "./config";
import { logger } from "./logger";
import { installCrashHandlers } from "./crash";

import {
  markCompleted,
  markFailedNoHandler,
  handleJobFailure,
  releaseJob,
  JobWithQueue,
} from "./workers/complete";

import { handlers } from "./handlers/index";
import { reapStaleJobs } from "./workers/reaper";
import { publishJobEvent, closeRedis } from "./events/redis";
import { runDueSchedules } from "./scheduler/scheduler";
import { checkRateLimit } from "./ratelimit/gate";

const ALIVE_FILE = "/tmp/worker-alive";

export interface WorkerHandle {
  workerId: string;
  stop: () => Promise<void>;
}

export function startWorker(): WorkerHandle {
  const workerId = `worker-${randomUUID().slice(0, 8)}`;
  const log = logger.child({ workerId });
  let running = true;

  log.info({ handlers: Object.keys(handlers), concurrency: config.WORKER_CONCURRENCY }, "worker starting");

  // ---------- Healthcheck heartbeat file ----------
  const touchAlive = () => {
    try {
      writeFileSync(ALIVE_FILE, String(Date.now()));
    } catch {
      /* healthcheck will report it */
    }
  };
  touchAlive();
  const aliveTimer = setInterval(touchAlive, 5000);

  // ---------- Rate-limit bookkeeping ----------
  const blockedUntil = new Map<number, number>();

  function blockedQueueIds(): number[] {
    const now = Date.now();
    const ids: number[] = [];
    for (const [id, until] of blockedUntil) {
      if (until > now) ids.push(id);
      else blockedUntil.delete(id);
    }
    return ids;
  }

  function msUntilNextUnblock(): number | null {
    const now = Date.now();
    let min: number | null = null;
    for (const until of blockedUntil.values()) {
      const wait = until - now;
      if (wait > 0 && (min === null || wait < min)) min = wait;
    }
    return min;
  }

  // ---------- Scheduler ----------
  let schedulerRun: Promise<void> = Promise.resolve();
  let schedulerBusy = false;

  const schedulerTimer = setInterval(() => {
    if (schedulerBusy) return;
    schedulerBusy = true;
    schedulerRun = runDueSchedules()
      .then(() => undefined)
      .catch((err) => log.error({ err }, "scheduler tick failed"))
      .finally(() => {
        schedulerBusy = false;
      });
  }, config.SCHEDULER_INTERVAL_MS);

  // ---------- Reaper ----------
  const reaperTimer = setInterval(() => {
    reapStaleJobs(config.STALE_JOB_TIMEOUT_MS).catch((err) =>
      log.error({ err }, "reaper failed")
    );
  }, config.REAPER_INTERVAL_MS);

  // ---------- Job heartbeat ----------
  async function sendHeartbeat(jobId: number): Promise<boolean> {
    const result = await pool.query(
      `UPDATE jobs
       SET locked_at = now()
       WHERE id = $1 AND locked_by = $2 AND status = 'processing'
       RETURNING id`,
      [jobId, workerId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  // ---------- Process one job ----------
  async function processJob(job: JobWithQueue): Promise<void> {
    // Context on every line of this job. Payloads are never logged: they may hold personal data.
    const jlog = log.child({ jobId: Number(job.id), queue: job.queue_name, attempt: job.attempts + 1 });
    const handler = handlers[job.queue_name];

    if (!handler) {
      jlog.error("no handler registered for queue, marking failed");
      await markFailedNoHandler(job.id, workerId);
      publishJobEvent({
        type: "failed",
        jobId: Number(job.id),
        queue: job.queue_name,
        status: "failed",
        attempts: job.attempts,
        workerId,
      });
      return;
    }

    const startedAt = Date.now();
    let heartbeatInProgress = false;

    publishJobEvent({
      type: "started",
      jobId: Number(job.id),
      queue: job.queue_name,
      status: "processing",
      attempts: job.attempts,
      workerId,
    });

    const heartbeatTimer = setInterval(async () => {
      if (heartbeatInProgress) return;
      heartbeatInProgress = true;
      try {
        const stillOwned = await sendHeartbeat(job.id);
        if (!stillOwned) jlog.warn("lost ownership of job");
      } catch (err) {
        jlog.error({ err }, "heartbeat failed");
      } finally {
        heartbeatInProgress = false;
      }
    }, config.HEARTBEAT_MS);

    try {
      const payload = job.payload;
      if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error(`Invalid payload for job ${job.id}`);
      }

      await handler(payload);

      await pool.query(`INSERT INTO job_executions (job_id, worker_id) VALUES ($1, $2)`, [
        job.id,
        workerId,
      ]);

      const completed = await markCompleted(job.id, workerId);

      if (completed) {
        jlog.info({ durationMs: Date.now() - startedAt }, "job completed");
        publishJobEvent({
          type: "completed",
          jobId: Number(job.id),
          queue: job.queue_name,
          status: "completed",
          attempts: job.attempts,
          workerId,
        });
      }
    } catch (err) {
      jlog.error({ err, durationMs: Date.now() - startedAt }, "job failed");
      await handleJobFailure(job, err, workerId);
    } finally {
      clearInterval(heartbeatTimer);
    }
  }

  // ---------- Main loop ----------
  async function loop(): Promise<void> {
    log.debug("loop started");

    while (running) {
      // A transient DB/Redis error (e.g. Neon waking up) must not kill the loop
      try {
        const job = await claimNextJob(workerId, blockedQueueIds());

        if (!job) {
          const wake = msUntilNextUnblock();
          await sleep(
            wake === null
              ? config.POLL_INTERVAL_MS
              : Math.min(config.POLL_INTERVAL_MS, Math.max(wake, 10))
          );
          continue;
        }

        const gate = await checkRateLimit(job.queue_id);

        if (!gate.allowed) {
          await releaseJob(job.id, workerId);
          blockedUntil.set(job.queue_id, Date.now() + Math.max(gate.retryAfterMs, 20));
          continue;
        }

        log.debug({ jobId: Number(job.id), queue: job.queue_name }, "claimed job");
        await processJob(job);
      } catch (err) {
        log.error({ err }, "loop error, retrying shortly");
        await sleep(Math.min(config.POLL_INTERVAL_MS * 5, 5000));
      }
    }
  }

  const loops = Promise.all(
    Array.from({ length: config.WORKER_CONCURRENCY }, () => loop())
  ).then(() => undefined);

  async function stop(): Promise<void> {
    running = false;
    clearInterval(schedulerTimer);
    clearInterval(reaperTimer);
    clearInterval(aliveTimer);
    await schedulerRun;
    await loops;
    log.info("worker stopped");
  }

  return { workerId, stop };
}

// ---------- Standalone mode (Docker Compose worker, ts-node) ----------
if (require.main === module) {
  installCrashHandlers();
  const worker = startWorker();
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ workerId: worker.workerId, signal }, "received signal, finishing current jobs");

    const forceExit = setTimeout(() => {
      logger.error({ workerId: worker.workerId }, "shutdown timed out, forcing exit");
      process.exit(1);
    }, 8000);
    forceExit.unref();

    await worker.stop();
    await closeRedis();
    await pool.end();

    logger.info({ workerId: worker.workerId }, "shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}