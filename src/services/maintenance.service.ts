import { and, asc, desc, eq, gt, gte, ilike, inArray, lte, lt, ne, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { db } from "@/db";
import { assets, maintenanceAssets, maintenances, users } from "@/db/schema";
import type { MaintenanceDoc } from "@/db/models/documents";
import { findAssetNamesByIds } from "@/db/repositories/assets.repository";
import {
  claimDueMaintenanceReminder,
  deleteMaintenanceById,
  findMaintenanceById,
  findMaintenanceConflicts as findMongoMaintenanceConflicts,
  insertMaintenanceWithAssets,
  listMaintenanceAssetLinks,
  listMaintenances,
  releaseMaintenanceReminderClaim,
  updateMaintenanceWithAssets,
} from "@/db/repositories/maintenance.repository";
import type { AuthUser } from "@/lib/auth";
import { errors, paginationMeta } from "@/lib/http";
import { recordAudit } from "@/services/audit.service";
import { assertAssetsExist } from "@/services/assets.service";
import { humanize, iso, likeTerm, pageOffset, userNameMap } from "@/services/common";
import { notifyUsers } from "@/services/notifications.service";
import { activeUserIdsByRoles } from "@/services/notifications.service";
import type { maintenanceCreateSchema, maintenanceListQuery, maintenanceUpdateSchema } from "@/validators/schemas";

type MaintenanceRow = typeof maintenances.$inferSelect | MaintenanceDoc;
type CreateInput = z.infer<typeof maintenanceCreateSchema>;
type UpdateInput = z.infer<typeof maintenanceUpdateSchema>;
type ListQuery = z.infer<typeof maintenanceListQuery>;

const TRANSITIONS: Record<string, string[]> = {
  scheduled: ["in_progress", "completed", "cancelled", "scheduled"],
  in_progress: ["completed", "cancelled", "in_progress"],
  completed: ["completed"],
  cancelled: ["cancelled"],
};

function toDto(row: MaintenanceRow, ownerName: string | null, assetList: Array<{ id: string; name: string }>) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    ownerId: row.ownerId,
    ownerName,
    notes: row.notes,
    assets: assetList,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function assetSummaries(maintenanceIds: string[]) {
  const map = new Map<string, Array<{ id: string; name: string }>>();
  if (maintenanceIds.length === 0) return map;
  if (process.env.MONGODB_URI) {
    const links = await listMaintenanceAssetLinks(maintenanceIds);
    const names = await findAssetNamesByIds(links.map((link) => link.assetId));
    const nameById = new Map(names.map((asset) => [asset.id, asset.name]));
    for (const link of links) {
      const name = nameById.get(link.assetId);
      if (!name) continue;
      const list = map.get(link.maintenanceId) ?? [];
      list.push({ id: link.assetId, name });
      map.set(link.maintenanceId, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return map;
  }
  const rows = await db
    .select({ maintenanceId: maintenanceAssets.maintenanceId, id: assets.id, name: assets.name })
    .from(maintenanceAssets)
    .innerJoin(assets, eq(maintenanceAssets.assetId, assets.id))
    .where(inArray(maintenanceAssets.maintenanceId, maintenanceIds))
    .orderBy(asc(assets.name));
  for (const r of rows) {
    const list = map.get(r.maintenanceId) ?? [];
    list.push({ id: r.id, name: r.name });
    map.set(r.maintenanceId, list);
  }
  return map;
}

/** Finds scheduled or running maintenance that overlaps the window for any of the same assets. */
export async function findMaintenanceConflicts(assetIds: string[], startsAt: Date, endsAt: Date, excludeId?: string) {
  if (assetIds.length === 0) return [];
  if (process.env.MONGODB_URI) {
    const rows = await findMongoMaintenanceConflicts(assetIds, startsAt, endsAt, excludeId);
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
    }));
  }
  const rows = await db
    .select({ id: maintenances.id, title: maintenances.title, startsAt: maintenances.startsAt, endsAt: maintenances.endsAt })
    .from(maintenances)
    .innerJoin(maintenanceAssets, eq(maintenanceAssets.maintenanceId, maintenances.id))
    .where(
      and(
        inArray(maintenanceAssets.assetId, assetIds),
        inArray(maintenances.status, ["scheduled", "in_progress"]),
        lt(maintenances.startsAt, endsAt),
        gt(maintenances.endsAt, startsAt),
        excludeId ? ne(maintenances.id, excludeId) : undefined,
      ),
    );
  const seen = new Map<string, { id: string; title: string; startsAt: string; endsAt: string }>();
  for (const r of rows) {
    seen.set(r.id, { id: r.id, title: r.title, startsAt: r.startsAt.toISOString(), endsAt: r.endsAt.toISOString() });
  }
  return [...seen.values()];
}

