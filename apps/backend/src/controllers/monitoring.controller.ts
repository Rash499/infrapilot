import { authorize } from "@/lib/auth";
import { jsonList, jsonOk, parseBody, parseQuery } from "@/lib/http";
import {
  createTarget,
  deleteTarget,
  getTarget,
  listResults,
  listTargets,
  monitoringAnalytics,
  monitoringOverview,
  queueCheck,
  targetAnalytics,
  updateTarget,
} from "@/services/monitoring.service";
import {
  analyticsRangeQuery,
  monitorCreateSchema,
  monitorListQuery,
  monitorUpdateSchema,
  resultsQuery,
} from "@/validators/schemas";
import type { RouteDef } from "@/routes/types";

export const monitoringRoutes: RouteDef[] = [
  {
    method: "GET",
    path: "monitoring/overview",
    handler: async ({ req }) => {
      await authorize(req, "read");
      return jsonOk(await monitoringOverview());
    },
  },
  {
    method: "GET",
    path: "monitoring/analytics",
    handler: async ({ req }) => {
      await authorize(req, "read");
      const { range } = parseQuery(req, analyticsRangeQuery);
      return jsonOk(await monitoringAnalytics(range));
    },
  },
  {
    method: "GET",
    path: "monitoring/targets/:id/analytics",
    handler: async ({ req, params }) => {
      await authorize(req, "read");
      const { range } = parseQuery(req, analyticsRangeQuery);
      return jsonOk(await targetAnalytics(params.id!, range));
    },
  },
  {
    method: "GET",
    path: "monitoring/targets",
    handler: async ({ req }) => {
      await authorize(req, "read");
      const result = await listTargets(parseQuery(req, monitorListQuery));
      return jsonList(result.items, result.pagination);
    },
  },
  {
    method: "POST",
    path: "monitoring/targets",
    handler: async ({ req, ip }) => {
      const user = await authorize(req, "write");
      const body = await parseBody(req, monitorCreateSchema);
      return jsonOk(await createTarget(user, body, ip), { status: 201 });
    },
  },
  {
    method: "GET",
    path: "monitoring/targets/:id",
    handler: async ({ req, params }) => {
      await authorize(req, "read");
      return jsonOk(await getTarget(params.id!));
    },
  },
  {
    method: "PATCH",
    path: "monitoring/targets/:id",
    handler: async ({ req, ip, params }) => {
      const user = await authorize(req, "write");
      const body = await parseBody(req, monitorUpdateSchema);
      return jsonOk(await updateTarget(user, params.id!, body, ip));
    },
  },
  {
    method: "DELETE",
    path: "monitoring/targets/:id",
    handler: async ({ req, ip, params }) => {
      const user = await authorize(req, "admin");
      await deleteTarget(user, params.id!, ip);
      return jsonOk({ deleted: true });
    },
  },
  {
    method: "POST",
    path: "monitoring/targets/:id/check",
    handler: async ({ req, ip, params }) => {
      const user = await authorize(req, "write");
      return jsonOk(await queueCheck(user, params.id!, ip), { status: 202 });
    },
  },
  {
    method: "GET",
    path: "monitoring/targets/:id/results",
    handler: async ({ req, params }) => {
      await authorize(req, "read");
      const result = await listResults(params.id!, parseQuery(req, resultsQuery));
      return jsonList(result.items, result.pagination);
    },
  },
];
