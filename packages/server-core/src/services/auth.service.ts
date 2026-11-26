import type { UserDoc } from "@/db/models/documents";
import {
  countUsers,
  findUserByEmail,
  findUserById,
  insertUser,
  updateUserById,
} from "@/db/repositories/users.repository";
import {
  findRefreshTokenByHash,
  insertPasswordResetToken,
  insertRefreshToken,
  revokeActiveRefreshTokensForUser,
  revokeRefreshTokenFamily,
  completePasswordResetWithToken,
  RefreshTokenAlreadyRotatedError,
  rotateRefreshTokenDoc,
} from "@/db/repositories/auth-tokens.repository";
import { getEnv } from "@/lib/env";
import { errors } from "@/lib/http";
import { sendMail } from "@/lib/mailer";
import { DUMMY_HASH_PROMISE, hashPassword, randomToken, sha256, signAccessToken, verifyPassword } from "@/lib/security";
import { recordAudit } from "@/services/audit.service";

export type UserRow = UserDoc;

export interface RequestMeta {
  ip: string;
  userAgent: string | null;
}

export function toPublicUser(u: UserDoc) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    isActive: u.isActive,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  };
}

export interface SessionResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: ReturnType<typeof toPublicUser>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function issueSession(user: UserDoc, meta: RequestMeta, familyId: string = crypto.randomUUID()): Promise<SessionResult> {
  const env = getEnv();
  const refreshToken = randomToken();
  await insertRefreshToken({
    userId: user.id,
    tokenHash: sha256(refreshToken),
    familyId,
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * DAY_MS),
    userAgent: meta.userAgent ? meta.userAgent.slice(0, 255) : null,
    ipAddress: meta.ip.slice(0, 64),
  });
  const accessToken = await signAccessToken({ sub: user.id, role: user.role });
  return { accessToken, refreshToken, expiresIn: env.ACCESS_TOKEN_TTL_SECONDS, user: toPublicUser(user) };
}

export async function register(input: { name: string; email: string; password: string }, meta: RequestMeta): Promise<SessionResult> {
  const existing = await findUserByEmail(input.email);
  if (existing) throw errors.conflict("An account with this email already exists");
  const role = (await countUsers()) === 0 ? "admin" : "viewer";
  const user = await insertUser({
    name: input.name,
    email: input.email,
    passwordHash: await hashPassword(input.password),
    role,
  });
  await recordAudit({ actorId: user.id, action: "auth.register", entityType: "user", entityId: user.id, summary: `Account registered with role ${role}`, ip: meta.ip });
  return issueSession(user, meta);
}

export async function login(input: { email: string; password: string }, meta: RequestMeta): Promise<SessionResult> {
  const user = await findUserByEmail(input.email);
  let passwordOk = false;
  if (user) passwordOk = await verifyPassword(input.password, user.passwordHash);
  else await verifyPassword(input.password, await DUMMY_HASH_PROMISE);
  if (!user || !passwordOk) {
    await recordAudit({
      action: "auth.login_failed",
      entityType: "user",
      entityId: user?.id ?? "unknown",
      summary: "Failed sign-in attempt",
      metadata: { userAgent: meta.userAgent },
      ip: meta.ip,
    });
    throw errors.unauthorized("Invalid email or password");
  }
  if (!user.isActive) {
    await recordAudit({
      action: "auth.login_failed",
      entityType: "user",
      entityId: user.id,
      summary: "Failed sign-in attempt for deactivated account",
      metadata: { userAgent: meta.userAgent },
      ip: meta.ip,
    });
    throw errors.forbidden("This account has been deactivated. Contact an administrator.");
  }
  await updateUserById(user.id, { lastLoginAt: new Date() });
  await recordAudit({
    actorId: user.id,
    action: "auth.login",
    entityType: "user",
    entityId: user.id,
    summary: "Signed in",
    metadata: { userAgent: meta.userAgent },
    ip: meta.ip,
  });
  return issueSession(user, meta);
}

export async function rotateSession(rawToken: string, meta: RequestMeta): Promise<SessionResult> {
  const sessionExpired = () => errors.unauthorized("Your session has expired. Please sign in again.");
  const row = await findRefreshTokenByHash(sha256(rawToken));
  if (!row) throw sessionExpired();
  if (row.revokedAt) {
    await revokeRefreshTokenFamily(row.familyId);
    await recordAudit({ actorId: row.userId, action: "auth.refresh_reuse_detected", entityType: "user", entityId: row.userId, summary: "Revoked session family after refresh token reuse", ip: meta.ip });
    throw sessionExpired();
  }
  if (row.expiresAt.getTime() <= Date.now()) throw sessionExpired();
  const env = getEnv();
  const rawNext = randomToken();
  try {
    await rotateRefreshTokenDoc(row.id, {
      userId: row.userId,
      tokenHash: sha256(rawNext),
      familyId: row.familyId,
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * DAY_MS),
      userAgent: meta.userAgent ? meta.userAgent.slice(0, 255) : null,
      ipAddress: meta.ip.slice(0, 64),
    });
  } catch (error) {
    if (!(error instanceof RefreshTokenAlreadyRotatedError)) throw error;
    await revokeRefreshTokenFamily(row.familyId);
    await recordAudit({ actorId: row.userId, action: "auth.refresh_reuse_detected", entityType: "user", entityId: row.userId, summary: "Revoked session family after refresh token reuse", ip: meta.ip });
    throw sessionExpired();
  }
  const user = await findUserById(row.userId);
  if (!user || !user.isActive) throw sessionExpired();
  const accessToken = await signAccessToken({ sub: user.id, role: user.role });
  return { accessToken, refreshToken: rawNext, expiresIn: env.ACCESS_TOKEN_TTL_SECONDS, user: toPublicUser(user) };
}

export async function logout(rawToken: string | null): Promise<void> {
  if (!rawToken) return;
  const row = await findRefreshTokenByHash(sha256(rawToken));
  if (row) await revokeRefreshTokenFamily(row.familyId);
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await revokeActiveRefreshTokensForUser(userId);
}

export async function requestPasswordReset(email: string, meta: RequestMeta): Promise<{ devToken?: string }> {
  const env = getEnv();
  const user = await findUserByEmail(email);
  if (!user || !user.isActive) return {};
  const token = randomToken(32);
  await insertPasswordResetToken({
    userId: user.id,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + env.PASSWORD_RESET_TTL_MINUTES * 60 * 1000),
  });
  const origin = env.APP_ORIGIN ?? "http://localhost:3000";
  await sendMail({ to: user.email, subject: "InfraPilot password reset", text: `Reset your password within ${env.PASSWORD_RESET_TTL_MINUTES} minutes: ${origin}/forgot-password?token=${token}` });
  await recordAudit({ actorId: user.id, action: "auth.password_reset_requested", entityType: "user", entityId: user.id, summary: "Password reset requested", ip: meta.ip });
  return env.EXPOSE_RESET_TOKEN ? { devToken: token } : {};
}

export async function completePasswordReset(token: string, password: string, meta: RequestMeta): Promise<void> {
  const passwordHash = await hashPassword(password);
  const userId = await completePasswordResetWithToken(sha256(token), passwordHash);
  if (!userId) throw errors.badRequest("This reset link is invalid or has expired");
  await recordAudit({ actorId: userId, action: "auth.password_reset_completed", entityType: "user", entityId: userId, summary: "Password reset completed; all sessions revoked", ip: meta.ip });
}
