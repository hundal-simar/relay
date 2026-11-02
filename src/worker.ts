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
import type { JobRow } from "./repositories/jobsRepository";
import { reapStaleJobs } from "./workers/reaper";
import { publishJobEvent, redis } from "./events/redis";
import { runDueSchedules } from "./scheduler/scheduler";
import { checkRateLimit } from "./ratelimit/gate";


const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY) || 1;
const workerId = `worker-${randomUUID().slice(0, 8)}`;

const POLL_INTERVAL_MS =
  Number(process.env.POLL_INTERVAL_MS) || 1000;

let running = true;
let shuttingDown = false;

let reaperTimer: NodeJS.Timeout | undefined;

const heartbeat = Number(process.env.HEARTBEAT_MS ?? 10000);

const SCHEDULER_INTERVAL_MS =
  Number(process.env.SCHEDULER_INTERVAL_MS) || 5000;

let schedulerRun: Promise<void> = Promise.resolve();
let schedulerBusy = false;


const ALIVE_FILE = "/tmp/worker-alive";
const touchAlive = () => {
  try {
    writeFileSync(ALIVE_FILE, String(Date.now()));
  } catch {
    /* healthcheck will report it */
  }
};
touchAlive();
const aliveTimer = setInterval(touchAlive, 5000);
// queueId -> timestamp (milliseconds) until which this worker avoids that queue
const blockedUntil = new Map<number, number>();

// Returns IDs of queues that are currently blocked
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

// Returns the time remaining until the nearest blocked queue becomes available
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

// Scheduler
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

// Reaper
function startReaper() {
  const intervalMs = Number(process.env.REAPER_INTERVAL_MS ?? 30000);
  const staleJobTimeout = Number(
    process.env.STALE_JOB_TIMEOUT_MS ?? 60000
  );

  reaperTimer = setInterval(() => {
    reapStaleJobs(staleJobTimeout).catch((error) => {
      console.error("[reaper] Failed to reap stale jobs:", error);
    });
  }, intervalMs);
}

// Heartbeat
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

// Process job
async function processJob(job: JobWithQueue) {
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
        console.warn(
          `[${workerId}] Lost ownership of job ${job.id}`
        );
      }
    } catch (error) {
      console.error(
        `[${workerId}] Heartbeat failed for job ${job.id}:`,
        error
      );
    } finally {
      heartbeatInProgress = false;
    }
  }, heartbeat);

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

    console.error(
      `[${workerId}] job ${job.id} failed:`,
      err
    );
  } finally {
    clearInterval(heartbeatTimer);
  }
}

// Main worker loop
async function loop(): Promise<void> {
  console.log(`[${workerId}] started`);

  while (running) {
    // Claim a job while excluding temporarily blocked queues
    const job = await claimNextJob(workerId, blockedQueueIds());

    // No eligible job found
    if (!job) {
      const wake = msUntilNextUnblock();

      await sleep(
        wake === null
          ? POLL_INTERVAL_MS
          : Math.min(POLL_INTERVAL_MS, Math.max(wake, 10))
      );

      continue;
    }

    // Check whether the queue is allowed to start another job
    const gate = await checkRateLimit(job.queue_id);

    if (!gate.allowed) {
      // Return the job to pending
      await releaseJob(job.id, workerId);

      // Temporarily block this queue for this worker
      blockedUntil.set(
        job.queue_id,
        Date.now() + Math.max(gate.retryAfterMs, 20)
      );

      // Immediately try another queue
      continue;
    }

    // Rate limit allows execution
    await processJob(job);

    console.log(`[${workerId}] claimed job ${job.id}`);
  }
}

// Start worker
startReaper();

const loopPromise = Promise.all(
  Array.from({ length: CONCURRENCY }, () => loop())
).then(() => undefined);
// Graceful shutdown
async function shutdown(signal: string) {
  if (shuttingDown) return;

  shuttingDown = true;

  console.log(
    `[${workerId}] received ${signal}, finishing current job...`
  );

  running = false;

  if (reaperTimer) {
    clearInterval(reaperTimer);
    reaperTimer = undefined;
  }

  const forceExit = setTimeout(() => {
    console.error(`[${workerId}] shutdown timed out, forcing exit`);
    process.exit(1);
  }, 8000);

  forceExit.unref();

  clearInterval(schedulerTimer);
  clearInterval(aliveTimer);

  await schedulerRun;
  await loopPromise;

  await redis.quit();
  await pool.end();

  console.log(`[${workerId}] shutdown complete`);

  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
