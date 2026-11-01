import {pool} from "../../db";
import {
  insertJob,
  findJobById,
  listJobs,
} from "../../repositories/jobsRepository";
import { truncateTables } from "../helpers/truncate";
import {
  beforeAll,
  beforeEach,
  afterAll,
  it,
  expect,
  describe,
} from "@jest/globals";
import { closeRedis } from "../../events/redis";



describe("Jobs Repository", () => {
  beforeEach(async () => {
    await truncateTables();
  });

  afterAll(async () => {
    await pool.end();
    await closeRedis();
  });

  it("findJobById returns null", async () => {
    const job = await findJobById(999);

    expect(job).toBeNull();
  });

  it("insertJob persists pending job", async () => {
    const queueResult = await pool.query(
      `
      INSERT INTO queues(name)
      VALUES($1)
      RETURNING *
      `,
      ["emails"]
    );

    const queue = queueResult.rows[0];

    const created = await insertJob({
      queueId: queue.id,
      payload: {
        email: "abc@test.com",
      },
    });

    const fetched = await findJobById(created.id);

    expect(fetched).not.toBeNull();

    expect(fetched?.status).toBe("pending");
  });

  it("listJobs filters status", async () => {
    const queueResult = await pool.query(
      `
      INSERT INTO queues(name)
      VALUES($1)
      RETURNING *
      `,
      ["emails"]
    );

    const queue = queueResult.rows[0];

    const completed = await insertJob({
      queueId: queue.id,
      payload: {},
    });

    await pool.query(
      `
      UPDATE jobs
      SET status='completed'
      WHERE id=$1
      `,
      [completed.id]
    );

    await insertJob({
      queueId: queue.id,
      payload: {},
    });

    const jobs = await listJobs({
      status: "pending",
      limit: 10,
    });


    expect(jobs).toHaveLength(1);

    const firstJob = jobs[0]!;
    expect(firstJob.status).toBe("pending");  });

  it("listJobs respects limit", async () => {
    const queueResult = await pool.query(
      `
      INSERT INTO queues(name)
      VALUES($1)
      RETURNING *
      `,
      ["emails"]
    );

    const queue = queueResult.rows[0];

    for (let i = 0; i < 5; i++) {
      await insertJob({
        queueId: queue.id,
        payload: {},
      });
    }

    const jobs = await listJobs({
      limit: 2,
    });

    expect(jobs.length).toBe(2);
  });
});