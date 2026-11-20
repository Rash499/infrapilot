import { and, asc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { refreshTokens, users } from "@/db/schema";
import type { AuthUser, Role } from "@/lib/auth";
import { errors, paginationMeta } from "@/lib/http";
import { hashPassword, verifyPassword } from "@/lib/security";
import { recordAudit } from "@/services/audit.service";
import { likeTerm, pageOffset } from "@/services/common";
import { issueSession, revokeAllSessions, toPublicUser, type RequestMeta } from "@/services/auth.service";

export async function listUsers(q: { page: number; pageSize: number; search?: string; role?: Role }) {
  const conditions: SQL[] = [];
  if (q.search) {
    const pattern = likeTerm(q.search);
    conditions.push(or(ilike(users.name, pattern), ilike(users.email, pattern))!);
  }
  if (q.role) conditions.push(eq(users.role, q.role));
  const where = conditions.length ? and(...conditions) : undefined;

  const rows = await db
    .select()
    .from(users)
    .where(where)
    .orderBy(asc(users.name))
    .limit(q.pageSize)
    .offset(pageOffset(q.page, q.pageSize));
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(users).where(where);
  return { items: rows.map(toPublicUser), pagination: paginationMeta(q.page, q.pageSize, total) };
}

export async function listUserOptions() {
  const rows = await db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(eq(users.isActive, true))
    .orderBy(asc(users.name));
  return rows;
}

export async function getProfile(userId: string) {
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!row) throw errors.notFound("User");
  return toPublicUser(row);
}

export async function updateProfile(actor: AuthUser, name: string, meta: RequestMeta) {
  const [row] = await db.update(users).set({ name, updatedAt: new Date() }).where(eq(users.id, actor.id)).returning();
  if (!row) throw errors.notFound("User");
  await recordAudit({
    actorId: actor.id,
    action: "user.profile_updated",
    entityType: "user",
    entityId: actor.id,
    summary: "Profile name updated",
    ip: meta.ip,
  });
  return toPublicUser(row);
}

export async function changePassword(actor: AuthUser, currentPassword: string, newPassword: string, meta: RequestMeta) {
  const [row] = await db.select().from(users).where(eq(users.id, actor.id)).limit(1);
  if (!row) throw errors.notFound("User");
  if (!(await verifyPassword(currentPassword, row.passwordHash))) {
    throw errors.unauthorized("Current password is incorrect");
  }
  const passwordHash = await hashPassword(newPassword);
  await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, actor.id));
  // Revoke every existing session, then issue a fresh one for this device.
  await revokeAllSessions(actor.id);
  await recordAudit({
    actorId: actor.id,
    action: "user.password_changed",
    entityType: "user",
    entityId: actor.id,
    summary: "Password changed; other sessions revoked",
    ip: meta.ip,
  });
  return issueSession(row, meta);
}

export async function updateUserByAdmin(
  actor: AuthUser,
  targetId: string,
  input: { name?: string; role?: Role; isActive?: boolean },
  meta: RequestMeta,
) {
  const [target] = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
  if (!target) throw errors.notFound("User");

  if (targetId === actor.id && (input.role !== undefined && input.role !== "admin" || input.isActive === false)) {
    throw errors.badRequest("You cannot demote or deactivate your own administrator account");
  }

  const patch: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.role !== undefined) patch.role = input.role;
  if (input.isActive !== undefined) patch.isActive = input.isActive;

  const [row] = await db.update(users).set(patch).where(eq(users.id, targetId)).returning();
  if (!row) throw errors.notFound("User");

  const revoke = input.isActive === false || (input.role !== undefined && input.role !== target.role);
  if (revoke) {
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, targetId), sql`${refreshTokens.revokedAt} is null`));
  }

  const changes: string[] = [];
  if (input.role !== undefined && input.role !== target.role) changes.push(`role ${target.role} → ${input.role}`);
  if (input.isActive !== undefined && input.isActive !== target.isActive) {
    changes.push(input.isActive ? "reactivated" : "deactivated");
  }
  if (input.name !== undefined && input.name !== target.name) changes.push("name updated");
  await recordAudit({
    actorId: actor.id,
    action: "user.updated",
    entityType: "user",
    entityId: targetId,
    summary: changes.length ? `User ${row.email}: ${changes.join(", ")}` : `User ${row.email} reviewed`,
    metadata: { changes },
    ip: meta.ip,
  });
  return toPublicUser(row);
}
