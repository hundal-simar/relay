import { pool } from "../db";
import { calculateBackoffMs } from "./backoff";
import type { JobRow } from "../repositories/jobsRepository";
import { publishJobEvent } from "../events/redis";

export type JobWithQueue = JobRow & { queue_name: string };



export async function markCompleted(
  jobId: number,
  workerId: string
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE jobs
     SET status = 'completed',
         locked_at = NULL,
         locked_by = NULL,
         completed_at = now()
     WHERE id = $1
       AND locked_by = $2
       AND status = 'processing'
     RETURNING id`,
    [jobId, workerId]
  );

  if (result.rowCount === 0) {
    console.warn(
      `[${workerId}] Could not complete job ${jobId}: ownership lost or status changed`
    );
    return false;
  }
  return true;
}

export async function markFailedNoHandler(
  jobId: number,
  workerId: string
): Promise<void> {
  const result = await pool.query(
    `UPDATE jobs
     SET status = 'failed',
         last_error = $1,
         locked_at = NULL,
         locked_by = NULL
     WHERE id = $2
       AND locked_by = $3
       AND status = 'processing'
     RETURNING id`,
    [
      JSON.stringify({
        message: "No handler registered for this queue",
      }),
      jobId,
      workerId,
    ]
  );

  if (result.rowCount === 0) {
    console.warn(
      `[${workerId}] Could not fail job ${jobId}: ownership lost or status changed`
    );
  }
}

interface FailureInfo {
  message: string | undefined;
  stack?: string | undefined;
  failedAt: string | undefined;
}

export async function handleJobFailure(
  job: JobRow & { queue_name: string },
  error: unknown,
  workerId: string
): Promise<void> {
  const attempts = job.attempts + 1;
  const errorInfo = {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack?.slice(0, 2000) : undefined,
    failedAt: new Date().toISOString(),
  };
  const exhausted = attempts >= job.max_attempts;

  let result;
  if (exhausted) {
    result = await pool.query(
      `UPDATE jobs
       SET status = 'failed', attempts = $1, last_error = $2,
           locked_at = NULL, locked_by = NULL
       WHERE id = $3 AND locked_by = $4 AND status = 'processing'`,
      [attempts, JSON.stringify(errorInfo), job.id, workerId]
    );
  } else {
    const delayMs = calculateBackoffMs(attempts);
    result = await pool.query(
      `UPDATE jobs
       SET status = 'pending', attempts = $1, last_error = $2,
           run_at = now() + ($3 || ' milliseconds')::interval,
           locked_at = NULL, locked_by = NULL
       WHERE id = $4 AND locked_by = $5 AND status = 'processing'`,
      [attempts, JSON.stringify(errorInfo), delayMs, job.id, workerId]
    );
  }

  if ((result.rowCount ?? 0) === 0) {
    console.warn(`[${workerId}] lost ownership of job ${job.id}, discarding failure result`);
    return; 
  }

  publishJobEvent({
    type: exhausted ? "failed" : "retrying",
    jobId: Number(job.id),
    queue: job.queue_name,
    status: exhausted ? "failed" : "pending",
    attempts,
    workerId,
  });
}

export async function releaseJob(jobId: number, workerId: string): Promise<void> {
  await pool.query(
    `UPDATE jobs
     SET status = 'pending', locked_at = NULL, locked_by = NULL, started_at = NULL
     WHERE id = $1 AND locked_by = $2 AND status = 'processing'`,
    [jobId, workerId]
  );
}