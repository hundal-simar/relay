
import { randomUUID } from "crypto";
import { pool } from "../db";

const args = process.argv.slice(2);
const mode = args[0] ?? "burst"; // burst | paced | clean

const opt = (name: string, def: string): string =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? def;

const queueName = opt("queue", "bench_noop");
const total = Number(opt("jobs", "20000"));
const rate = Number(opt("rate", "50")); // paced: jobs/sec
const durationSec = Number(opt("duration", "60")); // paced
const timeoutSec = Number(opt("timeout", "900"));
const runId = randomUUID().slice(0, 8);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ensureQueue(): Promise<number> {
  const r = await pool.query<{ id: number; rate_per_sec: number | null }>(
    `INSERT INTO queues (name) VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, rate_per_sec`,
    [queueName]
  );

  const queue = r.rows[0];

  if (!queue) {
    throw new Error(`Queue '${queueName}' could not be created or found.`);
  }

  if (queue.rate_per_sec !== null) {
    console.warn(
      `WARNING: '${queueName}' has a rate limit (${queue.rate_per_sec}/s). Remove it first.`
    );
  }

  return queue.id;
}

async function seed(queueId: number, n: number): Promise<void> {
  await pool.query(
    `INSERT INTO jobs (queue_id, payload)
     SELECT $1, jsonb_build_object('bench', true, 'runId', $2::text, 'n', i)
     FROM generate_series(1, $3::int) AS i`,
    [queueId, runId, n]
  );
}

interface Scope {
  startId: string;
  queueId: number;
}

const SCOPE = `id > $1 AND queue_id = $2 AND payload->>'runId' = $3`;

async function counts(s: Scope): Promise<Record<string, number>> {
  const r = await pool.query<{ status: string; n: string }>(
    `SELECT status, count(*) AS n
     FROM jobs
     WHERE ${SCOPE}
     GROUP BY status`,
    [s.startId, s.queueId, runId]
  );

  const c: Record<string, number> = {
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
  };

  for (const row of r.rows) {
    c[row.status] = Number(row.n);
  }

  return c;
}

async function waitForDrain(s: Scope): Promise<void> {
  const deadline = Date.now() + timeoutSec * 1000;

  let lastDone = -1;
  let lastProgress = Date.now();

  while (Date.now() < deadline) {
    const c = await counts(s);

    const completed = c.completed ?? 0;
    const failed = c.failed ?? 0;
    const pending = c.pending ?? 0;
    const processing = c.processing ?? 0;

    const done = completed + failed;

    process.stdout.write(
      `\r  pending ${pending}  processing ${processing}  done ${done}   `
    );

    if (pending + processing === 0) {
      console.log();
      return;
    }

    if (done !== lastDone) {
      lastDone = done;
      lastProgress = Date.now();
    } else if (Date.now() - lastProgress > 30_000) {
      throw new Error(
        "\nNo progress for 30s. Are workers running, with ENABLE_BENCH_HANDLERS=true?"
      );
    }

    await sleep(500);
  }

  throw new Error("\nTimed out waiting for drain");
}

// Open loop: arrivals follow the clock, not how fast workers keep up.
async function pacedArrivals(queueId: number): Promise<number> {
  const tickMs = 100;
  const perTick = (rate * tickMs) / 1000;
  const end = Date.now() + durationSec * 1000;

  let carry = 0;
  let enqueued = 0;

  while (Date.now() < end) {
    const t = Date.now();

    carry += perTick;

    const n = Math.floor(carry);
    carry -= n;

    if (n > 0) {
      await seed(queueId, n);
      enqueued += n;
    }

    await sleep(Math.max(0, tickMs - (Date.now() - t)));
  }

  return enqueued;
}

const pct = (a: number[] | null | undefined) =>
  a && a.length >= 3
    ? {
        p50: Math.round(a[0]!),
        p95: Math.round(a[1]!),
        p99: Math.round(a[2]!),
      }
    : null;

