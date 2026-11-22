import {
  insertNotifications,
  listUserNotifications,
  markAllUserNotificationsRead,
  markNotificationReadById,
} from "@/db/repositories/audit-notifications.repository";
import { listActiveUserOptions } from "@/db/repositories/users.repository";
import { errors, paginationMeta } from "@/lib/http";
import type { Role } from "@/lib/auth";
import type { NotificationType } from "@/db/models/documents";

export interface NotificationPayload {
  type: NotificationType;
  title: string;
  message: string;
  link?: string | null;
}

export async function notifyUsers(userIds: Array<string | null | undefined>, payload: NotificationPayload): Promise<void> {
  const unique = [...new Set(userIds.filter((v): v is string => typeof v === "string" && v.length > 0))];
  if (unique.length === 0) return;
  if (process.env.MONGODB_URI) {
    await insertNotifications(unique, payload);
    return;
  }

  const { db } = await import("@/db");
  const { notifications } = await import("@/db/schema");
  await db.insert(notifications).values(unique.map((userId) => ({
    userId,
    type: payload.type,
    title: payload.title.slice(0, 200),
    message: payload.message.slice(0, 2000),
    link: payload.link ?? null,
  })));
}

export async function activeUserIdsByRoles(roles: Role[]): Promise<string[]> {
  if (process.env.MONGODB_URI) {
    const users = await listActiveUserOptions();
    return users.filter((user) => roles.includes(user.role)).map((user) => user.id);
  }
  const { and, eq, inArray } = await import("drizzle-orm");
  const { db } = await import("@/db");
  const { users } = await import("@/db/schema");
  const rows = await db.select({ id: users.id }).from(users).where(and(eq(users.isActive, true), inArray(users.role, roles)));
  return rows.map((row) => row.id);
}

export async function notifyRoles(
  roles: Role[],
  payload: NotificationPayload,
  extraUserIds: Array<string | null | undefined> = [],
  excludeUserId?: string | null,
): Promise<void> {
  const ids = [...(await activeUserIdsByRoles(roles)), ...extraUserIds].filter(
    (id): id is string => !!id && id !== excludeUserId,
  );
  await notifyUsers(ids, payload);
}

export async function listNotifications(userId: string, q: { page: number; pageSize: number; unread: "true" | "false" }) {
  if (process.env.MONGODB_URI) {
    const result = await listUserNotifications(userId, {
      page: q.page,
      pageSize: q.pageSize,
      unreadOnly: q.unread === "true",
    });
    return {
      items: result.items.map((row) => ({
        id: row.id,
        type: row.type,
        title: row.title,
        message: row.message,
        link: row.link,
        readAt: row.readAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      pagination: paginationMeta(q.page, q.pageSize, result.total),
      unreadCount: result.unreadCount,
    };
  }

  const { and, desc, eq, isNull, sql } = await import("drizzle-orm");
  const { db } = await import("@/db");
  const { notifications } = await import("@/db/schema");
  const where = and(eq(notifications.userId, userId), q.unread === "true" ? isNull(notifications.readAt) : undefined);
  const rows = await db.select().from(notifications).where(where).orderBy(desc(notifications.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize);
  const [count] = await db.select({ total: sql<number>`count(*)::int` }).from(notifications).where(where);
  const [unread] = await db.select({ unread: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return {
    items: rows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      message: row.message,
      link: row.link,
      readAt: row.readAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    })),
    pagination: paginationMeta(q.page, q.pageSize, count?.total ?? 0),
    unreadCount: unread?.unread ?? 0,
  };
}

export async function markNotificationRead(userId: string, id: string): Promise<void> {
  if (process.env.MONGODB_URI) {
    if (!(await markNotificationReadById(userId, id))) throw errors.notFound("Notification");
    return;
  }
  const { and, eq } = await import("drizzle-orm");
  const { db } = await import("@/db");
  const { notifications } = await import("@/db/schema");
  const [row] = await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, id), eq(notifications.userId, userId))).returning({ id: notifications.id });
  if (!row) throw errors.notFound("Notification");
}

export async function markAllNotificationsRead(userId: string): Promise<number> {
  if (process.env.MONGODB_URI) return markAllUserNotificationsRead(userId);
  const { and, eq, isNull } = await import("drizzle-orm");
  const { db } = await import("@/db");
  const { notifications } = await import("@/db/schema");
  const rows = await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, userId), isNull(notifications.readAt))).returning({ id: notifications.id });
  return rows.length;
}
