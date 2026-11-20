import { authorize } from "@/lib/auth";
import { jsonList, jsonOk, parseBody, parseQuery } from "@/lib/http";
import { changePassword, getProfile, listUserOptions, listUsers, updateProfile, updateUserByAdmin } from "@/services/users.service";
import { changePasswordSchema, updateProfileSchema, updateUserSchema, userListQuery } from "@/validators/schemas";
import type { RouteDef } from "@/routes/types";
import { requestMeta, sessionResponse, throttle } from "@/controllers/auth.controller";

export const usersRoutes: RouteDef[] = [
  {
    method: "GET",
    path: "users/me",
    handler: async ({ req }) => {
      const user = await authorize(req, "read");
      return jsonOk(await getProfile(user.id));
    },
  },
  {
    method: "PATCH",
    path: "users/me",
    handler: async ({ req, ip }) => {
      const user = await authorize(req, "read");
      const body = await parseBody(req, updateProfileSchema);
      return jsonOk(await updateProfile(user, body.name, requestMeta(req, ip)));
    },
  },
  {
    method: "POST",
    path: "users/me/password",
    handler: async ({ req, ip }) => {
      const user = await authorize(req, "read");
      throttle(`password:${user.id}`, 10, 15 * 60 * 1000);
      const body = await parseBody(req, changePasswordSchema);
      const session = await changePassword(user, body.currentPassword, body.newPassword, requestMeta(req, ip));
      return sessionResponse(session);
    },
  },
  {
    method: "GET",
    path: "users/options",
    handler: async ({ req }) => {
      await authorize(req, "read");
      return jsonOk(await listUserOptions());
    },
  },
  {
    method: "GET",
    path: "users",
    handler: async ({ req }) => {
      await authorize(req, "admin");
      const result = await listUsers(parseQuery(req, userListQuery));
      return jsonList(result.items, result.pagination);
    },
  },
  {
    method: "PATCH",
    path: "users/:id",
    handler: async ({ req, ip, params }) => {
      const actor = await authorize(req, "admin");
      const body = await parseBody(req, updateUserSchema);
      return jsonOk(await updateUserByAdmin(actor, params.id!, body, requestMeta(req, ip)));
    },
  },
];
