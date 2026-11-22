import { and, asc, eq, inArray, lt, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, monitoringResults, monitoringTargets } from "@/db/schema";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { sendMaintenanceReminders } from "@/services/maintenance.service";
import { notifyRoles, notifyUsers } from "@/services/notifications.service";
import { computeState, rollupAssetStatus, runProbe, type ServiceState } from "@/workers/probe";
import {
  claimDueMonitoringTargets,
  pruneMonitoringResults,
  recordMonitoringCheck,
  findAssetByIdForMonitoring,
} from "@/db/repositories/monitoring.repository";

type TargetRow = typeof monitoringTargets.$inferSelect;

const HOUR_MS = 60 * 60 * 1000;
const globalForWorker = globalThis as typeof globalThis & { __infrapilotMonitorWorker?: boolean };
let ticking = false;
let lastPrune = 0;

/**
 * Atomically claims due targets. `FOR UPDATE SKIP LOCKED` lets several worker processes run safely:
 * each target is claimed once per interval and pushed into the future before its probe starts.
 */
export async function claimDueTargets(limit: number): Promise<TargetRow[]> {
  if (process.env.MONGODB_URI) {
    const targets = await claimDueMonitoringTargets(limit);
    return targets as unknown as TargetRow[];
  }
  return db.transaction(async (tx) => {
    const due = await tx
      .select({ id: monitoringTargets.id })
      .from(monitoringTargets)
      .where(and(eq(monitoringTargets.enabled, true), lte(monitoringTargets.nextCheckAt, new Date())))
      .orderBy(asc(monitoringTargets.nextCheckAt))
      .limit(limit)
      .for("update", { skipLocked: true });
    if (due.length === 0) return [];
    return tx
      .update(monitoringTargets)
      .set({ nextCheckAt: sql`now() + (${monitoringTargets.intervalSeconds} * interval '1 second')` })
      .where(inArray(monitoringTargets.id, due.map((d) => d.id)))
      .returning();
  });
}

async function handleTransition(target: TargetRow, next: ServiceState): Promise<void> {
  if (next === target.status) return;
  // The monitoring console opens a check from the `target` query parameter; there is no /monitoring/[id] route.
  const link = `/monitoring?target=${target.id}`;
  let ownerId: string | null = null;
  if (target.assetId) {
    if (process.env.MONGODB_URI) {
      ownerId = (await findAssetByIdForMonitoring(target.assetId))?.ownerId ?? null;
    } else {
      const [asset] = await db.select({ ownerId: assets.ownerId }).from(assets).where(eq(assets.id, target.assetId)).limit(1);
      ownerId = asset?.ownerId ?? null;
    }
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
  if (process.env.MONGODB_URI) {
    const asset = await findAssetByIdForMonitoring(assetId);
    if (!asset || asset.status === "maintenance") return;
    const { getCollection } = await import("@/db/collections");
    const { collections } = await import("@/db/collections");
    type ImportedTarget = import("@/db/models/documents").MonitoringTargetDoc;
    const col = await getCollection<ImportedTarget>(collections.monitoringTargets);
    const states = await col.find({ assetId, enabled: true }, { projection: { _id: 0, status: 1 } }).toArray();
    if (states.length === 0) return;
    const next = rollupAssetStatus(states.map((state) => state.status));
    if (next !== asset.status) {
      await (await getCollection<import("@/db/models/documents").AssetDoc>(collections.assets)).updateOne(
        { id: assetId },
        { $set: { status: next, updatedAt: new Date() } },
      );
    }
    return;
  }
  const [asset] = await db.select({ status: assets.status }).from(assets).where(eq(assets.id, assetId)).limit(1);
  if (!asset || asset.status === "maintenance") return;
  const states = await db
    .select({ status: monitoringTargets.status })
    .from(monitoringTargets)
    .where(and(eq(monitoringTargets.assetId, assetId), eq(monitoringTargets.enabled, true)));
  if (states.length === 0) return;
  const next = rollupAssetStatus(states.map((s) => s.status));
  if (next !== asset.status) {
    await db.update(assets).set({ status: next, updatedAt: new Date() }).where(eq(assets.id, assetId));
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
  if (process.env.MONGODB_URI) {
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
  } else {
    await db.transaction(async (tx) => {
      await tx.insert(monitoringResults).values({
        targetId: target.id,
        checkedAt: now,
        success: result.success,
        state: next.status,
        responseTimeMs: result.responseTimeMs,
        statusCode: result.statusCode,
        errorMessage: result.errorMessage,
      });
      await tx
        .update(monitoringTargets)
        .set({
          status: next.status,
          consecutiveFailures: next.consecutiveFailures,
          lastCheckedAt: now,
          lastResponseMs: result.responseTimeMs,
          lastError: result.errorMessage,
          updatedAt: now,
        })
        .where(eq(monitoringTargets.id, target.id));
    });
  }
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
  if (process.env.MONGODB_URI) {
    await pruneMonitoringResults(cutoff);
    return;
  }
  await db.delete(monitoringResults).where(lt(monitoringResults.checkedAt, cutoff));
}

/** One scheduler pass. Re-entrant calls are skipped so a slow pass never overlaps the next one. */
export async function runMonitorTick(): Promise<{ claimed: number }> {
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
    logger.error("monitor_tick_failed", { error: err instanceof Error ? err.message : "unknown" });
    return { claimed: 0 };
  } finally {
    ticking = false;
  }
}

/** Starts the periodic scheduler once per process. Safe to call from instrumentation and the standalone worker. */
export function startMonitorWorker(): void {
  if (globalForWorker.__infrapilotMonitorWorker) return;
  globalForWorker.__infrapilotMonitorWorker = true;
  const env = getEnv();
  logger.info("monitor_worker_started", {
    tickMs: env.MONITOR_TICK_MS,
    maxConcurrency: env.MONITOR_MAX_CONCURRENCY,
    batchSize: env.MONITOR_BATCH_SIZE,
  });
  setTimeout(() => void runMonitorTick(), 1000);
  setInterval(() => void runMonitorTick(), env.MONITOR_TICK_MS);
}
