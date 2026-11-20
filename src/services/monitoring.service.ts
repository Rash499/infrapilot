import { and, asc, desc, eq, gte, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { db } from "@/db";
import { assets, monitoringResults, monitoringTargets } from "@/db/schema";
import type { AuthUser } from "@/lib/auth";
import { errors, paginationMeta } from "@/lib/http";
import { DestinationError, assertSafeDestination, parseMonitorUrl, validatePort } from "@/lib/ssrf";
import { recordAudit } from "@/services/audit.service";
import { iso, likeTerm, pageOffset } from "@/services/common";
import type { monitorCreateSchema, monitorListQuery, monitorUpdateSchema } from "@/validators/schemas";

type TargetRow = typeof monitoringTargets.$inferSelect;
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
  const [row] = await db.select({ id: assets.id }).from(assets).where(eq(assets.id, assetId)).limit(1);
  if (!row) throw errors.unprocessable("The selected asset does not exist");
}

interface UptimeAgg {
  total: number;
  ok: number;
  avgMs: number | null;
}

async function uptimeFor(targetIds: string[], since: Date): Promise<Map<string, UptimeAgg>> {
  const map = new Map<string, UptimeAgg>();
  if (targetIds.length === 0) return map;
  const rows = await db
    .select({
      targetId: monitoringResults.targetId,
      total: sql<number>`count(*)::int`,
      ok: sql<number>`(count(*) filter (where ${monitoringResults.success}))::int`,
      avgMs: sql<number | null>`avg(${monitoringResults.responseTimeMs})::float`,
    })
    .from(monitoringResults)
    .where(and(inArray(monitoringResults.targetId, targetIds), gte(monitoringResults.checkedAt, since)))
    .groupBy(monitoringResults.targetId);
  for (const r of rows) map.set(r.targetId, { total: r.total, ok: r.ok, avgMs: r.avgMs });
  return map;
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
  const conditions: SQL[] = [];
  if (q.search) {
    const pattern = likeTerm(q.search);
    conditions.push(or(ilike(monitoringTargets.name, pattern), ilike(monitoringTargets.host, pattern), ilike(monitoringTargets.url, pattern))!);
  }
  if (q.state) conditions.push(eq(monitoringTargets.status, q.state));
  if (q.monitorType) conditions.push(eq(monitoringTargets.monitorType, q.monitorType));
  const where = conditions.length ? and(...conditions) : undefined;

  const sortColumn = {
    name: monitoringTargets.name,
    status: monitoringTargets.status,
    lastCheckedAt: monitoringTargets.lastCheckedAt,
    intervalSeconds: monitoringTargets.intervalSeconds,
  }[q.sort];
  const order = q.order === "asc" ? asc(sortColumn) : desc(sortColumn);

  const rows = await db
    .select({ target: monitoringTargets, assetName: assets.name })
    .from(monitoringTargets)
    .leftJoin(assets, eq(monitoringTargets.assetId, assets.id))
    .where(where)
    .orderBy(order)
    .limit(q.pageSize)
    .offset(pageOffset(q.page, q.pageSize));
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(monitoringTargets)
    .where(where);
  const uptime = await uptimeFor(
    rows.map((r) => r.target.id),
    new Date(Date.now() - 24 * HOUR),
  );
  return {
    items: rows.map((r) => toDto(r.target, r.assetName ?? null, pct(uptime.get(r.target.id)))),
    pagination: paginationMeta(q.page, q.pageSize, total),
  };
}

async function loadTarget(id: string) {
  const [row] = await db
    .select({ target: monitoringTargets, assetName: assets.name })
    .from(monitoringTargets)
    .leftJoin(assets, eq(monitoringTargets.assetId, assets.id))
    .where(eq(monitoringTargets.id, id))
    .limit(1);
  if (!row) throw errors.notFound("Monitoring target");
  return row;
}

