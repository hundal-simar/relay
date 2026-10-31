import { pool } from "../db";

export interface QueueMetrics {
  name: string;
  depth: number;
  processing: number;
  doneLastMinute: number;
  failed: number;
  ratePerSec: number | null
}

export interface Metrics {
  windowSec: number;
  queueDepth: number;
  scheduled: number;
  processing: number;
  throughputPerSec: number;
  avgProcessingMs: number | null;
  p95ProcessingMs: number | null;
  failureRate: number | null; // 0..1, null when nothing finished in the window
  throughputSeries: number[]; // 12 buckets of 5s, oldest first
  queues: QueueMetrics[] ;

}

const BUCKET_SEC = 5;
const BUCKETS = 12;

export async function getMetrics(windowSec = 300): Promise<Metrics> {
  const [summary, perQueue, series] = await Promise.all([
    pool.query(
      `SELECT
         count(*) FILTER (WHERE status = 'pending' AND run_at <= now()) AS queue_depth,
         count(*) FILTER (WHERE status = 'pending' AND run_at > now()) AS scheduled,
         count(*) FILTER (WHERE status = 'processing') AS processing,
         count(*) FILTER (WHERE status = 'completed'
                          AND completed_at > now() - interval '60 seconds') AS done_last_minute,
         count(*) FILTER (WHERE status = 'completed'
                          AND completed_at > now() - make_interval(secs => $1::double precision)) AS done_window,
         count(*) FILTER (WHERE status = 'failed'
                          AND updated_at > now() - make_interval(secs => $1::double precision)) AS failed_window,
         avg(extract(epoch FROM (completed_at - started_at)) * 1000)
           FILTER (WHERE status = 'completed' AND started_at IS NOT NULL
                   AND completed_at > now() - make_interval(secs => $1::double precision)) AS avg_ms,
         percentile_cont(0.95) WITHIN GROUP
           (ORDER BY extract(epoch FROM (completed_at - started_at)) * 1000)
           FILTER (WHERE status = 'completed' AND started_at IS NOT NULL
                   AND completed_at > now() - make_interval(secs => $1::double precision)) AS p95_ms
       FROM jobs`,
      [windowSec]
    ),
    pool.query(
      `SELECT q.name,
         count(*) FILTER (WHERE j.status = 'pending' AND j.run_at <= now()) AS depth,
         count(*) FILTER (WHERE j.status = 'processing') AS processing,
         count(*) FILTER (WHERE j.status = 'completed'
                          AND j.completed_at > now() - interval '60 seconds') AS done_last_minute,
         count(*) FILTER (WHERE j.status = 'failed') AS failed
       FROM queues q
       LEFT JOIN jobs j ON j.queue_id = q.id
       GROUP BY q.name
       ORDER BY q.name`
    ),
    pool.query<{ bucket: number; n: string }>(
      `SELECT floor(extract(epoch FROM (now() - completed_at)) / $1)::int AS bucket,
              count(*) AS n
       FROM jobs
       WHERE status = 'completed'
         AND completed_at > now() - make_interval(secs => $2::double precision)
       GROUP BY 1`,
      [BUCKET_SEC, BUCKET_SEC * BUCKETS]
    ),
  ]);

  const s = summary.rows[0];
  const done = Number(s.done_window);
  const failed = Number(s.failed_window);

  // bucket 0 = newest 5s. Flip so index 0 is oldest (left-to-right chart).
  const throughputSeries = new Array<number>(BUCKETS).fill(0);
  for (const row of series.rows) {
    if (row.bucket >= 0 && row.bucket < BUCKETS) {
      throughputSeries[BUCKETS - 1 - row.bucket] = Number(row.n);
    }
  }

  return {
    windowSec,
    queueDepth: Number(s.queue_depth),
    scheduled: Number(s.scheduled),
    processing: Number(s.processing),
    throughputPerSec: Number(s.done_last_minute) / 60,
    avgProcessingMs: s.avg_ms === null ? null : Number(s.avg_ms),
    p95ProcessingMs: s.p95_ms === null ? null : Number(s.p95_ms),
    failureRate: done + failed === 0 ? null : failed / (done + failed),
    throughputSeries,
    queues: perQueue.rows.map((r) => ({
      name: r.name,
      depth: Number(r.depth),
      processing: Number(r.processing),
      doneLastMinute: Number(r.done_last_minute),
      failed: Number(r.failed),
      ratePerSec: r.rate_per_sec === null ? null : Number(r.rate_per_sec),
    })),
  };
}