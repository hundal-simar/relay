import { Router } from "express";
import { getMetrics } from "../repositories/metricsRepository";

export const metricsRouter = Router();

metricsRouter.get("/metrics", async (req, res, next) => {
  try {
    const requested = Number(req.query.windowSec);
    const windowSec = Number.isFinite(requested) && requested > 0
      ? Math.min(requested, 3600)
      : 300;
    res.json({ success: true, data: await getMetrics(windowSec) });
  } catch (err) {
    next(err);
  }
});