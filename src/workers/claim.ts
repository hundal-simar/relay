import { pool } from "../db";
import type { JobRow } from "../repositories/jobsRepository";

export type ClaimedJob = JobRow & {
  queue_name: string;
};

export async function claimNextJob(
  workerId: string,
  excludeQueueIds: number[] = []
): Promise<ClaimedJob | null> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query<ClaimedJob>(
      `UPDATE jobs
       SET status = 'processing',
           locked_at = now(),
           locked_by = $1,
           started_at = now()
       WHERE id = (
         SELECT j.id
         FROM jobs j
         WHERE j.status = 'pending'
           AND j.run_at <= now()
           AND j.queue_id <> ALL($2::int[])
         ORDER BY j.run_at
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING *,
         (SELECT name FROM queues WHERE id = jobs.queue_id) AS queue_name`,
      [workerId, excludeQueueIds]
    );

    await client.query("COMMIT");

    return result.rows[0] ?? null;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