export async function listMaintenance(q: ListQuery) {
  if (process.env.MONGODB_URI) {
    const result = await listMaintenances(q);
    const owners = await userNameMap(result.items.map((row) => row.ownerId));
    const summaries = await assetSummaries(result.items.map((row) => row.id));
    return {
      items: result.items.map((row) => toDto(row, row.ownerId ? owners.get(row.ownerId) ?? null : null, summaries.get(row.id) ?? [])),
      pagination: paginationMeta(q.page, q.pageSize, result.total),
    };
  }
  const conditions: SQL[] = [];
  if (q.search) conditions.push(ilike(maintenances.title, likeTerm(q.search)));
  if (q.status) conditions.push(eq(maintenances.status, q.status));
  if (q.from) conditions.push(gte(maintenances.endsAt, new Date(q.from)));
  if (q.to) conditions.push(lte(maintenances.startsAt, new Date(q.to)));
  const where = conditions.length ? and(...conditions) : undefined;

  const sortExpr = q.sort === "createdAt" ? maintenances.createdAt : maintenances.startsAt;
  const order = q.order === "asc" ? asc(sortExpr) : desc(sortExpr);
  const rows = await db
    .select()
    .from(maintenances)
    .where(where)
    .orderBy(order)
    .limit(q.pageSize)
    .offset(pageOffset(q.page, q.pageSize));
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(maintenances).where(where);
  const owners = await userNameMap(rows.map((r) => r.ownerId));
  const summaries = await assetSummaries(rows.map((r) => r.id));
  return {
    items: rows.map((r) => toDto(r, r.ownerId ? owners.get(r.ownerId) ?? null : null, summaries.get(r.id) ?? [])),
    pagination: paginationMeta(q.page, q.pageSize, total),
  };
}

export async function getMaintenance(id: string) {
  const row = process.env.MONGODB_URI
    ? await findMaintenanceById(id)
    : (await db.select().from(maintenances).where(eq(maintenances.id, id)).limit(1))[0] ?? null;
  if (!row) throw errors.notFound("Maintenance");
  const owners = await userNameMap([row.ownerId]);
  const summaries = await assetSummaries([id]);
  const conflicts = await findMaintenanceConflicts(
    (summaries.get(id) ?? []).map((a) => a.id),
    row.startsAt,
    row.endsAt,
    id,
  );
  return { ...toDto(row, row.ownerId ? owners.get(row.ownerId) ?? null : null, summaries.get(id) ?? []), conflicts };
}

export async function createMaintenance(actor: AuthUser, input: CreateInput, ip: string) {
  await assertAssetsExist(input.assetIds);
  if (input.ownerId) {
    const names = await userNameMap([input.ownerId]);
    if (!names.has(input.ownerId)) throw errors.unprocessable("The selected owner does not exist");
  }
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  const conflicts = await findMaintenanceConflicts(input.assetIds, startsAt, endsAt);

  const row = process.env.MONGODB_URI
    ? await insertMaintenanceWithAssets(
        {
          title: input.title,
          description: input.description,
          startsAt,
          endsAt,
          ownerId: input.ownerId,
          createdById: actor.id,
          notes: input.notes,
        },
        input.assetIds,
      )
    : await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(maintenances)
      .values({
        title: input.title,
        description: input.description,
        status: "scheduled",
        startsAt,
        endsAt,
        ownerId: input.ownerId,
        createdById: actor.id,
        notes: input.notes,
      })
      .returning();
    if (!created) throw errors.badRequest("Maintenance could not be scheduled");
    if (input.assetIds.length > 0) {
      await tx.insert(maintenanceAssets).values(input.assetIds.map((assetId) => ({ maintenanceId: created.id, assetId })));
    }
    return created;
  });
  if (!row) throw errors.badRequest("Maintenance could not be scheduled");

  if (row.ownerId && row.ownerId !== actor.id) {
    await notifyUsers([row.ownerId], {
      type: "maintenance_scheduled",
      title: "Maintenance assigned to you",
      message: `${row.title} starts ${startsAt.toUTCString()}`,
      link: "/maintenance",
    });
  }
  await recordAudit({
    actorId: actor.id,
    action: "maintenance.scheduled",
    entityType: "maintenance",
    entityId: row.id,
    summary: `Maintenance "${row.title}" scheduled`,
    metadata: { conflicts: conflicts.map((c) => c.id) },
    ip,
  });
  return { ...(await getMaintenance(row.id)), conflictWarnings: conflicts.length };
}

