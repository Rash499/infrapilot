import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { notifications, notificationTypeEnum, users } from "@/db/schema";
import { errors, paginationMeta } from "@/lib/http";
import type { Role } from "@/lib/auth";
import { pageOffset } from "@/services/common";

export type NotificationType = (typeof notificationTypeEnum.enumValues)[number];

export interface NotificationPayload {
  type: NotificationType;
  title: string;
  message: string;
  link?: string | null;
}

/**
 * Notification dispatch is isolated here so email, chat, or webhook channels can be added as
 * additional sinks without changing the callers in domain services.
 */
export async function notifyUsers(userIds: Array<string | null | undefined>, payload: NotificationPayload): Promise<void> {
  const unique = [...new Set(userIds.filter((v): v is string => typeof v === "string" && v.length > 0))];
  if (unique.length === 0) return;
  await db.insert(notifications).values(
    unique.map((userId) => ({
      userId,
      type: payload.type,
      title: payload.title.slice(0, 200),
      message: payload.message.slice(0, 2000),
      link: payload.link ?? null,
    })),
  );
}

export async function activeUserIdsByRoles(roles: Role[]): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.isActive, true), inArray(users.role, roles)));
  return rows.map((r) => r.id);
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
  const where = and(
    eq(notifications.userId, userId),
    q.unread === "true" ? isNull(notifications.readAt) : undefined,
  );
  const rows = await db
    .select()
    .from(notifications)
    .where(where)
    .orderBy(desc(notifications.createdAt))
    .limit(q.pageSize)
    .offset(pageOffset(q.page, q.pageSize));
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(notifications).where(where);
  const [{ unread }] = await db
    .select({ unread: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return {
    items: rows.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      message: r.message,
      link: r.link,
      readAt: r.readAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
    pagination: paginationMeta(q.page, q.pageSize, total),
    unreadCount: unread,
  };
}

export async function markNotificationRead(userId: string, id: string): Promise<void> {
  const [row] = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
    .returning({ id: notifications.id });
  if (!row) throw errors.notFound("Notification");
}

export async function markAllNotificationsRead(userId: string): Promise<number> {
  const rows = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
    .returning({ id: notifications.id });
  return rows.length;
}
