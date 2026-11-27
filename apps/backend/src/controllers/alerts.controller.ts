import { authorize } from "@/lib/auth";
import { errors, jsonList, jsonOk, parseBody, parseQuery } from "@/lib/http";
import {
  acknowledgeAlert,
  alertSummary,
  getAlertDetail,
  listAlertPage,
  resolveAlert,
  suppressAlert,
} from "@/services/alerts.service";
import { alertAcknowledgeSchema, alertListQuery, alertResolveSchema, alertSuppressSchema } from "@/validators/schemas";
import type { RouteDef } from "@/routes/types";

export const alertsRoutes: RouteDef[] = [
  {
    method: "GET",
    path: "alerts",
    handler: async ({ req }) => {
      await authorize(req, "read");
      const result = await listAlertPage(parseQuery(req, alertListQuery));
      return jsonList(result.items, result.meta);
    },
  },
  {
    method: "GET",
    path: "alerts/summary",
    handler: async ({ req }) => {
      await authorize(req, "read");
      return jsonOk(await alertSummary());
    },
  },
  {
    method: "GET",
    path: "alerts/:id",
    handler: async ({ req, params }) => {
      await authorize(req, "read");
      return jsonOk(await getAlertDetail(params.id!));
    },
  },
  {
    method: "POST",
    path: "alerts/:id/acknowledge",
    handler: async ({ req, ip, params }) => {
      const user = await authorize(req, "write");
      const body = await parseBody(req, alertAcknowledgeSchema);
      return jsonOk(await acknowledgeAlert(user, params.id!, body.note, ip));
    },
  },
  {
    method: "POST",
    path: "alerts/:id/resolve",
    handler: async ({ req, ip, params }) => {
      const user = await authorize(req, "write");
      const body = await parseBody(req, alertResolveSchema);
      return jsonOk(await resolveAlert(user, params.id!, body.resolutionNotes, ip));
    },
  },
  {
    method: "POST",
    path: "alerts/:id/suppress",
    handler: async ({ req, ip, params }) => {
      const user = await authorize(req, "write");
      const body = await parseBody(req, alertSuppressSchema);
      const until = body.until ? new Date(body.until) : null;
      if (until && Number.isNaN(until.getTime())) throw errors.unprocessable("Suppression end must be a valid date");
      return jsonOk(await suppressAlert(user, params.id!, { reason: body.reason, until }, ip));
    },
  },
];
