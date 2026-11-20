import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, users } from "@/db/schema";
import { paginationMeta } from "@/lib/http";
import { pageOffset } from "@/services/common";

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

const auditFields = {
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
};

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

export async function listAudit(q: {
  page: number;
  pageSize: number;
  entityType?: string;
  entityId?: string;
  actorId?: string;
}) {
  const conditions: SQL[] = [];
  if (q.entityType) conditions.push(eq(auditLogs.entityType, q.entityType));
  if (q.entityId) conditions.push(eq(auditLogs.entityId, q.entityId));
  if (q.actorId) conditions.push(eq(auditLogs.actorId, q.actorId));
  const where = conditions.length ? and(...conditions) : undefined;

  const rows = await db
    .select(auditFields)
    .from(auditLogs)
    .leftJoin(users, eq(auditLogs.actorId, users.id))
    .where(where)
    .orderBy(desc(auditLogs.createdAt))
    .limit(q.pageSize)
    .offset(pageOffset(q.page, q.pageSize));
  const total = await countAudit(where);
  return { items: rows.map(mapAudit), pagination: paginationMeta(q.page, q.pageSize, total) };
}

async function countAudit(where: SQL | undefined): Promise<number> {
  const [row] = await db.select({ total: sql<number>`count(*)::int` }).from(auditLogs).where(where);
  return row?.total ?? 0;
}

export async function entityHistory(entityType: string, entityId: string, limit = 100) {
  const rows = await db
    .select(auditFields)
    .from(auditLogs)
    .leftJoin(users, eq(auditLogs.actorId, users.id))
    .where(and(eq(auditLogs.entityType, entityType), eq(auditLogs.entityId, entityId)))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
  return rows.map(mapAudit);
}


