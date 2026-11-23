import type { ClientSession, Filter, Sort } from "mongodb";
import { collections, getCollection, newEntityIds } from "@/db/collections";
import type { AssetDoc, AssetStatus, AssetType, EnvironmentType } from "@/db/models/documents";

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface NewAssetInput {
  name: string;
  assetType: AssetType;
  hostname: string | null;
  ipAddress: string | null;
  operatingSystem: string | null;
  environment: EnvironmentType;
  location: string | null;
  ownerId: string | null;
  description: string | null;
  status?: AssetStatus;
  createdById: string | null;
}

export type UpdateAssetPatch = Partial<{
  name: string;
  assetType: AssetType;
  hostname: string | null;
  ipAddress: string | null;
  operatingSystem: string | null;
  environment: EnvironmentType;
  location: string | null;
  ownerId: string | null;
  description: string | null;
  status: AssetStatus;
  archivedAt: Date | null;
}>;

export async function findAssetById(id: string, session?: ClientSession): Promise<AssetDoc | null> {
  const col = await getCollection<AssetDoc>(collections.assets);
  return col.findOne({ id }, { session });
}

export async function countAssetsByIds(ids: string[], session?: ClientSession): Promise<number> {
  if (ids.length === 0) return 0;
  const col = await getCollection<AssetDoc>(collections.assets);
  return col.countDocuments({ id: { $in: [...new Set(ids)] } }, { session });
}

export async function findAssetNamesByIds(ids: string[]): Promise<Array<Pick<AssetDoc, "id" | "name">>> {
  if (ids.length === 0) return [];
  const col = await getCollection<AssetDoc>(collections.assets);
  return col
    .find({ id: { $in: [...new Set(ids)] } }, { projection: { _id: 0, id: 1, name: 1 } })
    .toArray();
}

export async function findAssetsByIds(ids: string[]): Promise<Array<Pick<AssetDoc, "id" | "name" | "assetType" | "status">>> {
  if (ids.length === 0) return [];
  const col = await getCollection<AssetDoc>(collections.assets);
  return col
    .find({ id: { $in: [...new Set(ids)] } }, { projection: { _id: 0, id: 1, name: 1, assetType: 1, status: 1 } })
    .sort({ name: 1 })
    .toArray();
}

export async function insertAsset(input: NewAssetInput, session?: ClientSession): Promise<AssetDoc> {
  const col = await getCollection<AssetDoc>(collections.assets);
  const now = new Date();
  const doc: AssetDoc = {
    ...newEntityIds(),
    name: input.name,
    assetType: input.assetType,
    hostname: input.hostname,
    ipAddress: input.ipAddress,
    operatingSystem: input.operatingSystem,
    environment: input.environment,
    location: input.location,
    ownerId: input.ownerId,
    description: input.description,
    status: input.status ?? "unknown",
    archivedAt: null,
    createdById: input.createdById,
    createdAt: now,
    updatedAt: now,
  };
  await col.insertOne(doc, { session });
  return doc;
}

export async function updateAssetById(
  id: string,
  patch: UpdateAssetPatch,
  session?: ClientSession,
): Promise<AssetDoc | null> {
  const col = await getCollection<AssetDoc>(collections.assets);
  return col.findOneAndUpdate(
    { id },
    { $set: { ...patch, updatedAt: new Date() } },
    { returnDocument: "after", session },
  );
}

export async function listAssetsPaginated(query: {
  page: number;
  pageSize: number;
  search?: string;
  assetType?: AssetType;
  environment?: EnvironmentType;
  status?: AssetStatus;
  archived?: boolean;
  sort?: "name" | "assetType" | "environment" | "status" | "createdAt" | "updatedAt";
  order?: "asc" | "desc";
}): Promise<{ items: AssetDoc[]; total: number }> {
  const col = await getCollection<AssetDoc>(collections.assets);
  const filter: Filter<AssetDoc> = {
    archivedAt: query.archived ? { $ne: null } : null,
  };
  if (query.assetType) filter.assetType = query.assetType;
  if (query.environment) filter.environment = query.environment;
  if (query.status) filter.status = query.status;
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search.trim()), "i");
    filter.$or = [{ name: rx }, { hostname: rx }, { ipAddress: rx }, { location: rx }];
  }

  const sortField = query.sort ?? "name";
  const sortDir = query.order === "asc" ? 1 : -1;
  const sort: Sort = { [sortField]: sortDir };
  const skip = (query.page - 1) * query.pageSize;

  const [items, total] = await Promise.all([
    col.find(filter).sort(sort).skip(skip).limit(query.pageSize).toArray(),
    col.countDocuments(filter),
  ]);
  return { items, total };
}

export async function getAssetRelatedData(assetId: string) {
  const targetCol = await getCollection(collections.monitoringTargets);
  const findingCol = await getCollection(collections.securityFindings);
  const incidentAssetCol = await getCollection(collections.incidentAssets);
  const incidentCol = await getCollection(collections.incidents);

  const [monitors, findings, links] = await Promise.all([
    targetCol.find({ assetId }, { projection: { id: 1, name: 1, status: 1, monitorType: 1 } }).toArray(),
    findingCol.find({ assetId }).sort({ createdAt: -1 }).limit(50).toArray(),
    incidentAssetCol.find({ assetId }).limit(50).toArray(),
  ]);
  const incidentIds = links.map((link) => String(link.incidentId));
  const incidents = incidentIds.length
    ? await incidentCol.find({ id: { $in: incidentIds } }).sort({ openedAt: -1 }).limit(50).toArray()
    : [];
  return { monitors, findings, incidents };
}
