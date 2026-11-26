import "../../../src/lib/load-env";
import { closeMongo } from "@infrapilot/database";
import { startMonitorWorker } from "../../../src/workers/monitor.worker";

startMonitorWorker();
console.log(JSON.stringify({ event: "monitor_worker_ready", pid: process.pid }));

let shuttingDown = false;
const shutdown = (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  void closeMongo().finally(() => process.exit(0));
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
