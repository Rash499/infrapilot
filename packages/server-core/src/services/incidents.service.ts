import type { z } from "zod";
import type { IncidentDoc } from "@/db/models/documents";
import {
  acknowledgeIncident as acknowledgeIncidentRow,
  createIncident as createMongoIncident,
  findIncidentById,
  getIncidentStats,
  insertIncidentComment,
  listIncidentAssets,
  listIncidentComments,
  listIncidents as listMongoIncidents,
  listIncidentsForMetrics,
  updateIncident as updateMongoIncident,
} from "@/db/repositories/incidents.repository";
import { findAlertByIncidentId } from "@/db/repositories/alerts.repository";
import { listChangeRequestsForAssets } from "@/db/repositories/changes.repository";
import { listOpenFindingsForAssets } from "@/db/repositories/findings.repository";
import { computeIncidentSla, summarizeIncidents } from "../monitoring/sla";
import { findUserById } from "@/db/repositories/users.repository";
import type { AuthUser } from "@/lib/auth";
import { errors, paginationMeta } from "@/lib/http";
import { recordAudit } from "@/services/audit.service";
import { assertAssetsExist } from "@/services/assets.service";
import { humanize, iso, userNameMap } from "@/services/common";
import { notifyUsers } from "@/services/notifications.service";
import type { commentSchema, incidentCreateSchema, incidentListQuery, incidentUpdateSchema } from "@/validators/schemas";

type IncidentRow = IncidentDoc;
type CreateInput = z.infer<typeof incidentCreateSchema>;
type UpdateInput = z.infer<typeof incidentUpdateSchema>;
type ListQuery = z.infer<typeof incidentListQuery>;

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_STATUSES = ["open", "investigating", "in_progress"] as const;

export function incidentReference(n: number): string {
  return `INC-${String(n).padStart(5, "0")}`;
}

async function assertActiveUser(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const user = await findUserById(userId);
  if (!user?.isActive) throw errors.unprocessable("The selected assignee does not exist or is inactive");
  return user.name;
}

