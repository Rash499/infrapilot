import { pool } from "@/db";
import { logger } from "@/lib/logger";
import { startMonitorWorker } from "@/workers/monitor.worker";

/**
 * Standalone monitoring worker entry point (used by the `worker` service in docker-compose).
 * Run with: npx tsx src/workers/run.ts
 */
startMonitorWorker();
logger.info("monitor_worker_process_ready", { pid: process.pid });

function shutdown(signal: string) {
  logger.info("monitor_worker_shutdown", { signal });
  pool
    .end()
    .catch(() => undefined)
    .finally(() => process.exit(0));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
