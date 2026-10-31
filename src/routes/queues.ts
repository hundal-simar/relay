import { Router } from "express";
import { z } from "zod";
import { pool } from "../db";
import { AppError } from "../errors/AppError";

export const queuesRouter = Router();

queuesRouter.get("/queues", async (_req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT id, name, rate_per_sec AS "ratePerSec", burst FROM queues ORDER BY name`
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    next(err);
  }
});

const limitSchema = z.object({
  ratePerSec: z.number().positive().max(10000).nullable(), // null removes the limit
  burst: z.number().int().positive().max(100000).optional(),
});

queuesRouter.put("/queues/:name/rate-limit", async (req, res, next) => {
  try {
    const parsed = limitSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.issues.map((i) => i.message).join(", "));
    }
    const { ratePerSec, burst } = parsed.data;
    const effectiveBurst =
      ratePerSec === null ? null : burst ?? Math.max(1, Math.ceil(ratePerSec));

    const r = await pool.query(
      `UPDATE queues SET rate_per_sec = $1, burst = $2 WHERE name = $3
       RETURNING id, name, rate_per_sec AS "ratePerSec", burst`,
      [ratePerSec, effectiveBurst, req.params.name]
    );
    if (r.rowCount === 0) throw new AppError(404, `Queue '${req.params.name}' does not exist`);
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    next(err);
  }
});