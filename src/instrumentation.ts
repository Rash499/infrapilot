export async function register(): Promise<void> {
  if (process.env.NODE_ENV !== "development" || process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.INFRAPILOT_EMBEDDED_WORKER !== "true") return;
  const { startMonitorWorker } = await import("@/workers/monitor.worker");
  startMonitorWorker();
}