export async function updateMaintenance(actor: AuthUser, id: string, input: UpdateInput, ip: string) {
  const before = process.env.MONGODB_URI
    ? await findMaintenanceById(id)
    : (await db.select().from(maintenances).where(eq(maintenances.id, id)).limit(1))[0] ?? null;
  if (!before) throw errors.notFound("Maintenance");

  const nextStatus = input.status ?? before.status;
  if (input.status && !(TRANSITIONS[before.status] ?? []).includes(input.status)) {
    throw errors.unprocessable(`Cannot move maintenance from ${humanize(before.status)} to ${humanize(input.status)}`);
  }
  const timeChanged = input.startsAt !== undefined || input.endsAt !== undefined;
  if (timeChanged && (before.status === "completed" || before.status === "cancelled")) {
    throw errors.unprocessable("Completed or cancelled maintenance cannot be rescheduled");
  }
  if (input.assetIds) await assertAssetsExist(input.assetIds);

  const startsAt = input.startsAt ? new Date(input.startsAt) : before.startsAt;
  const endsAt = input.endsAt ? new Date(input.endsAt) : before.endsAt;
  if (endsAt.getTime() <= startsAt.getTime()) throw errors.unprocessable("End time must be after start time");

  if (process.env.MONGODB_URI) {
    const patch: Partial<Pick<MaintenanceDoc, "title" | "description" | "ownerId" | "notes" | "startsAt" | "endsAt" | "status">> = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.description !== undefined) patch.description = input.description;
    if (input.ownerId !== undefined) patch.ownerId = input.ownerId;
    if (input.notes !== undefined) patch.notes = input.notes;
    if (input.startsAt !== undefined) patch.startsAt = startsAt;
    if (input.endsAt !== undefined) patch.endsAt = endsAt;
    if (input.status !== undefined) patch.status = nextStatus;
    const updated = await updateMaintenanceWithAssets(id, patch, input.assetIds);
    if (!updated) throw errors.notFound("Maintenance");
  } else {
    const patch: Partial<typeof maintenances.$inferInsert> = { updatedAt: new Date() };
    if (input.title !== undefined) patch.title = input.title;
    if (input.description !== undefined) patch.description = input.description;
    if (input.ownerId !== undefined) patch.ownerId = input.ownerId;
    if (input.notes !== undefined) patch.notes = input.notes;
    if (input.startsAt !== undefined) patch.startsAt = startsAt;
    if (input.endsAt !== undefined) patch.endsAt = endsAt;
    if (input.status !== undefined) patch.status = nextStatus;

    await db.transaction(async (tx) => {
      await tx.update(maintenances).set(patch).where(eq(maintenances.id, id));
      if (input.assetIds) {
        await tx.delete(maintenanceAssets).where(eq(maintenanceAssets.maintenanceId, id));
        if (input.assetIds.length > 0) {
          await tx.insert(maintenanceAssets).values(input.assetIds.map((assetId) => ({ maintenanceId: id, assetId })));
        }
      }
    });
  }

  if (input.status && input.status !== before.status) {
    await recordAudit({
      actorId: actor.id,
      action: "maintenance.status_changed",
      entityType: "maintenance",
      entityId: id,
      summary: `Maintenance "${before.title}" ${humanize(before.status)} → ${humanize(input.status)}`,
      ip,
    });
  } else {
    await recordAudit({
      actorId: actor.id,
      action: "maintenance.updated",
      entityType: "maintenance",
      entityId: id,
      summary: `Maintenance "${before.title}" updated`,
      ip,
    });
  }
  return getMaintenance(id);
}

export async function deleteMaintenance(actor: AuthUser, id: string, ip: string): Promise<void> {
  const row = process.env.MONGODB_URI
    ? await deleteMaintenanceById(id)
    : (await db.delete(maintenances).where(eq(maintenances.id, id)).returning({ title: maintenances.title }))[0] ?? null;
  if (!row) throw errors.notFound("Maintenance");
  await recordAudit({
    actorId: actor.id,
    action: "maintenance.deleted",
    entityType: "maintenance",
    entityId: id,
    summary: `Maintenance "${row.title}" deleted`,
    ip,
  });
}

/** Sends one reminder per maintenance window that starts within the next 24 hours. Called by the worker. */
export async function sendMaintenanceReminders(now: Date = new Date()): Promise<number> {
  const horizon = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  if (process.env.MONGODB_URI) {
    let sent = 0;
    while (true) {
      const maintenance = await claimDueMaintenanceReminder(now, horizon);
      if (!maintenance) return sent;
      try {
        const operators = await activeUserIdsByRoles(["admin", "operator"]);
        await notifyUsers([maintenance.ownerId, ...operators], {
          type: "maintenance_reminder",
          title: "Maintenance starts within 24 hours",
          message: `${maintenance.title} starts ${maintenance.startsAt.toUTCString()}`,
          link: "/maintenance",
        });
        sent += 1;
      } catch (error) {
        await releaseMaintenanceReminderClaim(maintenance.id, now);
        throw error;
      }
    }
  }
  const due = await db
    .select()
    .from(maintenances)
    .where(
      and(
        eq(maintenances.status, "scheduled"),
        sql`${maintenances.reminderSentAt} is null`,
        gte(maintenances.startsAt, now),
        lte(maintenances.startsAt, horizon),
      ),
    );
  for (const m of due) {
    const operators = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.isActive, true), inArray(users.role, ["admin", "operator"])));
    await notifyUsers([m.ownerId, ...operators.map((o) => o.id)], {
      type: "maintenance_reminder",
      title: "Maintenance starts within 24 hours",
      message: `${m.title} starts ${m.startsAt.toUTCString()}`,
      link: "/maintenance",
    });
    await db.update(maintenances).set({ reminderSentAt: now }).where(eq(maintenances.id, m.id));
  }
  return due.length;
}
