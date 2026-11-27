import type { ClientSession, Filter } from "mongodb";
import { collections, getCollection, newEntityIds, withMongoTransaction } from "@/db/collections";
import type { MaintenanceAssetDoc, MaintenanceDoc, MaintenanceStatus } from "@/db/models/documents";

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function findMaintenanceById(id: string, session?: ClientSession): Promise<MaintenanceDoc | null> {
  const col = await getCollection<MaintenanceDoc>(collections.maintenances);
  return col.findOne({ id }, { session });
}

export async function listMaintenances(query: {
  page: number;
  pageSize: number;
  search?: string;
  status?: MaintenanceStatus;
  from?: string;
  to?: string;
  sort: "startsAt" | "createdAt";
  order: "asc" | "desc";
}): Promise<{ items: MaintenanceDoc[]; total: number }> {
  const col = await getCollection<MaintenanceDoc>(collections.maintenances);
  const filter: Filter<MaintenanceDoc> = {};
  if (query.status) filter.status = query.status;
  if (query.from) filter.endsAt = { $gte: new Date(query.from) };
  if (query.to) filter.startsAt = { $lte: new Date(query.to) };
  if (query.search) filter.title = new RegExp(escapeRegex(query.search.trim()), "i");
  const skip = (query.page - 1) * query.pageSize;
  const [items, total] = await Promise.all([
    col.find(filter).sort({ [query.sort]: query.order === "asc" ? 1 : -1 }).skip(skip).limit(query.pageSize).toArray(),
    col.countDocuments(filter),
  ]);
  return { items, total };
}

export async function listMaintenanceAssetLinks(maintenanceIds: string[]): Promise<MaintenanceAssetDoc[]> {
  if (maintenanceIds.length === 0) return [];
  const col = await getCollection<MaintenanceAssetDoc>(collections.maintenanceAssets);
  return col.find({ maintenanceId: { $in: maintenanceIds } }).toArray();
}

export async function findMaintenanceConflicts(
  assetIds: string[],
  startsAt: Date,
  endsAt: Date,
  excludeId?: string,
): Promise<Array<Pick<MaintenanceDoc, "id" | "title" | "startsAt" | "endsAt">>> {
  if (assetIds.length === 0) return [];
  const links = await getCollection<MaintenanceAssetDoc>(collections.maintenanceAssets);
  const linked = await links.distinct("maintenanceId", { assetId: { $in: [...new Set(assetIds)] } });
  const maintenanceIds = linked.filter((id): id is string => typeof id === "string");
  if (maintenanceIds.length === 0) return [];
  const col = await getCollection<MaintenanceDoc>(collections.maintenances);
  const filter: Filter<MaintenanceDoc> = {
    id: { $in: maintenanceIds },
    status: { $in: ["scheduled", "in_progress"] },
    startsAt: { $lt: endsAt },
    endsAt: { $gt: startsAt },
  };
  if (excludeId) filter.id = { $in: maintenanceIds.filter((id) => id !== excludeId) };
  return col
    .find(filter, { projection: { _id: 0, id: 1, title: 1, startsAt: 1, endsAt: 1 } })
    .sort({ startsAt: 1 })
    .toArray();
}

export interface NewMaintenanceInput {
  title: string;
  description: string;
  startsAt: Date;
  endsAt: Date;
  ownerId: string | null;
  createdById: string | null;
  notes: string | null;
}

export async function insertMaintenanceWithAssets(input: NewMaintenanceInput, assetIds: string[]): Promise<MaintenanceDoc> {
  return withMongoTransaction(async (session) => {
    const col = await getCollection<MaintenanceDoc>(collections.maintenances);
    const now = new Date();
    const doc: MaintenanceDoc = {
      ...newEntityIds(),
      ...input,
      status: "scheduled",
      reminderSentAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await col.insertOne(doc, { session });
    if (assetIds.length > 0) {
      const links = await getCollection<MaintenanceAssetDoc>(collections.maintenanceAssets);
      await links.insertMany(assetIds.map((assetId) => ({ ...newEntityIds(), maintenanceId: doc.id, assetId })), { session });
    }
    return doc;
  });
}

export async function updateMaintenanceWithAssets(
  id: string,
  patch: Partial<Pick<MaintenanceDoc, "title" | "description" | "startsAt" | "endsAt" | "ownerId" | "notes" | "status">>,
  assetIds?: string[],
): Promise<MaintenanceDoc | null> {
  return withMongoTransaction(async (session) => {
    const col = await getCollection<MaintenanceDoc>(collections.maintenances);
    const updated = await col.findOneAndUpdate(
      { id },
      { $set: { ...patch, updatedAt: new Date() } },
      { returnDocument: "after", session },
    );
    if (!updated || assetIds === undefined) return updated;
    const links = await getCollection<MaintenanceAssetDoc>(collections.maintenanceAssets);
    await links.deleteMany({ maintenanceId: id }, { session });
    if (assetIds.length > 0) {
      await links.insertMany(assetIds.map((assetId) => ({ ...newEntityIds(), maintenanceId: id, assetId })), { session });
    }
    return updated;
  });
}

export async function deleteMaintenanceById(id: string): Promise<MaintenanceDoc | null> {
  return withMongoTransaction(async (session) => {
    const col = await getCollection<MaintenanceDoc>(collections.maintenances);
    const doc = await col.findOneAndDelete({ id }, { session });
    if (doc) {
      const links = await getCollection<MaintenanceAssetDoc>(collections.maintenanceAssets);
      await links.deleteMany({ maintenanceId: id }, { session });
    }
    return doc;
  });
}

export async function claimDueMaintenanceReminder(now: Date, horizon: Date): Promise<MaintenanceDoc | null> {
  const col = await getCollection<MaintenanceDoc>(collections.maintenances);
  return col.findOneAndUpdate(
    { status: "scheduled", reminderSentAt: null, startsAt: { $gte: now, $lte: horizon } },
    { $set: { reminderSentAt: now, updatedAt: now } },
    { sort: { startsAt: 1 }, returnDocument: "after" },
  );
}

export async function releaseMaintenanceReminderClaim(id: string, claimedAt: Date): Promise<void> {
  const col = await getCollection<MaintenanceDoc>(collections.maintenances);
  await col.updateOne({ id, reminderSentAt: claimedAt }, { $set: { reminderSentAt: null, updatedAt: new Date() } });
}

/**
 * Maintenance windows that currently cover any of the given assets.
 *
 * Used by the worker to suppress alert escalation during planned work. Windows must overlap `at`
 * and be scheduled or in progress; completed/cancelled windows never suppress anything.
 */
export async function findActiveMaintenanceForAssets(
  assetIds: string[],
  at: Date,
): Promise<Array<{ assetId: string; window: MaintenanceDoc }>> {
  if (assetIds.length === 0) return [];
  const maintenances = await getCollection<MaintenanceDoc>(collections.maintenances);
  const links = await getCollection<MaintenanceAssetDoc>(collections.maintenanceAssets);
  const assetLinks = await links.find({ assetId: { $in: assetIds } }).toArray();
  if (assetLinks.length === 0) return [];
  const windows = await maintenances
    .find({
      id: { $in: [...new Set(assetLinks.map((link) => link.maintenanceId))] },
      status: { $in: ["scheduled", "in_progress"] },
      startsAt: { $lte: at },
      endsAt: { $gt: at },
    })
    .toArray();
  const byId = new Map(windows.map((window) => [window.id, window]));
  return assetLinks.flatMap((link) => {
    const window = byId.get(link.maintenanceId);
    return window ? [{ assetId: link.assetId, window }] : [];
  });
}
