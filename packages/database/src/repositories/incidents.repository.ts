import type { ClientSession, Filter } from "mongodb";
import { collections, getCollection, newEntityIds, withMongoTransaction } from "@/db/collections";
import type {
  AssetDoc,
  IncidentAssetDoc,
  IncidentCommentDoc,
  IncidentDoc,
  IncidentStatus,
} from "@/db/models/documents";
import { nextSequenceValue } from "@/db/repositories/counters.repository";

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function listIncidents(query: {
  page: number;
  pageSize: number;
  search?: string;
  status?: IncidentStatus;
  severity?: IncidentDoc["severity"];
  priority?: IncidentDoc["priority"];
  assigneeId?: string;
  assetId?: string;
  active?: "true" | "false";
  sort: "openedAt" | "priority" | "severity" | "updatedAt";
  order: "asc" | "desc";
}): Promise<{ items: IncidentDoc[]; total: number }> {
  const col = await getCollection<IncidentDoc>(collections.incidents);
  const filter: Filter<IncidentDoc> = {};
  const activeStatusFilter =
    query.active === "true"
      ? { status: { $nin: ["resolved", "closed"] } }
      : query.active === "false"
        ? { status: { $in: ["resolved", "closed"] } }
        : null;
  if (query.status && activeStatusFilter) {
    filter.$and = [{ status: query.status }, activeStatusFilter] as Filter<IncidentDoc>[];
  } else if (query.status) {
    filter.status = query.status;
  } else if (activeStatusFilter) {
    Object.assign(filter, activeStatusFilter);
  }
  if (query.severity) filter.severity = query.severity;
  if (query.priority) filter.priority = query.priority;
  if (query.assigneeId) filter.assigneeId = query.assigneeId;
  if (query.search) filter.title = new RegExp(escapeRegex(query.search.trim()), "i");
  if (query.assetId) {
    const links = await getCollection<IncidentAssetDoc>(collections.incidentAssets);
    const incidentIds = await links.distinct("incidentId", { assetId: query.assetId });
    const ids = incidentIds.filter((id): id is string => typeof id === "string");
    if (ids.length === 0) return { items: [], total: 0 };
    filter.id = { $in: ids };
  }
  const direction = query.order === "asc" ? 1 : -1;
  const skip = (query.page - 1) * query.pageSize;
  const items = query.sort === "severity"
    ? await col.aggregate<IncidentDoc>([
        { $match: filter },
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
        { $sort: { severityOrder: direction } },
        { $skip: skip },
        { $limit: query.pageSize },
        { $project: { severityOrder: 0 } },
      ]).toArray()
    : await col.find(filter).sort({ [query.sort]: direction }).skip(skip).limit(query.pageSize).toArray();
  const total = await col.countDocuments(filter);
  return { items, total };
}

export async function findIncidentById(id: string, session?: ClientSession): Promise<IncidentDoc | null> {
  const col = await getCollection<IncidentDoc>(collections.incidents);
  return col.findOne({ id }, { session });
}

export async function listIncidentAssets(
  incidentId: string,
): Promise<Array<Pick<AssetDoc, "id" | "name" | "assetType" | "status">>> {
  const links = await getCollection<IncidentAssetDoc>(collections.incidentAssets);
  const assetIds = await links.distinct("assetId", { incidentId });
  if (assetIds.length === 0) return [];
  const assets = await getCollection<AssetDoc>(collections.assets);
  return assets
    .find(
      { id: { $in: assetIds.filter((id): id is string => typeof id === "string") } },
      { projection: { _id: 0, id: 1, name: 1, assetType: 1, status: 1 } },
    )
    .sort({ name: 1 })
    .toArray();
}

export async function listIncidentComments(incidentId: string): Promise<IncidentCommentDoc[]> {
  const col = await getCollection<IncidentCommentDoc>(collections.incidentComments);
  return col.find({ incidentId }).sort({ createdAt: 1 }).toArray();
}

