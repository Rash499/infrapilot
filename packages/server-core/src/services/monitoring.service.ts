import type { z } from "zod";
import type { MonitoringTargetDoc } from "@/db/models/documents";
import {
  deleteMonitoringTargetById,
  findMonitoringTargetById,
  getMonitoringResultSummary,
  getMonitoringTargetCounts,
  getMonitoringTrend,
  getMonitoringUptime,
  getMonitoringWindowMetrics,
  insertMonitoringTarget,
  listMonitoringResults,
  listMonitoringTargets,
  listMonitoringTargetsForOverview,
  updateMonitoringTargetById,
} from "@/db/repositories/monitoring.repository";
import { findAssetById, findAssetNamesByIds } from "@/db/repositories/assets.repository";
import type { AuthUser } from "@/lib/auth";
import { errors, paginationMeta } from "@/lib/http";
import { DestinationError, assertSafeDestination, parseMonitorUrl, validatePort } from "@/lib/ssrf";
import { recordAudit } from "@/services/audit.service";
import { iso } from "@/services/common";
import type { monitorCreateSchema, monitorListQuery, monitorUpdateSchema } from "@/validators/schemas";

type TargetRow = MonitoringTargetDoc;
type CreateInput = z.infer<typeof monitorCreateSchema>;
type UpdateInput = z.infer<typeof monitorUpdateSchema>;
type ListQuery = z.infer<typeof monitorListQuery>;

const HOUR = 60 * 60 * 1000;
const rangeMs = { "1h": HOUR, "24h": 24 * HOUR, "7d": 7 * 24 * HOUR, "30d": 30 * 24 * HOUR } as const;

interface NormalizedConfig {
  url: string | null;
  host: string | null;
  port: number | null;
}

/** Validates the destination (syntax, scheme, and resolved network class) before a target is stored. */
async function normalizeConfig(cfg: {
  monitorType: "http" | "tcp";
  url?: string | null;
  host?: string | null;
  port?: number | null;
  allowPrivateNetwork: boolean;
}): Promise<NormalizedConfig> {
  try {
    if (cfg.monitorType === "http") {
      if (!cfg.url) throw new DestinationError("URL is required for HTTP checks");
      const url = parseMonitorUrl(cfg.url);
      await assertSafeDestination(url.hostname, cfg.allowPrivateNetwork);
      return { url: url.toString(), host: url.hostname, port: null };
    }
    if (!cfg.host || !cfg.port) throw new DestinationError("Host and port are required for TCP checks");
    validatePort(cfg.port);
    await assertSafeDestination(cfg.host, cfg.allowPrivateNetwork);
    return { url: null, host: cfg.host.toLowerCase(), port: cfg.port };
  } catch (err) {
    if (err instanceof DestinationError) throw errors.unprocessable(err.message);
    throw err;
  }
}

/** Only administrators may authorise monitoring of private or loopback networks. */
function assertPrivateOverride(actor: AuthUser, requested: boolean | undefined, current: boolean) {
  if (requested !== undefined && requested !== current && actor.role !== "admin") {
    throw errors.forbidden("Only administrators can authorise private network monitoring");
  }
}

async function assertAssetExists(assetId: string | null | undefined): Promise<void> {
  if (!assetId) return;
  if (!(await findAssetById(assetId))) throw errors.unprocessable("The selected asset does not exist");
}

interface UptimeAgg {
  total: number;
  ok: number;
  avgMs: number | null;
}

async function uptimeFor(targetIds: string[], since: Date): Promise<Map<string, UptimeAgg>> {
  return getMonitoringUptime(targetIds, since);
}

function pct(agg: UptimeAgg | undefined): number | null {
  if (!agg || agg.total === 0) return null;
  return Math.round((agg.ok / agg.total) * 10000) / 100;
}

