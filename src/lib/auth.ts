import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { errors } from "@/lib/http";
import { verifyAccessToken } from "@/lib/security";
import { getEnv } from "@/lib/env";

export type Role = "admin" | "operator" | "viewer";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export const REFRESH_COOKIE = "infrapilot_refresh";
export const REFRESH_COOKIE_PATH = "/api/v1/auth";

/** Role matrix enforced on the server. Viewer = read; Operator = read + write; Administrator = everything. */
export const PERMISSIONS = {
  read: ["admin", "operator", "viewer"] as Role[],
  write: ["admin", "operator"] as Role[],
  admin: ["admin"] as Role[],
};

/** Resolves the bearer token to a fresh, active user. Role changes apply immediately. */
export async function requireUser(req: Request): Promise<AuthUser> {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) throw errors.unauthorized();
  const claims = await verifyAccessToken(match[1]!.trim());
  if (!claims) throw errors.unauthorized("Your session is invalid or has expired");
  const [row] = await db
    .select({ id: users.id, email: users.email, name: users.name, role: users.role, isActive: users.isActive })
    .from(users)
    .where(eq(users.id, claims.sub))
    .limit(1);
  if (!row || !row.isActive) throw errors.unauthorized("Your session is invalid or has expired");
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

export function requireRole(user: AuthUser, allowed: Role[]): void {
  if (!allowed.includes(user.role)) throw errors.forbidden();
}

/** Ensures the request carries the custom header that browsers cannot send cross-site without CORS. */
export function requireCsrfHeader(req: Request): void {
  if (req.headers.get("x-infrapilot-request") !== "1") {
    throw errors.forbidden("Missing anti-CSRF header");
  }
}

export function buildRefreshCookie(value: string): string {
  const env = getEnv();
  const maxAge = env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60;
  const parts = [
    `${REFRESH_COOKIE}=${value}`,
    `Path=${REFRESH_COOKIE_PATH}`,
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Strict",
  ];
  if (env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

export function clearRefreshCookie(): string {
  const secure = getEnv().NODE_ENV === "production" ? "; Secure" : "";
  return `${REFRESH_COOKIE}=; Path=${REFRESH_COOKIE_PATH}; Max-Age=0; HttpOnly; SameSite=Strict${secure}`;
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/** Authenticates the request and enforces the minimum role level for the endpoint. */
export async function authorize(req: Request, level: keyof typeof PERMISSIONS): Promise<AuthUser> {
  const user = await requireUser(req);
  requireRole(user, PERMISSIONS[level]);
  return user;
}
