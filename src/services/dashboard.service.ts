import { and, desc, eq, gte, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  assets,
  changeRequests,
  incidents,
  maintenances,
  monitoringResults,
  monitoringTargets,
  securityFindings,
} from "@/db/schema";
import { changeReference } from "@/services/changes.service";
import { humanize, userNameMap } from "@/services/common";

const DAY_MS = 24 * 60 * 60 * 1000;
const ASSET_TYPES = [
  "physical_server",
  "virtual_machine",
  "network_device",
  "cloud_resource",
  "container",
  "database",
  "application",
  "other",
] as const;
const SERVICE_STATES = ["healthy", "degraded", "unavailable", "unknown"] as const;
const ASSET_STATUSES = ["healthy", "degraded", "unavailable", "maintenance", "unknown"] as const;
const SEVERITIES = ["critical", "high", "medium", "low"] as const;
const FINDING_STATUSES = ["open", "in_progress", "resolved", "accepted_risk"] as const;

/**
 * All dashboard figures are computed from the database on each request. Date filters apply to
 * time-based series (response times, incidents, changes). Asset, service, and finding snapshots are current-state.
 */
export async function getDashboard(days: 1 | 7 | 30 | 90) {
  const now = new Date();
  const since = new Date(now.getTime() - days * DAY_MS);
  const unit = days <= 1 ? "hour" : "day";

  const [assetStatusRows, typeRows, serviceRows, incidentOpen, incidentSeverityRows, findingRows, findingCritical, maintenanceRows, maintenanceCount, changeRows, trendRows] =
    await Promise.all([
      db
        .select({ status: assets.status, count: sql<number>`count(*)::int` })
        .from(assets)
        .where(isNull(assets.archivedAt))
        .groupBy(assets.status),
      db
        .select({ type: assets.assetType, count: sql<number>`count(*)::int` })
        .from(assets)
        .where(isNull(assets.archivedAt))
        .groupBy(assets.assetType),
      db
        .select({ status: monitoringTargets.status, count: sql<number>`count(*)::int` })
        .from(monitoringTargets)
        .where(eq(monitoringTargets.enabled, true))
        .groupBy(monitoringTargets.status),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(incidents)
        .where(notInArray(incidents.status, ["resolved", "closed"])),
      db
        .select({ severity: incidents.severity, count: sql<number>`count(*)::int` })
        .from(incidents)
        .where(gte(incidents.openedAt, since))
        .groupBy(incidents.severity),
      db
        .select({ status: securityFindings.status, count: sql<number>`count(*)::int` })
        .from(securityFindings)
        .groupBy(securityFindings.status),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(securityFindings)
        .where(
          and(
            inArray(securityFindings.severity, ["critical", "high"]),
            inArray(securityFindings.status, ["open", "in_progress"]),
          ),
        ),
      db
        .select({
          id: maintenances.id,
          title: maintenances.title,
          startsAt: maintenances.startsAt,
          endsAt: maintenances.endsAt,
          ownerId: maintenances.ownerId,
        })
        .from(maintenances)
        .where(
          and(
            eq(maintenances.status, "scheduled"),
            gte(maintenances.startsAt, now),
            sql`${maintenances.startsAt} <= ${new Date(now.getTime() + 14 * DAY_MS)}`,
          ),
        )
        .orderBy(maintenances.startsAt)
        .limit(6),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(maintenances)
        .where(
          and(
            eq(maintenances.status, "scheduled"),
            gte(maintenances.startsAt, now),
            sql`${maintenances.startsAt} <= ${new Date(now.getTime() + 14 * DAY_MS)}`,
          ),
        ),
      db
        .select()
        .from(changeRequests)
        .where(gte(changeRequests.updatedAt, since))
        .orderBy(desc(changeRequests.updatedAt))
        .limit(8),
      db.execute<{ bucket: Date; avg_ms: number | null; total: number; ok: number }>(sql`
        select date_trunc(${sql.raw(`'${unit}'`)}, checked_at) as bucket,
               avg(response_time_ms)::float as avg_ms,
               count(*)::int as total,
               (count(*) filter (where success))::int as ok
        from monitoring_results
        where checked_at >= ${since}
        group by 1
        order by 1
      `),
    ]);

  const assetStatus = (s: (typeof ASSET_STATUSES)[number]) => assetStatusRows.find((r) => r.status === s)?.count ?? 0;
  const totalAssets = assetStatusRows.reduce((acc, r) => acc + r.count, 0);
  const serviceState = (s: (typeof SERVICE_STATES)[number]) => serviceRows.find((r) => r.status === s)?.count ?? 0;
  const monitoredServices = serviceRows.reduce((acc, r) => acc + r.count, 0);

  const names = await userNameMap(maintenanceRows.map((m) => m.ownerId));
  const changeNames = await userNameMap(changeRows.map((c) => c.requesterId));

  return {
    range: { days, from: since.toISOString(), to: now.toISOString() },
    kpis: {
      totalAssets,
      healthyAssets: assetStatus("healthy"),
      degradedAssets: assetStatus("degraded"),
      unavailableAssets: assetStatus("unavailable"),
      maintenanceAssets: assetStatus("maintenance"),
      unknownAssets: assetStatus("unknown"),
      monitoredServices,
      serviceHealthy: serviceState("healthy"),
      serviceDegraded: serviceState("degraded"),
      serviceUnavailable: serviceState("unavailable"),
      serviceUnknown: serviceState("unknown"),
      openIncidents: incidentOpen[0]?.count ?? 0,
      criticalHighOpenFindings: findingCritical[0]?.count ?? 0,
      upcomingMaintenance: maintenanceCount[0]?.count ?? 0,
    },
    assetDistribution: ASSET_TYPES.map((t) => ({
      type: t,
      label: humanize(t),
      count: typeRows.find((r) => r.type === t)?.count ?? 0,
    })),
    incidentBySeverity: SEVERITIES.map((s) => ({
      severity: s,
      count: incidentSeverityRows.find((r) => r.severity === s)?.count ?? 0,
    })),
    findingsByStatus: FINDING_STATUSES.map((s) => ({
      status: s,
      label: humanize(s),
      count: findingRows.find((r) => r.status === s)?.count ?? 0,
    })),
    responseTrend: trendRows.rows.map((r) => ({
      ts: new Date(r.bucket).toISOString(),
      avgResponseMs: r.avg_ms !== null ? Math.round(Number(r.avg_ms)) : null,
      checks: r.total,
      uptimePct: r.total > 0 ? Math.round((r.ok / r.total) * 10000) / 100 : null,
    })),
    upcomingMaintenance: maintenanceRows.map((m) => ({
      id: m.id,
      title: m.title,
      startsAt: m.startsAt.toISOString(),
      endsAt: m.endsAt.toISOString(),
      ownerName: m.ownerId ? names.get(m.ownerId) ?? null : null,
    })),
    recentChanges: changeRows.map((c) => ({
      id: c.id,
      reference: changeReference(c.number),
      title: c.title,
      status: c.status,
      riskLevel: c.riskLevel,
      requesterName: c.requesterId ? changeNames.get(c.requesterId) ?? null : null,
      updatedAt: c.updatedAt.toISOString(),
    })),
    generatedAt: now.toISOString(),
  };
}


