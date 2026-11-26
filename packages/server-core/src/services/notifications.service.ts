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
  await insertNotifications(unique, payload);
}

export async function activeUserIdsByRoles(roles: Role[]): Promise<string[]> {
  const users = await listActiveUserOptions();
  return users.filter((user) => roles.includes(user.role)).map((user) => user.id);
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

export async function markNotificationRead(userId: string, id: string): Promise<void> {
  if (!(await markNotificationReadById(userId, id))) throw errors.notFound("Notification");
}

export async function markAllNotificationsRead(userId: string): Promise<number> {
  return markAllUserNotificationsRead(userId);
}
