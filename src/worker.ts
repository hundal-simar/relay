import { writeFileSync } from "fs";
import { randomUUID } from "crypto";
import { claimNextJob } from "./workers/claim";
import { sleep } from "./workers/sleep";
import { pool } from "./db";

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

const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY) || 1;
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS) || 1000;
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS ?? 10000);
const SCHEDULER_INTERVAL_MS = Number(process.env.SCHEDULER_INTERVAL_MS) || 5000;
const REAPER_INTERVAL_MS = Number(process.env.REAPER_INTERVAL_MS ?? 30000);
const STALE_JOB_TIMEOUT_MS = Number(process.env.STALE_JOB_TIMEOUT_MS ?? 60000);
const ALIVE_FILE = "/tmp/worker-alive";

export interface WorkerHandle {
  workerId: string;
  stop: () => Promise<void>;
}

export function startWorker(): WorkerHandle {
  const workerId = `worker-${randomUUID().slice(0, 8)}`;
  let running = true;

  console.log(`[${workerId}] handlers: ${Object.keys(handlers).join(", ")}`);

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
  // queueId -> timestamp (ms) until which this worker avoids that queue
  const blockedUntil = new Map<number, number>();

  function blockedQueueIds(): number[] {
    const now = Date.now();
    const ids: number[] = [];

    for (const [id, until] of blockedUntil) {
      if (until > now) {
        ids.push(id);
      } else {
        blockedUntil.delete(id);
      }
    }

    return ids;
  }

  function msUntilNextUnblock(): number | null {
    const now = Date.now();
    let min: number | null = null;

    for (const until of blockedUntil.values()) {
      const wait = until - now;
      if (wait > 0 && (min === null || wait < min)) {
        min = wait;
      }
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
      .catch((err) => console.error("[scheduler] tick failed:", err))
      .finally(() => {
        schedulerBusy = false;
      });
  }, SCHEDULER_INTERVAL_MS);

  // ---------- Reaper ----------
  const reaperTimer = setInterval(() => {
    reapStaleJobs(STALE_JOB_TIMEOUT_MS).catch((error) => {
      console.error("[reaper] Failed to reap stale jobs:", error);
    });
  }, REAPER_INTERVAL_MS);

  // ---------- Job heartbeat ----------
  async function sendHeartbeat(jobId: number): Promise<boolean> {
    const result = await pool.query(
      `UPDATE jobs
       SET locked_at = now()
       WHERE id = $1
         AND locked_by = $2
         AND status = 'processing'
       RETURNING id`,
      [jobId, workerId]
    );

    return (result.rowCount ?? 0) > 0;
  }

  // ---------- Process one job ----------
  async function processJob(job: JobWithQueue): Promise<void> {
    const handler = handlers[job.queue_name];

    if (!handler) {
      console.error(
        `[${workerId}] no handler for queue '${job.queue_name}', job ${job.id}`
      );

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

        if (!stillOwned) {
          console.warn(`[${workerId}] Lost ownership of job ${job.id}`);
        }
      } catch (error) {
        console.error(
          `[${workerId}] Heartbeat failed for job ${job.id}:`,
          error
        );
      } finally {
        heartbeatInProgress = false;
      }
    }, HEARTBEAT_MS);

    try {
      const payload = job.payload;

      if (
        payload === null ||
        typeof payload !== "object" ||
        Array.isArray(payload)
      ) {
        throw new Error(`Invalid payload for job ${job.id}`);
      }

      await handler(payload);

      await pool.query(
        `INSERT INTO job_executions (job_id, worker_id)
         VALUES ($1, $2)`,
        [job.id, workerId]
      );

      const completed = await markCompleted(job.id, workerId);

      if (completed) {
        console.log(`[${workerId}] completed job ${job.id}`);

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
      await handleJobFailure(job, err, workerId);

      console.error(`[${workerId}] job ${job.id} failed:`, err);
    } finally {
      clearInterval(heartbeatTimer);
    }
  }

  // ---------- Main loop ----------
  async function loop(): Promise<void> {
    console.log(`[${workerId}] started`);

    while (running) {
      // A transient DB/Redis error (for example Neon waking from sleep) must
      // not kill the loop, or the whole API process in embedded mode.
      try {
        const job = await claimNextJob(workerId, blockedQueueIds());

        if (!job) {
          const wake = msUntilNextUnblock();

          await sleep(
            wake === null
              ? POLL_INTERVAL_MS
              : Math.min(POLL_INTERVAL_MS, Math.max(wake, 10))
          );

          continue;
        }

        const gate = await checkRateLimit(job.queue_id);

        if (!gate.allowed) {
          await releaseJob(job.id, workerId);

          blockedUntil.set(
            job.queue_id,
            Date.now() + Math.max(gate.retryAfterMs, 20)
          );

          continue;
        }

        console.log(`[${workerId}] claimed job ${job.id}`);
        await processJob(job);
      } catch (err) {
        console.error(`[${workerId}] loop error, retrying shortly:`, err);
        await sleep(Math.min(POLL_INTERVAL_MS * 5, 5000));
      }
    }
  }

  const loops = Promise.all(
    Array.from({ length: CONCURRENCY }, () => loop())
  ).then(() => undefined);

  // ---------- Stop (no process.exit, no pool/redis close) ----------
  async function stop(): Promise<void> {
    running = false;

    clearInterval(schedulerTimer);
    clearInterval(reaperTimer);
    clearInterval(aliveTimer);

    await schedulerRun; // let an in-flight scheduler tick finish
    await loops; // let in-flight jobs finish
  }

  return { workerId, stop };
}

// ---------- Standalone mode ----------
// Runs only for `node dist/worker.js`, `ts-node src/worker.ts`, or the Docker
// Compose worker service. Importing this file from server.ts does NOT run it.
if (require.main === module) {
  const worker = startWorker();
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(
      `[${worker.workerId}] received ${signal}, finishing current job...`
    );

    const forceExit = setTimeout(() => {
      console.error(`[${worker.workerId}] shutdown timed out, forcing exit`);
      process.exit(1);
    }, 8000);
    forceExit.unref();

    await worker.stop();
    await closeRedis();
    await pool.end();

    console.log(`[${worker.workerId}] shutdown complete`);
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}