export async function getTarget(id: string) {
  const { target, assetName } = await loadTarget(id);
  const now = Date.now();
  const [u24, u7, u30] = await Promise.all([
    uptimeFor([id], new Date(now - rangeMs["24h"])),
    uptimeFor([id], new Date(now - rangeMs["7d"])),
    uptimeFor([id], new Date(now - rangeMs["30d"])),
  ]);
  const recent = await db
    .select()
    .from(monitoringResults)
    .where(eq(monitoringResults.targetId, id))
    .orderBy(desc(monitoringResults.checkedAt))
    .limit(30);
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
  const [row] = await db
    .insert(monitoringTargets)
    .values({
      name: input.name,
      monitorType: input.monitorType,
      url: config.url,
      host: config.host,
      port: config.port,
      expectedStatusCode: input.expectedStatusCode ?? null,
      intervalSeconds: input.intervalSeconds,
      timeoutMs: input.timeoutMs,
      degradedThresholdMs: input.degradedThresholdMs,
      enabled: input.enabled,
      allowPrivateNetwork: input.allowPrivateNetwork,
      assetId: input.assetId,
      createdById: actor.id,
    })
    .returning();
  if (!row) throw errors.badRequest("Monitoring target could not be created");
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

  const [row] = await db
    .update(monitoringTargets)
    .set({
      name: input.name ?? existing.name,
      monitorType,
      url: config.url,
      host: config.host,
      port: config.port,
      expectedStatusCode: input.expectedStatusCode !== undefined ? input.expectedStatusCode ?? null : existing.expectedStatusCode,
      intervalSeconds: input.intervalSeconds ?? existing.intervalSeconds,
      timeoutMs: input.timeoutMs ?? existing.timeoutMs,
      degradedThresholdMs: input.degradedThresholdMs ?? existing.degradedThresholdMs,
      enabled: input.enabled ?? existing.enabled,
      allowPrivateNetwork,
      assetId: input.assetId !== undefined ? input.assetId : existing.assetId,
      nextCheckAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(monitoringTargets.id, id))
    .returning();
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
  const [row] = await db.delete(monitoringTargets).where(eq(monitoringTargets.id, id)).returning({ name: monitoringTargets.name });
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
  await db.update(monitoringTargets).set({ nextCheckAt: now }).where(eq(monitoringTargets.id, id));
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
  const where = and(eq(monitoringResults.targetId, targetId), gte(monitoringResults.checkedAt, since));
  const rows = await db
    .select()
    .from(monitoringResults)
    .where(where)
    .orderBy(desc(monitoringResults.checkedAt))
    .limit(q.pageSize)
    .offset(pageOffset(q.page, q.pageSize));
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(monitoringResults).where(where);
  return {
    items: rows.map((r) => ({
      id: r.id,
      checkedAt: r.checkedAt.toISOString(),
      success: r.success,
      state: r.state,
      responseTimeMs: r.responseTimeMs,
      statusCode: r.statusCode,
      errorMessage: r.errorMessage,
    })),
    pagination: paginationMeta(q.page, q.pageSize, total),
  };
}

export async function monitoringOverview() {
  const counts = await db
    .select({ status: monitoringTargets.status, enabled: monitoringTargets.enabled, total: sql<number>`count(*)::int` })
    .from(monitoringTargets)
    .groupBy(monitoringTargets.status, monitoringTargets.enabled);

  const summary = { total: 0, healthy: 0, degraded: 0, unavailable: 0, unknown: 0, paused: 0 };
  for (const c of counts) {
    summary.total += c.total;
    if (!c.enabled) {
      summary.paused += c.total;
      continue;
    }
    summary[c.status] += c.total;
  }

  const since24 = new Date(Date.now() - 24 * HOUR);
  const globalAgg = await db
    .select({
      total: sql<number>`count(*)::int`,
      ok: sql<number>`(count(*) filter (where ${monitoringResults.success}))::int`,
      avgMs: sql<number | null>`avg(${monitoringResults.responseTimeMs})::float`,
    })
    .from(monitoringResults)
    .where(gte(monitoringResults.checkedAt, since24));
  const agg = globalAgg[0];

  const rows = await db
    .select({ target: monitoringTargets, assetName: assets.name })
    .from(monitoringTargets)
    .leftJoin(assets, eq(monitoringTargets.assetId, assets.id))
    .orderBy(
      sql`case ${monitoringTargets.status} when 'unavailable' then 0 when 'degraded' then 1 when 'unknown' then 2 else 3 end`,
      asc(monitoringTargets.name),
    )
    .limit(200);
  const uptime = await uptimeFor(
    rows.map((r) => r.target.id),
    since24,
  );

  return {
    summary,
    uptime24hPct: agg && agg.total > 0 ? Math.round((agg.ok / agg.total) * 10000) / 100 : null,
    avgResponse24hMs: agg?.avgMs ? Math.round(agg.avgMs) : null,
    checks24h: agg?.total ?? 0,
    services: rows.map((r) => toDto(r.target, r.assetName ?? null, pct(uptime.get(r.target.id)))),
  };
}
