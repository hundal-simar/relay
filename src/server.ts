import http from "http";
import  app  from "./app";
import { attachRealtime } from "./realtime/socket";
import { redis } from "./events/redis";
import { pool } from "./db";
import { startWorker } from "./worker";


const PORT = Number(process.env.PORT) || 3000;

const httpServer = http.createServer(app);
const realtime = attachRealtime(httpServer);
const embeddedWorker = process.env.EMBED_WORKER === "true" ? startWorker() : null;


httpServer.listen(PORT, () => console.log(`API + WebSocket listening on ${PORT}`));

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[api] received ${signal}, shutting down...`);

  const forceExit = setTimeout(() => process.exit(1), 8000);
  forceExit.unref();

  await embeddedWorker?.stop();
  await realtime.close();
  await redis.quit();
  await pool.end();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));