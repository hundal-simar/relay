import { pool } from "../../db";
import { getMetrics } from "../../repositories/metricsRepository";

beforeEach(async () => {
  await pool.query("TRUNCATE jobs, queues RESTART IDENTITY CASCADE");
  await pool.query("INSERT INTO queues (name) VALUES ('emails')");
});
afterAll(() => pool.end());

it("computes depth, scheduled, and failure rate", async () => {
  await pool.query(`
    INSERT INTO jobs (queue_id, payload, status, run_at, started_at, completed_at) VALUES
      (1, '{}', 'pending',   now() - interval '1 minute', NULL, NULL),
      (1, '{}', 'pending',   now() + interval '1 hour',   NULL, NULL),
      (1, '{}', 'completed', now(), now() - interval '2 seconds', now()),
      (1, '{}', 'completed', now(), now() - interval '4 seconds', now()),
      (1, '{}', 'completed', now(), now() - interval '6 seconds', now())
  `);
  await pool.query(`INSERT INTO jobs (queue_id, payload, status) VALUES (1, '{}', 'failed')`);

  const m = await getMetrics(300);
  expect(m.queueDepth).toBe(1);
  expect(m.scheduled).toBe(1);
  expect(m.failureRate).toBeCloseTo(0.25); // 1 failed / (3 completed + 1 failed)
  expect(m.avgProcessingMs).toBeGreaterThan(3500);
  expect(m.avgProcessingMs).toBeLessThan(4500);
  expect(m.queues[0]?.name).toBe("emails");
});

it("returns nulls when nothing has finished", async () => {
  const m = await getMetrics(300);
  expect(m.avgProcessingMs).toBeNull();
  expect(m.failureRate).toBeNull();
});