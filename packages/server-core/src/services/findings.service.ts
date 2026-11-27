import type { z } from "zod";
import type { SecurityFindingDoc } from "@/db/models/documents";
import { findAssetById, findAssetNamesByIds } from "@/db/repositories/assets.repository";
import {
  createSecurityFinding,
  deleteSecurityFinding,
  findSecurityFindingById,
  getFindingMetrics,
  insertScanImport,
  listFindingEvents,
  listScanImports,
  listSecurityFindings,
  updateSecurityFinding,
  upsertVulnerabilityFinding,
} from "@/db/repositories/findings.repository";
import { findUserById } from "@/db/repositories/users.repository";
import type { AuthUser } from "@/lib/auth";
import { errors, paginationMeta } from "@/lib/http";
import { notifyRoles, notifyUsers } from "@/services/notifications.service";
import { recordAudit } from "@/services/audit.service";
import { diffFields, humanize, iso, userNameMap } from "@/services/common";
import {
  REMEDIATION_DAYS,
  TrivyParseError,
  parseTrivyReport,
  remediationDeadline,
} from "../security/trivy";
import type { findingCreateSchema, findingListQuery, findingUpdateSchema, trivyImportSchema } from "@/validators/schemas";

type FindingRow = SecurityFindingDoc;
type CreateInput = z.infer<typeof findingCreateSchema>;
type TrivyImportInput = z.infer<typeof trivyImportSchema>;
type UpdateInput = z.infer<typeof findingUpdateSchema>;
type ListQuery = z.infer<typeof findingListQuery>;

const TRACKED = ["title", "description", "severity", "assetId", "assigneeId", "remediation", "cveId", "status", "cvssScore"] as const;

async function assertActiveUser(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const user = await findUserById(userId);
  if (!user?.isActive) throw errors.unprocessable("The selected user does not exist or is inactive");
  return user.name;
}

async function assertAsset(assetId: string | null | undefined): Promise<void> {
  if (!assetId) return;
  if (!(await findAssetById(assetId))) throw errors.unprocessable("The selected asset does not exist");
}

