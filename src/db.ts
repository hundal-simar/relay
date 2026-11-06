import { Pool, PoolConfig } from "pg";
import { config } from "./config";
import { logger } from "./logger";

const base: PoolConfig = {
  max: config.DB_POOL_MAX,
  idleTimeoutMillis: config.DB_POOL_IDLE_MS,
  connectionTimeoutMillis: config.DB_POOL_CONNECT_TIMEOUT_MS,
  query_timeout: config.DB_QUERY_TIMEOUT_MS, 
  keepAlive: true,
  application_name: config.SERVICE_NAME,
};

const poolConfig: PoolConfig = config.DATABASE_URL
  ? { ...base, connectionString: config.DATABASE_URL }
  : {
      ...base,
      host: config.DB_HOST,
      port: config.DB_PORT,
      user: config.DB_USER,
      password: config.DB_PASSWORD,
      database: config.DB_NAME,
    };

export const pool = new Pool(poolConfig);

pool.on("error", (err) => logger.error({ err }, "idle database client error"));

export function poolStats() {
  return { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount };
}

export async function waitForDatabase(maxAttempts = 8): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (err) {
      if (attempt >= maxAttempts) throw err;
      const delayMs = Math.min(500 * 2 ** (attempt - 1), 8000);
      logger.warn({ err: (err as Error).message, attempt, delayMs }, "database not ready, retrying");
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}