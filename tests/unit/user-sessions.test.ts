import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listUserSessions, revokeUserSession } from "@/services/users.service";

const mocks = vi.hoisted(() => ({
  listActiveRefreshSessions: vi.fn(),
  findActiveRefreshSessionById: vi.fn(),
  findRefreshTokenByHash: vi.fn(),
  revokeRefreshTokenFamily: vi.fn(),
  recordAudit: vi.fn(),
  sha256: vi.fn((value: string) => `hash:${value}`),
}));
const originalMongoUri = process.env.MONGODB_URI;

vi.mock("@/db/repositories/auth-tokens.repository", () => ({
  listActiveRefreshSessions: mocks.listActiveRefreshSessions,
  findActiveRefreshSessionById: mocks.findActiveRefreshSessionById,
  findRefreshTokenByHash: mocks.findRefreshTokenByHash,
  revokeRefreshTokenFamily: mocks.revokeRefreshTokenFamily,
}));
vi.mock("@/db/repositories/users.repository", () => ({
  findUserById: vi.fn(),
  listActiveUserOptions: vi.fn(),
  listUsersPaginated: vi.fn(),
  updateUserById: vi.fn(),
}));
vi.mock("@/services/audit.service", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/services/auth.service", () => ({
  toPublicUser: vi.fn(),
  issueSession: vi.fn(),
  revokeAllSessions: vi.fn(),
}));
vi.mock("@/lib/security", () => ({
  hashPassword: vi.fn(),
  sha256: mocks.sha256,
  verifyPassword: vi.fn(),
}));

describe("account session management", () => {
  const now = new Date();
  const meta = { ip: "192.0.2.1", userAgent: "Test browser" };
  const actor = { id: "user-1", email: "admin@example.com", name: "Ada Admin", role: "admin" as const };

  afterEach(() => {
    if (originalMongoUri === undefined) delete process.env.MONGODB_URI;
    else process.env.MONGODB_URI = originalMongoUri;
  });

  beforeEach(() => {
    process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/test?replicaSet=rs0";
    mocks.listActiveRefreshSessions.mockResolvedValue([
      {
        id: "current-session",
        familyId: "current-family",
        userAgent: "Current browser",
        ipAddress: "192.0.2.2",
        createdAt: now,
        expiresAt: new Date(now.getTime() + 60_000),
      },
      {
        id: "other-session",
        familyId: "other-family",
        userAgent: "Other browser",
        ipAddress: "192.0.2.3",
        createdAt: now,
        expiresAt: new Date(now.getTime() + 60_000),
      },
    ]);
    mocks.findRefreshTokenByHash.mockResolvedValue({
      userId: "user-1",
      familyId: "current-family",
      revokedAt: null,
      expiresAt: new Date(now.getTime() + 60_000),
    });
    mocks.findActiveRefreshSessionById.mockResolvedValue({ familyId: "other-family" });
  });

  it("marks the current session without exposing token-family data", async () => {
    const sessions = await listUserSessions("user-1", "current-token");

    expect(sessions[0]).toMatchObject({ id: "current-session", current: true });
    expect(sessions[1]).toMatchObject({ id: "other-session", current: false });
    expect(sessions[0]).not.toHaveProperty("familyId");
    expect(sessions[0]).not.toHaveProperty("tokenHash");
    expect(mocks.findRefreshTokenByHash).toHaveBeenCalledWith("hash:current-token");
  });

  it("revokes another session family and records an audit event", async () => {
    await revokeUserSession(actor, actor.id, "other-session", "current-token", meta);

    expect(mocks.revokeRefreshTokenFamily).toHaveBeenCalledWith("other-family");
    expect(mocks.recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "user.session_revoked",
      entityId: actor.id,
      ip: meta.ip,
    }));
  });

  it("prevents revoking the current session through session management", async () => {
    mocks.findActiveRefreshSessionById.mockResolvedValue({ familyId: "current-family" });

    await expect(revokeUserSession(actor, actor.id, "current-session", "current-token", meta))
      .rejects.toThrow("Use log out to end the current session");

    expect(mocks.revokeRefreshTokenFamily).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it("allows an administrator to revoke another user's session and audits the target", async () => {
    await revokeUserSession(actor, "user-2", "other-session", "current-token", meta);

    expect(mocks.findActiveRefreshSessionById).toHaveBeenCalledWith("user-2", "other-session", expect.any(Date));
    expect(mocks.revokeRefreshTokenFamily).toHaveBeenCalledWith("other-family");
    expect(mocks.recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      actorId: actor.id,
      entityId: "user-2",
      metadata: { sessionId: "other-session", targetUserId: "user-2" },
    }));
  });
});
