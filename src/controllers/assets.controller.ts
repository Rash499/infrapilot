import { authorize } from "@/lib/auth";
import { jsonList, jsonOk, parseBody, parseQuery } from "@/lib/http";
import { archiveAsset, assetHistory, createAsset, getAsset, listAssets, updateAsset } from "@/services/assets.service";
import { assetCreateSchema, assetListQuery, assetUpdateSchema } from "@/validators/schemas";
import type { RouteDef } from "@/routes/types";

export const assetRoutes: RouteDef[] = [
  {
    method: "GET",
    path: "assets",
    handler: async ({ req }) => {
      await authorize(req, "read");
      const result = await listAssets(parseQuery(req, assetListQuery));
      return jsonList(result.items, result.pagination);
    },
  },
  {
    method: "POST",
    path: "assets",
    handler: async ({ req, ip }) => {
      const user = await authorize(req, "write");
      const body = await parseBody(req, assetCreateSchema);
      return jsonOk(await createAsset(user, body, ip), { status: 201 });
    },
  },
  {
    method: "GET",
    path: "assets/:id",
    handler: async ({ req, params }) => {
      await authorize(req, "read");
      return jsonOk(await getAsset(params.id!));
    },
  },
  {
    method: "PATCH",
    path: "assets/:id",
    handler: async ({ req, ip, params }) => {
      const user = await authorize(req, "write");
      const body = await parseBody(req, assetUpdateSchema);
      return jsonOk(await updateAsset(user, params.id!, body, ip));
    },
  },
  {
    method: "DELETE",
    path: "assets/:id",
    handler: async ({ req, ip, params }) => {
      const user = await authorize(req, "write");
      return jsonOk(await archiveAsset(user, params.id!, ip));
    },
  },
  {
    method: "GET",
    path: "assets/:id/history",
    handler: async ({ req, params }) => {
      await authorize(req, "read");
      return jsonOk(await assetHistory(params.id!));
    },
  },
];
