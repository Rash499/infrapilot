import { insertAuditLog, listAuditLogsPaginated } from "@/db/repositories/audit-notifications.repository";
import { findUserById } from "@/db/repositories/users.repository";
import { paginationMeta } from "@/lib/http";
import type { SQL } from "drizzle-orm";

export interface AuditEntry {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

/** Writes an immutable audit record. Failures propagate so that untracked changes never succeed silently. */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  if (process.env.MONGODB_URI) {
    await insertAuditLog({
      actorId: entry.actorId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      summary: entry.summary.slice(0, 1000),
      metadata: entry.metadata ?? null,
      ip: entry.ip ? entry.ip.slice(0, 64) : null,
    });
    return;
  }

  const { db } = await import("@/db");
  const { auditLogs } = await import("@/db/schema");
  await db.insert(auditLogs).values({
    actorId: entry.actorId ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    summary: entry.summary.slice(0, 1000),
    metadata: entry.metadata ?? null,
    ipAddress: entry.ip ? entry.ip.slice(0, 64) : null,
  });
}

function mapAudit(row: {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  metadata: unknown;
  ipAddress: string | null;
  createdAt: Date;
  actorId: string | null;
  actorName: string | null;
}) {
  return {
    id: row.id,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    summary: row.summary,
    metadata: row.metadata,
    ipAddress: row.ipAddress,
    createdAt: row.createdAt.toISOString(),
    actorId: row.actorId,
    actorName: row.actorName ?? "System",
  };
}

async function mongoAuditItems(items: Array<Parameters<typeof mapAudit>[0]>) {
  const ids = [...new Set(items.map((row) => row.actorId).filter((id): id is string => !!id))];
  const users = await Promise.all(ids.map((id) => findUserById(id)));
  const names = new Map(users.filter((user) => user !== null).map((user) => [user!.id, user!.name]));
  return items.map((row) => mapAudit({ ...row, actorName: row.actorId ? names.get(row.actorId) ?? null : null }));
}

export async function listAudit(q: {
  page: number;
  pageSize: number;
  entityType?: string;
  entityId?: string;
  actorId?: string;
  action?: string;
  search?: string;
  actions?: string[];
}) {
  if (process.env.MONGODB_URI) {
    const result = await listAuditLogsPaginated(q);
    const items = await mongoAuditItems(
      result.items.map((row) => ({
        id: row.id,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        summary: row.summary,
        metadata: row.metadata,
        ipAddress: row.ipAddress,
        createdAt: row.createdAt,
        actorId: row.actorId,
        actorName: null,
      })),
    );
    return { items, pagination: paginationMeta(q.page, q.pageSize, result.total) };
  }

  const { and, desc, eq, ilike, inArray, or, sql } = await import("drizzle-orm");
  const { db } = await import("@/db");
  const { auditLogs, users } = await import("@/db/schema");
  const conditions: SQL[] = [];
  if (q.entityType) conditions.push(eq(auditLogs.entityType, q.entityType));
  if (q.entityId) conditions.push(eq(auditLogs.entityId, q.entityId));
  if (q.actorId) conditions.push(eq(auditLogs.actorId, q.actorId));
  if (q.action) conditions.push(eq(auditLogs.action, q.action));
  if (q.actions?.length) conditions.push(inArray(auditLogs.action, q.actions));
  if (q.search) {
    const pattern = `%${q.search.replace(/[\\%_]/g, "\\$&")}%`;
    conditions.push(or(ilike(auditLogs.summary, pattern), ilike(auditLogs.action, pattern), ilike(auditLogs.entityId, pattern))!);
  }
  const where = conditions.length ? and(...conditions) : undefined;
  const rows = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      summary: auditLogs.summary,
      metadata: auditLogs.metadata,
      ipAddress: auditLogs.ipAddress,
      createdAt: auditLogs.createdAt,
      actorId: auditLogs.actorId,
      actorName: users.name,
    })
    .from(auditLogs)
    .leftJoin(users, eq(auditLogs.actorId, users.id))
    .where(where)
    .orderBy(desc(auditLogs.createdAt))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  const [count] = await db.select({ total: sql<number>`count(*)::int` }).from(auditLogs).where(where);
  return { items: rows.map(mapAudit), pagination: paginationMeta(q.page, q.pageSize, count?.total ?? 0) };
}

export async function listLoginHistory(userId: string, q: { page: number; pageSize: number }) {
  const result = await listAudit({
    ...q,
    entityType: "user",
    entityId: userId,
    actions: ["auth.login", "auth.login_failed"],
  });
  return {
    items: result.items.map((entry) => {
      const metadata = entry.metadata;
      const userAgent =
        metadata && typeof metadata === "object" && "userAgent" in metadata && typeof metadata.userAgent === "string"
          ? metadata.userAgent
          : null;
      return {
        id: entry.id,
        action: entry.action,
        createdAt: entry.createdAt,
        ipAddress: entry.ipAddress,
        userAgent,
      };
    }),
    pagination: result.pagination,
  };
}

export async function entityHistory(entityType: string, entityId: string, limit = 100) {
  if (process.env.MONGODB_URI) {
    const result = await listAuditLogsPaginated({ page: 1, pageSize: limit, entityType, entityId });
    return mongoAuditItems(
      result.items.map((row) => ({
        id: row.id,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        summary: row.summary,
        metadata: row.metadata,
        ipAddress: row.ipAddress,
        createdAt: row.createdAt,
        actorId: row.actorId,
        actorName: null,
      })),
    );
  }

  const { and, desc, eq } = await import("drizzle-orm");
  const { db } = await import("@/db");
  const { auditLogs, users } = await import("@/db/schema");
  const rows = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      summary: auditLogs.summary,
      metadata: auditLogs.metadata,
      ipAddress: auditLogs.ipAddress,
      createdAt: auditLogs.createdAt,
      actorId: auditLogs.actorId,
      actorName: users.name,
    })
    .from(auditLogs)
    .leftJoin(users, eq(auditLogs.actorId, users.id))
    .where(and(eq(auditLogs.entityType, entityType), eq(auditLogs.entityId, entityId)))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
  return rows.map(mapAudit);
}
