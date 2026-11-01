import  { pool } from "../db";



interface InsertJobInput {
  queueId: number;
  payload: Record<string, unknown>;
  maxAttempts?: number | undefined;
  runAt?: Date | undefined;
}

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface JobRow {
    id: number;
    queue_id: number;
    payload: JsonValue;
    max_attempts: number;
    attempts: number;
    status: "pending" | "processing" | "completed" | "failed";
    run_at: Date;
    created_at: Date;
    updated_at: Date;
    locked_at: Date | null;
    locked_by: string | null;
    last_error: string | null;
}


export const insertJob = async (input: InsertJobInput): Promise<JobRow> => {
  const result = await pool.query<JobRow>(
    `INSERT INTO jobs (queue_id, payload, max_attempts, run_at)
     VALUES ($1, $2, COALESCE($3, 5), COALESCE($4, now()))
     RETURNING *`, 
    [input.queueId, input.payload, input.maxAttempts ?? null, input.runAt ?? null]
  );
  const job= result.rows[0];
  if(!job){
    throw new Error("Failed to insert job");
  }
    return job;
}

export const findJobById = async (id: number): Promise<JobRow | null> => {
  const result = await pool.query<JobRow>(
    `SELECT * FROM jobs WHERE id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

type listJobsOptions = {
  status?: string| undefined;
  limit: number;
}

// export const listJobs = async (options: listJobsOptions): Promise<JobRow[]> => {
//   let query = `SELECT * FROM jobs`;
//   const values : unknown[] = [];
//   if (options.status) {
//     query += ` WHERE status = $1`;
//     values.push(options.status);
//   }
//   query += ` LIMIT $${values.length + 1}`;
//   values.push(options.limit);
//   const result = await pool.query<JobRow>(query, values);
//   return result.rows;
// }

export async function getStatusCounts(): Promise<Record<string, number>> {
  const result = await pool.query<{ status: string; count: string }>(
    "SELECT status, COUNT(*) AS count FROM jobs GROUP BY status"
  );
  const counts: Record<string, number> = { pending: 0, processing: 0, completed: 0, failed: 0 };
  for (const row of result.rows) {
    counts[row.status] = Number(row.count); 
  }
  return counts;
}

export async function listJobs(opts: { status?: string; limit: number }) {
  const result = await pool.query<JobRow & { queue_name: string }>(
    `SELECT j.*, q.name AS queue_name
     FROM jobs j
     JOIN queues q ON q.id = j.queue_id
     WHERE ($1::text IS NULL OR j.status = $1)
     ORDER BY j.updated_at DESC
     LIMIT $2`,
    [opts.status ?? null, opts.limit]
  );
  return result.rows;
}
