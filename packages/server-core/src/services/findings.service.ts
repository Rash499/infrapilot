import type { z } from "zod";
import type { SecurityFindingDoc } from "@/db/models/documents";
import { findAssetById, findAssetNamesByIds } from "@/db/repositories/assets.repository";
import {
  createSecurityFinding,
  deleteSecurityFinding,
  findSecurityFindingById,
  listFindingEvents,
  listSecurityFindings,
  updateSecurityFinding,
} from "@/db/repositories/findings.repository";
import { findUserById } from "@/db/repositories/users.repository";
import type { AuthUser } from "@/lib/auth";
import { errors, paginationMeta } from "@/lib/http";
import { notifyRoles, notifyUsers } from "@/services/notifications.service";
import { recordAudit } from "@/services/audit.service";
import { diffFields, humanize, iso, userNameMap } from "@/services/common";
import type { findingCreateSchema, findingListQuery, findingUpdateSchema } from "@/validators/schemas";

type FindingRow = SecurityFindingDoc;
type CreateInput = z.infer<typeof findingCreateSchema>;
type UpdateInput = z.infer<typeof findingUpdateSchema>;
type ListQuery = z.infer<typeof findingListQuery>;

const TRACKED = ["title", "description", "severity", "assetId", "assigneeId", "remediation", "cveId", "status"] as const;

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
  const row = await createSecurityFinding(
    {
      title: input.title,
      description: input.description,
      severity: input.severity,
      assetId: input.assetId,
      assigneeId: input.assigneeId,
      remediation: input.remediation,
      cveId: input.cveId,
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
  const patch: Partial<Pick<SecurityFindingDoc, "title" | "description" | "severity" | "assetId" | "assigneeId" | "remediation" | "cveId" | "status" | "resolvedAt">> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description;
  if (input.severity !== undefined) patch.severity = input.severity;
  if (input.assetId !== undefined) patch.assetId = input.assetId;
  if (input.assigneeId !== undefined) patch.assigneeId = input.assigneeId;
  if (input.remediation !== undefined) patch.remediation = input.remediation;
  if (input.cveId !== undefined) patch.cveId = input.cveId;
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
