import { Router } from "express";
import { z } from "zod";
import { pool } from "../db";
import { AppError } from "../errors/AppError";
import { findQueueByName } from "../repositories/queuesRepository";
import { isValidSchedule, nextRun } from "../scheduler/cron";

export const schedulesRouter = Router();

const createSchema = z
  .object({
    name: z.string().min(1).max(100),
    queueName: z.string().min(1),
    payload: z.record(z.string(), z.unknown()).default({}),
    cron: z.string().min(1),
    timezone: z.string().default("UTC"),
  })
  .refine((v) => isValidSchedule(v.cron, v.timezone), {
    message: "Invalid cron expression or timezone",
    path: ["cron"],
  });

const SELECT_SCHEDULE = `
  SELECT s.id, s.name, q.name AS queue_name, s.payload, s.cron_expr, s.timezone,
         s.enabled, s.next_run_at, s.last_run_at
  FROM schedules s JOIN queues q ON q.id = s.queue_id`;

schedulesRouter.post("/schedules", async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.issues.map((i) => i.message).join(", "));
    }
    const { name, queueName, payload, cron, timezone } = parsed.data;

    const queue = await findQueueByName(queueName);
    if (!queue) throw new AppError(404, `Queue '${queueName}' does not exist`);

    try {
      const result = await pool.query(
        `INSERT INTO schedules (name, queue_id, payload, cron_expr, timezone, next_run_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [name, queue.id, JSON.stringify(payload), cron, timezone, nextRun(cron, timezone)]
      );
      const row = await pool.query(`${SELECT_SCHEDULE} WHERE s.id = $1`, [result.rows[0].id]);
      res.status(201).json({ success: true, data: row.rows[0] });
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        throw new AppError(409, `Schedule '${name}' already exists`);
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

schedulesRouter.get("/schedules", async (_req, res, next) => {
  try {
    const result = await pool.query(`${SELECT_SCHEDULE} ORDER BY s.id`);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
});

const patchSchema = z.object({ enabled: z.boolean() });

schedulesRouter.patch("/schedules/:id", async (req, res, next) => {
  try {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "Body must be { enabled: boolean }");
    const id = Number(req.params.id);

    const current = await pool.query<{ cron_expr: string; timezone: string }>(
      "SELECT cron_expr, timezone FROM schedules WHERE id = $1",
      [id]
    );
   const schedule = current.rows[0];

    if (!schedule) {
      throw new AppError(404, "Schedule not found");
    }

    const { cron_expr, timezone } = schedule;
    await pool.query(
      "UPDATE schedules SET enabled = $1, next_run_at = $2 WHERE id = $3",
      [parsed.data.enabled, nextRun(cron_expr, timezone), id]
    );
    const row = await pool.query(`${SELECT_SCHEDULE} WHERE s.id = $1`, [id]);
    res.json({ success: true, data: row.rows[0] });
  } catch (err) {
    next(err);
  }
});

schedulesRouter.delete("/schedules/:id", async (req, res, next) => {
  try {
    const result = await pool.query("DELETE FROM schedules WHERE id = $1", [Number(req.params.id)]);
    if (result.rowCount === 0) throw new AppError(404, "Schedule not found");
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});