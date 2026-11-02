import { Pool, PoolConfig } from "pg";
import dotenv from "dotenv";
dotenv.config({ quiet: true });

const max = Number(process.env.DB_POOL_MAX) || 10;

const config: PoolConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL, max }
  : {
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      max,
    };

export const pool = new Pool(config);
pool.on("error", (err) => console.error("Unexpected pool error", err));