import { MongoServerError, type ClientSession, type Filter } from "mongodb";
import { collections, getCollection, newEntityIds, withMongoTransaction } from "@/db/collections";
import type {
  ChangeApprovalDoc,
  ChangeAssetDoc,
  ChangeRequestDoc,
  ChangeStatus,
  RiskLevel,
} from "@/db/models/documents";
import { nextSequenceValue } from "@/db/repositories/counters.repository";

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function listChangeRequests(query: {
  page: number;
  pageSize: number;
  search?: string;
  status?: ChangeStatus;
  riskLevel?: RiskLevel;
  sort: "createdAt" | "updatedAt" | "plannedStartAt";
  order: "asc" | "desc";
}): Promise<{ items: ChangeRequestDoc[]; total: number }> {
  const col = await getCollection<ChangeRequestDoc>(collections.changeRequests);
  const filter: Filter<ChangeRequestDoc> = {};
  if (query.status) filter.status = query.status;
  if (query.riskLevel) filter.riskLevel = query.riskLevel;
  if (query.search) filter.title = new RegExp(escapeRegex(query.search.trim()), "i");
  const skip = (query.page - 1) * query.pageSize;
  const [items, total] = await Promise.all([
    col.find(filter).sort({ [query.sort]: query.order === "asc" ? 1 : -1 }).skip(skip).limit(query.pageSize).toArray(),
    col.countDocuments(filter),
  ]);
  return { items, total };
}

export async function findChangeRequestById(id: string, session?: ClientSession): Promise<ChangeRequestDoc | null> {
  const col = await getCollection<ChangeRequestDoc>(collections.changeRequests);
  return col.findOne({ id }, { session });
}

export async function listChangeAssets(changeId: string): Promise<ChangeAssetDoc[]> {
  const col = await getCollection<ChangeAssetDoc>(collections.changeAssets);
  return col.find({ changeId }).toArray();
}

export async function listChangeApprovals(changeId: string): Promise<ChangeApprovalDoc[]> {
  const col = await getCollection<ChangeApprovalDoc>(collections.changeApprovals);
  return col.find({ changeId }).sort({ decidedAt: 1 }).toArray();
}

export async function countApprovedChanges(changeIds: string[]): Promise<Map<string, number>> {
  if (changeIds.length === 0) return new Map();
  const col = await getCollection<ChangeApprovalDoc>(collections.changeApprovals);
  const rows = await col.aggregate<{ _id: string; count: number }>([
    { $match: { changeId: { $in: changeIds }, decision: "approved" } },
    { $group: { _id: "$changeId", count: { $sum: 1 } } },
  ]).toArray();
  return new Map(rows.map((row) => [row._id, row.count]));
}

