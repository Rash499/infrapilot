import { randomUUID } from "node:crypto";
import { collections, getCollection } from "@infrapilot/database";
import type { AssetDoc, MonitoringTargetDoc } from "@infrapilot/database";
import { recordWorkerTick, registerWorkerInstance, stopWorkerInstance } from "@infrapilot/database";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { sendMaintenanceReminders } from "@/services/maintenance.service";
import { notifyRoles, notifyUsers } from "@/services/notifications.service";
import { computeState, rollupAssetStatus, runProbe, type ServiceState } from "@infrapilot/server-core";
import {
  claimDueMonitoringTargets,
  pruneMonitoringResults,
  recordMonitoringCheck,
  findAssetByIdForMonitoring,
} from "@/db/repositories/monitoring.repository";

type TargetRow = MonitoringTargetDoc;

const HOUR_MS = 60 * 60 * 1000;
const globalForWorker = globalThis as typeof globalThis & { __infrapilotMonitorWorker?: boolean };
let ticking = false;
let lastPrune = 0;
let initialTick: ReturnType<typeof setTimeout> | undefined;
let tickInterval: ReturnType<typeof setInterval> | undefined;
let activeTick: Promise<{ claimed: number }> | undefined;
let stopping = false;
let workerInstanceId: string | null = null;

/**
 * The repository claims each due target atomically and advances its next-check time in MongoDB.
 */
export async function claimDueTargets(limit: number): Promise<TargetRow[]> {
  return claimDueMonitoringTargets(limit);
}

async function handleTransition(target: TargetRow, next: ServiceState): Promise<void> {
  if (next === target.status) return;
  // The monitoring console opens a check from the `target` query parameter; there is no /monitoring/[id] route.
  const link = `/monitoring?target=${target.id}`;
  let ownerId: string | null = null;
  if (target.assetId) {
    ownerId = (await findAssetByIdForMonitoring(target.assetId))?.ownerId ?? null;
  }
  if (next === "unavailable") {
    await notifyRoles(
      ["admin", "operator"],
      {
        type: "monitoring_unavailable",
        title: `Service unavailable: ${target.name}`,
        message: target.lastError
          ? `${target.name} is failing checks: ${target.lastError}`
          : `${target.name} failed consecutive checks`,
        link,
      },
      [ownerId],
    );
  } else if (target.status === "unavailable" && (next === "healthy" || next === "degraded")) {
    await notifyUsers([ownerId], {
      type: "monitoring_recovered",
      title: `Service recovered: ${target.name}`,
      message: `${target.name} is responding again`,
      link,
    });
    await notifyRoles(["admin", "operator"], {
      type: "monitoring_recovered",
      title: `Service recovered: ${target.name}`,
      message: `${target.name} is responding again`,
      link,
    });
  }
}

async function rollupAsset(assetId: string): Promise<void> {
  const asset = await findAssetByIdForMonitoring(assetId);
  if (!asset || asset.status === "maintenance") return;
  const targets = await getCollection<MonitoringTargetDoc>(collections.monitoringTargets);
  const states = await targets.find({ assetId, enabled: true }, { projection: { _id: 0, status: 1 } }).toArray();
  if (states.length === 0) return;
  const next = rollupAssetStatus(states.map((s) => s.status));
  if (next !== asset.status) {
    const assets = await getCollection<AssetDoc>(collections.assets);
    await assets.updateOne({ id: assetId }, { $set: { status: next, updatedAt: new Date() } });
  }
}

