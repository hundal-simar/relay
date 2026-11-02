import { NextFunction, Request, Response } from "express";
import { timingSafeEqual } from "crypto";
import rateLimit from "express-rate-limit";

export function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.API_KEY;
  if (!expected || req.method === "GET" || req.method === "OPTIONS") return next();

  const given = req.header("x-api-key") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length === b.length && timingSafeEqual(a, b)) return next();

  res.status(401).json({ success: false, error: "Invalid or missing API key" });
}

export const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
});