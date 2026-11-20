/**
 * Next.js instrumentation hook. Starts the background monitoring scheduler inside the web process
 * unless INFRAPILOT_EMBEDDED_WORKER=false (production compose runs a dedicated worker container).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.INFRAPILOT_EMBEDDED_WORKER === "false") return;
  const { startMonitorWorker } = await import("@/workers/monitor.worker");
  startMonitorWorker();
}
