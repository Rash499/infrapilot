import type { ClientSession, Filter } from "mongodb";
import { collections, getCollection, newEntityIds, withMongoTransaction } from "@/db/collections";
import type {
  AssetDoc,
  MonitoringResultDoc,
  MonitoringTargetDoc,
  ServiceState,
} from "@/db/models/documents";

export async function findAssetByIdForMonitoring(assetId: string): Promise<{ ownerId: string | null; status: AssetDoc["status"] } | null> {
  const col = await getCollection<AssetDoc>(collections.assets);
  const asset = await col.findOne({ id: assetId }, { projection: { _id: 0, ownerId: 1, status: 1 } });
  return asset ? { ownerId: asset.ownerId, status: asset.status } : null;
}

export async function claimDueMonitoringTargets(limit: number): Promise<MonitoringTargetDoc[]> {
  return withMongoTransaction(async (session) => {
    const col = await getCollection<MonitoringTargetDoc>(collections.monitoringTargets);
    const claimed: MonitoringTargetDoc[] = [];
    while (claimed.length < limit) {
      const now = new Date();
      const target = await col.findOneAndUpdate(
        { enabled: true, nextCheckAt: { $lte: now } },
        [
          {
            $set: {
              nextCheckAt: { $dateAdd: { startDate: now, unit: "second", amount: "$intervalSeconds" } },
              updatedAt: now,
            },
          },
        ],
        { sort: { nextCheckAt: 1 }, returnDocument: "before", session },
      );
      if (!target) break;
      claimed.push(target);
    }
    return claimed;
  });
}

export async function findMonitoringTargetById(id: string): Promise<MonitoringTargetDoc | null> {
  const col = await getCollection<MonitoringTargetDoc>(collections.monitoringTargets);
  return col.findOne({ id });
}

export async function listMonitoringTargets(query: {
  page: number;
  pageSize: number;
  search?: string;
  assetId?: string;
  status?: ServiceState;
  monitorType?: MonitoringTargetDoc["monitorType"];
  enabled?: boolean;
  sort?: "name" | "status" | "lastCheckedAt" | "intervalSeconds";
  order?: "asc" | "desc";
}): Promise<{ items: MonitoringTargetDoc[]; total: number }> {
  const col = await getCollection<MonitoringTargetDoc>(collections.monitoringTargets);
  const filter: Filter<MonitoringTargetDoc> = {};
  if (query.assetId) filter.assetId = query.assetId;
  if (query.status) filter.status = query.status;
  if (query.monitorType) filter.monitorType = query.monitorType;
  if (query.enabled !== undefined) filter.enabled = query.enabled;
  if (query.search) {
    const rx = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ name: rx }, { url: rx }, { host: rx }];
  }
  const skip = (query.page - 1) * query.pageSize;
  const sortField = query.sort ?? "name";
  const [items, total] = await Promise.all([
    col.find(filter).sort({ [sortField]: query.order === "asc" ? 1 : -1 }).skip(skip).limit(query.pageSize).toArray(),
    col.countDocuments(filter),
  ]);
  return { items, total };
}

export async function listMonitoringTargetsForOverview(limit: number): Promise<MonitoringTargetDoc[]> {
  const col = await getCollection<MonitoringTargetDoc>(collections.monitoringTargets);
  return col
    .aggregate<MonitoringTargetDoc>([
      {
        $addFields: {
          healthOrder: {
            $switch: {
              branches: [
                { case: { $eq: ["$status", "unavailable"] }, then: 0 },
                { case: { $eq: ["$status", "degraded"] }, then: 1 },
                { case: { $eq: ["$status", "unknown"] }, then: 2 },
              ],
              default: 3,
            },
          },
        },
      },
      { $sort: { healthOrder: 1, name: 1 } },
      { $limit: limit },
      { $project: { healthOrder: 0 } },
    ])
    .toArray();
}

export interface NewMonitoringTargetInput {
  name: string;
  monitorType: MonitoringTargetDoc["monitorType"];
  url: string | null;
  host: string | null;
  port: number | null;
  expectedStatusCode: number | null;
  intervalSeconds: number;
  timeoutMs: number;
  degradedThresholdMs: number;
  enabled: boolean;
  allowPrivateNetwork: boolean;
  assetId: string | null;
  createdById: string | null;
}

export async function insertMonitoringTarget(input: NewMonitoringTargetInput): Promise<MonitoringTargetDoc> {
  const col = await getCollection<MonitoringTargetDoc>(collections.monitoringTargets);
  const now = new Date();
  const doc: MonitoringTargetDoc = {
    ...newEntityIds(),
    ...input,
    status: "unknown",
    consecutiveFailures: 0,
    lastCheckedAt: null,
    nextCheckAt: now,
    lastResponseMs: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };
  await col.insertOne(doc);
  return doc;
}

