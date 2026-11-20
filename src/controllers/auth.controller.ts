import { REFRESH_COOKIE, buildRefreshCookie, clearRefreshCookie, readCookie, requireCsrfHeader } from "@/lib/auth";
import { errors, jsonOk, parseBody } from "@/lib/http";
import { consumeRateLimit } from "@/lib/security";
import {
  completePasswordReset,
  login,
  logout,
  register,
  requestPasswordReset,
  rotateSession,
  type RequestMeta,
  type SessionResult,
} from "@/services/auth.service";
import { forgotPasswordSchema, loginSchema, registerSchema, resetPasswordSchema } from "@/validators/schemas";
import type { RouteDef } from "@/routes/types";

const MINUTE = 60 * 1000;

export function throttle(key: string, limit: number, windowMs: number): void {
  const result = consumeRateLimit(key, limit, windowMs);
  if (!result.allowed) {
    throw errors.tooManyRequests(`Too many attempts. Try again in ${result.retryAfterSec} seconds.`);
  }
}

export function requestMeta(req: Request, ip: string): RequestMeta {
  return { ip, userAgent: req.headers.get("user-agent") };
}

/** Returns the access token in the body and the rotating refresh token in an httpOnly cookie. */
export function sessionResponse(session: SessionResult, status = 200): Response {
  return jsonOk(
    { accessToken: session.accessToken, expiresIn: session.expiresIn, user: session.user },
    {
      status,
      headers: {
        "Set-Cookie": buildRefreshCookie(session.refreshToken),
        "Cache-Control": "no-store",
      },
    },
  );
}

export const authRoutes: RouteDef[] = [
  {
    method: "POST",
    path: "auth/register",
    handler: async ({ req, ip }) => {
      throttle(`register:${ip}`, 10, 60 * MINUTE);
      const body = await parseBody(req, registerSchema);
      return sessionResponse(await register(body, requestMeta(req, ip)), 201);
    },
  },
  {
    method: "POST",
    path: "auth/login",
    handler: async ({ req, ip }) => {
      throttle(`login:${ip}`, 25, 15 * MINUTE);
      const body = await parseBody(req, loginSchema);
      return sessionResponse(await login(body, requestMeta(req, ip)));
    },
  },
  {
    method: "POST",
    path: "auth/refresh",
    handler: async ({ req, ip }) => {
      requireCsrfHeader(req);
      throttle(`refresh:${ip}`, 60, MINUTE);
      const raw = readCookie(req, REFRESH_COOKIE);
      if (!raw) throw errors.unauthorized("No active session");
      return sessionResponse(await rotateSession(raw, requestMeta(req, ip)));
    },
  },
  {
    method: "POST",
    path: "auth/logout",
    handler: async ({ req }) => {
      requireCsrfHeader(req);
      await logout(readCookie(req, REFRESH_COOKIE));
      return jsonOk({ loggedOut: true }, { headers: { "Set-Cookie": clearRefreshCookie() } });
    },
  },
  {
    method: "POST",
    path: "auth/forgot-password",
    handler: async ({ req, ip }) => {
      throttle(`forgot:${ip}`, 5, 60 * MINUTE);
      const body = await parseBody(req, forgotPasswordSchema);
      const result = await requestPasswordReset(body.email, requestMeta(req, ip));
      return jsonOk(
        {
          message: "If an account exists for this email, password reset instructions have been sent.",
          ...(result.devToken ? { devToken: result.devToken } : {}),
        },
        { status: 202 },
      );
    },
  },
  {
    method: "POST",
    path: "auth/reset-password",
    handler: async ({ req, ip }) => {
      throttle(`reset:${ip}`, 10, 15 * MINUTE);
      const body = await parseBody(req, resetPasswordSchema);
      await completePasswordReset(body.token, body.password, requestMeta(req, ip));
      return jsonOk({ message: "Your password has been updated. Please sign in again." });
    },
  },
];