export async function createIncident(
  input: Pick<IncidentDoc, "title" | "description" | "severity" | "priority" | "assigneeId">,
  actorId: string,
  actorName: string,
  assetIds: string[],
): Promise<IncidentDoc> {
  const number = await nextSequenceValue("incident_number");
  return withMongoTransaction(async (session) => {
    const now = new Date();
    const doc: IncidentDoc = {
      ...newEntityIds(),
      number,
      ...input,
      status: "open",
      reporterId: actorId,
      rootCause: null,
      resolution: null,
      openedAt: now,
      resolvedAt: null,
      closedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const incidents = await getCollection<IncidentDoc>(collections.incidents);
    const links = await getCollection<IncidentAssetDoc>(collections.incidentAssets);
    const comments = await getCollection<IncidentCommentDoc>(collections.incidentComments);
    await incidents.insertOne(doc, { session });
    if (assetIds.length > 0) {
      await links.insertMany(assetIds.map((assetId) => ({ ...newEntityIds(), incidentId: doc.id, assetId })), { session });
    }
    await comments.insertOne({
      ...newEntityIds(),
      incidentId: doc.id,
      authorId: actorId,
      kind: "system",
      body: `Incident opened by ${actorName} (${input.severity.charAt(0).toUpperCase()}${input.severity.slice(1)} severity, ${input.priority.toUpperCase()})`,
      createdAt: now,
    }, { session });
    return doc;
  });
}

export interface IncidentCommentInput {
  authorId: string | null;
  kind: IncidentCommentDoc["kind"];
  body: string;
}

export async function updateIncident(
  id: string,
  patch: Partial<Pick<IncidentDoc, "title" | "description" | "severity" | "priority" | "status" | "assigneeId" | "rootCause" | "resolution" | "resolvedAt" | "closedAt">>,
  assetIds: string[] | undefined,
  commentsToAdd: IncidentCommentInput[],
): Promise<IncidentDoc | null> {
  return withMongoTransaction(async (session) => {
    const incidents = await getCollection<IncidentDoc>(collections.incidents);
    const updated = await incidents.findOneAndUpdate(
      { id },
      { $set: { ...patch, updatedAt: new Date() } },
      { returnDocument: "after", session },
    );
    if (!updated) return null;
    if (assetIds !== undefined) {
      const links = await getCollection<IncidentAssetDoc>(collections.incidentAssets);
      await links.deleteMany({ incidentId: id }, { session });
      if (assetIds.length > 0) {
        await links.insertMany(assetIds.map((assetId) => ({ ...newEntityIds(), incidentId: id, assetId })), { session });
      }
    }
    if (commentsToAdd.length > 0) {
      const comments = await getCollection<IncidentCommentDoc>(collections.incidentComments);
      const createdAt = new Date();
      await comments.insertMany(
        commentsToAdd.map((comment) => ({ ...newEntityIds(), incidentId: id, ...comment, createdAt })),
        { session },
      );
    }
    return updated;
  });
}

export async function insertIncidentComment(
  incidentId: string,
  input: IncidentCommentInput,
): Promise<IncidentCommentDoc> {
  const col = await getCollection<IncidentCommentDoc>(collections.incidentComments);
  const comment: IncidentCommentDoc = {
    ...newEntityIds(),
    incidentId,
    ...input,
    createdAt: new Date(),
  };
  await col.insertOne(comment);
  return comment;
}

export async function getIncidentStats(since: Date): Promise<{
  total: number;
  bySeverity: Array<{ _id: string; count: number }>;
  byStatus: Array<{ _id: string; count: number }>;
  openedByDay: Array<{ _id: string; count: number }>;
  meanTimeToResolveHours: number | null;
}> {
  const col = await getCollection<IncidentDoc>(collections.incidents);
  const [total, bySeverity, byStatus, openedByDay, [mttr]] = await Promise.all([
    col.countDocuments({ openedAt: { $gte: since } }),
    col.aggregate<{ _id: string; count: number }>([
      { $match: { openedAt: { $gte: since } } },
      { $group: { _id: "$severity", count: { $sum: 1 } } },
    ]).toArray(),
    col.aggregate<{ _id: string; count: number }>([
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]).toArray(),
    col.aggregate<{ _id: string; count: number }>([
      { $match: { openedAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$openedAt", timezone: "UTC" } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]).toArray(),
    col.aggregate<{ hours: number | null }>([
      { $match: { openedAt: { $gte: since }, resolvedAt: { $ne: null } } },
      { $group: { _id: null, hours: { $avg: { $divide: [{ $subtract: ["$resolvedAt", "$openedAt"] }, 3_600_000] } } } },
      { $project: { _id: 0, hours: 1 } },
    ]).toArray(),
  ]);
  return {
    total,
    bySeverity,
    byStatus,
    openedByDay,
    meanTimeToResolveHours: mttr?.hours ?? null,
  };
}