/** Runs one probe for a claimed target, stores the result, updates state, and emits notifications. */
export async function executeCheck(target: TargetRow): Promise<void> {
  const env = getEnv();
  const result = await runProbe({
    monitorType: target.monitorType,
    url: target.url,
    host: target.host,
    port: target.port,
    expectedStatusCode: target.expectedStatusCode,
    timeoutMs: target.timeoutMs,
    allowPrivateNetwork: target.allowPrivateNetwork,
  });
  const next = computeState(
    { status: target.status, consecutiveFailures: target.consecutiveFailures },
    result,
    { failureThreshold: env.MONITOR_FAILURE_THRESHOLD, degradedThresholdMs: target.degradedThresholdMs },
  );
  const now = new Date();
  await recordMonitoringCheck(
    target.id,
    {
      checkedAt: now,
      success: result.success,
      state: next.status,
      responseTimeMs: result.responseTimeMs,
      statusCode: result.statusCode,
      errorMessage: result.errorMessage,
    },
    {
      status: next.status,
      consecutiveFailures: next.consecutiveFailures,
      lastCheckedAt: now,
      lastResponseMs: result.responseTimeMs,
      lastError: result.errorMessage,
    },
  );
  await handleTransition(target, next.status);
  if (target.assetId) await rollupAsset(target.assetId);
}

async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor]!;
      cursor += 1;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

async function pruneResults(): Promise<void> {
  const cutoff = new Date(Date.now() - getEnv().MONITOR_RETENTION_DAYS * 24 * HOUR_MS);
  await pruneMonitoringResults(cutoff);
}

/** One scheduler pass. Re-entrant calls are skipped so a slow pass never overlaps the next one. */
export async function runMonitorTick(): Promise<{ claimed: number; error?: string }> {
  if (ticking) return { claimed: 0 };
  ticking = true;
  try {
    const env = getEnv();
    const targets = await claimDueTargets(env.MONITOR_BATCH_SIZE);
    await runWithConcurrency(targets, env.MONITOR_MAX_CONCURRENCY, async (target) => {
      try {
        await executeCheck(target);
      } catch (err) {
        logger.error("monitor_check_failed", {
          targetId: target.id,
          error: err instanceof Error ? err.message : "unknown",
        });
      }
    });
    await sendMaintenanceReminders();
    if (Date.now() - lastPrune > HOUR_MS) {
      lastPrune = Date.now();
      await pruneResults();
    }
    return { claimed: targets.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    logger.error("monitor_tick_failed", { error: message });
    return { claimed: 0, error: message };
  } finally {
    ticking = false;
  }
}

/** Starts the independent periodic scheduler once per worker process. */
export async function startMonitorWorker(): Promise<void> {
  if (globalForWorker.__infrapilotMonitorWorker || stopping) return;
  workerInstanceId = randomUUID();
  await registerWorkerInstance(workerInstanceId);
  globalForWorker.__infrapilotMonitorWorker = true;
  const env = getEnv();
  logger.info("monitor_worker_started", {
    tickMs: env.MONITOR_TICK_MS,
    maxConcurrency: env.MONITOR_MAX_CONCURRENCY,
    batchSize: env.MONITOR_BATCH_SIZE,
  });
  const runScheduledTick = () => {
    if (stopping || activeTick) return;
    const id = workerInstanceId;
    if (!id) return;
    activeTick = runMonitorTick()
      .then(async (result) => {
        await recordWorkerTick(id, result);
        return result;
      })
      .catch((error: unknown) => {
        logger.error("monitor_worker_heartbeat_failed", {
          error: error instanceof Error ? error.message : "unknown",
        });
        return { claimed: 0 };
      })
      .finally(() => {
        activeTick = undefined;
      });
  };
  initialTick = setTimeout(runScheduledTick, 1000);
  tickInterval = setInterval(runScheduledTick, env.MONITOR_TICK_MS);
}

export async function stopMonitorWorker(): Promise<void> {
  stopping = true;
  if (initialTick) clearTimeout(initialTick);
  if (tickInterval) clearInterval(tickInterval);
  initialTick = undefined;
  tickInterval = undefined;
  await activeTick;
  const id = workerInstanceId;
  workerInstanceId = null;
  if (id) await stopWorkerInstance(id);
  globalForWorker.__infrapilotMonitorWorker = false;
}
