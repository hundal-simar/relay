
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { pool } from "../db";
import { publishJobEvent } from "../events/redis";

export const demoRouter = Router();

const limiter = rateLimit({
  windowMs: 60_000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
});

demoRouter.post("/demo/enqueue", limiter, async (_req, res, next) => {
  try {
    // Check the number of pending jobs
    const pending = await pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM jobs WHERE status = 'pending'"
    );

    const pendingCount = Number(pending.rows[0]?.n ?? 0);

    // Reject request if the queue has too many pending jobs
    if (pendingCount > 200) {
      return res.status(429).json({
        success: false,
        error: "Queue is busy, try again shortly",
      });
    }

    // Insert a demo job into the emails queue
    const r = await pool.query<{ id: string }>(
      `INSERT INTO jobs (queue_id, payload)
       SELECT id, '{"demo":true}'::jsonb
       FROM queues
       WHERE name = 'emails'
       RETURNING id`
    );

    // Ensure the job was actually created
    const job = r.rows[0];

    if (!job) {
      return res.status(500).json({
        success: false,
        error: "Failed to create demo job. Emails queue may not exist.",
      });
    }

    // Publish job event to Redis
    publishJobEvent({
      type: "enqueued",
      jobId: Number(job.id),
      queue: "emails",
      status: "pending",
      attempts: 0,
    });

    // Return the created job ID
    return res.status(201).json({
      success: true,
      data: {
        id: job.id,
      },
    });
  } catch (err) {
    next(err);
  }
});
