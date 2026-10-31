import { pool } from "../db";
import { publishJobEvent } from "../events/redis";


export async function reapStaleJobs(timeoutMs: number): Promise<number> {
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  throw new Error("timeoutMs must be a positive number");
}
  const result = await pool.query(
    `UPDATE jobs
     SET attempts = attempts + 1,
         status = CASE WHEN attempts + 1 >= max_attempts THEN 'failed' ELSE 'pending' END,
         run_at = now(),
         last_error = jsonb_build_object(
           'message', 'Worker lost: job reclaimed after heartbeat timeout',
           'failedAt', now()
         ),
         locked_at = NULL,
         locked_by = NULL
     WHERE status = 'processing'
       AND locked_at < now() - ($1 || ' milliseconds')::interval
     RETURNING id, status`,
    [timeoutMs]
  );
  for (const row of result.rows) {
    console.log(`[reaper] job ${row.id} reclaimed -> ${row.status}`);
     publishJobEvent({
      type: "reclaimed",
      jobId: Number(row.id),
      queue: row.queue_name,
      status: row.status,
      attempts: row.attempts,
    });
  }
  return result.rowCount ?? 0;
}