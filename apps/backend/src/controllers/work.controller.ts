import { authorize } from "@/lib/auth";
import { errors, jsonList, jsonOk, parseBody, parseQuery } from "@/lib/http";
import {
  createFinding,
  deleteFinding,
  getFinding,
  importTrivyReport,
  listFindings,
  scanHistory,
  securityDashboard,
  updateFinding,
} from "@/services/findings.service";
import {
  acknowledgeIncident,
  addIncidentComment,
  createIncident,
  getIncident,
  incidentSlaMetrics,
  incidentStats,
  listIncidents,
  updateIncident,
} from "@/services/incidents.service";
import {
  createMaintenance,
  deleteMaintenance,
  getMaintenance,
  listMaintenance,
  updateMaintenance,
} from "@/services/maintenance.service";
import {
  approvalSchema,
  changeCreateSchema,
  changeListQuery,
  changeTransitionSchema,
  changeUpdateSchema,
  commentSchema,
  findingCreateSchema,
  findingListQuery,
  findingUpdateSchema,
  incidentCreateSchema,
  incidentListQuery,
  incidentUpdateSchema,
  maintenanceCreateSchema,
  maintenanceListQuery,
  maintenanceUpdateSchema,
  statsQuery,
  trivyImportSchema,
} from "@/validators/schemas";
import {
  createChange,
  decideChange,
  getChange,
  listChanges,
  submitChange,
  transitionChange,
  updateChange,
} from "@/services/changes.service";
import type { RouteDef } from "@/routes/types";
import { TRIVY_MAX_REPORT_BYTES } from "../../../../packages/server-core/src/security/trivy";

