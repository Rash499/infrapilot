import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { passwordResetTokens, refreshTokens, users } from "@/db/schema";
import { getEnv } from "@/lib/env";
import { errors } from "@/lib/http";
import { sendMail } from "@/lib/mailer";
import { DUMMY_HASH_PROMISE, hashPassword, randomToken, sha256, signAccessToken, verifyPassword } from "@/lib/security";
import { recordAudit } from "@/services/audit.service";

export type UserRow = typeof users.$inferSelect;

export interface RequestMeta {
  ip: string;
  userAgent: string | null;
}

export function toPublicUser(u: UserRow) {
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

/** Creates a refresh-token record (stored only as a SHA-256 hash) and a short-lived access token. */
export async function issueSession(user: UserRow, meta: RequestMeta, familyId: string = crypto.randomUUID()): Promise<SessionResult> {
  const env = getEnv();
  const refreshToken = randomToken();
  await db.insert(refreshTokens).values({
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
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
  if (existing) throw errors.conflict("An account with this email already exists");

  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(users);
  // The very first account bootstraps the platform as Administrator; later self-registrations are Viewers.
  const role = total === 0 ? "admin" : "viewer";
  const [user] = await db
    .insert(users)
    .values({ name: input.name, email: input.email, passwordHash: await hashPassword(input.password), role })
    .returning();
  if (!user) throw errors.badRequest("Account could not be created");

  await recordAudit({
    actorId: user.id,
    action: "auth.register",
    entityType: "user",
    entityId: user.id,
    summary: `Account registered with role ${role}`,
    ip: meta.ip,
  });
  return issueSession(user, meta);
}

export async function login(input: { email: string; password: string }, meta: RequestMeta): Promise<SessionResult> {
  const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
  // Always run one hash comparison so response timing does not reveal whether the email exists.
  let passwordOk = false;
  if (user) {
    passwordOk = await verifyPassword(input.password, user.passwordHash);
  } else {
    await verifyPassword(input.password, await DUMMY_HASH_PROMISE);
  }
  if (!user || !passwordOk) {
    await recordAudit({
      action: "auth.login_failed",
      entityType: "user",
      entityId: user?.id ?? "unknown",
      summary: "Failed sign-in attempt",
      ip: meta.ip,
    });
    throw errors.unauthorized("Invalid email or password");
  }
  if (!user.isActive) throw errors.forbidden("This account has been deactivated. Contact an administrator.");

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  await recordAudit({
    actorId: user.id,
    action: "auth.login",
    entityType: "user",
    entityId: user.id,
    summary: "Signed in",
    ip: meta.ip,
  });
  return issueSession(user, meta);
}

/**
 * Rotates a refresh token. Each token is single-use: presenting an already-revoked token is treated
 * as theft and revokes every token in the same family.
 */
export async function rotateSession(rawToken: string, meta: RequestMeta): Promise<SessionResult> {
  const sessionExpired = () => errors.unauthorized("Your session has expired. Please sign in again.");
  const [row] = await db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, sha256(rawToken))).limit(1);
  if (!row) throw sessionExpired();

  if (row.revokedAt) {
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.familyId, row.familyId), isNull(refreshTokens.revokedAt)));
    await recordAudit({
      actorId: row.userId,
      action: "auth.refresh_reuse_detected",
      entityType: "user",
      entityId: row.userId,
      summary: "Revoked session family after refresh token reuse",
      ip: meta.ip,
    });
    throw sessionExpired();
  }
  if (row.expiresAt.getTime() <= Date.now()) throw sessionExpired();

  const claimed = await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.id, row.id), isNull(refreshTokens.revokedAt)))
    .returning({ id: refreshTokens.id });
  if (claimed.length === 0) throw sessionExpired();

  const [user] = await db.select().from(users).where(eq(users.id, row.userId)).limit(1);
  if (!user || !user.isActive) throw sessionExpired();
  return issueSession(user, meta, row.familyId);
}

export async function logout(rawToken: string | null): Promise<void> {
  if (!rawToken) return;
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.tokenHash, sha256(rawToken)), isNull(refreshTokens.revokedAt)));
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
}

/**
 * Starts a password reset. The response is identical for known and unknown emails. The token is
 * delivered through the mail transport; it is only echoed back when EXPOSE_RESET_TOKEN=true (local development).
 */
export async function requestPasswordReset(email: string, meta: RequestMeta): Promise<{ devToken?: string }> {
  const env = getEnv();
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || !user.isActive) return {};

  const token = randomToken(32);
  await db.insert(passwordResetTokens).values({
    userId: user.id,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + env.PASSWORD_RESET_TTL_MINUTES * 60 * 1000),
  });
  const origin = env.APP_ORIGIN ?? "http://localhost:3000";
  await sendMail({
    to: user.email,
    subject: "InfraPilot password reset",
    text: `Reset your password within ${env.PASSWORD_RESET_TTL_MINUTES} minutes: ${origin}/forgot-password?token=${token}`,
  });
  await recordAudit({
    actorId: user.id,
    action: "auth.password_reset_requested",
    entityType: "user",
    entityId: user.id,
    summary: "Password reset requested",
    ip: meta.ip,
  });
  return env.EXPOSE_RESET_TOKEN ? { devToken: token } : {};
}

export async function completePasswordReset(token: string, password: string, meta: RequestMeta): Promise<void> {
  const [row] = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.tokenHash, sha256(token))).limit(1);
  if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now()) {
    throw errors.badRequest("This reset link is invalid or has expired");
  }
  const passwordHash = await hashPassword(password);
  await db.transaction(async (tx) => {
    const claimed = await tx
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordResetTokens.id, row.id), isNull(passwordResetTokens.usedAt)))
      .returning({ id: passwordResetTokens.id });
    if (claimed.length === 0) throw errors.badRequest("This reset link has already been used");
    await tx.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, row.userId));
    await tx
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, row.userId), isNull(refreshTokens.revokedAt)));
  });
  await recordAudit({
    actorId: row.userId,
    action: "auth.password_reset_completed",
    entityType: "user",
    entityId: row.userId,
    summary: "Password reset completed; all sessions revoked",
    ip: meta.ip,
  });
}