async function report(s: Scope, expected: number): Promise<boolean> {
  const c = await counts(s);

  const lat = await pool.query<{
    n: string;
    span_sec: string | null;
    wait_ms: number[] | null;
    proc_ms: number[] | null;
    e2e_ms: number[] | null;
  }>(
    `SELECT count(*) AS n,
       extract(epoch FROM (max(completed_at) - min(started_at))) AS span_sec,
       percentile_cont(ARRAY[0.5,0.95,0.99]) WITHIN GROUP
         (ORDER BY extract(epoch FROM (started_at - created_at)) * 1000) AS wait_ms,
       percentile_cont(ARRAY[0.5,0.95,0.99]) WITHIN GROUP
         (ORDER BY extract(epoch FROM (completed_at - started_at)) * 1000) AS proc_ms,
       percentile_cont(ARRAY[0.5,0.95,0.99]) WITHIN GROUP
         (ORDER BY extract(epoch FROM (completed_at - created_at)) * 1000) AS e2e_ms
     FROM jobs
     WHERE ${SCOPE} AND status = 'completed'`,
    [s.startId, s.queueId, runId]
  );

  const dupes = await pool.query(
    `SELECT e.job_id
     FROM job_executions e
     JOIN jobs j ON j.id = e.job_id
     WHERE j.id > $1
       AND j.queue_id = $2
       AND j.payload->>'runId' = $3
     GROUP BY e.job_id
     HAVING count(*) > 1`,
    [s.startId, s.queueId, runId]
  );

  const perWorker = await pool.query<{ worker_id: string; n: string }>(
    `SELECT e.worker_id, count(*) AS n
     FROM job_executions e
     JOIN jobs j ON j.id = e.job_id
     WHERE j.${SCOPE}
     GROUP BY e.worker_id
     ORDER BY e.worker_id`,
    [s.startId, s.queueId, runId]
  );

  const row = lat.rows[0];

  if (!row) {
    throw new Error("Could not retrieve benchmark report.");
  }

  const n = Number(row.n);
  const span = row.span_sec === null ? 0 : Number(row.span_sec);

  const completed = c.completed ?? 0;
  const failed = c.failed ?? 0;

  console.log(
    `\n=== Result (${mode}, queue=${queueName}, run=${runId}) ===`
  );

  console.table({
    expected,
    completed,
    failed,
    "duplicate executions": dupes.rowCount ?? 0,
    "processing span (s)": span ? span.toFixed(2) : "-",
    "throughput (jobs/s)": span ? (n / span).toFixed(1) : "-",
  });

  console.log("Queue wait ms (started - created):", pct(row.wait_ms));
  console.log("Handler time ms (completed - started):", pct(row.proc_ms));
  console.log("End-to-end ms (completed - created):", pct(row.e2e_ms));

  console.log(
    "Per worker process:",
    Object.fromEntries(
      perWorker.rows.map((r) => [r.worker_id, Number(r.n)])
    )
  );

  if (mode === "burst") {
    console.log(
      "Note: in a burst every job is created at once, so 'wait' measures drain position, not typical latency."
    );
  }

  const ok =
    completed === expected &&
    failed === 0 &&
    (dupes.rowCount ?? 0) === 0;

  console.log(
    ok
      ? "\nPASS: all completed, no duplicates"
      : "\nFAIL: check counts above"
  );

  return ok;
}

async function main(): Promise<void> {
  if (mode === "clean") {
  // First delete execution records belonging to benchmark jobs
  const e = await pool.query(
    `DELETE FROM job_executions e
     USING jobs j
     WHERE e.job_id = j.id
       AND j.payload->>'bench' = 'true'`
  );

  // Then delete benchmark jobs
  const j = await pool.query(
    `DELETE FROM jobs
     WHERE payload->>'bench' = 'true'`
  );

  // Delete any remaining orphaned execution records
  const orphaned = await pool.query(
    `DELETE FROM job_executions e
     WHERE NOT EXISTS (
       SELECT 1
       FROM jobs j
       WHERE j.id = e.job_id
     )`
  );

  await pool.query("VACUUM (ANALYZE) jobs");
  await pool.query("VACUUM (ANALYZE) job_executions");

  console.log(
    `Removed ${j.rowCount ?? 0} benchmark jobs, ${
      e.rowCount ?? 0
    } associated executions and ${
      orphaned.rowCount ?? 0
    } orphaned executions`
  );

  return;
}

  if (mode !== "burst" && mode !== "paced") {
    throw new Error(
      `Invalid mode '${mode}'. Use: burst, paced, or clean.`
    );
  }

  const queueId = await ensureQueue();

  const start = await pool.query<{ m: string }>(
    "SELECT coalesce(max(id), 0)::text AS m FROM jobs"
  );

  const firstRow = start.rows[0];

  if (!firstRow) {
    throw new Error("Could not determine benchmark starting ID.");
  }

  const scope: Scope = {
    startId: firstRow.m,
    queueId,
  };

  let expected: number;

  if (mode === "paced") {
    console.log(
      `Paced: ${rate} jobs/s for ${durationSec}s on '${queueName}'`
    );

    expected = await pacedArrivals(queueId);
  } else {
    console.log(`Burst: seeding ${total} jobs on '${queueName}'`);

    await seed(queueId, total);
    expected = total;
  }

  await waitForDrain(scope);

  const ok = await report(scope, expected);

  process.exitCode = ok ? 0 : 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
