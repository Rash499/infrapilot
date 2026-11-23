import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { db } from "@/db";
import { assets, findingEvents, securityFindings, users } from "@/db/schema";
import type { FindingStatus, SecurityFindingDoc } from "@/db/models/documents";
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
import { diffFields, humanize, iso, likeTerm, pageOffset, userNameMap } from "@/services/common";
import type { findingCreateSchema, findingListQuery, findingUpdateSchema } from "@/validators/schemas";

type FindingRow = typeof securityFindings.$inferSelect | SecurityFindingDoc;
type CreateInput = z.infer<typeof findingCreateSchema>;
type UpdateInput = z.infer<typeof findingUpdateSchema>;
type ListQuery = z.infer<typeof findingListQuery>;

const TRACKED = ["title", "description", "severity", "assetId", "assigneeId", "remediation", "cveId", "status"] as const;

const severityRank = sql`case ${securityFindings.severity} when 'critical' then 0 when 'high' then 1 when 'medium' then 2 when 'low' then 3 else 4 end`;

async function assertActiveUser(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  if (process.env.MONGODB_URI) {
    const user = await findUserById(userId);
    if (!user?.isActive) throw errors.unprocessable("The selected user does not exist or is inactive");
    return user.name;
  }
  const [row] = await db.select({ id: users.id, name: users.name, isActive: users.isActive }).from(users).where(eq(users.id, userId)).limit(1);
  if (!row || !row.isActive) throw errors.unprocessable("The selected user does not exist or is inactive");
  return row.name;
}

