import { authorize } from "@/lib/auth";
import { jsonList, jsonOk, parseQuery } from "@/lib/http";
import { getDashboard } from "@/services/dashboard.service";
import { entityHistory, listAudit } from "@/services/audit.service";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/services/notifications.service";
import { globalSearch } from "@/services/search.service";
import { auditListQuery, dashboardQuery, notificationListQuery, searchQuerySchema } from "@/validators/schemas";
import type { RouteDef } from "@/routes/types";

export const opsRoutes: RouteDef[] = [
  {
    method: "GET",
    path: "search",
    handler: async ({ req }) => {
      const user = await authorize(req, "read");
      return jsonOk(await globalSearch(user, parseQuery(req, searchQuerySchema)));
    },
  },
  {
    method: "GET",
    path: "notifications",
    handler: async ({ req }) => {
      const user = await authorize(req, "read");
      const result = await listNotifications(user.id, parseQuery(req, notificationListQuery));
      return jsonList(result.items, result.pagination, { unreadCount: result.unreadCount });
    },
  },
  {
    method: "POST",
    path: "notifications/read-all",
    handler: async ({ req }) => {
      const user = await authorize(req, "read");
      return jsonOk({ updated: await markAllNotificationsRead(user.id) });
    },
  },
  {
    method: "POST",
    path: "notifications/:id/read",
    handler: async ({ req, params }) => {
      const user = await authorize(req, "read");
      await markNotificationRead(user.id, params.id!);
      return jsonOk({ read: true });
    },
  },
  {
    method: "GET",
    path: "dashboard",
    handler: async ({ req }) => {
      await authorize(req, "read");
      const { days } = parseQuery(req, dashboardQuery);
      return jsonOk(await getDashboard(days as 1 | 7 | 30 | 90));
    },
  },
  {
    method: "GET",
    path: "audit",
    handler: async ({ req }) => {
      await authorize(req, "admin");
      const result = await listAudit(parseQuery(req, auditListQuery));
      return jsonList(result.items, result.pagination);
    },
  },
  {
    method: "GET",
    path: "audit/:entityType/:entityId",
    handler: async ({ req, params }) => {
      await authorize(req, "read");
      return jsonOk(await entityHistory(params.entityType!, params.entityId!));
    },
  },
];