export const workRoutes: RouteDef[] = [
  /* ---------- security findings ---------- */
  {
    method: "GET",
    path: "findings",
    handler: async ({ req }) => {
      await authorize(req, "read");
      const result = await listFindings(parseQuery(req, findingListQuery));
      return jsonList(result.items, result.pagination);
    },
  },
  {
    method: "POST",
    path: "findings",
    handler: async ({ req, ip }) => {
      const user = await authorize(req, "write");
      return jsonOk(await createFinding(user, await parseBody(req, findingCreateSchema), ip), { status: 201 });
    },
  },
  {
    method: "GET",
    path: "findings/:id",
    handler: async ({ req, params }) => {
      await authorize(req, "read");
      return jsonOk(await getFinding(params.id!));
    },
  },
  {
    method: "PATCH",
    path: "findings/:id",
    handler: async ({ req, ip, params }) => {
      const user = await authorize(req, "write");
      return jsonOk(await updateFinding(user, params.id!, await parseBody(req, findingUpdateSchema), ip));
    },
  },
  {
    method: "DELETE",
    path: "findings/:id",
    handler: async ({ req, ip, params }) => {
      const user = await authorize(req, "admin");
      await deleteFinding(user, params.id!, ip);
      return jsonOk({ deleted: true });
    },
  },

  {
    method: "GET",
    path: "security/dashboard",
    handler: async ({ req }) => {
      await authorize(req, "read");
      return jsonOk(await securityDashboard());
    },
  },
  {
    method: "GET",
    path: "security/imports/:assetId",
    handler: async ({ req, params }) => {
      await authorize(req, "read");
      return jsonOk(await scanHistory(params.assetId!));
    },
  },
  {
    method: "POST",
    path: "security/imports",
    handler: async ({ req, ip }) => {
      const user = await authorize(req, "write");
      const body = await parseBody(req, trivyImportSchema);
      const bytes = Buffer.byteLength(JSON.stringify(body.report ?? null), "utf8");
      if (bytes > TRIVY_MAX_REPORT_BYTES) {
        throw errors.payloadTooLarge(
          `Trivy report is ${Math.round(bytes / 1024)} KB; the limit is ${Math.round(TRIVY_MAX_REPORT_BYTES / 1024)} KB`,
        );
      }
      return jsonOk(await importTrivyReport(user, body, ip), { status: 201 });
    },
  },

  /* ---------- incidents ---------- */
  {
    method: "GET",
    path: "incidents",
    handler: async ({ req }) => {
      await authorize(req, "read");
      const result = await listIncidents(parseQuery(req, incidentListQuery));
      return jsonList(result.items, result.pagination);
    },
  },
  {
    method: "POST",
    path: "incidents",
    handler: async ({ req, ip }) => {
      const user = await authorize(req, "write");
      return jsonOk(await createIncident(user, await parseBody(req, incidentCreateSchema), ip), { status: 201 });
    },
  },
  {
    method: "GET",
    path: "incidents/stats",
    handler: async ({ req }) => {
      await authorize(req, "read");
      const { days } = parseQuery(req, statsQuery);
      return jsonOk(await incidentStats(days));
    },
  },
  {
    method: "GET",
    path: "incidents/sla",
    handler: async ({ req }) => {
      await authorize(req, "read");
      const { days } = parseQuery(req, statsQuery);
      return jsonOk(await incidentSlaMetrics(days));
    },
  },
  {
    method: "GET",
    path: "incidents/:id",
    handler: async ({ req, params }) => {
      await authorize(req, "read");
      return jsonOk(await getIncident(params.id!));
    },
  },
  {
    method: "POST",
    path: "incidents/:id/acknowledge",
    handler: async ({ req, ip, params }) => {
      const user = await authorize(req, "write");
      return jsonOk(await acknowledgeIncident(user, params.id!, ip));
    },
  },
  {
    method: "PATCH",
    path: "incidents/:id",
    handler: async ({ req, ip, params }) => {
      const user = await authorize(req, "write");
      return jsonOk(await updateIncident(user, params.id!, await parseBody(req, incidentUpdateSchema), ip));
    },
  },
  {
    method: "POST",
    path: "incidents/:id/comments",
    handler: async ({ req, ip, params }) => {
      const user = await authorize(req, "write");
      const body = await parseBody(req, commentSchema);
      return jsonOk(await addIncidentComment(user, params.id!, body.body, ip), { status: 201 });
    },
  },

  /* ---------- maintenance ---------- */
  {
    method: "GET",
    path: "maintenance",
    handler: async ({ req }) => {
      await authorize(req, "read");
      const result = await listMaintenance(parseQuery(req, maintenanceListQuery));
      return jsonList(result.items, result.pagination);
    },
  },
  {
    method: "POST",
    path: "maintenance",
    handler: async ({ req, ip }) => {
      const user = await authorize(req, "write");
      return jsonOk(await createMaintenance(user, await parseBody(req, maintenanceCreateSchema), ip), { status: 201 });
    },
  },
  {
    method: "GET",
    path: "maintenance/:id",
    handler: async ({ req, params }) => {
      await authorize(req, "read");
      return jsonOk(await getMaintenance(params.id!));
    },
  },
  {
    method: "PATCH",
    path: "maintenance/:id",
    handler: async ({ req, ip, params }) => {
      const user = await authorize(req, "write");
      return jsonOk(await updateMaintenance(user, params.id!, await parseBody(req, maintenanceUpdateSchema), ip));
    },
  },
  {
    method: "DELETE",
    path: "maintenance/:id",
    handler: async ({ req, ip, params }) => {
      const user = await authorize(req, "admin");
      await deleteMaintenance(user, params.id!, ip);
      return jsonOk({ deleted: true });
    },
  },

  /* ---------- change management ---------- */
  {
    method: "GET",
    path: "changes",
    handler: async ({ req }) => {
      await authorize(req, "read");
      const result = await listChanges(parseQuery(req, changeListQuery));
      return jsonList(result.items, result.pagination, { approvalsRequired: result.approvalsRequired });
    },
  },
  {
    method: "POST",
    path: "changes",
    handler: async ({ req, ip }) => {
      const user = await authorize(req, "write");
      return jsonOk(await createChange(user, await parseBody(req, changeCreateSchema), ip), { status: 201 });
    },
  },
  {
    method: "GET",
    path: "changes/:id",
    handler: async ({ req, params }) => {
      await authorize(req, "read");
      return jsonOk(await getChange(params.id!));
    },
  },
  {
    method: "PATCH",
    path: "changes/:id",
    handler: async ({ req, ip, params }) => {
      const user = await authorize(req, "write");
      return jsonOk(await updateChange(user, params.id!, await parseBody(req, changeUpdateSchema), ip));
    },
  },
  {
    method: "POST",
    path: "changes/:id/submit",
    handler: async ({ req, ip, params }) => {
      const user = await authorize(req, "write");
      return jsonOk(await submitChange(user, params.id!, ip));
    },
  },
  {
    method: "POST",
    path: "changes/:id/approvals",
    handler: async ({ req, ip, params }) => {
      const user = await authorize(req, "write");
      const body = await parseBody(req, approvalSchema);
      return jsonOk(await decideChange(user, params.id!, body.decision, body.comment, ip), { status: 201 });
    },
  },
  {
    method: "POST",
    path: "changes/:id/transitions",
    handler: async ({ req, ip, params }) => {
      const user = await authorize(req, "write");
      return jsonOk(await transitionChange(user, params.id!, await parseBody(req, changeTransitionSchema), ip));
    },
  },
];
