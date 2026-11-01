import { Router, Request, Response, NextFunction } from "express";
import { createJobSchema } from "../validators/job.validatot";
import {  insertJob, findJobById, listJobs, getStatusCounts } from "../repositories/jobsRepository";
import { findQueueByName } from "../repositories/queuesRepository";
import { AppError } from "../errors/AppError";
import { publishJobEvent } from "../events/redis";


const router = Router();

router.post("/jobs", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = createJobSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.issues.map(i => i.message).join(", "));
    }

    const queue = await findQueueByName(parsed.data.queueName);
    if (!queue) {
      throw new AppError(404, `Queue '${parsed.data.queueName}' does not exist`);
    }

    const job = await insertJob({
      queueId: queue.id,
      payload: parsed.data.payload,
      maxAttempts: parsed.data.maxAttempts,
      runAt: parsed.data.runAt ? new Date(parsed.data.runAt) : undefined,
    });

    publishJobEvent({
    type: "enqueued",
    jobId: Number(job.id),
    queue: queue.name,
    status: job.status,
    attempts: job.attempts,
  });

    res.status(201).json({ success: true, data: job });
  } catch (err) {
    next(err);
  }
});

router.get("/jobs", async (req, res, next) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const jobs = await listJobs({ ...(status !== undefined ? { status } : {}),
  limit });
    res.json({ success: true, data: jobs });
  } catch (err) {
    next(err);
  }
});

router.get("/jobs/:id", async (req, res, next) => {
  try {
    const job = await findJobById(Number(req.params.id));
    if (!job) throw new AppError(404, "Job not found");
    res.json({ success: true, data: job });
  } catch (err) {
    next(err);
  }
});

router.get("/jobs/counts", async (_req, res, next) => {
  try {
    res.json({ success: true, data: await getStatusCounts() });
  } catch (err) {
    next(err);
  }
});

export default router;
