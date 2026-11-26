import type { z } from "zod";
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

type MaintenanceRow = MaintenanceDoc;
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

/** Finds scheduled or running maintenance that overlaps the window for any of the same assets. */
export async function findMaintenanceConflicts(assetIds: string[], startsAt: Date, endsAt: Date, excludeId?: string) {
  if (assetIds.length === 0) return [];
  const rows = await findMongoMaintenanceConflicts(assetIds, startsAt, endsAt, excludeId);
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
  }));
}

export async function listMaintenance(q: ListQuery) {
  const result = await listMaintenances(q);
  const owners = await userNameMap(result.items.map((row) => row.ownerId));
  const summaries = await assetSummaries(result.items.map((row) => row.id));
  return {
    items: result.items.map((row) => toDto(row, row.ownerId ? owners.get(row.ownerId) ?? null : null, summaries.get(row.id) ?? [])),
    pagination: paginationMeta(q.page, q.pageSize, result.total),
  };
}

export async function getMaintenance(id: string) {
  const row = await findMaintenanceById(id);
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

  const row = await insertMaintenanceWithAssets(
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
  );

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
  const before = await findMaintenanceById(id);
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
  const row = await deleteMaintenanceById(id);
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
