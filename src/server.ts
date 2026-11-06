import http from "http";
import  app  from "./app";
import { attachRealtime } from "./realtime/socket";
import { redis } from "./events/redis";
import { pool } from "./db";
import { startWorker } from "./worker";
import { config, configWarnings } from "./config";
import { logger } from "./logger";
import { installCrashHandlers } from "./crash";

installCrashHandlers();
configWarnings.forEach((w) => logger.warn(w));

const PORT = config.PORT;

const httpServer = http.createServer(app);
const realtime = attachRealtime(httpServer);
const embeddedWorker = config.EMBED_WORKER ? startWorker() : null;


httpServer.listen(PORT, () =>
  logger.info({ port: PORT, env: config.NODE_ENV, embeddedWorker: !!embeddedWorker }, "API listening")
);

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down...");

  const forceExit = setTimeout(() =>{
    logger.error({ signal }, "Forcefully exiting") ;
    process.exit(1)}, 8000);
  forceExit.unref();

  await embeddedWorker?.stop();
  await realtime.close();
  await redis.quit();
  await pool.end();
  logger.info({ signal }, "shutdown complete, exiting");
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));