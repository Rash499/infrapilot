import { and, asc, desc, eq, gte, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { collections, getCollection } from "@/db/collections";
import type {
  AssetDoc,
  ChangeRequestDoc,
  IncidentDoc,
  MaintenanceDoc,
  MonitoringResultDoc,
  MonitoringTargetDoc,
  SecurityFindingDoc,
} from "@/db/models/documents";
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
import { incidentReference } from "@/services/incidents.service";
import { findAssetNamesByIds } from "@/db/repositories/assets.repository";
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
const incidentSeverityRank = sql`case ${incidents.severity} when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`;
const findingSeverityRank = sql`case ${securityFindings.severity} when 'critical' then 0 when 'high' then 1 else 2 end`;

async function getAssetNameMap(ids: string[]): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (uniqueIds.length === 0) return new Map();
  const rows = process.env.MONGODB_URI
    ? await findAssetNamesByIds(uniqueIds)
    : await db.select({ id: assets.id, name: assets.name }).from(assets).where(inArray(assets.id, uniqueIds));
  return new Map(rows.map((row) => [row.id, row.name]));
}

async function getMongoDashboard(days: 1 | 7 | 30 | 90, now: Date, since: Date, unit: "hour" | "day") {
  const assetCol = await getCollection<AssetDoc>(collections.assets);
  const targetCol = await getCollection<MonitoringTargetDoc>(collections.monitoringTargets);
  const incidentCol = await getCollection<IncidentDoc>(collections.incidents);
  const findingCol = await getCollection<SecurityFindingDoc>(collections.securityFindings);
  const maintenanceCol = await getCollection<MaintenanceDoc>(collections.maintenances);
  const changeCol = await getCollection<ChangeRequestDoc>(collections.changeRequests);
  const resultCol = await getCollection<MonitoringResultDoc>(collections.monitoringResults);
  const maintenanceUntil = new Date(now.getTime() + 14 * DAY_MS);

  const [
    assetStatusRows,
    typeRows,
    serviceRows,
    attentionServiceRows,
    overdueServiceRows,
    openIncidents,
    recentIncidentRows,
    incidentSeverityRows,
    findingRows,
    criticalFindings,
    criticalFindingRows,
    maintenanceRows,
    maintenanceCount,
    changeRows,
    trendRows,
  ] = await Promise.all([
    assetCol.aggregate<{ _id: string; count: number }>([
      { $match: { archivedAt: null } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]).toArray(),
    assetCol.aggregate<{ _id: string; count: number }>([
      { $match: { archivedAt: null } },
      { $group: { _id: "$assetType", count: { $sum: 1 } } },
    ]).toArray(),
    targetCol.aggregate<{ _id: string; count: number }>([
      { $match: { enabled: true } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]).toArray(),
    targetCol.aggregate<MonitoringTargetDoc>([
      { $match: { enabled: true, status: { $in: ["unavailable", "degraded"] } } },
      {
        $addFields: {
          statusPriority: { $cond: [{ $eq: ["$status", "unavailable"] }, 0, 1] },
        },
      },
      { $sort: { statusPriority: 1, updatedAt: -1 } },
      { $limit: 6 },
      { $project: { statusPriority: 0 } },
    ]).toArray(),
    targetCol.aggregate<MonitoringTargetDoc>([
      {
        $match: {
          enabled: true,
          status: { $in: ["healthy", "unknown"] },
          $expr: {
            $lt: [
              "$nextCheckAt",
              { $subtract: [now, { $multiply: ["$intervalSeconds", 2000] }] },
            ],
          },
        },
      },
      { $sort: { nextCheckAt: 1 } },
      { $limit: 6 },
    ]).toArray(),
    incidentCol.countDocuments({ status: { $nin: ["resolved", "closed"] } }),
    incidentCol.find({ status: { $nin: ["resolved", "closed"] } })
      .sort({ severity: 1, updatedAt: -1 })
      .limit(6)
      .toArray(),
    incidentCol.aggregate<{ _id: string; count: number }>([
      { $match: { openedAt: { $gte: since } } },
      { $group: { _id: "$severity", count: { $sum: 1 } } },
    ]).toArray(),
    findingCol.aggregate<{ _id: string; count: number }>([
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]).toArray(),
    findingCol.countDocuments({
      severity: { $in: ["critical", "high"] },
      status: { $in: ["open", "in_progress"] },
    }),
    findingCol.find({
      severity: { $in: ["critical", "high"] },
      status: { $in: ["open", "in_progress"] },
    }).sort({ severity: 1, updatedAt: -1 }).limit(6).toArray(),
    maintenanceCol.find({
      status: "scheduled",
      startsAt: { $gte: now, $lte: maintenanceUntil },
    }).sort({ startsAt: 1 }).limit(6).toArray(),
    maintenanceCol.countDocuments({
      status: "scheduled",
      startsAt: { $gte: now, $lte: maintenanceUntil },
    }),
    changeCol.find({ updatedAt: { $gte: since } }).sort({ updatedAt: -1 }).limit(8).toArray(),
    resultCol.aggregate<{ _id: Date; avgMs: number | null; total: number; ok: number }>([
      { $match: { checkedAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateTrunc: { date: "$checkedAt", unit } },
          avgMs: { $avg: "$responseTimeMs" },
          total: { $sum: 1 },
          ok: { $sum: { $cond: ["$success", 1, 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]).toArray(),
  ]);

  const count = (rows: Array<{ _id: string; count: number }>, key: string) =>
    rows.find((row) => row._id === key)?.count ?? 0;
  const assetStatus = (status: (typeof ASSET_STATUSES)[number]) => count(assetStatusRows, status);
  const serviceState = (status: (typeof SERVICE_STATES)[number]) => count(serviceRows, status);
  const names = await userNameMap(maintenanceRows.map((row) => row.ownerId));
  const changeNames = await userNameMap(changeRows.map((row) => row.requesterId));
  const incidentNames = await userNameMap(recentIncidentRows.map((row) => row.assigneeId));
  const findingAssetNames = await getAssetNameMap(criticalFindingRows.map((row) => row.assetId ?? ""));
  const attentionAssetNames = await getAssetNameMap(attentionServiceRows.map((row) => row.assetId ?? ""));
  const overdueAssetNames = await getAssetNameMap(overdueServiceRows.map((row) => row.assetId ?? ""));
  const completedChecks = trendRows.reduce((total, row) => total + row.total, 0);
  const successfulChecks = trendRows.reduce((total, row) => total + row.ok, 0);

  return {
    range: { days, from: since.toISOString(), to: now.toISOString() },
    kpis: {
      totalAssets: assetStatusRows.reduce((total, row) => total + row.count, 0),
      healthyAssets: assetStatus("healthy"),
      degradedAssets: assetStatus("degraded"),
      unavailableAssets: assetStatus("unavailable"),
      maintenanceAssets: assetStatus("maintenance"),
      unknownAssets: assetStatus("unknown"),
      monitoredServices: serviceRows.reduce((total, row) => total + row.count, 0),
      serviceHealthy: serviceState("healthy"),
      serviceDegraded: serviceState("degraded"),
      serviceUnavailable: serviceState("unavailable"),
      serviceUnknown: serviceState("unknown"),
      openIncidents,
      criticalHighOpenFindings: criticalFindings,
      upcomingMaintenance: maintenanceCount,
    },
    assetDistribution: ASSET_TYPES.map((type) => ({
      type,
      label: humanize(type),
      count: count(typeRows, type),
    })),
    incidentBySeverity: SEVERITIES.map((severity) => ({
      severity,
      count: count(incidentSeverityRows, severity),
    })),
    findingsByStatus: FINDING_STATUSES.map((status) => ({
      status,
      label: humanize(status),
      count: count(findingRows, status),
    })),
    monitoringSummary: {
      uptimePct: completedChecks > 0 ? Math.round((successfulChecks / completedChecks) * 10000) / 100 : null,
      checks: completedChecks,
    },
    responseTrend: trendRows.map((row) => ({
      ts: row._id.toISOString(),
      avgResponseMs: row.avgMs !== null ? Math.round(row.avgMs) : null,
      checks: row.total,
      uptimePct: row.total > 0 ? Math.round((row.ok / row.total) * 10000) / 100 : null,
    })),
    attentionServices: attentionServiceRows.map((row) => ({
      id: row.id,
      name: row.name,
      monitorType: row.monitorType,
      status: row.status,
      assetName: row.assetId ? attentionAssetNames.get(row.assetId) ?? null : null,
      lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
      lastError: row.lastError,
      consecutiveFailures: row.consecutiveFailures,
    })),
    overdueServices: overdueServiceRows.map((row) => ({
      id: row.id,
      name: row.name,
      monitorType: row.monitorType,
      status: row.status,
      assetName: row.assetId ? overdueAssetNames.get(row.assetId) ?? null : null,
      nextCheckAt: row.nextCheckAt.toISOString(),
      lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
      intervalSeconds: row.intervalSeconds,
    })),
    upcomingMaintenance: maintenanceRows.map((row) => ({
      id: row.id,
      title: row.title,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      ownerName: row.ownerId ? names.get(row.ownerId) ?? null : null,
    })),
    recentChanges: changeRows.map((row) => ({
      id: row.id,
      reference: changeReference(row.number),
      title: row.title,
      status: row.status,
      riskLevel: row.riskLevel,
      requesterName: row.requesterId ? changeNames.get(row.requesterId) ?? null : null,
      updatedAt: row.updatedAt.toISOString(),
    })),
    recentIncidents: recentIncidentRows.map((row) => ({
      id: row.id,
      reference: incidentReference(row.number),
      title: row.title,
      severity: row.severity,
      status: row.status,
      assigneeName: row.assigneeId ? incidentNames.get(row.assigneeId) ?? null : null,
      openedAt: row.openedAt.toISOString(),
    })),
    criticalFindings: criticalFindingRows.map((row) => ({
      id: row.id,
      title: row.title,
      severity: row.severity,
      status: row.status,
      assetName: row.assetId ? findingAssetNames.get(row.assetId) ?? null : null,
      cveId: row.cveId,
      updatedAt: row.updatedAt.toISOString(),
    })),
    generatedAt: now.toISOString(),
  };
}

/**
 * All dashboard figures are computed from the database on each request. Date filters apply to
 * time-based series (response times, incidents, changes). Asset, service, and finding snapshots are current-state.
 */
export async function getDashboard(days: 1 | 7 | 30 | 90) {
  const now = new Date();
  const since = new Date(now.getTime() - days * DAY_MS);
  const unit = days <= 1 ? "hour" : "day";
  if (process.env.MONGODB_URI) return getMongoDashboard(days, now, since, unit);

  const [
    assetStatusRows,
    typeRows,
    serviceRows,
    attentionServiceRows,
    overdueServiceRows,
    incidentOpen,
    recentIncidentRows,
    incidentSeverityRows,
    findingRows,
    findingCritical,
    criticalFindingRows,
    maintenanceRows,
    maintenanceCount,
    changeRows,
    trendRows,
  ] =
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
        .select({
          id: monitoringTargets.id,
          name: monitoringTargets.name,
          monitorType: monitoringTargets.monitorType,
          status: monitoringTargets.status,
          assetId: monitoringTargets.assetId,
          lastCheckedAt: monitoringTargets.lastCheckedAt,
          lastError: monitoringTargets.lastError,
          consecutiveFailures: monitoringTargets.consecutiveFailures,
        })
        .from(monitoringTargets)
        .where(
          and(
            eq(monitoringTargets.enabled, true),
            inArray(monitoringTargets.status, ["unavailable", "degraded"]),
          ),
        )
        .orderBy(
          sql`case ${monitoringTargets.status} when 'unavailable' then 0 when 'degraded' then 1 else 2 end`,
          desc(monitoringTargets.updatedAt),
        )
        .limit(6),
      db
        .select({
          id: monitoringTargets.id,
          name: monitoringTargets.name,
          monitorType: monitoringTargets.monitorType,
          status: monitoringTargets.status,
          assetId: monitoringTargets.assetId,
          nextCheckAt: monitoringTargets.nextCheckAt,
          lastCheckedAt: monitoringTargets.lastCheckedAt,
          intervalSeconds: monitoringTargets.intervalSeconds,
        })
        .from(monitoringTargets)
        .where(
          and(
            eq(monitoringTargets.enabled, true),
            inArray(monitoringTargets.status, ["healthy", "unknown"]),
            sql`${monitoringTargets.nextCheckAt} < ${now} - (${monitoringTargets.intervalSeconds} * interval '2 seconds')`,
          ),
        )
        .orderBy(asc(monitoringTargets.nextCheckAt))
        .limit(6),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(incidents)
        .where(notInArray(incidents.status, ["resolved", "closed"])),
      db
        .select({
          id: incidents.id,
          number: incidents.number,
          title: incidents.title,
          severity: incidents.severity,
          status: incidents.status,
          assigneeId: incidents.assigneeId,
          openedAt: incidents.openedAt,
        })
        .from(incidents)
        .where(notInArray(incidents.status, ["resolved", "closed"]))
        .orderBy(incidentSeverityRank, desc(incidents.updatedAt))
        .limit(6),
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
          id: securityFindings.id,
          title: securityFindings.title,
          severity: securityFindings.severity,
          status: securityFindings.status,
          assetId: securityFindings.assetId,
          cveId: securityFindings.cveId,
          updatedAt: securityFindings.updatedAt,
        })
        .from(securityFindings)
        .where(
          and(
            inArray(securityFindings.severity, ["critical", "high"]),
            inArray(securityFindings.status, ["open", "in_progress"]),
          ),
        )
        .orderBy(findingSeverityRank, desc(securityFindings.updatedAt))
        .limit(6),
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
  const incidentNames = await userNameMap(recentIncidentRows.map((row) => row.assigneeId));
  const findingAssetNames = await getAssetNameMap(criticalFindingRows.map((row) => row.assetId ?? ""));
  const attentionAssetNames = await getAssetNameMap(attentionServiceRows.map((row) => row.assetId ?? ""));
  const overdueAssetNames = await getAssetNameMap(overdueServiceRows.map((row) => row.assetId ?? ""));
  const completedChecks = trendRows.rows.reduce((total, row) => total + Number(row.total), 0);
  const successfulChecks = trendRows.rows.reduce((total, row) => total + Number(row.ok), 0);

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
    monitoringSummary: {
      uptimePct: completedChecks > 0 ? Math.round((successfulChecks / completedChecks) * 10000) / 100 : null,
      checks: completedChecks,
    },
    responseTrend: trendRows.rows.map((r) => ({
      ts: new Date(r.bucket).toISOString(),
      avgResponseMs: r.avg_ms !== null ? Math.round(Number(r.avg_ms)) : null,
      checks: r.total,
      uptimePct: r.total > 0 ? Math.round((r.ok / r.total) * 10000) / 100 : null,
    })),
    attentionServices: attentionServiceRows.map((row) => ({
      id: row.id,
      name: row.name,
      monitorType: row.monitorType,
      status: row.status,
      assetName: row.assetId ? attentionAssetNames.get(row.assetId) ?? null : null,
      lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
      lastError: row.lastError,
      consecutiveFailures: row.consecutiveFailures,
    })),
    overdueServices: overdueServiceRows.map((row) => ({
      id: row.id,
      name: row.name,
      monitorType: row.monitorType,
      status: row.status,
      assetName: row.assetId ? overdueAssetNames.get(row.assetId) ?? null : null,
      nextCheckAt: row.nextCheckAt.toISOString(),
      lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
      intervalSeconds: row.intervalSeconds,
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
    recentIncidents: recentIncidentRows.map((row) => ({
      id: row.id,
      reference: incidentReference(row.number),
      title: row.title,
      severity: row.severity,
      status: row.status,
      assigneeName: row.assigneeId ? incidentNames.get(row.assigneeId) ?? null : null,
      openedAt: row.openedAt.toISOString(),
    })),
    criticalFindings: criticalFindingRows.map((row) => ({
      id: row.id,
      title: row.title,
      severity: row.severity,
      status: row.status,
      assetName: row.assetId ? findingAssetNames.get(row.assetId) ?? null : null,
      cveId: row.cveId,
      updatedAt: row.updatedAt.toISOString(),
    })),
    generatedAt: now.toISOString(),
  };
}


