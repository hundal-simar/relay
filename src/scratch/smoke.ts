import { pool } from "../db";

const API = process.env.API_URL ?? "http://localhost:3000";
const TOTAL = Number(process.argv[2]) || 200;
const QUEUE = "emails";
const TIMEOUT_MS = 120_000;

async function enqueue(total: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < total; i += 25) {
    const size = Math.min(25, total - i);
    const batch = await Promise.all(
      Array.from({ length: size }, async (_, k) => {
        const res = await fetch(`${API}/jobs`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ queueName: QUEUE, payload: { smoke: true, n: i + k } }),
        });
        if (res.status !== 201) throw new Error(`enqueue failed: ${res.status}`);
        const body = (await res.json()) as { data: { id: string | number } };
        return String(body.data.id);
      })
    );
    ids.push(...batch);
  }
  return ids;
}

async function waitForDrain(ids: string[]): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < TIMEOUT_MS) {
    const r = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM jobs
       WHERE id = ANY($1::bigint[]) AND status IN ('pending','processing')`,
      [ids]
    );
    if (Number(r.rows[0]?.n) === 0) return;
    await new Promise((res) => setTimeout(res, 500));
  }
  throw new Error("timed out waiting for jobs to drain (are workers running?)");
}

async function main() {
  console.log(`Enqueuing ${TOTAL} jobs...`);
  const t0 = Date.now();
  const ids = await enqueue(TOTAL);
  await waitForDrain(ids);
  const seconds = (Date.now() - t0) / 1000;

  const statuses = await pool.query<{ status: string; n: string }>(
    `SELECT status, count(*) AS n FROM jobs WHERE id = ANY($1::bigint[]) GROUP BY status`,
    [ids]
  );
  const dupes = await pool.query(
    `SELECT job_id, count(*) AS times FROM job_executions
     WHERE job_id = ANY($1::bigint[]) GROUP BY job_id HAVING count(*) > 1`,
    [ids]
  );
  const workers = await pool.query<{ worker_id: string; n: string }>(
    `SELECT worker_id, count(*) AS n FROM job_executions
     WHERE job_id = ANY($1::bigint[]) GROUP BY worker_id ORDER BY worker_id`,
    [ids]
  );

  console.log("\nStatuses:", Object.fromEntries(statuses.rows.map((r) => [r.status, Number(r.n)])));
  console.log("Per worker:", Object.fromEntries(workers.rows.map((r) => [r.worker_id, Number(r.n)])));
  console.log(`Duplicate executions: ${dupes.rowCount}`);
  console.log(`Total ${seconds.toFixed(1)}s -> ${(TOTAL / seconds).toFixed(1)} jobs/s`);

  const completed = Number(statuses.rows.find((r) => r.status === "completed")?.n ?? 0);
  const ok = completed === TOTAL && (dupes.rowCount ?? 0) === 0;
  console.log(ok ? "\nPASS" : "\nFAIL");
  await pool.end();
  process.exit(ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});