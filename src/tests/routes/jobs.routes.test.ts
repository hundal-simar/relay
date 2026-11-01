import request from "supertest";
import app from "../../app";
import { pool } from "../../db";
import { truncateTables } from "../helpers/truncate";
import {redis} from "../../events/redis";
import { closeRedis } from "../../events/redis";

import {
  beforeAll,
  beforeEach,
  afterAll,
  it,
  expect,
  describe,
} from "@jest/globals";

describe("Jobs Routes", () => {
  beforeEach(async () => {
    await truncateTables();
  });

  beforeAll(async () => {
  if (redis.status !== "ready") {
    await Promise.race([
      new Promise((r) => redis.once("ready", r)),
      new Promise((_, rej) => setTimeout(() => rej(new Error("Redis not reachable on localhost:6379")), 5000)),
    ]);
  }
});

  afterAll(async () => {
    await pool.end();
    await closeRedis();
  });

  it("creates a job", async () => {
  await pool.query(
    `
    INSERT INTO queues(name)
    VALUES($1)
    `,
    ["emails"]
  );

  const response = await request(app)
    .post("/api/jobs")
    .send({
      queueName: "emails",
      payload: {
        email: "abc@test.com",
      },
    });

  expect(response.status).toBe(201);

  expect(response.body.success).toBe(true);

  expect(response.body.data.id).toBeDefined();
});

    it("returns 400", async () => {
  const response = await request(app)
    .post("/api/jobs")
    .send({
      queueName: "emails",
    });

  expect(response.status).toBe(400);
});
    
    it("returns 404", async () => {
  const response = await request(app)
    .post("/api/jobs")
    .send({
      queueName: "unknown",
      payload: {},
    });

  expect(response.status).toBe(404);
});
   
     it("returns existing job", async () => {
  const queueResult = await pool.query(
    `
    INSERT INTO queues(name)
    VALUES($1)
    RETURNING *
    `,
    ["emails"]
  );

  const queue = queueResult.rows[0];

  const jobResult = await pool.query(
    `
    INSERT INTO jobs(queue_id,payload)
    VALUES($1,$2)
    RETURNING *
    `,
    [queue.id, {}]
  );

  const job = jobResult.rows[0];

  const response = await request(app)
    .get(`/api/jobs/${job.id}`);

  expect(response.status).toBe(200);

  expect(response.body.data.id)
    .toBe(job.id);
});

    it("returns 404 for unknown job", async () => {
  const response = await request(app)
    .get("/api/jobs/9999");

  expect(response.status).toBe(404);
});

    it("returns only pending jobs", async () => {
  const queueResult = await pool.query(
    `
    INSERT INTO queues(name)
    VALUES($1)
    RETURNING *
    `,
    ["emails"]
  );

  const queue = queueResult.rows[0];

  const completed = await pool.query(
    `
    INSERT INTO jobs(queue_id,payload,status)
    VALUES($1,$2,'completed')
    `,
    [queue.id, {}]
  );

  await pool.query(
    `
    INSERT INTO jobs(queue_id,payload,status)
    VALUES($1,$2,'pending')
    `,
    [queue.id, {}]
  );

  const response = await request(app)
    .get("/api/jobs?status=pending");

  expect(response.status).toBe(200);

  expect(response.body.data.length)
    .toBe(1);

  expect(response.body.data[0].status)
    .toBe("pending");
});

});