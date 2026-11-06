import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ quiet: true });

const bool = z.enum(["true", "false"]).default("false").transform((v) => v === "true");
const int = (def: number, min: number) => z.coerce.number().int().min(min).default(def);

function isOrigin(value: string): boolean {
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
}

const postgresUrl = z.string().regex(/^postgres(ql)?:\/\//, "must start with postgres:// or postgresql://");

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: int(3000, 1),
    SERVICE_NAME: z.string().default("relay"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).optional(),
    STRICT_CONFIG: bool,

    DATABASE_URL: postgresUrl.optional(),
    MIGRATE_DATABASE_URL: postgresUrl.optional(),
    DB_HOST: z.string().optional(),
    DB_PORT: int(5432, 1),
    DB_NAME: z.string().optional(),
    DB_USER: z.string().optional(),
    DB_PASSWORD: z.string().optional(),
    DB_POOL_MAX: int(10, 1),
    DB_POOL_IDLE_MS: int(30_000, 1000),
    DB_POOL_CONNECT_TIMEOUT_MS: int(10_000, 1000),
    DB_QUERY_TIMEOUT_MS: int(30_000, 1000),

    REDIS_URL: z.string().regex(/^rediss?:\/\//, "must start with redis:// or rediss://").optional(),
    REDIS_HOST: z.string().default("localhost"),
    REDIS_PORT: int(6379, 1),

    DASHBOARD_ORIGIN: z
      .string()
      .default("http://localhost:5173")
      .refine(isOrigin, "must be an origin like https://app.example.com (no path, no trailing slash)"),
    API_KEY: z.string().min(16, "must be at least 16 characters").optional(),

    EMBED_WORKER: bool,
    ENABLE_BENCH_HANDLERS: bool,
    WORKER_CONCURRENCY: int(1, 1),
    POLL_INTERVAL_MS: int(1000, 10),
    HEARTBEAT_MS: int(10_000, 500),
    STALE_JOB_TIMEOUT_MS: int(60_000, 1000),
    REAPER_INTERVAL_MS: int(30_000, 1000),
    SCHEDULER_INTERVAL_MS: int(5000, 500),
  })
  .superRefine((v, ctx) => {
    const fail = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });

    if (!v.DATABASE_URL) {
      for (const key of ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"] as const) {
        if (!v[key]) fail(key, "required when DATABASE_URL is not set");
      }
    }

    if (v.STALE_JOB_TIMEOUT_MS < v.HEARTBEAT_MS * 3) {
      fail(
        "STALE_JOB_TIMEOUT_MS",
        "must be at least 3x HEARTBEAT_MS, or the reaper will steal jobs that are still running"
      );
    }

    if (v.NODE_ENV === "test") {
      if (v.DATABASE_URL) fail("DATABASE_URL", "must not be set when running tests");
      if (!/test/i.test(v.DB_NAME ?? "")) {
        fail("DB_NAME", "tests TRUNCATE tables, so the database name must contain 'test'");
      }
    }

    if (v.STRICT_CONFIG) {
      if (v.NODE_ENV !== "production") fail("NODE_ENV", "must be production when STRICT_CONFIG=true");
      if (!v.API_KEY) fail("API_KEY", "required when STRICT_CONFIG=true");
      if (/localhost|127\.0\.0\.1/.test(v.DASHBOARD_ORIGIN)) {
        fail("DASHBOARD_ORIGIN", "must not point at localhost when STRICT_CONFIG=true");
      }
      if (v.ENABLE_BENCH_HANDLERS) fail("ENABLE_BENCH_HANDLERS", "must be false when STRICT_CONFIG=true");
    }
  });

export class ConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid configuration:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "ConfigError";
  }
}

export function parseConfig(env: NodeJS.ProcessEnv) {
  const cleaned = Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined && value !== "")
  );

  const result = schema.safeParse(cleaned);
  if (!result.success) {
    
    throw new ConfigError(
      result.error.issues.map((i) => `${i.path.map(String).join(".") || "(config)"}: ${i.message}`)
    );
  }

  const v = result.data;
  const isProd = v.NODE_ENV === "production";
  const isTest = v.NODE_ENV === "test";

  const config = {
    ...v,
    isProd,
    isTest,
    isDev: !isProd && !isTest,
    LOG_LEVEL: v.LOG_LEVEL ?? (isTest ? "silent" : isProd ? "info" : "debug"),
  };

  const warnings: string[] = [];
  if (v.DB_POOL_MAX < v.WORKER_CONCURRENCY + 2) {
    warnings.push(
      `DB_POOL_MAX (${v.DB_POOL_MAX}) is below WORKER_CONCURRENCY + 2 (${v.WORKER_CONCURRENCY + 2}): jobs may wait for a free connection`
    );
  }

  return { config, warnings };
}

export type Config = ReturnType<typeof parseConfig>["config"];

function load() {
  try {
    return parseConfig(process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message); 
      process.exit(1);
    }
    throw err;
  }
}

const loaded = load();
export const config = loaded.config;
export const configWarnings = loaded.warnings;