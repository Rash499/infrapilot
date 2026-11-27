import type { ClientSession, Filter } from "mongodb";
import { collections, getCollection, newEntityIds, withMongoTransaction } from "@/db/collections";
import type { FindingEventDoc, FindingStatus, SecurityFindingDoc, ScanImportDoc } from "@/db/models/documents";

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
  input: Pick<
    SecurityFindingDoc,
    | "title"
    | "description"
    | "severity"
    | "assetId"
    | "assigneeId"
    | "remediation"
    | "cveId"
    | "createdById"
    | "cvssScore"
    | "component"
    | "installedVersion"
    | "fixedVersion"
    | "remediationDeadline"
    | "source"
    | "scanId"
    | "lastSeenAt"
  >,
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
  patch: Partial<
    Pick<
      SecurityFindingDoc,
      | "title"
      | "description"
      | "severity"
      | "status"
      | "assetId"
      | "assigneeId"
      | "remediation"
      | "cveId"
      | "resolvedAt"
      | "cvssScore"
      | "component"
      | "installedVersion"
      | "fixedVersion"
      | "remediationDeadline"
    >
  >,
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

export interface VulnerabilityFindingInput {
  assetId: string;
  cveId: string;
  component: string;
  title: string;
  description: string;
  severity: SecurityFindingDoc["severity"];
  cvssScore: number | null;
  installedVersion: string | null;
  fixedVersion: string | null;
  remediation: string;
  remediationDeadline: Date;
  scanId: string;
  seenAt: Date;
  createdById: string;
}

/**
 * Creates a finding for an asset/CVE/component triple, or refreshes it when a later scan still
 * reports the vulnerability. Existing triage state is preserved; a previously resolved finding is
 * reopened because the vulnerable package is demonstrably still present.
 */
