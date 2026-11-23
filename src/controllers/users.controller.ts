import { authorize, REFRESH_COOKIE, readCookie, requireCsrfHeader } from "@/lib/auth";
import { errors, jsonList, jsonOk, parseBody, parseQuery } from "@/lib/http";
import { listLoginHistory } from "@/services/audit.service";
import { changePassword, getProfile, listUserOptions, listUsers, listUserSessions, revokeUserSession, updateProfile, updateUserByAdmin } from "@/services/users.service";
import { changePasswordSchema, loginHistoryQuery, updateProfileSchema, updateUserSchema, userListQuery } from "@/validators/schemas";
import type { RouteDef } from "@/routes/types";
import { requestMeta, sessionResponse, throttle } from "@/controllers/auth.controller";
import { z } from "zod";

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
    path: "users/me/sessions",
    handler: async ({ req }) => {
      const user = await authorize(req, "read");
      return jsonOk(await listUserSessions(user.id, readCookie(req, REFRESH_COOKIE)));
    },
  },
  {
    method: "DELETE",
    path: "users/me/sessions/:id",
    handler: async ({ req, ip, params }) => {
      requireCsrfHeader(req);
      const user = await authorize(req, "read");
      await revokeUserSession(user, user.id, params.id!, readCookie(req, REFRESH_COOKIE), requestMeta(req, ip));
      return jsonOk({ revoked: true });
    },
  },
  {
    method: "GET",
    path: "users/me/login-history",
    handler: async ({ req }) => {
      const user = await authorize(req, "read");
      const result = await listLoginHistory(user.id, parseQuery(req, loginHistoryQuery));
      return jsonList(result.items, result.pagination);
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
  {
    method: "GET",
    path: "users/:id/sessions",
    handler: async ({ req, params }) => {
      const actor = await authorize(req, "admin");
      const currentRefreshToken = actor.id === params.id ? readCookie(req, REFRESH_COOKIE) : null;
      return jsonOk(await listUserSessions(params.id!, currentRefreshToken));
    },
  },
  {
    method: "GET",
    path: "users/:id/login-history",
    handler: async ({ req, params }) => {
      await authorize(req, "admin");
      const result = await listLoginHistory(params.id!, parseQuery(req, loginHistoryQuery));
      return jsonList(result.items, result.pagination);
    },
  },
  {
    method: "DELETE",
    path: "users/:id/sessions/:sessionId",
    handler: async ({ req, ip, params }) => {
      requireCsrfHeader(req);
      const actor = await authorize(req, "admin");
      const parsedSessionId = z.uuid().safeParse(params.sessionId);
      if (!parsedSessionId.success) throw errors.badRequest("Invalid session identifier");
      const currentRefreshToken = actor.id === params.id ? readCookie(req, REFRESH_COOKIE) : null;
      await revokeUserSession(
        actor,
        params.id!,
        parsedSessionId.data,
        currentRefreshToken,
        requestMeta(req, ip),
      );
      return jsonOk({ revoked: true });
    },
  },
];
