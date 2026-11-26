import { createServer } from "node:http";
import "@infrapilot/server-core/load-env";
import { closeMongo, ensureMongoIndexes, getWorkerHealth } from "@infrapilot/database";
import { logger } from "@infrapilot/server-core";
import { startMonitorWorker, stopMonitorWorker } from "./monitor.worker";

const healthHost = process.env.WORKER_HEALTH_HOST ?? "0.0.0.0";
const healthPort = Number(process.env.WORKER_HEALTH_PORT ?? 4010);
const healthServer = createServer((req, res) => {
  if (req.url === "/health/live") {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ status: "ok" }));
    return;
  }
  if (req.url !== "/health/ready") {
    res.writeHead(404).end();
    return;
  }
  void getWorkerHealth()
    .then((health) => {
      res.writeHead(health.status === "ok" ? 200 : 503, { "content-type": "application/json" });
      res.end(JSON.stringify(health));
    })
    .catch((error: unknown) => {
      logger.error("worker_readiness_failed", { error: error instanceof Error ? error.message : "unknown" });
      res.writeHead(503, { "content-type": "application/json" }).end(JSON.stringify({ status: "not_ready" }));
    });
});

async function start(): Promise<void> {
  await ensureMongoIndexes();
  await startMonitorWorker();
  try {
    await new Promise<void>((resolve, reject) => {
      healthServer.once("error", reject);
      healthServer.listen(healthPort, healthHost, () => {
        healthServer.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    await stopMonitorWorker();
    throw error;
  }
  logger.info("monitor_worker_ready", { pid: process.pid });
}

let shuttingDown = false;
const shutdown = (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("monitor_worker_shutdown", { signal });
  const closeHealthServer = healthServer.listening
    ? new Promise<void>((resolve, reject) => {
        healthServer.close((error) => (error ? reject(error) : resolve()));
      })
    : Promise.resolve();
  void closeHealthServer
    .then(() => stopMonitorWorker())
    .then(() => closeMongo())
    .then(() => {
      process.exitCode = 0;
    })
    .catch((error: unknown) => {
      logger.error("monitor_worker_shutdown_failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
      process.exitCode = 1;
    });
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

void start().catch((error: unknown) => {
  logger.error("monitor_worker_start_failed", {
    error: error instanceof Error ? error.message : "unknown",
  });
  process.exitCode = 1;
});
