import { pool } from "../db";
import { publishJobEvent } from "../events/redis";
import { nextRun } from "./cron";

interface DueSchedule {
  id: number;
  name: string;
  queue_id: number;
  queue_name: string;
  payload: Record<string, unknown>;
  cron_expr: string;
  timezone: string;
}

export async function runDueSchedules(batchSize = 20): Promise<number> {
  const client = await pool.connect();
  const created: { jobId: number; queue: string }[] = [];

  try {
    await client.query("BEGIN");

    const due = await client.query<DueSchedule>(
      `SELECT s.id, s.name, s.queue_id, q.name AS queue_name, s.payload, s.cron_expr, s.timezone
       FROM schedules s
       JOIN queues q ON q.id = s.queue_id
       WHERE s.enabled AND s.next_run_at <= now()
       ORDER BY s.next_run_at
       LIMIT $1
       FOR UPDATE OF s SKIP LOCKED`,
      [batchSize]
    );

    for (const s of due.rows) {
      let next: Date;
      try {
        next = nextRun(s.cron_expr, s.timezone);
      } catch (err) {
        console.error(`[scheduler] schedule '${s.name}' is invalid, disabling`, err);
        await client.query("UPDATE schedules SET enabled = false WHERE id = $1", [s.id]);
        continue;
      }

      const job = await client.query<{ id: string }>(
        `INSERT INTO jobs (queue_id, payload) VALUES ($1, $2) RETURNING id`,
        [s.queue_id, JSON.stringify(s.payload)]
      );

      await client.query(
        "UPDATE schedules SET last_run_at = now(), next_run_at = $1 WHERE id = $2",
        [next, s.id]
      );

      created.push({ jobId: Number(job.rows[0]?.id), queue: s.queue_name });
      console.log(`[scheduler] '${s.name}' fired job ${job.rows[0]?.id}, next at ${next.toISOString()}`);
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  for (const c of created) {
    publishJobEvent({
      type: "enqueued",
      jobId: c.jobId,
      queue: c.queue,
      status: "pending",
      attempts: 0,
    });
  }
  return created.length;
}