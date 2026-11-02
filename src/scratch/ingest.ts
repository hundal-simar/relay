import autocannon from "autocannon";
import { pool } from "../db";

const API = process.env.API_URL ?? "http://localhost:3000/api";
const connections = Number(process.argv[2]) || 50;
const duration = Number(process.argv[3]) || 20;

async function main(): Promise<void> {
  await pool.query(
    "INSERT INTO queues (name) VALUES ('bench_noop') ON CONFLICT (name) DO NOTHING"
  );

  console.log(`Ingest: ${connections} connections for ${duration}s -> ${API}/jobs`);
  const r = await autocannon({
    url: `${API}/jobs`,
    method: "POST",
    connections,
    duration,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ queueName: "bench_noop", payload: { bench: true, ingest: true } }),
  });

  console.table({
    "requests/s (avg)": r.requests.average,
    "total requests": r.requests.total,
    "2xx": r["2xx"],
    "non-2xx": r.non2xx,
    errors: r.errors,
    "latency p50 (ms)": r.latency.p50,
    "latency p97.5 (ms)": r.latency.p97_5,
    "latency p99 (ms)": r.latency.p99,
  });
}

main().finally(() => pool.end());