import { pool } from "../../db";
import { redis } from "../../events/redis";
import { runDueSchedules } from "../../scheduler/scheduler";
import { isValidSchedule, nextRun } from "../../scheduler/cron";

beforeEach(async () => {
  await pool.query("TRUNCATE jobs, queues RESTART IDENTITY CASCADE");
  await pool.query("INSERT INTO queues (name) VALUES ('reports')");
});
afterAll(async () => {
  await redis.quit();
  await pool.end();
});

async function insertDue(cron = "* * * * *") {
  await pool.query(
    `INSERT INTO schedules (name, queue_id, payload, cron_expr, next_run_at)
     VALUES ('every-minute', 1, '{"report":"daily"}', $1, now() - interval '1 minute')`,
    [cron]
  );
}

it("fires a due schedule once and advances next_run_at into the future", async () => {
  await insertDue();
  expect(await runDueSchedules()).toBe(1);

  const jobs = await pool.query("SELECT payload FROM jobs");
  expect(jobs.rowCount).toBe(1);
  expect(jobs.rows[0].payload).toEqual({ report: "daily" });

  const s = await pool.query("SELECT next_run_at > now() AS future FROM schedules");
  expect(s.rows[0].future).toBe(true);

  expect(await runDueSchedules()).toBe(0); // not due again
});

it("never double-fires when several schedulers race", async () => {
  await insertDue();
  await Promise.all(Array.from({ length: 5 }, () => runDueSchedules()));
  const jobs = await pool.query("SELECT count(*) AS n FROM jobs");
  expect(Number(jobs.rows[0].n)).toBe(1);
});

it("skips missed runs instead of backfilling", async () => {
  await pool.query(
    `INSERT INTO schedules (name, queue_id, cron_expr, next_run_at)
     VALUES ('old', 1, '* * * * *', now() - interval '3 hours')`
  );
  await runDueSchedules();
  const jobs = await pool.query("SELECT count(*) AS n FROM jobs");
  expect(Number(jobs.rows[0].n)).toBe(1);
});

it("does not fire disabled schedules", async () => {
  await insertDue();
  await pool.query("UPDATE schedules SET enabled = false");
  expect(await runDueSchedules()).toBe(0);
});

it("validates cron and timezone", () => {
  expect(isValidSchedule("*/5 * * * *")).toBe(true);
  expect(isValidSchedule("not a cron")).toBe(false);
  expect(isValidSchedule("* * * * *", "Mars/Olympus")).toBe(false);
});

it("respects the timezone", () => {
  // 09:00 IST is 03:30 UTC
  const next = nextRun("0 9 * * *", "Asia/Kolkata", new Date("2026-10-27T00:00:00Z"));
  expect(next.toISOString()).toBe("2026-10-27T03:30:00.000Z");
});