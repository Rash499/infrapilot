import type { ClientSession, Filter } from "mongodb";
import { collections, getCollection, newEntityIds } from "@/db/collections";
import type { AuditLogDoc, NotificationDoc, NotificationType } from "@/db/models/documents";

export async function insertAuditLog(
  input: {
    actorId?: string | null;
    action: string;
    entityType: string;
    entityId: string;
    summary: string;
    metadata?: Record<string, unknown> | null;
    ip?: string | null;
  },
  session?: ClientSession,
): Promise<AuditLogDoc> {
  const col = await getCollection<AuditLogDoc>(collections.auditLogs);
  const doc: AuditLogDoc = {
    ...newEntityIds(),
    actorId: input.actorId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    summary: input.summary,
    metadata: input.metadata ?? null,
    ipAddress: input.ip ?? null,
    createdAt: new Date(),
  };
  await col.insertOne(doc, { session });
  return doc;
}

export async function listAuditLogsPaginated(query: {
  page: number;
  pageSize: number;
  entityType?: string;
  entityId?: string;
  actorId?: string;
  action?: string;
  search?: string;
  actions?: string[];
}): Promise<{ items: AuditLogDoc[]; total: number }> {
  const col = await getCollection<AuditLogDoc>(collections.auditLogs);
  const filter: Filter<AuditLogDoc> = {};
  if (query.entityType) filter.entityType = query.entityType;
  if (query.entityId) filter.entityId = query.entityId;
  if (query.actorId) filter.actorId = query.actorId;
  if (query.action) filter.action = query.action;
  if (query.actions?.length) filter.action = { $in: query.actions };
  if (query.search) {
    const rx = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ summary: rx }, { action: rx }, { entityId: rx }];
  }
  const skip = (query.page - 1) * query.pageSize;
  const [items, total] = await Promise.all([
    col.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.pageSize).toArray(),
    col.countDocuments(filter),
  ]);
  return { items, total };
}

export async function insertNotifications(
  userIds: string[],
  payload: { type: NotificationType; title: string; message: string; link?: string | null },
  session?: ClientSession,
): Promise<void> {
  const unique = [...new Set(userIds.filter((id) => id.length > 0))];
  if (unique.length === 0) return;
  const col = await getCollection<NotificationDoc>(collections.notifications);
  const now = new Date();
  await col.insertMany(
    unique.map((userId) => ({
      ...newEntityIds(),
      userId,
      type: payload.type,
      title: payload.title.slice(0, 200),
      message: payload.message.slice(0, 2000),
      link: payload.link ?? null,
      readAt: null,
      createdAt: now,
    })),
    { session },
  );
}

export async function listUserNotifications(
  userId: string,
  query: { page: number; pageSize: number; unreadOnly?: boolean },
): Promise<{ items: NotificationDoc[]; total: number; unreadCount: number }> {
  const col = await getCollection<NotificationDoc>(collections.notifications);
  const filter: Filter<NotificationDoc> = { userId };
  if (query.unreadOnly) filter.readAt = null;
  const skip = (query.page - 1) * query.pageSize;
  const [items, total, unreadCount] = await Promise.all([
    col.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.pageSize).toArray(),
    col.countDocuments(filter),
    col.countDocuments({ userId, readAt: null }),
  ]);
  return { items, total, unreadCount };
}

export async function markNotificationReadById(userId: string, id: string): Promise<boolean> {
  const col = await getCollection<NotificationDoc>(collections.notifications);
  const res = await col.updateOne({ id, userId }, { $set: { readAt: new Date() } });
  return res.matchedCount > 0;
}

export async function markAllUserNotificationsRead(userId: string): Promise<number> {
  const col = await getCollection<NotificationDoc>(collections.notifications);
  const res = await col.updateMany({ userId, readAt: null }, { $set: { readAt: new Date() } });
  return res.modifiedCount;
}
