import type { ClientSession, Filter } from "mongodb";
import { collections, getCollection, newEntityIds, withMongoTransaction } from "@/db/collections";
import type { FindingEventDoc, FindingStatus, SecurityFindingDoc } from "@/db/models/documents";

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function listSecurityFindings(query: {
  page: number;
  pageSize: number;
  search?: string;
  severity?: SecurityFindingDoc["severity"];
  status?: FindingStatus;
  assetId?: string;
  assigneeId?: string;
  sort: "severity" | "createdAt" | "updatedAt" | "title";
  order: "asc" | "desc";
}): Promise<{ items: SecurityFindingDoc[]; total: number }> {
  const col = await getCollection<SecurityFindingDoc>(collections.securityFindings);
  const filter: Filter<SecurityFindingDoc> = {};
  if (query.severity) filter.severity = query.severity;
  if (query.status) filter.status = query.status;
  if (query.assetId) filter.assetId = query.assetId;
  if (query.assigneeId) filter.assigneeId = query.assigneeId;
  if (query.search) {
    const regex = new RegExp(escapeRegex(query.search.trim()), "i");
    filter.$or = [{ title: regex }, { cveId: regex }];
  }
  const direction = query.order === "asc" ? 1 : -1;
  const skip = (query.page - 1) * query.pageSize;
  const [items, total] = await Promise.all([
    query.sort === "severity"
      ? col.aggregate<SecurityFindingDoc>([
          { $match: filter },
          {
            $addFields: {
              severityOrder: {
                $switch: {
                  branches: [
                    { case: { $eq: ["$severity", "critical"] }, then: 0 },
                    { case: { $eq: ["$severity", "high"] }, then: 1 },
                    { case: { $eq: ["$severity", "medium"] }, then: 2 },
                    { case: { $eq: ["$severity", "low"] }, then: 3 },
                  ],
                  default: 4,
                },
              },
            },
          },
          { $sort: { severityOrder: direction, createdAt: -1 } },
          { $skip: skip },
          { $limit: query.pageSize },
          { $project: { severityOrder: 0 } },
        ]).toArray()
      : col.find(filter).sort({ [query.sort]: direction, createdAt: -1 }).skip(skip).limit(query.pageSize).toArray(),
    col.countDocuments(filter),
  ]);
  return { items, total };
}

export async function findSecurityFindingById(id: string, session?: ClientSession): Promise<SecurityFindingDoc | null> {
  const col = await getCollection<SecurityFindingDoc>(collections.securityFindings);
  return col.findOne({ id }, { session });
}

export async function listFindingEvents(findingId: string): Promise<FindingEventDoc[]> {
  const col = await getCollection<FindingEventDoc>(collections.findingEvents);
  return col.find({ findingId }).sort({ createdAt: 1 }).toArray();
}

export async function createSecurityFinding(
  input: Pick<SecurityFindingDoc, "title" | "description" | "severity" | "assetId" | "assigneeId" | "remediation" | "cveId" | "createdById">,
  actorId: string,
): Promise<SecurityFindingDoc> {
  return withMongoTransaction(async (session) => {
    const now = new Date();
    const doc: SecurityFindingDoc = {
      ...newEntityIds(),
      ...input,
      status: "open",
      resolvedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const findings = await getCollection<SecurityFindingDoc>(collections.securityFindings);
    const events = await getCollection<FindingEventDoc>(collections.findingEvents);
    await findings.insertOne(doc, { session });
    await events.insertOne({
      ...newEntityIds(),
      findingId: doc.id,
      actorId,
      fromStatus: null,
      toStatus: "open",
      note: "Finding recorded",
      createdAt: now,
    }, { session });
    return doc;
  });
}

export interface FindingEventInput {
  actorId: string | null;
  fromStatus: FindingStatus | null;
  toStatus: FindingStatus | null;
  note: string;
}

export async function updateSecurityFinding(
  id: string,
  patch: Partial<Pick<SecurityFindingDoc, "title" | "description" | "severity" | "status" | "assetId" | "assigneeId" | "remediation" | "cveId" | "resolvedAt">>,
  eventsToAdd: FindingEventInput[],
): Promise<SecurityFindingDoc | null> {
  return withMongoTransaction(async (session) => {
    const findings = await getCollection<SecurityFindingDoc>(collections.securityFindings);
    const updated = await findings.findOneAndUpdate(
      { id },
      { $set: { ...patch, updatedAt: new Date() } },
      { returnDocument: "after", session },
    );
    if (!updated) return null;
    if (eventsToAdd.length > 0) {
      const events = await getCollection<FindingEventDoc>(collections.findingEvents);
      const createdAt = new Date();
      await events.insertMany(
        eventsToAdd.map((event) => ({ ...newEntityIds(), findingId: id, ...event, createdAt })),
        { session },
      );
    }
    return updated;
  });
}

export async function deleteSecurityFinding(id: string): Promise<SecurityFindingDoc | null> {
  return withMongoTransaction(async (session) => {
    const findings = await getCollection<SecurityFindingDoc>(collections.securityFindings);
    const finding = await findings.findOneAndDelete({ id }, { session });
    if (finding) {
      const events = await getCollection<FindingEventDoc>(collections.findingEvents);
      await events.deleteMany({ findingId: id }, { session });
    }
    return finding;
  });
}
