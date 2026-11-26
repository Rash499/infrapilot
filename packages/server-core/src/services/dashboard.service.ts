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
async function getAssetNameMap(ids: string[]): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (uniqueIds.length === 0) return new Map();
  const rows = await findAssetNamesByIds(uniqueIds);
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
    incidentCol.aggregate<IncidentDoc>([
      { $match: { status: { $nin: ["resolved", "closed"] } } },
      {
        $addFields: {
          severityOrder: {
            $switch: {
              branches: [
                { case: { $eq: ["$severity", "critical"] }, then: 0 },
                { case: { $eq: ["$severity", "high"] }, then: 1 },
                { case: { $eq: ["$severity", "medium"] }, then: 2 },
              ],
              default: 3,
            },
          },
        },
      },
      { $sort: { severityOrder: 1, updatedAt: -1 } },
      { $limit: 6 },
      { $project: { severityOrder: 0 } },
    ]).toArray(),
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
  return getMongoDashboard(days, now, since, unit);
}
