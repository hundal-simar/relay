import { logger } from "./logger";

export function installCrashHandlers(): void {
  process.on("unhandledRejection", (reason) => {
    logger.fatal({ err: reason }, "unhandled promise rejection, exiting");
    process.exit(1);
  });
  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "uncaught exception, exiting");
    process.exit(1);
  });
}