export async function createChangeRequest(
  input: Pick<ChangeRequestDoc, "title" | "description" | "reason" | "riskLevel" | "riskAssessment" | "rollbackPlan" | "implementerId" | "plannedStartAt" | "plannedEndAt">,
  requesterId: string,
  assetIds: string[],
): Promise<ChangeRequestDoc> {
  const number = await nextSequenceValue("change_number");
  return withMongoTransaction(async (session) => {
    const now = new Date();
    const doc: ChangeRequestDoc = {
      ...newEntityIds(),
      number,
      ...input,
      status: "draft",
      requesterId,
      implementationNotes: null,
      rollbackNotes: null,
      implementedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const changes = await getCollection<ChangeRequestDoc>(collections.changeRequests);
    await changes.insertOne(doc, { session });
    if (assetIds.length > 0) {
      const links = await getCollection<ChangeAssetDoc>(collections.changeAssets);
      await links.insertMany(assetIds.map((assetId) => ({ ...newEntityIds(), changeId: doc.id, assetId })), { session });
    }
    return doc;
  });
}

export async function updateChangeRequest(
  id: string,
  patch: Partial<Pick<ChangeRequestDoc, "title" | "description" | "reason" | "riskLevel" | "riskAssessment" | "rollbackPlan" | "implementerId" | "plannedStartAt" | "plannedEndAt">>,
  assetIds?: string[],
): Promise<ChangeRequestDoc | null> {
  return withMongoTransaction(async (session) => {
    const changes = await getCollection<ChangeRequestDoc>(collections.changeRequests);
    const updated = await changes.findOneAndUpdate(
      { id, status: { $in: ["draft", "rejected"] } },
      { $set: { ...patch, updatedAt: new Date() } },
      { returnDocument: "after", session },
    );
    if (!updated || assetIds === undefined) return updated;
    const links = await getCollection<ChangeAssetDoc>(collections.changeAssets);
    await links.deleteMany({ changeId: id }, { session });
    if (assetIds.length > 0) {
      await links.insertMany(assetIds.map((assetId) => ({ ...newEntityIds(), changeId: id, assetId })), { session });
    }
    return updated;
  });
}

export async function submitChangeRequest(id: string): Promise<ChangeRequestDoc | null> {
  const col = await getCollection<ChangeRequestDoc>(collections.changeRequests);
  return col.findOneAndUpdate(
    { id, status: { $in: ["draft", "rejected"] } },
    { $set: { status: "pending_approval", updatedAt: new Date() } },
    { returnDocument: "after" },
  );
}

export async function decideChangeRequest(
  id: string,
  approverId: string,
  decision: ChangeApprovalDoc["decision"],
  comment: string | null,
  requiredApprovals: number,
): Promise<{ change: ChangeRequestDoc | null; duplicate: boolean }> {
  try {
    return await withMongoTransaction(async (session) => {
      const changes = await getCollection<ChangeRequestDoc>(collections.changeRequests);
      const approvals = await getCollection<ChangeApprovalDoc>(collections.changeApprovals);
      const current = await changes.findOne({ id, status: "pending_approval" }, { session });
      if (!current) return { change: null, duplicate: false };
      const existing = await approvals.findOne({ changeId: id, approverId }, { session });
      if (existing) return { change: null, duplicate: true };

      await approvals.insertOne({
        ...newEntityIds(),
        changeId: id,
        approverId,
        decision,
        comment,
        decidedAt: new Date(),
      }, { session });
      const approved = await approvals.countDocuments({ changeId: id, decision: "approved" }, { session });
      const status = decision === "rejected" ? "rejected" : approved >= requiredApprovals ? "approved" : "pending_approval";
      const updated = await changes.findOneAndUpdate(
        { id, status: "pending_approval" },
        { $set: { status, updatedAt: new Date() } },
        { returnDocument: "after", session },
      );
      if (!updated) throw new Error("Change status changed while recording an approval");
      return { change: updated, duplicate: false };
    });
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000 && error.message.includes("change_approvals_change_approver_unique")) {
      return { change: null, duplicate: true };
    }
    throw error;
  }
}

export async function transitionChangeRequest(
  id: string,
  expectedStatus: ChangeStatus,
  patch: Partial<Pick<ChangeRequestDoc, "status" | "implementedAt" | "implementerId" | "implementationNotes" | "rollbackNotes">>,
): Promise<ChangeRequestDoc | null> {
  const col = await getCollection<ChangeRequestDoc>(collections.changeRequests);
  return col.findOneAndUpdate(
    { id, status: expectedStatus },
    { $set: { ...patch, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
}

/** Change requests that touch any of the given assets, newest first (used for impact analysis). */
export async function listChangeRequestsForAssets(assetIds: string[], limit = 20): Promise<ChangeRequestDoc[]> {
  if (assetIds.length === 0) return [];
  const links = await getCollection<ChangeAssetDoc>(collections.changeAssets);
  const rows = await links.find({ assetId: { $in: assetIds } }).toArray();
  if (rows.length === 0) return [];
  const changes = await getCollection<ChangeRequestDoc>(collections.changeRequests);
  return changes
    .find({ id: { $in: [...new Set(rows.map((row) => row.changeId))] } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
}

/** Counts approved changes per asset, used to show implementation coverage. */
export async function listChangeAssetLinks(assetIds: string[]): Promise<ChangeAssetDoc[]> {
  if (assetIds.length === 0) return [];
  const links = await getCollection<ChangeAssetDoc>(collections.changeAssets);
  return links.find({ assetId: { $in: assetIds } }).toArray();
}
