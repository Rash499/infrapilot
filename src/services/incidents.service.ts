import { and, asc, desc, eq, notInArray, ilike, inArray, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { db } from "@/db";
import { assets, incidentAssets, incidentComments, incidents, users } from "@/db/schema";
import type { AuthUser } from "@/lib/auth";
import { errors, paginationMeta } from "@/lib/http";
import { recordAudit } from "@/services/audit.service";
import { assertAssetsExist } from "@/services/assets.service";
import { humanize, iso, likeTerm, pageOffset, userNameMap } from "@/services/common";
import { notifyUsers } from "@/services/notifications.service";
import type { commentSchema, incidentCreateSchema, incidentListQuery, incidentUpdateSchema } from "@/validators/schemas";

type IncidentRow = typeof incidents.$inferSelect;
type CreateInput = z.infer<typeof incidentCreateSchema>;
type UpdateInput = z.infer<typeof incidentUpdateSchema>;
type ListQuery = z.infer<typeof incidentListQuery>;

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_STATUSES = ["open", "investigating", "in_progress"] as const;
const CLOSED_STATUSES = ["resolved", "closed"] as const;

export function incidentReference(n: number): string {
  return `INC-${String(n).padStart(5, "0")}`;
}

const severityRank = sql`case ${incidents.severity} when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`;

async function assertActiveUser(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const [row] = await db.select({ name: users.name, isActive: users.isActive }).from(users).where(eq(users.id, userId)).limit(1);
  if (!row || !row.isActive) throw errors.unprocessable("The selected assignee does not exist or is inactive");
  return row.name;
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
  const conditions: SQL[] = [];
  if (q.search) conditions.push(ilike(incidents.title, likeTerm(q.search)));
  if (q.status) conditions.push(eq(incidents.status, q.status));
  if (q.severity) conditions.push(eq(incidents.severity, q.severity));
  if (q.priority) conditions.push(eq(incidents.priority, q.priority));
  if (q.assigneeId) conditions.push(eq(incidents.assigneeId, q.assigneeId));
  if (q.assetId) {
    conditions.push(
      inArray(incidents.id, db.select({ id: incidentAssets.incidentId }).from(incidentAssets).where(eq(incidentAssets.assetId, q.assetId))),
    );
  }
  if (q.active === "true") conditions.push(notInArray(incidents.status, [...CLOSED_STATUSES]));
  if (q.active === "false") conditions.push(inArray(incidents.status, [...CLOSED_STATUSES]));
  const where = conditions.length ? and(...conditions) : undefined;

  const sortExpr =
    q.sort === "severity"
      ? severityRank
      : { openedAt: incidents.openedAt, priority: incidents.priority, updatedAt: incidents.updatedAt }[q.sort === "openedAt" ? "openedAt" : q.sort === "priority" ? "priority" : "updatedAt"];
  const order = q.order === "asc" ? asc(sortExpr) : desc(sortExpr);

  const rows = await db
    .select()
    .from(incidents)
    .where(where)
    .orderBy(order)
    .limit(q.pageSize)
    .offset(pageOffset(q.page, q.pageSize));
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(incidents).where(where);
  const names = await userNameMap([...rows.map((r) => r.assigneeId), ...rows.map((r) => r.reporterId)]);
  return {
    items: rows.map((r) => toDto(r, names)),
    pagination: paginationMeta(q.page, q.pageSize, total),
  };
}

export async function getIncident(id: string) {
  const [row] = await db.select().from(incidents).where(eq(incidents.id, id)).limit(1);
  if (!row) throw errors.notFound("Incident");
  const names = await userNameMap([row.assigneeId, row.reporterId]);

  const affected = await db
    .select({ id: assets.id, name: assets.name, assetType: assets.assetType, status: assets.status })
    .from(incidentAssets)
    .innerJoin(assets, eq(incidentAssets.assetId, assets.id))
    .where(eq(incidentAssets.incidentId, id))
    .orderBy(asc(assets.name));

  const comments = await db
    .select({ comment: incidentComments, authorName: users.name })
    .from(incidentComments)
    .leftJoin(users, eq(incidentComments.authorId, users.id))
    .where(eq(incidentComments.incidentId, id))
    .orderBy(asc(incidentComments.createdAt));

  return {
    ...toDto(row, names),
    assets: affected,
    timeline: comments.map((c) => ({
      id: c.comment.id,
      kind: c.comment.kind,
      body: c.comment.body,
      authorId: c.comment.authorId,
      authorName: c.authorName ?? "System",
      createdAt: c.comment.createdAt.toISOString(),
    })),
  };
}

export async function createIncident(actor: AuthUser, input: CreateInput, ip: string) {
  const assigneeName = await assertActiveUser(input.assigneeId);
  await assertAssetsExist(input.assetIds);

  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(incidents)
      .values({
        title: input.title,
        description: input.description,
        severity: input.severity,
        priority: input.priority,
        status: "open",
        assigneeId: input.assigneeId,
        reporterId: actor.id,
      })
      .returning();
    if (!row) throw errors.badRequest("Incident could not be created");
    if (input.assetIds.length > 0) {
      await tx.insert(incidentAssets).values(input.assetIds.map((assetId) => ({ incidentId: row.id, assetId })));
    }
    await tx.insert(incidentComments).values({
      incidentId: row.id,
      authorId: actor.id,
      kind: "system",
      body: `Incident opened by ${actor.name} (${humanize(input.severity)} severity, ${input.priority.toUpperCase()})`,
    });
    return row;
  });

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
  const [before] = await db.select().from(incidents).where(eq(incidents.id, id)).limit(1);
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
  const patch: Partial<typeof incidents.$inferInsert> = { updatedAt: now };
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description;
  if (input.severity !== undefined) patch.severity = input.severity;
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.assigneeId !== undefined) patch.assigneeId = input.assigneeId;
  if (input.rootCause !== undefined) patch.rootCause = input.rootCause;
  if (input.resolution !== undefined) patch.resolution = input.resolution;
  if (statusChanged) {
    patch.status = nextStatus;
    patch.resolvedAt = nextStatus === "resolved" ? now : nextStatus === "closed" ? (before.resolvedAt ?? now) : null;
    patch.closedAt = nextStatus === "closed" ? now : null;
  }

  await db.transaction(async (tx) => {
    await tx.update(incidents).set(patch).where(eq(incidents.id, id));
    if (input.assetIds) {
      await tx.delete(incidentAssets).where(eq(incidentAssets.incidentId, id));
      if (input.assetIds.length > 0) {
        await tx.insert(incidentAssets).values(input.assetIds.map((assetId) => ({ incidentId: id, assetId })));
      }
    }
    const lines: string[] = [];
    if (statusChanged) lines.push(`Status changed from ${humanize(before.status)} to ${humanize(nextStatus)}`);
    if (assigneeChanged) lines.push(assigneeName ? `Assigned to ${assigneeName}` : "Unassigned");
    if (input.severity !== undefined && input.severity !== before.severity) lines.push(`Severity changed to ${humanize(input.severity)}`);
    if (input.priority !== undefined && input.priority !== before.priority) lines.push(`Priority changed to ${input.priority.toUpperCase()}`);
    if (input.assetIds) lines.push("Affected assets updated");
    if (input.rootCause !== undefined && input.rootCause !== before.rootCause) lines.push("Root cause recorded");
    if (input.resolution !== undefined && input.resolution !== before.resolution) lines.push("Resolution documented");
    if (lines.length > 0) {
      await tx.insert(incidentComments).values(
        lines.map((line) => ({ incidentId: id, authorId: actor.id, kind: "system" as const, body: `${line} by ${actor.name}` })),
      );
    }
  });

  const [after] = await db.select().from(incidents).where(eq(incidents.id, id)).limit(1);
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
  const [incident] = await db.select().from(incidents).where(eq(incidents.id, id)).limit(1);
  if (!incident) throw errors.notFound("Incident");
  const [comment] = await db
    .insert(incidentComments)
    .values({ incidentId: id, authorId: actor.id, kind: "comment", body })
    .returning();
  if (!comment) throw errors.badRequest("Comment could not be saved");

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
  const dayExpr = sql<string>`to_char(date_trunc('day', ${incidents.openedAt}), 'YYYY-MM-DD')`;

  const [bySeverity, byStatus, byDay, [mttr], [{ total }]] = await Promise.all([
    db
      .select({ severity: incidents.severity, count: sql<number>`count(*)::int` })
      .from(incidents)
      .where(sql`${incidents.openedAt} >= ${since}`)
      .groupBy(incidents.severity),
    db
      .select({ status: incidents.status, count: sql<number>`count(*)::int` })
      .from(incidents)
      .groupBy(incidents.status),
    db
      .select({ day: dayExpr, count: sql<number>`count(*)::int` })
      .from(incidents)
      .where(sql`${incidents.openedAt} >= ${since}`)
      .groupBy(dayExpr)
      .orderBy(dayExpr),
    db
      .select({ hours: sql<number | null>`avg(extract(epoch from (${incidents.resolvedAt} - ${incidents.openedAt})) / 3600)::float` })
      .from(incidents)
      .where(and(sql`${incidents.resolvedAt} is not null`, sql`${incidents.openedAt} >= ${since}`)),
    db.select({ total: sql<number>`count(*)::int` }).from(incidents).where(sql`${incidents.openedAt} >= ${since}`),
  ]);

  const severities = ["critical", "high", "medium", "low"] as const;
  const statuses = ["open", "investigating", "in_progress", "resolved", "closed"] as const;
  return {
    days,
    total,
    bySeverity: severities.map((s) => ({ severity: s, count: bySeverity.find((r) => r.severity === s)?.count ?? 0 })),
    byStatus: statuses.map((s) => ({ status: s, count: byStatus.find((r) => r.status === s)?.count ?? 0 })),
    openedByDay: byDay,
    meanTimeToResolveHours: mttr?.hours !== null && mttr?.hours !== undefined ? Math.round(mttr.hours * 10) / 10 : null,
    activeCount: byStatus.filter((r) => (ACTIVE_STATUSES as readonly string[]).includes(r.status)).reduce((a, r) => a + r.count, 0),
  };
}
