import Redis from "ioredis";
import dotenv from "dotenv";
import { JOB_EVENTS_CHANNEL, JobEvent } from "./types";

dotenv.config();

export const redis = new Redis({
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT) || 6379,
  enableOfflineQueue: false,
  retryStrategy: (times) =>
    process.env.NODE_ENV === "test" && times > 3 ? null : Math.min(times * 200, 2000),
});

redis.on("error", (err) => console.error("[redis] error (non-fatal):", err.message));

export function createSubscriber(): Redis {
  return redis.duplicate({ enableOfflineQueue: true });
}

export function publishJobEvent(event: Omit<JobEvent, "timestamp">): void {
  const full: JobEvent = { ...event, timestamp: new Date().toISOString() };
  redis
    .publish(JOB_EVENTS_CHANNEL, JSON.stringify(full))
    .catch((err) => console.error("[redis] publish failed (non-fatal):", err.message));
}

export async function closeRedis(): Promise<void> {
  if (redis.status === "ready") await redis.quit();
  else redis.disconnect(); // never connected: quit() would throw
}