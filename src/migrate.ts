import { readdirSync, readFileSync } from "fs";
import { createHash } from "crypto";
import path from "path";
import { pool } from "./db";

const MIGRATIONS_DIR = path.join(__dirname, "..", "sql", "migrations");
const LOCK_ID = 727274; 

async function main(): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort();

  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_ID]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);

    const rows = await client.query<{ name: string; checksum: string }>(
      "SELECT name, checksum FROM schema_migrations"
    );
    const applied = new Map(rows.rows.map((r) => [r.name, r.checksum]));

    let count = 0;
    for (const file of files) {
      const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");

      const previous = applied.get(file);
      if (previous) {
        if (previous !== checksum) {
          throw new Error(`Migration ${file} was modified after it was applied`);
        }
        continue;
      }

      console.log(`[migrate] applying ${file}`);
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [
          file,
          checksum,
        ]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
      count++;
    }
    console.log(count ? `[migrate] applied ${count} migration(s)` : "[migrate] up to date");
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_ID]).catch(() => undefined);
    client.release();
  }
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error("[migrate] failed:", err);
    await pool.end();
    process.exit(1);
  });