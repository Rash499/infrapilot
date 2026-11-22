import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { db } from "@/db";
import { assets, incidentAssets, incidents, monitoringTargets, securityFindings, users } from "@/db/schema";
import type { AuthUser } from "@/lib/auth";
import { errors, paginationMeta } from "@/lib/http";
import { entityHistory, recordAudit } from "@/services/audit.service";
import { diffFields, iso, likeTerm, pageOffset, userNameMap } from "@/services/common";
import type { assetCreateSchema, assetListQuery, assetUpdateSchema } from "@/validators/schemas";
import {
  findAssetById,
  getAssetRelatedData,
  insertAsset,
  listAssetsPaginated,
  updateAssetById,
} from "@/db/repositories/assets.repository";

type AssetRow = typeof assets.$inferSelect;
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

function toDto(row: AssetRow, ownerName: string | null) {
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
  if (process.env.MONGODB_URI) {
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
      items: result.items.map((row) => toDto(row as unknown as AssetRow, row.ownerId ? owners.get(row.ownerId) ?? null : null)),
      pagination: paginationMeta(q.page, q.pageSize, result.total),
    };
  }
  const conditions: SQL[] = [q.archived === "true" ? isNotNull(assets.archivedAt) : isNull(assets.archivedAt)];
  if (q.search) {
    const pattern = likeTerm(q.search);
    conditions.push(
      or(
        ilike(assets.name, pattern),
        ilike(assets.hostname, pattern),
        ilike(assets.ipAddress, pattern),
        ilike(assets.location, pattern),
      )!,
    );
  }
  if (q.assetType) conditions.push(eq(assets.assetType, q.assetType));
  if (q.environment) conditions.push(eq(assets.environment, q.environment));
  if (q.status) conditions.push(eq(assets.status, q.status));
  const where = and(...conditions);

  const sortColumn = {
    name: assets.name,
    assetType: assets.assetType,
    environment: assets.environment,
    status: assets.status,
    createdAt: assets.createdAt,
    updatedAt: assets.updatedAt,
  }[q.sort];
  const order = q.order === "asc" ? asc(sortColumn) : desc(sortColumn);

  const rows = await db
    .select()
    .from(assets)
    .where(where)
    .orderBy(order)
    .limit(q.pageSize)
    .offset(pageOffset(q.page, q.pageSize));
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(assets).where(where);
  const owners = await userNameMap(rows.map((r) => r.ownerId));
  return {
    items: rows.map((r) => toDto(r, r.ownerId ? owners.get(r.ownerId) ?? null : null)),
    pagination: paginationMeta(q.page, q.pageSize, total),
  };
}

export async function getAsset(id: string) {
  if (process.env.MONGODB_URI) {
    const row = await findAssetById(id);
    if (!row) throw errors.notFound("Asset");
    const owners = await userNameMap([row.ownerId]);
    const related = await getAssetRelatedData(id);
    return {
      ...toDto(row as unknown as AssetRow, row.ownerId ? owners.get(row.ownerId) ?? null : null),
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
  const [row] = await db.select().from(assets).where(eq(assets.id, id)).limit(1);
  if (!row) throw errors.notFound("Asset");
  const owners = await userNameMap([row.ownerId]);

  const monitors = await db
    .select({ id: monitoringTargets.id, name: monitoringTargets.name, status: monitoringTargets.status, monitorType: monitoringTargets.monitorType })
    .from(monitoringTargets)
    .where(eq(monitoringTargets.assetId, id));

  const findings = await db
    .select({
      id: securityFindings.id,
      title: securityFindings.title,
      severity: securityFindings.severity,
      status: securityFindings.status,
      createdAt: securityFindings.createdAt,
    })
    .from(securityFindings)
    .where(eq(securityFindings.assetId, id))
    .orderBy(desc(securityFindings.createdAt))
    .limit(50);

  const linkedIncidents = await db
    .select({
      id: incidents.id,
      number: incidents.number,
      title: incidents.title,
      severity: incidents.severity,
      status: incidents.status,
      openedAt: incidents.openedAt,
    })
    .from(incidentAssets)
    .innerJoin(incidents, eq(incidentAssets.incidentId, incidents.id))
    .where(eq(incidentAssets.assetId, id))
    .orderBy(desc(incidents.openedAt))
    .limit(50);

  return {
    ...toDto(row, row.ownerId ? owners.get(row.ownerId) ?? null : null),
    monitors,
    findings: findings.map((f) => ({ ...f, createdAt: f.createdAt.toISOString() })),
    incidents: linkedIncidents.map((i) => ({
      id: i.id,
      reference: `INC-${String(i.number).padStart(5, "0")}`,
      title: i.title,
      severity: i.severity,
      status: i.status,
      openedAt: i.openedAt.toISOString(),
    })),
  };
}

export async function createAsset(actor: AuthUser, input: CreateInput, ip: string) {
  await assertOwnerExists(input.ownerId);
  if (process.env.MONGODB_URI) {
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
  const [row] = await db
    .insert(assets)
    .values({
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
    })
    .returning();
  if (!row) throw errors.badRequest("Asset could not be created");
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
  if (process.env.MONGODB_URI) {
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
  const [before] = await db.select().from(assets).where(eq(assets.id, id)).limit(1);
  if (!before) throw errors.notFound("Asset");
  if (input.ownerId !== undefined) await assertOwnerExists(input.ownerId);

  const { archived, ...fields } = input;
  const patch: Partial<typeof assets.$inferInsert> = { ...fields, updatedAt: new Date() };
  if (archived !== undefined) patch.archivedAt = archived ? (before.archivedAt ?? new Date()) : null;

  const [after] = await db.update(assets).set(patch).where(eq(assets.id, id)).returning();
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
  const [row] = await db.select({ id: assets.id }).from(assets).where(eq(assets.id, id)).limit(1);
  if (!row) throw errors.notFound("Asset");
  return entityHistory("asset", id);
}

export async function assertAssetsExist(assetIds: string[]): Promise<void> {
  if (assetIds.length === 0) return;
  const rows = await db.select({ id: assets.id }).from(assets).where(inArray(assets.id, assetIds));
  if (rows.length !== new Set(assetIds).size) throw errors.unprocessable("One or more selected assets do not exist");
}
