import type { AuthUser, Role } from "@/lib/auth";
import { errors, paginationMeta } from "@/lib/http";
import { hashPassword, sha256, verifyPassword } from "@/lib/security";
import {
  findActiveRefreshSessionById,
  findRefreshTokenByHash,
  listActiveRefreshSessions,
  revokeRefreshTokenFamily,
  type ActiveRefreshSession,
} from "@/db/repositories/auth-tokens.repository";
import { recordAudit } from "@/services/audit.service";
import {
  findUserById,
  listActiveUserOptions,
  listUsersPaginated,
  updateUserById,
} from "@/db/repositories/users.repository";
import type { UserDoc } from "@/db/models/documents";
import { toPublicUser, issueSession, revokeAllSessions, type RequestMeta } from "@/services/auth.service";

export async function listUsers(q: { page: number; pageSize: number; search?: string; role?: Role }) {
  const result = await listUsersPaginated(q);
  return { items: result.items.map(toPublicUser), pagination: paginationMeta(q.page, q.pageSize, result.total) };
}

export async function listUserOptions() {
  return listActiveUserOptions();
}

export async function getProfile(userId: string) {
  const row = await findUserById(userId);
  if (!row) throw errors.notFound("User");
  return toPublicUser(row);
}

export async function updateProfile(actor: AuthUser, name: string, meta: RequestMeta) {
  const row = await updateUserById(actor.id, { name });
  if (!row) throw errors.notFound("User");
  await recordAudit({ actorId: actor.id, action: "user.profile_updated", entityType: "user", entityId: actor.id, summary: "Profile name updated", ip: meta.ip });
  return toPublicUser(row);
}

export async function changePassword(actor: AuthUser, currentPassword: string, newPassword: string, meta: RequestMeta) {
  const row = await findUserById(actor.id);
  if (!row) throw errors.notFound("User");
  if (!(await verifyPassword(currentPassword, row.passwordHash))) throw errors.unauthorized("Current password is incorrect");
  const passwordHash = await hashPassword(newPassword);
  await updateUserById(actor.id, { passwordHash });
  await revokeAllSessions(actor.id);
  await recordAudit({ actorId: actor.id, action: "user.password_changed", entityType: "user", entityId: actor.id, summary: "Password changed; other sessions revoked", ip: meta.ip });
  return issueSession(row, meta);
}

export interface UserSession {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}

export async function listUserSessions(userId: string, currentRefreshToken: string | null): Promise<UserSession[]> {
  const now = new Date();
  let rows: ActiveRefreshSession[];
  let currentFamilyId: string | null = null;

  const [sessions, currentToken] = await Promise.all([
    listActiveRefreshSessions(userId, now),
    currentRefreshToken ? findRefreshTokenByHash(sha256(currentRefreshToken)) : Promise.resolve(null),
  ]);
  rows = sessions;
  if (currentToken?.userId === userId && !currentToken.revokedAt && currentToken.expiresAt > now) {
    currentFamilyId = currentToken.familyId;
  }

  return rows.map(({ id, familyId, userAgent, ipAddress, createdAt, expiresAt }) => ({
    id,
    userAgent,
    ipAddress,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    current: familyId === currentFamilyId,
  }));
}

export async function revokeUserSession(
  actor: AuthUser,
  targetUserId: string,
  sessionId: string,
  currentRefreshToken: string | null,
  meta: RequestMeta,
): Promise<void> {
  const now = new Date();

  const target = await findActiveRefreshSessionById(targetUserId, sessionId, now);
  if (!target) throw errors.notFound("Session");
  const currentToken = actor.id === targetUserId && currentRefreshToken
    ? await findRefreshTokenByHash(sha256(currentRefreshToken))
    : null;
  if (currentToken?.userId === targetUserId && !currentToken.revokedAt && currentToken.familyId === target.familyId) {
    throw errors.badRequest("Use log out to end the current session");
  }
  await revokeRefreshTokenFamily(target.familyId);

  await recordAudit({
    actorId: actor.id,
    action: "user.session_revoked",
    entityType: "user",
    entityId: targetUserId,
    summary: actor.id === targetUserId ? "An account session was revoked" : "An administrator revoked an account session",
    metadata: { sessionId, targetUserId },
    ip: meta.ip,
  });
}

export async function updateUserByAdmin(
  actor: AuthUser,
  targetId: string,
  input: { name?: string; role?: Role; isActive?: boolean },
  meta: RequestMeta,
) {
  const target = await findUserById(targetId);
  if (!target) throw errors.notFound("User");
  if (targetId === actor.id && ((input.role !== undefined && input.role !== "admin") || input.isActive === false)) {
    throw errors.badRequest("You cannot demote or deactivate your own administrator account");
  }
  const patch: Partial<Pick<UserDoc, "name" | "role" | "isActive">> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.role !== undefined) patch.role = input.role;
  if (input.isActive !== undefined) patch.isActive = input.isActive;
  const row = await updateUserById(targetId, patch);
  if (!row) throw errors.notFound("User");
  const revoke = input.isActive === false || (input.role !== undefined && input.role !== target.role);
  if (revoke) await revokeAllSessions(targetId);
  const changes: string[] = [];
  if (input.role !== undefined && input.role !== target.role) changes.push(`role ${target.role} → ${input.role}`);
  if (input.isActive !== undefined && input.isActive !== target.isActive) changes.push(input.isActive ? "reactivated" : "deactivated");
  if (input.name !== undefined && input.name !== target.name) changes.push("name updated");
  await recordAudit({ actorId: actor.id, action: "user.updated", entityType: "user", entityId: targetId, summary: changes.length ? `User ${row.email}: ${changes.join(", ")}` : `User ${row.email} reviewed`, metadata: { changes }, ip: meta.ip });
  return toPublicUser(row);
}
