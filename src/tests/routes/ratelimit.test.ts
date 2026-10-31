import { pool } from "../../db";
import { redis } from "../../events/redis";
import { takeToken } from "../../ratelimit/tokenBucket";
import { claimNextJob } from "../../workers/claim";
import { releaseJob } from "../../workers/complete";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  if (redis.status !== "ready") await new Promise((r) => redis.once("ready", r));
});
beforeEach(async () => {
  await pool.query("TRUNCATE jobs, queues RESTART IDENTITY CASCADE");
  await pool.query("INSERT INTO queues (name) VALUES ('a'), ('b')");
});
afterAll(async () => {
  await redis.quit();
  await pool.end();
});

it("allows a burst, then denies with a sensible retry-after", async () => {
  const key = `test:rl:${Date.now()}:burst`;
  for (let i = 0; i < 3; i++) expect((await takeToken(key, 1, 3)).allowed).toBe(true);
  const denied = await takeToken(key, 1, 3);
  expect(denied.allowed).toBe(false);
  expect(denied.retryAfterMs).toBeGreaterThan(0);
  expect(denied.retryAfterMs).toBeLessThanOrEqual(1000);
  await redis.del(key);
});

it("refills over time", async () => {
  const key = `test:rl:${Date.now()}:refill`;
  await takeToken(key, 5, 1); // empties the 1-token bucket
  expect((await takeToken(key, 5, 1)).allowed).toBe(false);
  await sleep(250); // 5/sec -> 1 token per 200ms
  expect((await takeToken(key, 5, 1)).allowed).toBe(true);
  await redis.del(key);
});

it("never over-spends under concurrency", async () => {
  const key = `test:rl:${Date.now()}:race`;
  const results = await Promise.all(
    Array.from({ length: 50 }, () => takeToken(key, 0.001, 5)) // effectively no refill
  );
  expect(results.filter((r) => r.allowed).length).toBe(5);
  await redis.del(key);
});

it("claim skips excluded queues", async () => {
  await pool.query(`INSERT INTO jobs (queue_id, payload) VALUES (1, '{}'), (2, '{}')`);
  const job = await claimNextJob("w1", [1]);
  expect(job?.queue_name).toBe("b");
  expect(await claimNextJob("w1", [1])).toBeNull(); // queue 1 stays excluded
});

it("release puts a job back without using an attempt", async () => {
  await pool.query(`INSERT INTO jobs (queue_id, payload) VALUES (1, '{}')`);
  const job = await claimNextJob("w1");
  await releaseJob(job!.id, "w1");
  const r = await pool.query("SELECT status, attempts, locked_by FROM jobs");
  expect(r.rows[0]).toEqual({ status: "pending", attempts: 0, locked_by: null });
});