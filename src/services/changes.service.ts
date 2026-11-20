import { and, asc, desc, eq, ilike, inArray, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { db } from "@/db";
import { assets, changeApprovals, changeAssets, changeRequests, users } from "@/db/schema";
import { getEnv } from "@/lib/env";
import type { AuthUser } from "@/lib/auth";
import { errors, paginationMeta } from "@/lib/http";
import { recordAudit } from "@/services/audit.service";
import { assertAssetsExist } from "@/services/assets.service";
import { diffFields, humanize, iso, likeTerm, pageOffset, userNameMap } from "@/services/common";
import { notifyRoles, notifyUsers } from "@/services/notifications.service";
import type { changeCreateSchema, changeListQuery, changeTransitionSchema, changeUpdateSchema } from "@/validators/schemas";

type ChangeRow = typeof changeRequests.$inferSelect;
type CreateInput = z.infer<typeof changeCreateSchema>;
type UpdateInput = z.infer<typeof changeUpdateSchema>;
type ListQuery = z.infer<typeof changeListQuery>;
type TransitionInput = z.infer<typeof changeTransitionSchema>;

const EDITABLE_STATUSES = ["draft", "rejected"];
const TRACKED = ["title", "description", "reason", "riskLevel", "riskAssessment", "rollbackPlan", "implementerId"] as const;

export function changeReference(n: number): string {
  return `CHG-${String(n).padStart(5, "0")}`;
}

function toDto(row: ChangeRow, names: Map<string, string>, approvalsCount: number) {
  return {
    id: row.id,
    reference: changeReference(row.number),
    title: row.title,
    description: row.description,
    reason: row.reason,
    riskLevel: row.riskLevel,
    riskAssessment: row.riskAssessment,
    rollbackPlan: row.rollbackPlan,
    status: row.status,
    requesterId: row.requesterId,
    requesterName: row.requesterId ? names.get(row.requesterId) ?? null : null,
    implementerId: row.implementerId,
    implementerName: row.implementerId ? names.get(row.implementerId) ?? null : null,
    plannedStartAt: iso(row.plannedStartAt),
    plannedEndAt: iso(row.plannedEndAt),
    implementationNotes: row.implementationNotes,
    rollbackNotes: row.rollbackNotes,
    implementedAt: iso(row.implementedAt),
    approvalsCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function approvalCounts(ids: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (ids.length === 0) return map;
  const rows = await db
    .select({ changeId: changeApprovals.changeId, count: sql<number>`count(*)::int` })
    .from(changeApprovals)
    .where(and(inArray(changeApprovals.changeId, ids), eq(changeApprovals.decision, "approved")))
    .groupBy(changeApprovals.changeId);
  for (const r of rows) map.set(r.changeId, r.count);
  return map;
}

export async function listChanges(q: ListQuery) {
  const conditions: SQL[] = [];
  if (q.search) conditions.push(ilike(changeRequests.title, likeTerm(q.search)));
  if (q.status) conditions.push(eq(changeRequests.status, q.status));
  if (q.riskLevel) conditions.push(eq(changeRequests.riskLevel, q.riskLevel));
  const where = conditions.length ? and(...conditions) : undefined;

  const sortExpr = {
    createdAt: changeRequests.createdAt,
    updatedAt: changeRequests.updatedAt,
    plannedStartAt: changeRequests.plannedStartAt,
  }[q.sort];
  const order = q.order === "asc" ? asc(sortExpr) : desc(sortExpr);

  const rows = await db
    .select()
    .from(changeRequests)
    .where(where)
    .orderBy(order)
    .limit(q.pageSize)
    .offset(pageOffset(q.page, q.pageSize));
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(changeRequests).where(where);
  const names = await userNameMap([...rows.map((r) => r.requesterId), ...rows.map((r) => r.implementerId)]);
  const counts = await approvalCounts(rows.map((r) => r.id));
  return {
    items: rows.map((r) => toDto(r, names, counts.get(r.id) ?? 0)),
    pagination: paginationMeta(q.page, q.pageSize, total),
    approvalsRequired: getEnv().REQUIRED_CHANGE_APPROVALS,
  };
}

export async function getChange(id: string) {
  const [row] = await db.select().from(changeRequests).where(eq(changeRequests.id, id)).limit(1);
  if (!row) throw errors.notFound("Change request");
  const names = await userNameMap([row.requesterId, row.implementerId]);
  const affected = await db
    .select({ id: assets.id, name: assets.name, assetType: assets.assetType })
    .from(changeAssets)
    .innerJoin(assets, eq(changeAssets.assetId, assets.id))
    .where(eq(changeAssets.changeId, id))
    .orderBy(asc(assets.name));
  const approvals = await db
    .select({ approval: changeApprovals, approverName: users.name })
    .from(changeApprovals)
    .leftJoin(users, eq(changeApprovals.approverId, users.id))
    .where(eq(changeApprovals.changeId, id))
    .orderBy(asc(changeApprovals.decidedAt));
  const counts = await approvalCounts([id]);
  return {
    ...toDto(row, names, counts.get(id) ?? 0),
    approvalsRequired: getEnv().REQUIRED_CHANGE_APPROVALS,
    assets: affected,
    approvals: approvals.map((a) => ({
      id: a.approval.id,
      decision: a.approval.decision,
      comment: a.approval.comment,
      approverName: a.approverName ?? "Unknown",
      decidedAt: a.approval.decidedAt.toISOString(),
    })),
  };
}

async function assertUserId(userId: string | null | undefined): Promise<void> {
  if (!userId) return;
  const names = await userNameMap([userId]);
  if (!names.has(userId)) throw errors.unprocessable("The selected implementer does not exist");
}

export async function createChange(actor: AuthUser, input: CreateInput, ip: string) {
  await assertAssetsExist(input.assetIds);
  await assertUserId(input.implementerId);
  const row = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(changeRequests)
      .values({
        title: input.title,
        description: input.description,
        reason: input.reason,
        riskLevel: input.riskLevel,
        riskAssessment: input.riskAssessment,
        rollbackPlan: input.rollbackPlan,
        status: "draft",
        requesterId: actor.id,
        implementerId: input.implementerId,
        plannedStartAt: input.plannedStartAt ? new Date(input.plannedStartAt) : null,
        plannedEndAt: input.plannedEndAt ? new Date(input.plannedEndAt) : null,
      })
      .returning();
    if (!created) throw errors.badRequest("Change request could not be created");
    if (input.assetIds.length > 0) {
      await tx.insert(changeAssets).values(input.assetIds.map((assetId) => ({ changeId: created.id, assetId })));
    }
    return created;
  });
  await recordAudit({
    actorId: actor.id,
    action: "change.created",
    entityType: "change_request",
    entityId: row.id,
    summary: `${changeReference(row.number)} drafted: ${row.title}`,
    ip,
  });
  return getChange(row.id);
}

export async function updateChange(actor: AuthUser, id: string, input: UpdateInput, ip: string) {
  const [before] = await db.select().from(changeRequests).where(eq(changeRequests.id, id)).limit(1);
  if (!before) throw errors.notFound("Change request");
  if (!EDITABLE_STATUSES.includes(before.status)) {
    throw errors.unprocessable("Only draft or rejected change requests can be edited");
  }
  if (before.requesterId !== actor.id && actor.role !== "admin") {
    throw errors.forbidden("Only the requester or an administrator can edit this change");
  }
  if (input.assetIds) await assertAssetsExist(input.assetIds);
  if (input.implementerId !== undefined) await assertUserId(input.implementerId);

  const patch: Partial<typeof changeRequests.$inferInsert> = { updatedAt: new Date() };
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description;
  if (input.reason !== undefined) patch.reason = input.reason;
  if (input.riskLevel !== undefined) patch.riskLevel = input.riskLevel;
  if (input.riskAssessment !== undefined) patch.riskAssessment = input.riskAssessment;
  if (input.rollbackPlan !== undefined) patch.rollbackPlan = input.rollbackPlan;
  if (input.implementerId !== undefined) patch.implementerId = input.implementerId;
  if (input.plannedStartAt !== undefined) patch.plannedStartAt = input.plannedStartAt ? new Date(input.plannedStartAt) : null;
  if (input.plannedEndAt !== undefined) patch.plannedEndAt = input.plannedEndAt ? new Date(input.plannedEndAt) : null;

  await db.transaction(async (tx) => {
    await tx.update(changeRequests).set(patch).where(eq(changeRequests.id, id));
    if (input.assetIds) {
      await tx.delete(changeAssets).where(eq(changeAssets.changeId, id));
      if (input.assetIds.length > 0) {
        await tx.insert(changeAssets).values(input.assetIds.map((assetId) => ({ changeId: id, assetId })));
      }
    }
  });
  const [after] = await db.select().from(changeRequests).where(eq(changeRequests.id, id)).limit(1);
  if (!after) throw errors.notFound("Change request");
  const changed = diffFields(before, after, TRACKED);
  await recordAudit({
    actorId: actor.id,
    action: "change.updated",
    entityType: "change_request",
    entityId: id,
    summary: changed.length ? `${changeReference(after.number)} updated: ${changed.join(", ")}` : `${changeReference(after.number)} reviewed`,
    metadata: { changedFields: changed },
    ip,
  });
  return getChange(id);
}

export async function submitChange(actor: AuthUser, id: string, ip: string) {
  const [row] = await db.select().from(changeRequests).where(eq(changeRequests.id, id)).limit(1);
  if (!row) throw errors.notFound("Change request");
  if (row.requesterId !== actor.id && actor.role !== "admin") {
    throw errors.forbidden("Only the requester can submit this change");
  }
  if (!EDITABLE_STATUSES.includes(row.status)) throw errors.unprocessable(`A ${humanize(row.status).toLowerCase()} change cannot be submitted`);
  if (!row.riskAssessment || !row.rollbackPlan) {
    throw errors.unprocessable("A risk assessment and rollback plan are required before submission");
  }
  await db
    .update(changeRequests)
    .set({ status: "pending_approval", updatedAt: new Date() })
    .where(eq(changeRequests.id, id));
  await notifyRoles(
    ["admin", "operator"],
    {
      type: "change_pending_approval",
      title: `${changeReference(row.number)} awaiting approval`,
      message: row.title,
      link: `/changes?change=${id}`,
    },
    [],
    actor.id,
  );
  await recordAudit({
    actorId: actor.id,
    action: "change.submitted",
    entityType: "change_request",
    entityId: id,
    summary: `${changeReference(row.number)} submitted for approval`,
    ip,
  });
  return getChange(id);
}

export async function decideChange(actor: AuthUser, id: string, decision: "approved" | "rejected", comment: string | null, ip: string) {
  const [row] = await db.select().from(changeRequests).where(eq(changeRequests.id, id)).limit(1);
  if (!row) throw errors.notFound("Change request");
  if (row.status !== "pending_approval") throw errors.unprocessable("This change is not awaiting approval");
  if (row.requesterId === actor.id) throw errors.forbidden("Requesters cannot approve their own change");
  if (decision === "rejected" && !comment) throw errors.unprocessable("A comment is required when rejecting a change");

  const existing = await db
    .select({ id: changeApprovals.id })
    .from(changeApprovals)
    .where(and(eq(changeApprovals.changeId, id), eq(changeApprovals.approverId, actor.id)))
    .limit(1);
  if (existing.length > 0) throw errors.conflict("You have already recorded a decision for this change");

  const required = getEnv().REQUIRED_CHANGE_APPROVALS;
  const approvedSoFar = (await approvalCounts([id])).get(id) ?? 0;
  const nextStatus =
    decision === "rejected" ? "rejected" : approvedSoFar + 1 >= required ? "approved" : "pending_approval";

  await db.transaction(async (tx) => {
    await tx.insert(changeApprovals).values({ changeId: id, approverId: actor.id, decision, comment });
    await tx.update(changeRequests).set({ status: nextStatus, updatedAt: new Date() }).where(eq(changeRequests.id, id));
  });

  await notifyUsers([row.requesterId], {
    type: "change_decision",
    title: `${changeReference(row.number)} ${nextStatus === "pending_approval" ? "received an approval" : nextStatus}`,
    message: `${actor.name} ${decision === "approved" ? "approved" : "rejected"} "${row.title}"${comment ? `: ${comment}` : ""}`,
    link: `/changes?change=${id}`,
  });
  await recordAudit({
    actorId: actor.id,
    action: `change.${decision}`,
    entityType: "change_request",
    entityId: id,
    summary: `${changeReference(row.number)} ${decision} by ${actor.name} (status: ${humanize(nextStatus)})`,
    ip,
  });
  return getChange(id);
}

export async function transitionChange(actor: AuthUser, id: string, input: TransitionInput, ip: string) {
  const [row] = await db.select().from(changeRequests).where(eq(changeRequests.id, id)).limit(1);
  if (!row) throw errors.notFound("Change request");

  const invalid = () => errors.unprocessable(`A ${humanize(row.status).toLowerCase()} change cannot be ${input.action === "implement" ? "implemented" : input.action === "rollback" ? "rolled back" : "cancelled"}`);
  const now = new Date();
  let patch: Partial<typeof changeRequests.$inferInsert>;

  if (input.action === "implement") {
    if (row.status !== "approved") throw invalid();
    patch = {
      status: "implemented",
      implementedAt: now,
      implementerId: row.implementerId ?? actor.id,
      implementationNotes: input.notes ?? row.implementationNotes,
    };
  } else if (input.action === "rollback") {
    if (row.status !== "implemented") throw invalid();
    patch = { status: "rolled_back", rollbackNotes: input.notes ?? null };
  } else {
    if (!["draft", "pending_approval", "approved", "rejected"].includes(row.status)) throw invalid();
    patch = { status: "cancelled" };
  }

  await db.update(changeRequests).set({ ...patch, updatedAt: now }).where(eq(changeRequests.id, id));
  if (row.requesterId && row.requesterId !== actor.id) {
    await notifyUsers([row.requesterId], {
      type: "change_decision",
      title: `${changeReference(row.number)} ${humanize(patch.status ?? row.status).toLowerCase()}`,
      message: row.title,
      link: `/changes?change=${id}`,
    });
  }
  await recordAudit({
    actorId: actor.id,
    action: `change.${input.action}`,
    entityType: "change_request",
    entityId: id,
    summary: `${changeReference(row.number)} ${humanize(row.status)} → ${humanize(patch.status ?? row.status)}`,
    metadata: { notes: input.notes ?? null },
    ip,
  });
  return getChange(id);
}