async function assertAsset(assetId: string | null | undefined): Promise<void> {
  if (!assetId) return;
  if (process.env.MONGODB_URI) {
    if (!(await findAssetById(assetId))) throw errors.unprocessable("The selected asset does not exist");
    return;
  }
  const [row] = await db.select({ id: assets.id }).from(assets).where(eq(assets.id, assetId)).limit(1);
  if (!row) throw errors.unprocessable("The selected asset does not exist");
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
  if (process.env.MONGODB_URI) {
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
  const conditions: SQL[] = [];
  if (q.search) {
    const pattern = likeTerm(q.search);
    conditions.push(or(ilike(securityFindings.title, pattern), ilike(securityFindings.cveId, pattern))!);
  }
  if (q.severity) conditions.push(eq(securityFindings.severity, q.severity));
  if (q.status) conditions.push(eq(securityFindings.status, q.status));
  if (q.assetId) conditions.push(eq(securityFindings.assetId, q.assetId));
  if (q.assigneeId) conditions.push(eq(securityFindings.assigneeId, q.assigneeId));
  const where = conditions.length ? and(...conditions) : undefined;

  const sortExpr =
    q.sort === "severity"
      ? severityRank
      : {
          createdAt: securityFindings.createdAt,
          updatedAt: securityFindings.updatedAt,
          title: securityFindings.title,
        }[q.sort];
  const order = q.order === "asc" ? asc(sortExpr) : desc(sortExpr);

  const rows = await db
    .select({ finding: securityFindings, assetName: assets.name })
    .from(securityFindings)
    .leftJoin(assets, eq(securityFindings.assetId, assets.id))
    .where(where)
    .orderBy(order, desc(securityFindings.createdAt))
    .limit(q.pageSize)
    .offset(pageOffset(q.page, q.pageSize));
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(securityFindings).where(where);
  const names = await userNameMap([...rows.map((r) => r.finding.assigneeId), ...rows.map((r) => r.finding.createdById)]);

  return {
    items: rows.map((r) =>
      toDto(r.finding, {
        asset: r.assetName ?? null,
        assignee: r.finding.assigneeId ? names.get(r.finding.assigneeId) ?? null : null,
        creator: r.finding.createdById ? names.get(r.finding.createdById) ?? null : null,
      }),
    ),
    pagination: paginationMeta(q.page, q.pageSize, total),
  };
}

export async function getFinding(id: string) {
  if (process.env.MONGODB_URI) {
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
  const [row] = await db
    .select({ finding: securityFindings, assetName: assets.name })
    .from(securityFindings)
    .leftJoin(assets, eq(securityFindings.assetId, assets.id))
    .where(eq(securityFindings.id, id))
    .limit(1);
  if (!row) throw errors.notFound("Security finding");

  const events = await db
    .select({ event: findingEvents, actorName: users.name })
    .from(findingEvents)
    .leftJoin(users, eq(findingEvents.actorId, users.id))
    .where(eq(findingEvents.findingId, id))
    .orderBy(asc(findingEvents.createdAt));

  const names = await userNameMap([row.finding.assigneeId, row.finding.createdById]);
  return {
    ...toDto(row.finding, {
      asset: row.assetName ?? null,
      assignee: row.finding.assigneeId ? names.get(row.finding.assigneeId) ?? null : null,
      creator: row.finding.createdById ? names.get(row.finding.createdById) ?? null : null,
    }),
    history: events.map((e) => ({
      id: e.event.id,
      fromStatus: e.event.fromStatus,
      toStatus: e.event.toStatus,
      note: e.event.note,
      actorName: e.actorName ?? "System",
      createdAt: e.event.createdAt.toISOString(),
    })),
  };
}

export async function createFinding(actor: AuthUser, input: CreateInput, ip: string) {
  await assertAsset(input.assetId);
  await assertActiveUser(input.assigneeId);
  const row = process.env.MONGODB_URI
    ? await createSecurityFinding({
        title: input.title,
        description: input.description,
        severity: input.severity,
        assetId: input.assetId,
        assigneeId: input.assigneeId,
        remediation: input.remediation,
        cveId: input.cveId,
        createdById: actor.id,
      }, actor.id)
    : (await db
    .insert(securityFindings)
    .values({
      title: input.title,
      description: input.description,
      severity: input.severity,
      status: "open",
      assetId: input.assetId,
      assigneeId: input.assigneeId,
      remediation: input.remediation,
      cveId: input.cveId,
      createdById: actor.id,
    })
    .returning())[0] ?? null;
  if (!row) throw errors.badRequest("Finding could not be created");

  if (!process.env.MONGODB_URI) {
    await db.insert(findingEvents).values({
      findingId: row.id,
      actorId: actor.id,
      fromStatus: null,
      toStatus: "open",
      note: "Finding recorded",
    });
  }

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
  const before = process.env.MONGODB_URI
    ? await findSecurityFindingById(id)
    : (await db.select().from(securityFindings).where(eq(securityFindings.id, id)).limit(1))[0] ?? null;
  if (!before) throw errors.notFound("Security finding");

  const statusChanged = input.status !== undefined && input.status !== before.status;
  if (statusChanged && input.status === "accepted_risk" && !input.note) {
    throw errors.unprocessable("A justification note is required to accept a risk");
  }
  if (input.assetId !== undefined) await assertAsset(input.assetId);
  const assigneeChanged = input.assigneeId !== undefined && input.assigneeId !== before.assigneeId;
  const assigneeName = assigneeChanged ? await assertActiveUser(input.assigneeId) : null;

  const now = new Date();
  let after: FindingRow | null;
  if (process.env.MONGODB_URI) {
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
    after = await updateSecurityFinding(id, patch, eventsToAdd);
  } else {
    const patch: Partial<typeof securityFindings.$inferInsert> = { updatedAt: now };
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
    await db.transaction(async (tx) => {
      await tx.update(securityFindings).set(patch).where(eq(securityFindings.id, id));
      if (statusChanged && input.status) {
        await tx.insert(findingEvents).values({
          findingId: id,
          actorId: actor.id,
          fromStatus: before.status,
          toStatus: input.status,
          note: input.note || `Status changed from ${humanize(before.status)} to ${humanize(input.status)}`,
        });
      }
      if (assigneeChanged) {
        await tx.insert(findingEvents).values({
          findingId: id,
          actorId: actor.id,
          fromStatus: null,
          toStatus: null,
          note: assigneeName ? `Assigned to ${assigneeName}` : "Unassigned",
        });
      }
      if (!statusChanged && !assigneeChanged && input.note) {
        await tx.insert(findingEvents).values({
          findingId: id,
          actorId: actor.id,
          fromStatus: null,
          toStatus: null,
          note: input.note,
        });
      }
    });
    after = (await db.select().from(securityFindings).where(eq(securityFindings.id, id)).limit(1))[0] ?? null;
  }
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
  const row = process.env.MONGODB_URI
    ? await deleteSecurityFinding(id)
    : (await db.delete(securityFindings).where(eq(securityFindings.id, id)).returning({ title: securityFindings.title }))[0] ?? null;
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