function toDto(row: FindingRow, names: { asset: string | null; assignee: string | null; creator: string | null }) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    severity: row.severity,
    status: row.status,
    assetId: row.assetId,
    assetName: names.asset,
    assigneeId: row.assigneeId,
    assigneeName: names.assignee,
    remediation: row.remediation,
    cveId: row.cveId,
    cvssScore: row.cvssScore ?? null,
    component: row.component ?? null,
    installedVersion: row.installedVersion ?? null,
    fixedVersion: row.fixedVersion ?? null,
    remediationDeadline: iso(row.remediationDeadline ?? null),
    source: row.source ?? "manual",
    scanId: row.scanId ?? null,
    lastSeenAt: iso(row.lastSeenAt ?? null),
    createdById: row.createdById,
    createdByName: names.creator,
    resolvedAt: iso(row.resolvedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listFindings(q: ListQuery) {
  const result = await listSecurityFindings(q);
  const [assetsById, names] = await Promise.all([
    findAssetNamesByIds(result.items.map((row) => row.assetId).filter((id): id is string => !!id)),
    userNameMap(result.items.flatMap((row) => [row.assigneeId, row.createdById])),
  ]);
  const assetNames = new Map(assetsById.map((asset) => [asset.id, asset.name]));
  return {
    items: result.items.map((row) =>
      toDto(row, {
        asset: row.assetId ? assetNames.get(row.assetId) ?? null : null,
        assignee: row.assigneeId ? names.get(row.assigneeId) ?? null : null,
        creator: row.createdById ? names.get(row.createdById) ?? null : null,
      }),
    ),
    pagination: paginationMeta(q.page, q.pageSize, result.total),
  };
}

export async function getFinding(id: string) {
  const finding = await findSecurityFindingById(id);
  if (!finding) throw errors.notFound("Security finding");
  const [assetsById, names, events] = await Promise.all([
    findAssetNamesByIds(finding.assetId ? [finding.assetId] : []),
    userNameMap([finding.assigneeId, finding.createdById]),
    listFindingEvents(id),
  ]);
  const eventNames = await userNameMap(events.map((event) => event.actorId));
  return {
    ...toDto(finding, {
      asset: assetsById[0]?.name ?? null,
      assignee: finding.assigneeId ? names.get(finding.assigneeId) ?? null : null,
      creator: finding.createdById ? names.get(finding.createdById) ?? null : null,
    }),
    history: events.map((event) => ({
      id: event.id,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      note: event.note,
      actorName: event.actorId ? eventNames.get(event.actorId) ?? "System" : "System",
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

export async function createFinding(actor: AuthUser, input: CreateInput, ip: string) {
  await assertAsset(input.assetId);
  await assertActiveUser(input.assigneeId);
  const now = new Date();
  const row = await createSecurityFinding(
    {
      title: input.title,
      description: input.description,
      severity: input.severity,
      assetId: input.assetId,
      assigneeId: input.assigneeId,
      remediation: input.remediation,
      cveId: input.cveId,
      cvssScore: input.cvssScore,
      component: input.component ?? null,
      installedVersion: input.installedVersion ?? null,
      fixedVersion: input.fixedVersion ?? null,
      remediationDeadline: remediationDeadline(input.severity, now),
      source: "manual",
      scanId: null,
      lastSeenAt: now,
      createdById: actor.id,
    },
    actor.id,
  );

  if (row.severity === "critical") {
    await notifyRoles(
      ["admin", "operator"],
      {
        type: "critical_finding",
        title: "New critical security finding",
        message: `${row.title} was recorded by ${actor.name}`,
        link: `/security?finding=${row.id}`,
      },
      [row.assigneeId],
    );
  } else if (row.assigneeId && row.assigneeId !== actor.id) {
    await notifyUsers([row.assigneeId], {
      type: "general",
      title: "Security finding assigned to you",
      message: `${row.title} (${humanize(row.severity)} severity)`,
      link: `/security?finding=${row.id}`,
    });
  }

  await recordAudit({
    actorId: actor.id,
    action: "finding.created",
    entityType: "security_finding",
    entityId: row.id,
    summary: `Finding "${row.title}" recorded (${row.severity})`,
    ip,
  });
  return getFinding(row.id);
}

export async function updateFinding(actor: AuthUser, id: string, input: UpdateInput, ip: string) {
  const before = await findSecurityFindingById(id);
  if (!before) throw errors.notFound("Security finding");

  const statusChanged = input.status !== undefined && input.status !== before.status;
  if (statusChanged && input.status === "accepted_risk" && !input.note) {
    throw errors.unprocessable("A justification note is required to accept a risk");
  }
  if (input.assetId !== undefined) await assertAsset(input.assetId);
  const assigneeChanged = input.assigneeId !== undefined && input.assigneeId !== before.assigneeId;
  const assigneeName = assigneeChanged ? await assertActiveUser(input.assigneeId) : null;

  const now = new Date();
  const patch: Partial<
    Pick<
      SecurityFindingDoc,
      | "title"
      | "description"
      | "severity"
      | "assetId"
      | "assigneeId"
      | "remediation"
      | "cveId"
      | "status"
      | "resolvedAt"
      | "cvssScore"
      | "component"
      | "installedVersion"
      | "fixedVersion"
      | "remediationDeadline"
    >
  > = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description;
  if (input.severity !== undefined) patch.severity = input.severity;
  if (input.assetId !== undefined) patch.assetId = input.assetId;
  if (input.assigneeId !== undefined) patch.assigneeId = input.assigneeId;
  if (input.remediation !== undefined) patch.remediation = input.remediation;
  if (input.cveId !== undefined) patch.cveId = input.cveId;
  if (input.cvssScore !== undefined) patch.cvssScore = input.cvssScore;
  if (input.component !== undefined) patch.component = input.component;
  if (input.installedVersion !== undefined) patch.installedVersion = input.installedVersion;
  if (input.fixedVersion !== undefined) patch.fixedVersion = input.fixedVersion;
  if (input.severity !== undefined && input.severity !== before.severity) {
    // Severity changes restart the remediation clock under the documented policy.
    patch.remediationDeadline = remediationDeadline(input.severity, now);
  }
  if (statusChanged && input.status) {
    patch.status = input.status;
    patch.resolvedAt = input.status === "resolved" ? now : null;
  }
  const eventsToAdd = [];
  if (statusChanged && input.status) {
    eventsToAdd.push({
      actorId: actor.id,
      fromStatus: before.status,
      toStatus: input.status,
      note: input.note || `Status changed from ${humanize(before.status)} to ${humanize(input.status)}`,
    });
  }
  if (assigneeChanged) {
    eventsToAdd.push({
      actorId: actor.id,
      fromStatus: null,
      toStatus: null,
      note: input.assigneeId ? `Assigned to ${assigneeName}` : "Unassigned",
    });
  }
  if (!statusChanged && !assigneeChanged && input.note) {
    eventsToAdd.push({ actorId: actor.id, fromStatus: null, toStatus: null, note: input.note });
  }
  const after = await updateSecurityFinding(id, patch, eventsToAdd);
  if (!after) throw errors.notFound("Security finding");

  if (assigneeChanged && input.assigneeId && input.assigneeId !== actor.id) {
    await notifyUsers([input.assigneeId], {
      type: "general",
      title: "Security finding assigned to you",
      message: after.title,
      link: `/security?finding=${id}`,
    });
  }
  if (after.severity === "critical" && before.severity !== "critical") {
    await notifyRoles(["admin", "operator"], {
      type: "critical_finding",
      title: "Finding escalated to critical",
      message: after.title,
      link: `/security?finding=${id}`,
    });
  }

  const changed = diffFields(before, after, TRACKED);
  await recordAudit({
    actorId: actor.id,
    action: "finding.updated",
    entityType: "security_finding",
    entityId: id,
    summary: changed.length ? `Updated ${changed.join(", ")}` : "Finding note recorded",
    metadata: { changedFields: changed, status: after.status },
    ip,
  });
  return getFinding(id);
}

export async function deleteFinding(actor: AuthUser, id: string, ip: string): Promise<void> {
  const row = await deleteSecurityFinding(id);
  if (!row) throw errors.notFound("Security finding");
  await recordAudit({
    actorId: actor.id,
    action: "finding.deleted",
    entityType: "security_finding",
    entityId: id,
    summary: `Finding "${row.title}" deleted`,
    ip,
  });
}

/* ---------- security operations: Trivy report import ---------- */

const MAX_VULNERABILITIES_PER_IMPORT = 1000;

/**
 * Imports a Trivy JSON report as findings for one asset.
 *
 * The upload is treated strictly as data: it is parsed, bounded (2 MB / 1000 vulnerabilities) and
 * never executed. InfraPilot does not run Trivy itself, so findings reflect the report's scan time,
 * not a live scan performed by this platform.
 */
export async function importTrivyReport(actor: AuthUser, input: TrivyImportInput, ip: string) {
  const asset = await findAssetById(input.assetId);
  if (!asset) throw errors.unprocessable("The selected asset does not exist");

  let report;
  try {
    report = parseTrivyReport(input.report);
  } catch (error) {
    if (error instanceof TrivyParseError) throw errors.unprocessable(error.message);
    throw error;
  }
  if (report.vulnerabilities.length > MAX_VULNERABILITIES_PER_IMPORT) {
    throw errors.unprocessable(
      `Report contains ${report.vulnerabilities.length} vulnerabilities; the limit per import is ${MAX_VULNERABILITIES_PER_IMPORT}. Split the report or import a filtered scan.`,
    );
  }

  const now = new Date();
  const scanId = crypto.randomUUID();
  let created = 0;
  let updated = 0;
  let reopened = 0;
  const skipped = report.skipped.length;

  for (const vulnerability of report.vulnerabilities) {
    const result = await upsertVulnerabilityFinding({
      assetId: asset.id,
      cveId: vulnerability.cveId,
      component: vulnerability.component,
      title: vulnerability.title,
      description: vulnerability.description,
      severity: vulnerability.severity,
      cvssScore: vulnerability.cvssScore,
      installedVersion: vulnerability.installedVersion,
      fixedVersion: vulnerability.fixedVersion,
      remediation: vulnerability.remediation,
      remediationDeadline: remediationDeadline(vulnerability.severity, now),
      scanId,
      seenAt: now,
      createdById: actor.id,
    });
    if (result.created) created += 1;
    else updated += 1;
    if (result.reopened) reopened += 1;
  }

  const scan = await insertScanImport({
    assetId: asset.id,
    scanner: "trivy",
    artifactName: report.artifactName,
    artifactType: report.artifactType,
    reportVersion: report.schemaVersion,
    importedById: actor.id,
    vulnerabilitiesSeen: report.vulnerabilities.length,
    findingsCreated: created,
    findingsUpdated: updated,
    findingsSkipped: skipped,
    importedAt: now,
  });

  const critical = report.vulnerabilities.filter((row) => row.severity === "critical").length;
  const high = report.vulnerabilities.filter((row) => row.severity === "high").length;

  await recordAudit({
    actorId: actor.id,
    action: "finding.report_imported",
    entityType: "asset",
    entityId: asset.id,
    summary: `Trivy report imported for ${asset.name}: ${created} new, ${updated} refreshed, ${reopened} reopened, ${skipped} skipped`,
    metadata: { scanId, artifactName: report.artifactName, critical, high, source: "trivy" },
    ip,
  });

  if (critical > 0) {
    await notifyRoles(["admin", "operator"], {
      type: "security_import",
      title: `${critical} critical vulnerabilities imported`,
      message: `${asset.name}: Trivy report ${report.artifactName} added ${created} findings.`,
      link: `/security?assetId=${asset.id}`,
    });
  }

  return {
    scanId,
    asset: { id: asset.id, name: asset.name },
    scanner: "trivy" as const,
    artifactName: report.artifactName,
    artifactType: report.artifactType,
    scannerVersion: report.scannerVersion,
    scannedAt: iso(report.scannedAt),
    importedAt: iso(scan.importedAt),
    vulnerabilitiesSeen: report.vulnerabilities.length,
    findingsCreated: created,
    findingsUpdated: updated,
    findingsSkipped: skipped,
    findingsReopened: reopened,
    criticalCount: critical,
    highCount: high,
    duplicateCount: report.duplicateCount,
    skipped: report.skipped.slice(0, 25),
    remediationPolicyDays: REMEDIATION_DAYS,
  };
}

export async function securityDashboard() {
  const metrics = await getFindingMetrics();
  const topAssets = await findAssetNamesByIds(metrics.byAsset.map((row) => row.assetId));
  const names = new Map(topAssets.map((row) => [row.id, row.name]));
  const open = metrics.byStatus.filter((row) => row.status === "open" || row.status === "in_progress").reduce((sum, row) => sum + row.count, 0);
  return {
    ...metrics,
    open,
    topAssets: metrics.byAsset.map((row) => ({ id: row.assetId, name: names.get(row.assetId) ?? "Deleted asset", count: row.count })),
  };
}

export async function scanHistory(assetId: string) {
  const rows = await listScanImports(assetId);
  return rows.map((row) => ({
    id: row.id,
    scanner: row.scanner,
    artifactName: row.artifactName,
    artifactType: row.artifactType,
    vulnerabilitiesSeen: row.vulnerabilitiesSeen,
    findingsCreated: row.findingsCreated,
    findingsUpdated: row.findingsUpdated,
    findingsSkipped: row.findingsSkipped,
    importedAt: row.importedAt.toISOString(),
  }));
}
