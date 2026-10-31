import { pool } from "../db";
import { takeToken, TokenResult } from "./tokenBucket";

interface Limit {
  ratePerSec: number;
  burst: number;
}

const REFRESH_MS = 5000;
let cache = new Map<number, Limit>();
let loadedAt = 0;

async function getLimit(queueId: number): Promise<Limit | undefined> {
  if (Date.now() - loadedAt > REFRESH_MS) {
    const r = await pool.query<{ id: number; rate_per_sec: number | null; burst: number | null }>(
      "SELECT id, rate_per_sec, burst FROM queues WHERE rate_per_sec IS NOT NULL"
    );
    cache = new Map(
      r.rows.map((row) => [
        row.id,
        { ratePerSec: row.rate_per_sec!, burst: row.burst ?? Math.max(1, Math.ceil(row.rate_per_sec!)) },
      ])
    );
    loadedAt = Date.now();
  }
  return cache.get(queueId);
}

export async function checkRateLimit(queueId: number): Promise<TokenResult> {
  try {
    const limit = await getLimit(queueId);
    if (!limit) return { allowed: true, retryAfterMs: 0 };
    return await takeToken(`relay:rl:queue:${queueId}`, limit.ratePerSec, limit.burst);
  } catch (err) {
    console.error("[ratelimit] check failed, allowing job (fail-open):", (err as Error).message);
    return { allowed: true, retryAfterMs: 0 };
  }
}