import { pool } from "../db";

async function seed(queueId: number) {
  await pool.query(
    `
    INSERT INTO jobs (queue_id, payload)
    SELECT $1, jsonb_build_object('n', i)
    FROM generate_series(1, 5000) AS i
    `,
    [queueId]
  );

  console.log("Seeded 5000 jobs");

  await pool.end();
}

seed(1).catch(console.error);