export async function updateMonitoringTargetById(
  id: string,
  patch: Partial<Pick<MonitoringTargetDoc, "name" | "monitorType" | "url" | "host" | "port" | "expectedStatusCode" | "intervalSeconds" | "timeoutMs" | "degradedThresholdMs" | "enabled" | "allowPrivateNetwork" | "assetId" | "nextCheckAt">>,
): Promise<MonitoringTargetDoc | null> {
  const col = await getCollection<MonitoringTargetDoc>(collections.monitoringTargets);
  return col.findOneAndUpdate(
    { id },
    { $set: { ...patch, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
}

export async function deleteMonitoringTargetById(id: string): Promise<MonitoringTargetDoc | null> {
  return withMongoTransaction(async (session) => {
    const targets = await getCollection<MonitoringTargetDoc>(collections.monitoringTargets);
    const results = await getCollection<MonitoringResultDoc>(collections.monitoringResults);
    const target = await targets.findOneAndDelete({ id }, { session });
    if (target) await results.deleteMany({ targetId: id }, { session });
    return target;
  });
}

export async function insertMonitoringResult(
  input: {
    targetId: string;
    checkedAt: Date;
    success: boolean;
    state: ServiceState;
    responseTimeMs: number | null;
    statusCode: number | null;
    errorMessage: string | null;
  },
  session?: ClientSession,
): Promise<MonitoringResultDoc> {
  const col = await getCollection<MonitoringResultDoc>(collections.monitoringResults);
  const doc: MonitoringResultDoc = {
    ...newEntityIds(),
    targetId: input.targetId,
    checkedAt: input.checkedAt,
    success: input.success,
    state: input.state,
    responseTimeMs: input.responseTimeMs,
    statusCode: input.statusCode,
    errorMessage: input.errorMessage,
  };
  await col.insertOne(doc, { session });
  return doc;
}

export async function updateMonitoringTargetAfterCheck(
  id: string,
  patch: Partial<Pick<MonitoringTargetDoc,
    "status" | "consecutiveFailures" | "lastCheckedAt" | "lastResponseMs" | "lastError"
  >>,
  session?: ClientSession,
): Promise<MonitoringTargetDoc | null> {
  const col = await getCollection<MonitoringTargetDoc>(collections.monitoringTargets);
  return col.findOneAndUpdate(
    { id },
    { $set: { ...patch, updatedAt: new Date() } },
    { returnDocument: "after", session },
  );
}

export async function recordMonitoringCheck(
  targetId: string,
  input: {
    checkedAt: Date;
    success: boolean;
    state: ServiceState;
    responseTimeMs: number | null;
    statusCode: number | null;
    errorMessage: string | null;
  },
  patch: Partial<Pick<MonitoringTargetDoc,
    "status" | "consecutiveFailures" | "lastCheckedAt" | "lastResponseMs" | "lastError"
  >>,
): Promise<void> {
  await withMongoTransaction(async (session) => {
    await insertMonitoringResult({ targetId, ...input }, session);
    await updateMonitoringTargetAfterCheck(targetId, patch, session);
  });
}

export async function getMonitoringUptime(
  targetIds: string[],
  since: Date,
): Promise<Map<string, { total: number; ok: number; avgMs: number | null }>> {
  if (targetIds.length === 0) return new Map();
  const col = await getCollection<MonitoringResultDoc>(collections.monitoringResults);
  const rows = await col
    .aggregate<{ _id: string; total: number; ok: number; avgMs: number | null }>([
      { $match: { targetId: { $in: targetIds }, checkedAt: { $gte: since } } },
      {
        $group: {
          _id: "$targetId",
          total: { $sum: 1 },
          ok: { $sum: { $cond: ["$success", 1, 0] } },
          avgMs: { $avg: "$responseTimeMs" },
        },
      },
    ])
    .toArray();
  return new Map(rows.map((row) => [row._id, { total: row.total, ok: row.ok, avgMs: row.avgMs }]));
}

export async function listMonitoringResults(
  targetId: string,
  query: { since: Date; page: number; pageSize: number },
): Promise<{ items: MonitoringResultDoc[]; total: number }> {
  const col = await getCollection<MonitoringResultDoc>(collections.monitoringResults);
  const filter = { targetId, checkedAt: { $gte: query.since } };
  const skip = (query.page - 1) * query.pageSize;
  const [items, total] = await Promise.all([
    col.find(filter).sort({ checkedAt: -1 }).skip(skip).limit(query.pageSize).toArray(),
    col.countDocuments(filter),
  ]);
  return { items, total };
}

export async function getMonitoringResultSummary(since: Date): Promise<{ total: number; ok: number; avgMs: number | null }> {
  const col = await getCollection<MonitoringResultDoc>(collections.monitoringResults);
  const [summary] = await col
    .aggregate<{ total: number; ok: number; avgMs: number | null }>([
      { $match: { checkedAt: { $gte: since } } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          ok: { $sum: { $cond: ["$success", 1, 0] } },
          avgMs: { $avg: "$responseTimeMs" },
        },
      },
      { $project: { _id: 0, total: 1, ok: 1, avgMs: 1 } },
    ])
    .toArray();
  return summary ?? { total: 0, ok: 0, avgMs: null };
}

export async function getMonitoringTargetCounts(): Promise<Array<{ status: ServiceState; enabled: boolean; total: number }>> {
  const col = await getCollection<MonitoringTargetDoc>(collections.monitoringTargets);
  return col
    .aggregate<{ status: ServiceState; enabled: boolean; total: number }>([
      { $group: { _id: { status: "$status", enabled: "$enabled" }, total: { $sum: 1 } } },
      { $project: { _id: 0, status: "$_id.status", enabled: "$_id.enabled", total: 1 } },
    ])
    .toArray();
}

export async function pruneMonitoringResults(cutoff: Date): Promise<number> {
  const col = await getCollection<MonitoringResultDoc>(collections.monitoringResults);
  const res = await col.deleteMany({ checkedAt: { $lt: cutoff } });
  return res.deletedCount;
}

