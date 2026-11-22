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
  enabled?: boolean;
}): Promise<{ items: MonitoringTargetDoc[]; total: number }> {
  const col = await getCollection<MonitoringTargetDoc>(collections.monitoringTargets);
  const filter: Filter<MonitoringTargetDoc> = {};
  if (query.assetId) filter.assetId = query.assetId;
  if (query.status) filter.status = query.status;
  if (query.enabled !== undefined) filter.enabled = query.enabled;
  if (query.search) {
    const rx = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ name: rx }, { url: rx }, { host: rx }];
  }
  const skip = (query.page - 1) * query.pageSize;
  const [items, total] = await Promise.all([
    col.find(filter).sort({ name: 1 }).skip(skip).limit(query.pageSize).toArray(),
    col.countDocuments(filter),
  ]);
  return { items, total };
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

export async function pruneMonitoringResults(cutoff: Date): Promise<number> {
  const col = await getCollection<MonitoringResultDoc>(collections.monitoringResults);
  const res = await col.deleteMany({ checkedAt: { $lt: cutoff } });
  return res.deletedCount;
}

