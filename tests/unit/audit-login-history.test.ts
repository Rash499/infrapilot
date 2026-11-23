import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listAudit, listLoginHistory, recordAudit } from "@/services/audit.service";

const mocks = vi.hoisted(() => ({
  listAuditLogsPaginated: vi.fn(),
  findUserById: vi.fn(),
  insertAuditLog: vi.fn(),
}));
const originalMongoUri = process.env.MONGODB_URI;

vi.mock("@/db/repositories/audit-notifications.repository", () => ({
  insertAuditLog: mocks.insertAuditLog,
  listAuditLogsPaginated: mocks.listAuditLogsPaginated,
}));
vi.mock("@/db/repositories/users.repository", () => ({
  findUserById: mocks.findUserById,
}));

describe("login history", () => {
  beforeEach(() => {
    process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/test?replicaSet=rs0";
    mocks.findUserById.mockResolvedValue(null);
    mocks.listAuditLogsPaginated.mockResolvedValue({
      items: [
        {
          id: "successful-login",
          action: "auth.login",
          entityType: "user",
          entityId: "user-1",
          summary: "Signed in",
          metadata: { userAgent: "Test browser" },
          ipAddress: "192.0.2.1",
          createdAt: new Date("2026-01-01T10:00:00.000Z"),
          actorId: "user-1",
        },
        {
          id: "failed-login",
          action: "auth.login_failed",
          entityType: "user",
          entityId: "user-1",
          summary: "Failed sign-in attempt",
          metadata: null,
          ipAddress: null,
          createdAt: new Date("2026-01-01T09:00:00.000Z"),
          actorId: null,
        },
      ],
      total: 2,
    });
  });

  afterEach(() => {
    if (originalMongoUri === undefined) delete process.env.MONGODB_URI;
    else process.env.MONGODB_URI = originalMongoUri;
  });

  it("limits results to the selected account's successful and failed sign-ins", async () => {
    const result = await listLoginHistory("user-1", { page: 1, pageSize: 10 });

    expect(mocks.listAuditLogsPaginated).toHaveBeenCalledWith({
      page: 1,
      pageSize: 10,
      entityType: "user",
      entityId: "user-1",
      actions: ["auth.login", "auth.login_failed"],
    });
    expect(result.items).toEqual([
      {
        id: "successful-login",
        action: "auth.login",
        createdAt: "2026-01-01T10:00:00.000Z",
        ipAddress: "192.0.2.1",
        userAgent: "Test browser",
      },
      {
        id: "failed-login",
        action: "auth.login_failed",
        createdAt: "2026-01-01T09:00:00.000Z",
        ipAddress: null,
        userAgent: null,
      },
    ]);
    expect(result.pagination.total).toBe(2);
  });

  it("applies action and free-text filters to the audit list", async () => {
    await listAudit({ page: 2, pageSize: 10, action: "auth.login_failed", search: "192.0.2.1" });

    expect(mocks.listAuditLogsPaginated).toHaveBeenCalledWith({
      page: 2,
      pageSize: 10,
      action: "auth.login_failed",
      search: "192.0.2.1",
    });
  });

  it("propagates audit persistence failures rather than hiding them", async () => {
    const failure = new Error("audit storage unavailable");
    mocks.insertAuditLog.mockRejectedValueOnce(failure);

    await expect(
      recordAudit({
        action: "auth.login",
        entityType: "user",
        entityId: "user-1",
        summary: "Signed in",
      }),
    ).rejects.toBe(failure);
  });
});
