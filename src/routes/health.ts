import { Router } from "express";
import { pool } from "../db";
import { redis } from "../events/redis";
import { poolStats } from "../db";


export const healthRouter = Router();

healthRouter.get("/health", async (_req, res) => {
  const checks = { db: false, redis: false };

  try {
    await pool.query("SELECT 1");
    checks.db = true;
  } catch {
    /* leave false */
  }

  try {
    checks.redis = (await redis.ping()) === "PONG";
  } catch {
    /* leave false */
  }

  const ok = checks.db && checks.redis;
res.status(ok ? 200 : 503).json({ status: ok ? "ok" : "degraded", checks, pool: poolStats() });});