function toDto(row: IncidentRow, names: Map<string, string>) {
  return {
    id: row.id,
    reference: incidentReference(row.number),
    number: row.number,
    title: row.title,
    description: row.description,
    severity: row.severity,
    priority: row.priority,
    status: row.status,
    assigneeId: row.assigneeId,
    assigneeName: row.assigneeId ? names.get(row.assigneeId) ?? null : null,
    reporterId: row.reporterId,
    reporterName: row.reporterId ? names.get(row.reporterId) ?? null : null,
    category: row.category ?? null,
    impact: row.impact ?? null,
    urgency: row.urgency ?? null,
    acknowledgedAt: iso(row.acknowledgedAt ?? null),
    autoCreated: row.autoCreated === true,
    sourceAlertId: row.sourceAlertId ?? null,
    rootCause: row.rootCause,
    resolution: row.resolution,
    openedAt: row.openedAt.toISOString(),
    resolvedAt: iso(row.resolvedAt),
    closedAt: iso(row.closedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listIncidents(q: ListQuery) {
  const result = await listMongoIncidents(q);
  const names = await userNameMap(result.items.flatMap((row) => [row.assigneeId, row.reporterId]));
  return {
    items: result.items.map((row) => toDto(row, names)),
    pagination: paginationMeta(q.page, q.pageSize, result.total),
  };
}

export async function getIncident(id: string) {
  const row = await findIncidentById(id);
  if (!row) throw errors.notFound("Incident");
  const [names, affected, comments] = await Promise.all([
    userNameMap([row.assigneeId, row.reporterId]),
    listIncidentAssets(id),
    listIncidentComments(id),
  ]);
  const assetIds = affected.map((asset) => asset.id);
  const [alert, changes, findings] = await Promise.all([
    findAlertByIncidentId(id),
    listChangeRequestsForAssets(assetIds),
    listOpenFindingsForAssets(assetIds),
  ]);
  const authors = await userNameMap(comments.map((comment) => comment.authorId));
  type TimelineEntry = {
    id: string;
    kind: string;
    body: string;
    authorId: string | null;
    authorName: string;
    createdAt: string;
    source: "comment" | "alert" | "change" | "finding";
    href?: string;
  };
  const timeline: TimelineEntry[] = comments.map((comment) => ({
    id: comment.id,
    kind: comment.kind,
    body: comment.body,
    authorId: comment.authorId,
    authorName: comment.authorId ? authors.get(comment.authorId) ?? "System" : "System",
    createdAt: comment.createdAt.toISOString(),
    source: "comment",
  }));
  if (alert) {
    for (const event of alert.events) {
      timeline.push({
        id: `${alert.id}:${event.at.toISOString()}:${event.type}`,
        kind: "system",
        body: `Monitoring alert "${alert.title}" — ${humanize(event.type)}${event.note ? `: ${event.note}` : ""}`,
        authorId: event.actorId,
        authorName: event.actorId ? authors.get(event.actorId) ?? "User" : "Monitoring",
        createdAt: event.at.toISOString(),
        source: "alert",
        href: "/alerts",
      });
    }
  }
  for (const change of changes.slice(0, 10)) {
    timeline.push({
      id: `change:${change.id}`,
      kind: "system",
      body: `Change request #${change.number} "${change.title}" (${humanize(change.status)}, risk ${humanize(change.riskLevel)}) affects an impacted asset`,
      authorId: change.requesterId,
      authorName: change.requesterId ? authors.get(change.requesterId) ?? "User" : "Change management",
      createdAt: (change.implementedAt ?? change.plannedStartAt ?? change.createdAt).toISOString(),
      source: "change",
      href: "/changes",
    });
  }
  for (const finding of findings.slice(0, 10)) {
    timeline.push({
      id: `finding:${finding.id}`,
      kind: "system",
      body: `Open security finding (${humanize(finding.severity)}) ${finding.title}${finding.component ? ` in ${finding.component}` : ""}`,
      authorId: finding.createdById,
      authorName: finding.createdById ? authors.get(finding.createdById) ?? "User" : "Security",
      createdAt: finding.createdAt.toISOString(),
      source: "finding",
      href: "/security",
    });
  }
  timeline.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return {
    ...toDto(row, names),
    assets: affected,
    sla: computeIncidentSla(row, new Date()),
    monitoringAlert: alert
      ? { id: alert.id, status: alert.status, severity: alert.severity, title: alert.title, triggeredAt: alert.triggeredAt.toISOString() }
      : null,
    timeline,
  };
}

export async function createIncident(actor: AuthUser, input: CreateInput, ip: string) {
  const assigneeName = await assertActiveUser(input.assigneeId);
  await assertAssetsExist(input.assetIds);

  const created = await createMongoIncident({
    title: input.title,
    description: input.description,
    severity: input.severity,
    priority: input.priority,
    assigneeId: input.assigneeId,
  }, actor.id, actor.name, input.assetIds);

  if (created.assigneeId && created.assigneeId !== actor.id) {
    await notifyUsers([created.assigneeId], {
      type: "incident_assigned",
      title: `${incidentReference(created.number)} assigned to you`,
      message: created.title,
      link: `/incidents/${created.id}`,
    });
  }
  await recordAudit({
    actorId: actor.id,
    action: "incident.created",
    entityType: "incident",
    entityId: created.id,
    summary: `${incidentReference(created.number)} opened: ${created.title}${assigneeName ? ` (assigned to ${assigneeName})` : ""}`,
    ip,
  });
  return getIncident(created.id);
}

export async function updateIncident(actor: AuthUser, id: string, input: UpdateInput, ip: string) {
  const before = await findIncidentById(id);
  if (!before) throw errors.notFound("Incident");

  const nextStatus = input.status ?? before.status;
  const resolution = input.resolution !== undefined ? input.resolution : before.resolution;
  if ((nextStatus === "resolved" || nextStatus === "closed") && !resolution) {
    throw errors.unprocessable("A resolution summary is required before an incident is resolved or closed");
  }
  const statusChanged = nextStatus !== before.status;
  const assigneeChanged = input.assigneeId !== undefined && input.assigneeId !== before.assigneeId;
  const assigneeName = assigneeChanged ? await assertActiveUser(input.assigneeId) : undefined;
  if (input.assetIds) await assertAssetsExist(input.assetIds);

  const now = new Date();
  const patch: Partial<
    Pick<
      IncidentDoc,
      | "title"
      | "description"
      | "severity"
      | "priority"
      | "assigneeId"
      | "rootCause"
      | "resolution"
      | "status"
      | "resolvedAt"
      | "closedAt"
      | "acknowledgedAt"
      | "category"
      | "impact"
      | "urgency"
    >
  > = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description;
  if (input.severity !== undefined) patch.severity = input.severity;
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.assigneeId !== undefined) patch.assigneeId = input.assigneeId;
  if (input.rootCause !== undefined) patch.rootCause = input.rootCause;
  if (input.resolution !== undefined) patch.resolution = input.resolution;
  if (input.category !== undefined) patch.category = input.category;
  if (input.impact !== undefined) patch.impact = input.impact;
  if (input.urgency !== undefined) patch.urgency = input.urgency;
  if (statusChanged && nextStatus !== "open" && !before.acknowledgedAt) {
    // Moving an incident out of "open" counts as the first acknowledgement for MTTA/SLA purposes.
    patch.acknowledgedAt = now;
  }
  if (statusChanged) {
    patch.status = nextStatus;
    patch.resolvedAt = nextStatus === "resolved" ? now : nextStatus === "closed" ? (before.resolvedAt ?? now) : null;
    patch.closedAt = nextStatus === "closed" ? now : null;
  }

  const lines: string[] = [];
  if (statusChanged) lines.push(`Status changed from ${humanize(before.status)} to ${humanize(nextStatus)}`);
  if (assigneeChanged) lines.push(assigneeName ? `Assigned to ${assigneeName}` : "Unassigned");
  if (input.severity !== undefined && input.severity !== before.severity) lines.push(`Severity changed to ${humanize(input.severity)}`);
  if (input.priority !== undefined && input.priority !== before.priority) lines.push(`Priority changed to ${input.priority.toUpperCase()}`);
  if (input.assetIds) lines.push("Affected assets updated");
  if (input.rootCause !== undefined && input.rootCause !== before.rootCause) lines.push("Root cause recorded");
  if (input.resolution !== undefined && input.resolution !== before.resolution) lines.push("Resolution documented");

  const after = await updateMongoIncident(
    id,
    patch,
    input.assetIds,
    lines.map((line) => ({ authorId: actor.id, kind: "system", body: `${line} by ${actor.name}` })),
  );
  if (!after) throw errors.notFound("Incident");
  const link = `/incidents/${id}`;
  if (assigneeChanged && after.assigneeId && after.assigneeId !== actor.id) {
    await notifyUsers([after.assigneeId], {
      type: "incident_assigned",
      title: `${incidentReference(after.number)} assigned to you`,
      message: after.title,
      link,
    });
  } else if (statusChanged && after.assigneeId && after.assigneeId !== actor.id) {
    await notifyUsers([after.assigneeId], {
      type: "incident_updated",
      title: `${incidentReference(after.number)} status: ${humanize(after.status)}`,
      message: after.title,
      link,
    });
  }

  await recordAudit({
    actorId: actor.id,
    action: statusChanged ? "incident.status_changed" : "incident.updated",
    entityType: "incident",
    entityId: id,
    summary: statusChanged
      ? `${incidentReference(after.number)} status ${humanize(before.status)} → ${humanize(after.status)}`
      : `${incidentReference(after.number)} updated`,
    metadata: { from: before.status, to: after.status },
    ip,
  });
  return getIncident(id);
}

export async function addIncidentComment(actor: AuthUser, id: string, body: z.infer<typeof commentSchema>["body"], ip: string) {
  const incident = await findIncidentById(id);
  if (!incident) throw errors.notFound("Incident");
  const comment = await insertIncidentComment(id, { authorId: actor.id, kind: "comment", body });

  await notifyUsers([incident.assigneeId, incident.reporterId].filter((v): v is string => !!v && v !== actor.id), {
    type: "incident_updated",
    title: `New update on ${incidentReference(incident.number)}`,
    message: `${actor.name}: ${body.slice(0, 160)}`,
    link: `/incidents/${id}`,
  });
  await recordAudit({
    actorId: actor.id,
    action: "incident.comment_added",
    entityType: "incident",
    entityId: id,
    summary: `Comment added to ${incidentReference(incident.number)}`,
    ip,
  });
  return {
    id: comment.id,
    kind: comment.kind,
    body: comment.body,
    authorId: actor.id,
    authorName: actor.name,
    createdAt: comment.createdAt.toISOString(),
  };
}

export async function incidentStats(days: number) {
  const since = new Date(Date.now() - days * DAY_MS);
  const stats = await getIncidentStats(since);
  const severities = ["critical", "high", "medium", "low"] as const;
  const statuses = ["open", "investigating", "in_progress", "resolved", "closed"] as const;
  return {
    days,
    total: stats.total,
    bySeverity: severities.map((severity) => ({
      severity,
      count: stats.bySeverity.find((row) => row._id === severity)?.count ?? 0,
    })),
    byStatus: statuses.map((status) => ({
      status,
      count: stats.byStatus.find((row) => row._id === status)?.count ?? 0,
    })),
    openedByDay: stats.openedByDay.map((row) => ({ day: row._id, count: row.count })),
    meanTimeToResolveHours:
      stats.meanTimeToResolveHours !== null ? Math.round(stats.meanTimeToResolveHours * 10) / 10 : null,
    activeCount: stats.byStatus
      .filter((row) => (ACTIVE_STATUSES as readonly string[]).includes(row._id))
      .reduce((total, row) => total + row.count, 0),
  };
}

/** Explicit acknowledgement endpoint; idempotent so repeat calls do not distort MTTA. */
export async function acknowledgeIncident(actor: AuthUser, id: string, ip: string) {
  const before = await findIncidentById(id);
  if (!before) throw errors.notFound("Incident");
  if (before.acknowledgedAt) return getIncident(id);
  const now = new Date();
  const row = await acknowledgeIncidentRow(id, now);
  if (!row) return getIncident(id);
  await insertIncidentComment(id, {
    authorId: actor.id,
    kind: "system",
    body: `Acknowledged by ${actor.name}`,
  });
  await recordAudit({
    actorId: actor.id,
    action: "incident.acknowledged",
    entityType: "incident",
    entityId: id,
    summary: `${incidentReference(before.number)} acknowledged`,
    ip,
  });
  return getIncident(id);
}

/** SLA and throughput metrics. Open incidents contribute to open/breach counts but never to MTTR. */
export async function incidentSlaMetrics(days: number) {
  const since = new Date(Date.now() - days * DAY_MS);
  const rows = await listIncidentsForMetrics(since);
  const metrics = summarizeIncidents(rows, new Date());
  return {
    ...metrics,
    days,
    policy: {
      p1: "Acknowledge 15 min / resolve 4 h",
      p2: "Acknowledge 30 min / resolve 8 h",
      p3: "Acknowledge 2 h / resolve 24 h",
      p4: "Acknowledge 8 h / resolve 72 h",
    },
  };
}
