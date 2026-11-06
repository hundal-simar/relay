
import pino from "pino";
import { config } from "./config";

export const logger = pino({
  level: config.LOG_LEVEL,

  base: { service: config.SERVICE_NAME },

  timestamp: pino.stdTimeFunctions.isoTime,

  ...(config.isDev
    ? {}
    : {
        formatters: {
          level: (label: string) => ({ level: label }),
        },
      }),

  redact: {
    paths: [
      "req.headers.authorization",
      'req.headers["x-api-key"]',
      "req.headers.cookie",
      "*.password",
      "*.apiKey",
      "*.connectionString",
      "*.DATABASE_URL",
      "*.REDIS_URL",
    ],
    censor: "[redacted]",
  },

  ...(config.isDev
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss",
            ignore: "pid,hostname,service",
          },
        },
      }
    : {}),
});

const lastLogged = new Map<string, number>();

export function warnThrottled(
  key: string,
  obj: object,
  msg: string,
  everyMs = 10_000
): void {
  const now = Date.now();

  if ((lastLogged.get(key) ?? 0) + everyMs > now) {
    return;
  }

  lastLogged.set(key, now);

  logger.warn(obj, msg);
}
