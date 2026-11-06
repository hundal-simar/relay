
import Redis from "ioredis";
import { config } from "../config";
import { warnThrottled } from "../logger";
import { JOB_EVENTS_CHANNEL, JobEvent } from "./types";

const options = {
  enableOfflineQueue: false,
  family: 0, // IPv4 and IPv6 (Railway-style private networks)
  retryStrategy: (times: number) =>
    config.isTest && times > 3 ? null : Math.min(times * 200, 2000),
};

export const redis = config.REDIS_URL
  ? new Redis(config.REDIS_URL, options)
  : new Redis({
      host: config.REDIS_HOST,
      port: config.REDIS_PORT,
      ...options,
    });

redis.on("error", (err: Error) =>
  warnThrottled(
    "redis-error",
    { err: err.message },
    "redis error (non-fatal)"
  )
);

export function createSubscriber(): Redis {
  return redis.duplicate({ enableOfflineQueue: true });
}

export function publishJobEvent(event: Omit<JobEvent, "timestamp">): void {
  const full: JobEvent = {
    ...event,
    timestamp: new Date().toISOString(),
  };

  redis
    .publish(JOB_EVENTS_CHANNEL, JSON.stringify(full))
    .catch((err: Error) =>
      warnThrottled(
        "redis-publish",
        { err: err.message },
        "event publish failed (non-fatal)"
      )
    );
}

export async function closeRedis(): Promise<void> {
  if (redis.status === "ready") {
    await redis.quit();
  } else {
    redis.disconnect();
  }
}
