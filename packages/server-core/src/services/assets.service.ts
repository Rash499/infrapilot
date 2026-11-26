import type { z } from "zod";
import type { AuthUser } from "@/lib/auth";
import { errors, paginationMeta } from "@/lib/http";
import { entityHistory, recordAudit } from "@/services/audit.service";
import { diffFields, iso, userNameMap } from "@/services/common";
import type { assetCreateSchema, assetListQuery, assetUpdateSchema } from "@/validators/schemas";
import type { AssetDoc } from "@/db/models/documents";
import {
  findAssetById,
  getAssetRelatedData,
  insertAsset,
  listAssetsPaginated,
  countAssetsByIds,
  updateAssetById,
} from "@/db/repositories/assets.repository";

type CreateInput = z.infer<typeof assetCreateSchema>;
type UpdateInput = z.infer<typeof assetUpdateSchema>;
type ListQuery = z.infer<typeof assetListQuery>;

const TRACKED_FIELDS = [
  "name",
  "assetType",
  "hostname",
  "ipAddress",
  "operatingSystem",
  "environment",
  "location",
  "ownerId",
  "description",
  "status",
] as const;

function toDto(row: AssetDoc, ownerName: string | null) {
  return {
    id: row.id,
    name: row.name,
    assetType: row.assetType,
    hostname: row.hostname,
    ipAddress: row.ipAddress,
    operatingSystem: row.operatingSystem,
    environment: row.environment,
    location: row.location,
    ownerId: row.ownerId,
    ownerName,
    description: row.description,
    status: row.status,
    archivedAt: iso(row.archivedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function assertOwnerExists(ownerId: string | null | undefined): Promise<void> {
  if (!ownerId) return;
  const names = await userNameMap([ownerId]);
  if (!names.has(ownerId)) throw errors.unprocessable("The selected owner does not exist");
}

export async function listAssets(q: ListQuery) {
  const result = await listAssetsPaginated({
    page: q.page,
    pageSize: q.pageSize,
    search: q.search,
    assetType: q.assetType,
    environment: q.environment,
    status: q.status,
    archived: q.archived === "true",
    sort: q.sort,
    order: q.order,
  });
  const owners = await userNameMap(result.items.map((row) => row.ownerId));
  return {
    items: result.items.map((row) => toDto(row, row.ownerId ? owners.get(row.ownerId) ?? null : null)),
    pagination: paginationMeta(q.page, q.pageSize, result.total),
  };
}

export async function getAsset(id: string) {
  const row = await findAssetById(id);
  if (!row) throw errors.notFound("Asset");
  const owners = await userNameMap([row.ownerId]);
  const related = await getAssetRelatedData(id);
  return {
    ...toDto(row, row.ownerId ? owners.get(row.ownerId) ?? null : null),
    monitors: related.monitors.map((monitor) => ({
      id: String(monitor.id),
      name: String(monitor.name),
      status: monitor.status,
      monitorType: monitor.monitorType,
    })),
    findings: related.findings.map((finding) => ({
      id: String(finding.id),
      title: String(finding.title),
      severity: finding.severity,
      status: finding.status,
      createdAt: finding.createdAt instanceof Date ? finding.createdAt.toISOString() : String(finding.createdAt),
    })),
    incidents: related.incidents.map((incident) => ({
      id: String(incident.id),
      reference: `INC-${String(incident.number).padStart(5, "0")}`,
      title: String(incident.title),
      severity: incident.severity,
      status: incident.status,
      openedAt: incident.openedAt instanceof Date ? incident.openedAt.toISOString() : String(incident.openedAt),
    })),
  };
}

export async function createAsset(actor: AuthUser, input: CreateInput, ip: string) {
  await assertOwnerExists(input.ownerId);
  const row = await insertAsset({
    name: input.name,
    assetType: input.assetType,
    hostname: input.hostname ?? null,
    ipAddress: input.ipAddress ?? null,
    operatingSystem: input.operatingSystem ?? null,
    environment: input.environment,
    location: input.location ?? null,
    ownerId: input.ownerId,
    description: input.description,
    status: input.status ?? "unknown",
    createdById: actor.id,
  });
  await recordAudit({
    actorId: actor.id,
    action: "asset.created",
    entityType: "asset",
    entityId: row.id,
    summary: `Asset "${row.name}" registered (${row.assetType}, ${row.environment})`,
    ip,
  });
  return getAsset(row.id);
}

export async function updateAsset(actor: AuthUser, id: string, input: UpdateInput, ip: string) {
  const before = await findAssetById(id);
  if (!before) throw errors.notFound("Asset");
  if (input.ownerId !== undefined) await assertOwnerExists(input.ownerId);

  const { archived, ...fields } = input;
  const patch: Parameters<typeof updateAssetById>[1] = { ...fields };
  if (archived !== undefined) patch.archivedAt = archived ? (before.archivedAt ?? new Date()) : null;

  const after = await updateAssetById(id, patch);
  if (!after) throw errors.notFound("Asset");

  const changed = diffFields(before, after, TRACKED_FIELDS);
  if (archived !== undefined && (archived === true) !== (before.archivedAt !== null)) {
    await recordAudit({
      actorId: actor.id,
      action: archived ? "asset.archived" : "asset.restored",
      entityType: "asset",
      entityId: id,
      summary: archived ? `Asset "${after.name}" archived` : `Asset "${after.name}" restored`,
      ip,
    });
  }
  await recordAudit({
    actorId: actor.id,
    action: "asset.updated",
    entityType: "asset",
    entityId: id,
    summary: changed.length ? `Updated ${changed.join(", ")}` : "Asset reviewed with no field changes",
    metadata: { changedFields: changed },
    ip,
  });
  return getAsset(id);
}

export async function archiveAsset(actor: AuthUser, id: string, ip: string) {
  return updateAsset(actor, id, { archived: true }, ip);
}

export async function assetHistory(id: string) {
  if (!(await findAssetById(id))) throw errors.notFound("Asset");
  return entityHistory("asset", id);
}

export async function assertAssetsExist(assetIds: string[]): Promise<void> {
  if (assetIds.length === 0) return;
  if ((await countAssetsByIds(assetIds)) !== new Set(assetIds).size) {
    throw errors.unprocessable("One or more selected assets do not exist");
  }
}
