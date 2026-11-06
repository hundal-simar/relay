import dotenv from "dotenv";

dotenv.config({ quiet: true });

if (process.env.MIGRATE_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.MIGRATE_DATABASE_URL;
}