function toDto(row: TargetRow, assetName: string | null, uptime24h: number | null) {
  return {
    id: row.id,
    name: row.name,
    monitorType: row.monitorType,
    url: row.url,
    host: row.host,
    port: row.port,
    expectedStatusCode: row.expectedStatusCode,
    intervalSeconds: row.intervalSeconds,
    timeoutMs: row.timeoutMs,
    degradedThresholdMs: row.degradedThresholdMs,
    failureThreshold: row.failureThreshold ?? 3,
    recoveryThreshold: row.recoveryThreshold ?? 2,
    warningThresholdMs: row.warningThresholdMs ?? row.degradedThresholdMs,
    criticalThresholdMs: row.criticalThresholdMs ?? 5000,
    autoIncidentEnabled: row.autoIncidentEnabled !== false,
    enabled: row.enabled,
    allowPrivateNetwork: row.allowPrivateNetwork,
    assetId: row.assetId,
    assetName,
    status: row.status,
    consecutiveFailures: row.consecutiveFailures,
    lastCheckedAt: iso(row.lastCheckedAt),
    nextCheckAt: iso(row.nextCheckAt),
    lastResponseMs: row.lastResponseMs,
    lastError: row.lastError,
    uptime24hPct: uptime24h,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listTargets(q: ListQuery) {
  const result = await listMonitoringTargets({
    page: q.page,
    pageSize: q.pageSize,
    search: q.search,
    status: q.state,
    monitorType: q.monitorType,
    sort: q.sort,
    order: q.order,
  });
  const [names, uptime] = await Promise.all([
    findAssetNamesByIds(result.items.map((row) => row.assetId).filter((id): id is string => !!id)),
    uptimeFor(result.items.map((row) => row.id), new Date(Date.now() - 24 * HOUR)),
  ]);
  const assetNames = new Map(names.map((asset) => [asset.id, asset.name]));
  return {
    items: result.items.map((row) => toDto(row, row.assetId ? assetNames.get(row.assetId) ?? null : null, pct(uptime.get(row.id)))),
    pagination: paginationMeta(q.page, q.pageSize, result.total),
  };
}

async function loadTarget(id: string) {
  const target = await findMonitoringTargetById(id);
  if (!target) throw errors.notFound("Monitoring target");
  const names = await findAssetNamesByIds(target.assetId ? [target.assetId] : []);
  return { target, assetName: names[0]?.name ?? null };
}

export async function getTarget(id: string) {
  const { target, assetName } = await loadTarget(id);
  const now = Date.now();
  const [u24, u7, u30] = await Promise.all([
    uptimeFor([id], new Date(now - rangeMs["24h"])),
    uptimeFor([id], new Date(now - rangeMs["7d"])),
    uptimeFor([id], new Date(now - rangeMs["30d"])),
  ]);
  const recent = (await listMonitoringResults(id, { since: new Date(0), page: 1, pageSize: 30 })).items;
  return {
    ...toDto(target, assetName ?? null, pct(u24.get(id))),
    stats: {
      uptime24hPct: pct(u24.get(id)),
      uptime7dPct: pct(u7.get(id)),
      uptime30dPct: pct(u30.get(id)),
      avgResponse24hMs: u24.get(id)?.avgMs ? Math.round(u24.get(id)!.avgMs!) : null,
      checks24h: u24.get(id)?.total ?? 0,
    },
    recentResults: recent.map((r) => ({
      id: r.id,
      checkedAt: r.checkedAt.toISOString(),
      success: r.success,
      state: r.state,
      responseTimeMs: r.responseTimeMs,
      statusCode: r.statusCode,
      errorMessage: r.errorMessage,
    })),
  };
}

export async function createTarget(actor: AuthUser, input: CreateInput, ip: string) {
  assertPrivateOverride(actor, input.allowPrivateNetwork, false);
  await assertAssetExists(input.assetId);
  const config = await normalizeConfig({ ...input, allowPrivateNetwork: input.allowPrivateNetwork });
  const row = await insertMonitoringTarget({
    name: input.name,
    monitorType: input.monitorType,
    url: config.url,
    host: config.host,
    port: config.port,
    expectedStatusCode: input.expectedStatusCode ?? null,
    intervalSeconds: input.intervalSeconds,
    timeoutMs: input.timeoutMs,
    degradedThresholdMs: input.degradedThresholdMs,
    failureThreshold: input.failureThreshold,
    recoveryThreshold: input.recoveryThreshold,
    warningThresholdMs: input.warningThresholdMs,
    criticalThresholdMs: input.criticalThresholdMs,
    autoIncidentEnabled: input.autoIncidentEnabled,
    enabled: input.enabled,
    allowPrivateNetwork: input.allowPrivateNetwork,
    assetId: input.assetId,
    createdById: actor.id,
  });
  await recordAudit({
    actorId: actor.id,
    action: "monitoring_target.created",
    entityType: "monitoring_target",
    entityId: row.id,
    summary: `Monitoring target "${row.name}" created (${row.monitorType})`,
    ip,
  });
  if (row.assetId) await recordAudit({
    actorId: actor.id,
    action: "asset.monitoring_linked",
    entityType: "asset",
    entityId: row.assetId,
    summary: `Monitoring target "${row.name}" linked to asset`,
    ip,
  });
  return getTarget(row.id);
}

export async function updateTarget(actor: AuthUser, id: string, input: UpdateInput, ip: string) {
  const { target: existing } = await loadTarget(id);
  assertPrivateOverride(actor, input.allowPrivateNetwork, existing.allowPrivateNetwork);
  if (input.assetId !== undefined) await assertAssetExists(input.assetId);

  const monitorType = input.monitorType ?? existing.monitorType;
  const allowPrivateNetwork = input.allowPrivateNetwork ?? existing.allowPrivateNetwork;
  const config = await normalizeConfig({
    monitorType,
    url: input.url ?? existing.url,
    host: input.host ?? existing.host,
    port: input.port ?? existing.port,
    allowPrivateNetwork,
  });

  const row = await updateMonitoringTargetById(id, {
    name: input.name ?? existing.name,
    monitorType,
    url: config.url,
    host: config.host,
    port: config.port,
    expectedStatusCode: input.expectedStatusCode !== undefined ? input.expectedStatusCode ?? null : existing.expectedStatusCode,
    intervalSeconds: input.intervalSeconds ?? existing.intervalSeconds,
    timeoutMs: input.timeoutMs ?? existing.timeoutMs,
    degradedThresholdMs: input.degradedThresholdMs ?? existing.degradedThresholdMs,
    failureThreshold: input.failureThreshold ?? existing.failureThreshold ?? 3,
    recoveryThreshold: input.recoveryThreshold ?? existing.recoveryThreshold ?? 2,
    warningThresholdMs: input.warningThresholdMs ?? existing.warningThresholdMs ?? existing.degradedThresholdMs,
    criticalThresholdMs: input.criticalThresholdMs ?? existing.criticalThresholdMs ?? 5000,
    autoIncidentEnabled: input.autoIncidentEnabled ?? existing.autoIncidentEnabled ?? true,
    enabled: input.enabled ?? existing.enabled,
    allowPrivateNetwork,
    assetId: input.assetId !== undefined ? input.assetId : existing.assetId,
    nextCheckAt: new Date(),
  });
  if (!row) throw errors.notFound("Monitoring target");
  await recordAudit({
    actorId: actor.id,
    action: "monitoring_target.updated",
    entityType: "monitoring_target",
    entityId: id,
    summary: `Monitoring target "${row.name}" updated`,
    ip,
  });
  return getTarget(id);
}

export async function deleteTarget(actor: AuthUser, id: string, ip: string): Promise<void> {
  const row = await deleteMonitoringTargetById(id);
  if (!row) throw errors.notFound("Monitoring target");
  await recordAudit({
    actorId: actor.id,
    action: "monitoring_target.deleted",
    entityType: "monitoring_target",
    entityId: id,
    summary: `Monitoring target "${row.name}" deleted`,
    ip,
  });
}

export async function queueCheck(actor: AuthUser, id: string, ip: string) {
  const { target } = await loadTarget(id);
  if (!target.enabled) throw errors.unprocessable("Enable this monitoring target before running a check");
  const now = new Date();
  const updated = await updateMonitoringTargetById(id, { nextCheckAt: now });
  if (!updated) throw errors.notFound("Monitoring target");
  await recordAudit({
    actorId: actor.id,
    action: "monitoring_target.check_queued",
    entityType: "monitoring_target",
    entityId: id,
    summary: `On-demand check queued for "${target.name}"`,
    ip,
  });
  return { queued: true, queuedAt: now.toISOString() };
}

export async function listResults(targetId: string, q: { page: number; pageSize: number; range: keyof typeof rangeMs }) {
  await loadTarget(targetId);
  const since = new Date(Date.now() - rangeMs[q.range]);
  const result = await listMonitoringResults(targetId, { since, page: q.page, pageSize: q.pageSize });
  return {
    items: result.items.map((row) => ({
      id: row.id,
      checkedAt: row.checkedAt.toISOString(),
      success: row.success,
      state: row.state,
      responseTimeMs: row.responseTimeMs,
      statusCode: row.statusCode,
      errorMessage: row.errorMessage,
    })),
    pagination: paginationMeta(q.page, q.pageSize, result.total),
  };
}

export async function monitoringOverview() {
  const counts = await getMonitoringTargetCounts();
  const summary = { total: 0, healthy: 0, degraded: 0, unavailable: 0, unknown: 0, paused: 0 };
  for (const row of counts) {
    summary.total += row.total;
    if (!row.enabled) {
      summary.paused += row.total;
      continue;
    }
    summary[row.status] += row.total;
  }
  const since24 = new Date(Date.now() - 24 * HOUR);
  const [agg, targets] = await Promise.all([
    getMonitoringResultSummary(since24),
    listMonitoringTargetsForOverview(200),
  ]);
  const [names, uptime] = await Promise.all([
    findAssetNamesByIds(targets.map((row) => row.assetId).filter((id): id is string => !!id)),
    uptimeFor(targets.map((row) => row.id), since24),
  ]);
  const assetNames = new Map(names.map((asset) => [asset.id, asset.name]));
  return {
    summary,
    uptime24hPct: agg.total > 0 ? Math.round((agg.ok / agg.total) * 10000) / 100 : null,
    avgResponse24hMs: agg.avgMs ? Math.round(agg.avgMs) : null,
    checks24h: agg.total,
    services: targets.map((row) => toDto(row, row.assetId ? assetNames.get(row.assetId) ?? null : null, pct(uptime.get(row.id)))),
  };
}

export type AnalyticsRange = "24h" | "7d" | "30d";
const ANALYTICS_MS: Record<AnalyticsRange, number> = {
  "24h": 24 * HOUR,
  "7d": 7 * 24 * HOUR,
  "30d": 30 * 24 * HOUR,
};

function uptimePct(ok: number, total: number): number | null {
  return total > 0 ? Math.round((ok / total) * 10000) / 100 : null;
}

/**
 * Fleet-wide monitoring analytics.
 *
 * Uptime for the three standard windows, latency distribution (average/min/max/p95/p99) and a trend
 * series are all computed by MongoDB from `monitoring_results`; nothing is estimated client-side.
 */
export async function monitoringAnalytics(range: AnalyticsRange) {
  const since = new Date(Date.now() - ANALYTICS_MS[range]);
  const windows = await Promise.all([
    getMonitoringWindowMetrics({ since: new Date(Date.now() - ANALYTICS_MS["24h"]) }),
    getMonitoringWindowMetrics({ since: new Date(Date.now() - ANALYTICS_MS["7d"]) }),
    getMonitoringWindowMetrics({ since: new Date(Date.now() - ANALYTICS_MS["30d"]) }),
  ]);
  const [current, trend, targets] = await Promise.all([
    getMonitoringWindowMetrics({ since }),
    getMonitoringTrend({ since, unit: range === "24h" ? "hour" : "day" }),
    listMonitoringTargetsForOverview(200),
  ]);

  const names = await findAssetNamesByIds(targets.map((row) => row.assetId).filter((id): id is string => !!id));
  const assetNames = new Map(names.map((row) => [row.id, row.name]));

  return {
    range,
    since: iso(since),
    uptime: {
      h24: uptimePct(windows[0].overall.ok, windows[0].overall.total),
      d7: uptimePct(windows[1].overall.ok, windows[1].overall.total),
      d30: uptimePct(windows[2].overall.ok, windows[2].overall.total),
    },
    totals: current.overall,
    uptimePct: uptimePct(current.overall.ok, current.overall.total),
    trend: trend.map((row) => ({
      ts: row.ts.toISOString(),
      total: row.total,
      ok: row.ok,
      avgMs: row.avgMs === null ? null : Math.round(row.avgMs),
      uptimePct: uptimePct(row.ok, row.total),
    })),
    targets: targets.map((row) => {
      const metrics = current.byTarget.get(row.id);
      return {
        id: row.id,
        name: row.name,
        status: row.status,
        monitorType: row.monitorType,
        assetName: row.assetId ? assetNames.get(row.assetId) ?? null : null,
        uptimePct: metrics ? uptimePct(metrics.ok, metrics.total) : null,
        total: metrics?.total ?? 0,
        failed: metrics?.failed ?? 0,
        avgMs: metrics?.avgMs === null || metrics?.avgMs === undefined ? null : Math.round(metrics.avgMs),
        maxMs: metrics?.maxMs ?? null,
        p95Ms: metrics?.p95Ms ?? null,
        p99Ms: metrics?.p99Ms ?? null,
      };
    }),
  };
}

/** Per-target analytics with the same real aggregates plus recent alert context. */
export async function targetAnalytics(id: string, range: AnalyticsRange) {
  const target = await findMonitoringTargetById(id);
  if (!target) throw errors.notFound("Monitoring target");
  const since = new Date(Date.now() - ANALYTICS_MS[range]);
  const [current, windows, trend] = await Promise.all([
    getMonitoringWindowMetrics({ since, targetIds: [id] }),
    Promise.all([
      getMonitoringWindowMetrics({ since: new Date(Date.now() - ANALYTICS_MS["24h"]), targetIds: [id] }),
      getMonitoringWindowMetrics({ since: new Date(Date.now() - ANALYTICS_MS["7d"]), targetIds: [id] }),
      getMonitoringWindowMetrics({ since: new Date(Date.now() - ANALYTICS_MS["30d"]), targetIds: [id] }),
    ]),
    getMonitoringTrend({ since, unit: range === "24h" ? "hour" : "day" }),
  ]);
  const assetNames = target.assetId ? await findAssetNamesByIds([target.assetId]) : [];
  const metrics = current.byTarget.get(id) ?? {
    total: 0,
    ok: 0,
    failed: 0,
    avgMs: null,
    minMs: null,
    maxMs: null,
    p95Ms: null,
    p99Ms: null,
  };
  return {
    range,
    since: iso(since),
    target: {
      id: target.id,
      name: target.name,
      status: target.status,
      monitorType: target.monitorType,
      assetId: target.assetId,
      assetName: assetNames[0]?.name ?? null,
      intervalSeconds: target.intervalSeconds,
      warningThresholdMs: target.warningThresholdMs ?? target.degradedThresholdMs,
      criticalThresholdMs: target.criticalThresholdMs ?? 5000,
      failureThreshold: target.failureThreshold ?? 3,
    },
    uptime: {
      h24: uptimePct(windows[0].overall.ok, windows[0].overall.total),
      d7: uptimePct(windows[1].overall.ok, windows[1].overall.total),
      d30: uptimePct(windows[2].overall.ok, windows[2].overall.total),
    },
    uptimePct: uptimePct(metrics.ok, metrics.total),
    totals: metrics,
    trend: trend.map((row) => ({
      ts: row.ts.toISOString(),
      total: row.total,
      ok: row.ok,
      avgMs: row.avgMs === null ? null : Math.round(row.avgMs),
      uptimePct: uptimePct(row.ok, row.total),
    })),
  };
}