export async function upsertVulnerabilityFinding(
  input: VulnerabilityFindingInput,
): Promise<{ finding: SecurityFindingDoc; created: boolean; reopened: boolean }> {
  const findings = await getCollection<SecurityFindingDoc>(collections.securityFindings);
  const events = await getCollection<FindingEventDoc>(collections.findingEvents);
  const now = new Date();
  const base = {
    assetId: input.assetId,
    cveId: input.cveId,
    component: input.component,
    title: input.title,
    description: input.description,
    severity: input.severity,
    cvssScore: input.cvssScore,
    installedVersion: input.installedVersion,
    fixedVersion: input.fixedVersion,
    remediation: input.remediation,
    remediationDeadline: input.remediationDeadline,
    source: "trivy" as const,
    scanId: input.scanId,
    lastSeenAt: input.seenAt,
  };

  try {
    const doc: SecurityFindingDoc = {
      ...newEntityIds(),
      ...base,
      status: "open",
      assigneeId: null,
      createdById: input.createdById,
      resolvedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await findings.insertOne(doc);
    await events.insertOne({
      ...newEntityIds(),
      findingId: doc.id,
      actorId: input.createdById,
      fromStatus: null,
      toStatus: "open",
      note: `Imported from Trivy scan ${input.scanId}`,
      createdAt: now,
    });
    return { finding: doc, created: true, reopened: false };
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
  }

  const existing = await findings.findOne({
    assetId: input.assetId,
    cveId: input.cveId,
    component: input.component,
  });
  if (!existing) throw new Error("Finding disappeared during Trivy import");
  const reopened = existing.status === "resolved";
  const updated = await findings.findOneAndUpdate(
    { id: existing.id },
    {
      $set: {
        ...base,
        status: reopened ? "open" : existing.status,
        resolvedAt: reopened ? null : existing.resolvedAt,
        updatedAt: now,
      },
    },
    { returnDocument: "after" },
  );
  if (reopened) {
    await events.insertOne({
      ...newEntityIds(),
      findingId: existing.id,
      actorId: input.createdById,
      fromStatus: "resolved",
      toStatus: "open",
      note: `Reopened: still reported by Trivy scan ${input.scanId}`,
      createdAt: now,
    });
  }
  return { finding: updated ?? existing, created: false, reopened };
}

export interface FindingMetrics {
  bySeverity: Array<{ severity: string; count: number }>;
  byStatus: Array<{ status: string; count: number }>;
  overdue: number;
  dueSoon: number;
  openCritical: number;
  byAsset: Array<{ assetId: string; count: number }>;
  createdTrend: Array<{ date: string; count: number }>;
}

/** Security dashboard aggregates computed from stored findings, not fixed values. */
export async function getFindingMetrics(now = new Date()): Promise<FindingMetrics> {
  const col = await getCollection<SecurityFindingDoc>(collections.securityFindings);
  const openStatuses = ["open", "in_progress"];
  const soon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [row] = await col
    .aggregate<{
      bySeverity: Array<{ _id: string; count: number }>;
      byStatus: Array<{ _id: string; count: number }>;
      overdue: Array<{ count: number }>;
      dueSoon: Array<{ count: number }>;
      openCritical: Array<{ count: number }>;
      byAsset: Array<{ _id: string; count: number }>;
      createdTrend: Array<{ _id: string; count: number }>;
    }>([
      {
        $facet: {
          bySeverity: [
            { $match: { status: { $in: openStatuses } } },
            { $group: { _id: "$severity", count: { $sum: 1 } } },
          ],
          byStatus: [{ $group: { _id: "$status", count: { $sum: 1 } } }],
          overdue: [
            { $match: { status: { $in: openStatuses }, remediationDeadline: { $ne: null, $lt: now } } },
            { $count: "count" },
          ],
          dueSoon: [
            { $match: { status: { $in: openStatuses }, remediationDeadline: { $ne: null, $gte: now, $lte: soon } } },
            { $count: "count" },
          ],
          openCritical: [
            { $match: { status: { $in: openStatuses }, severity: "critical" } },
            { $count: "count" },
          ],
          byAsset: [
            { $match: { status: { $in: openStatuses } } },
            { $group: { _id: "$assetId", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 5 },
          ],
          createdTrend: [
            { $match: { createdAt: { $gte: since } } },
            { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } },
            { $sort: { _id: 1 } },
          ],
        },
      },
    ])
    .toArray();

  return {
    bySeverity: (row?.bySeverity ?? []).map((item) => ({ severity: item._id, count: item.count })),
    byStatus: (row?.byStatus ?? []).map((item) => ({ status: item._id, count: item.count })),
    overdue: row?.overdue?.[0]?.count ?? 0,
    dueSoon: row?.dueSoon?.[0]?.count ?? 0,
    openCritical: row?.openCritical?.[0]?.count ?? 0,
    byAsset: (row?.byAsset ?? []).map((item) => ({ assetId: item._id, count: item.count })),
    createdTrend: (row?.createdTrend ?? []).map((item) => ({ date: item._id, count: item.count })),
  };
}

export interface NewScanImportInput {
  assetId: string;
  scanner: ScanImportDoc["scanner"];
  artifactName: string | null;
  artifactType: string | null;
  reportVersion: number | null;
  importedById: string;
  vulnerabilitiesSeen: number;
  findingsCreated: number;
  findingsUpdated: number;
  findingsSkipped: number;
  importedAt: Date;
}

export async function insertScanImport(input: NewScanImportInput): Promise<ScanImportDoc> {
  const col = await getCollection<ScanImportDoc>(collections.scanImports);
  const now = new Date();
  const doc: ScanImportDoc = { ...newEntityIds(), ...input, createdAt: now, updatedAt: now };
  await col.insertOne(doc);
  return doc;
}

export async function listScanImports(assetId: string, limit = 10): Promise<ScanImportDoc[]> {
  const col = await getCollection<ScanImportDoc>(collections.scanImports);
  return col.find({ assetId }).sort({ importedAt: -1 }).limit(limit).toArray();
}

/** Open findings for the given assets, newest first, for incident correlation. */
export async function listOpenFindingsForAssets(assetIds: string[], limit = 10): Promise<SecurityFindingDoc[]> {
  if (assetIds.length === 0) return [];
  const col = await getCollection<SecurityFindingDoc>(collections.securityFindings);
  return col
    .find({ assetId: { $in: assetIds }, status: { $in: ["open", "in_progress"] } })
    .sort({ severity: 1, createdAt: -1 })
    .limit(limit)
    .toArray();
}
