import { beforeEach, describe, expect, it, vi } from "vitest";
import { appDbCollectionNames, appDbIndexes } from "@/db/app_db";
import { collections, newEntityIds } from "@/db/collections";
import {
  deleteMonitoringTargetById,
  insertAsset,
  insertAuditLog,
  insertNotifications,
  insertRefreshToken,
  listActiveRefreshSessions,
  findActiveRefreshSessionById,
  revokeRefreshTokenFamily,
  insertUser,
  nextSequenceValue,
  insertMaintenanceWithAssets,
  rotateRefreshTokenDoc,
  listIncidents,
  createSecurityFinding,
  createIncident,
  createChangeRequest,
  decideChangeRequest,
  getWorkerHealth,
} from "@/db/repositories";

const mockState = vi.hoisted(() => ({
  docs: new Map<string, Array<Record<string, unknown>>>(),
  session: { id: "mock-session" },
}));

function getStore(name: string): Array<Record<string, unknown>> {
  let arr = mockState.docs.get(name);
  if (!arr) {
    arr = [];
    mockState.docs.set(name, arr);
  }
  return arr;
}

function compareValues(left: unknown, right: unknown): number | null {
  if (left instanceof Date && right instanceof Date) return left.getTime() - right.getTime();
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "string" && typeof right === "string") return left.localeCompare(right);
  return null;
}

function matches(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === "$and" && Array.isArray(expected)) {
      return expected.every((condition) => matches(doc, condition as Record<string, unknown>));
    }
    const actual = doc[key];
    if (typeof expected === "object" && expected !== null) {
      if ("$in" in expected) return (expected.$in as unknown[]).includes(actual);
      if ("$nin" in expected) return !(expected.$nin as unknown[]).includes(actual);
      if ("$gt" in expected) {
        const comparison = compareValues(actual, expected.$gt);
        return comparison !== null && comparison > 0;
      }
      if ("$gte" in expected) {
        const comparison = compareValues(actual, expected.$gte);
        return comparison !== null && comparison >= 0;
      }
    }
    return actual === expected;
  });
}

function makeMockCollection(name: string) {
  const store = getStore(name);
  return {
    insertOne: vi.fn(async (doc: Record<string, unknown>) => {
      store.push({ ...doc });
      return { acknowledged: true, insertedId: doc._id };
    }),
    insertMany: vi.fn(async (docs: Array<Record<string, unknown>>) => {
      for (const doc of docs) store.push({ ...doc });
      return { acknowledged: true, insertedCount: docs.length };
    }),
    findOne: vi.fn(async (filter: Record<string, unknown>) => store.find((doc) => matches(doc, filter)) ?? null),
    find: vi.fn((filter: Record<string, unknown>) => {
      let sortSpec: Record<string, 1 | -1> = {};
      let skip = 0;
      let limit = store.length;
      const cursor = {
        sort(spec: Record<string, 1 | -1>) {
          sortSpec = spec;
          return cursor;
        },
        limit(count: number) {
          limit = count;
          return cursor;
        },
        skip(count: number) {
          skip = count;
          return cursor;
        },
        async toArray() {
          const rows = store.filter((doc) => matches(doc, filter));
          const sortEntries = Object.entries(sortSpec);
          if (sortEntries.length > 0) {
            rows.sort((a, b) => {
              for (const [key, direction] of sortEntries) {
                const comparison = compareValues(a[key], b[key]) ?? 0;
                if (comparison !== 0) return comparison * direction;
              }
              return 0;
            });
          }
          return rows.slice(skip, skip + limit).map((doc) => ({ ...doc }));
        },
      };
      return cursor;
    }),
    updateOne: vi.fn(async (filter: Record<string, unknown>, update: { $set?: Record<string, unknown> }) => {
      let matchedCount = 0;
      let modifiedCount = 0;
      for (const d of store) {
        if (Object.entries(filter).every(([k, v]) => d[k] === v)) {
          matchedCount += 1;
          if (update.$set) Object.assign(d, update.$set);
          modifiedCount += 1;
          break;
        }
      }
      return { matchedCount, modifiedCount };
    }),
    updateMany: vi.fn(async (filter: Record<string, unknown>, update: { $set?: Record<string, unknown> }) => {
      let matchedCount = 0;
      let modifiedCount = 0;
      for (const d of store) {
        if (Object.entries(filter).every(([k, v]) => d[k] === v)) {
          matchedCount += 1;
          if (update.$set) Object.assign(d, update.$set);
          modifiedCount += 1;
        }
      }
      return { matchedCount, modifiedCount };
    }),
    countDocuments: vi.fn(async (filter: Record<string, unknown>) => {
      return store.filter((doc) => matches(doc, filter)).length;
    }),
    findOneAndDelete: vi.fn(async (filter: Record<string, unknown>) => {
      const index = store.findIndex((doc) => Object.entries(filter).every(([key, value]) => doc[key] === value));
      if (index < 0) return null;
      return store.splice(index, 1)[0] ?? null;
    }),
    findOneAndUpdate: vi.fn(async (
      filter: Record<string, unknown>,
      update: { $inc?: Record<string, number>; $set?: Record<string, unknown>; $setOnInsert?: Record<string, unknown> },
    ) => {
      let doc = store.find((item) => Object.entries(filter).every(([key, value]) => item[key] === value));
      if (!doc) {
        doc = { ...filter, ...update.$setOnInsert };
        store.push(doc);
      }
      for (const [key, increment] of Object.entries(update.$inc ?? {})) {
        doc[key] = Number(doc[key] ?? 0) + increment;
      }
      if (update.$set) Object.assign(doc, update.$set);
      return { ...doc };
    }),
    deleteMany: vi.fn(async (filter: Record<string, unknown>) => {
      const remaining = store.filter((doc) => !Object.entries(filter).every(([key, value]) => doc[key] === value));
      const deletedCount = store.length - remaining.length;
      store.splice(0, store.length, ...remaining);
      return { deletedCount };
    }),
  };
}

vi.mock("@/db/collections", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/collections")>();
  return {
    ...actual,
    getCollection: vi.fn(async (name: string) => makeMockCollection(name)),
    withMongoTransaction: vi.fn(async (op: (session: unknown) => Promise<unknown>) => op(mockState.session)),
  };
});

describe("MongoDB collection registry & index manifest", () => {
  it("registers all 22 InfraPilot collections consistently across collections.ts and app_db.ts", () => {
    const registryNames = Object.values(collections).sort();
    const bootstrapNames = [...appDbCollectionNames].sort();
    expect(registryNames).toHaveLength(22);
    expect(registryNames).toEqual(bootstrapNames);
    expect(registryNames).toEqual(expect.arrayContaining(["alerts", "scan_imports"]));
  });

  it("enforces one active alert per monitored condition with a partial unique index", () => {
    const index = appDbIndexes.find((idx) => idx.options.name === "alerts_active_dedupe_unique");
    expect(index).toBeDefined();
    expect(index?.options.unique).toBe(true);
    expect(index?.options.partialFilterExpression).toEqual({
      status: { $in: ["triggered", "acknowledged", "suppressed"] },
    });
  });

  it("prevents duplicate automatic incidents per alert and duplicate vulnerability findings", () => {
    const incidentIndex = appDbIndexes.find((idx) => idx.options.name === "incidents_source_alert_unique");
    expect(incidentIndex?.options).toMatchObject({ unique: true, sparse: true });
    const findingIndex = appDbIndexes.find((idx) => idx.options.name === "findings_vulnerability_unique");
    expect(findingIndex?.options).toMatchObject({ unique: true });
    expect(findingIndex?.keys).toEqual({ assetId: 1, cveId: 1, component: 1 });
  });

  it("ensures every collection has at least one unique identifier index", () => {
    for (const collectionName of appDbCollectionNames) {
      const colIndexes = appDbIndexes.filter((idx) => idx.collection === collectionName);
      expect(colIndexes.length).toBeGreaterThan(0);
      expect(colIndexes.some((idx) => idx.options.unique === true)).toBe(true);
    }
  });

  it("generates matching UUID strings for _id and id", () => {
    const ids = newEntityIds();
    expect(ids._id).toBe(ids.id);
    expect(ids.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("allocates monotonically increasing sequence values", async () => {
    expect(await nextSequenceValue("incident_number")).toBe(1);
    expect(await nextSequenceValue("incident_number")).toBe(2);
  });

  it("reports only running workers with a fresh heartbeat", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    mockState.docs.set(collections.workerStatuses, [
      { id: "fresh", status: "running", heartbeatAt: new Date(now.getTime() - 10_000) },
      { id: "stale", status: "running", heartbeatAt: new Date(now.getTime() - 60_000) },
      { id: "stopped", status: "stopped", heartbeatAt: now },
    ]);

    await expect(getWorkerHealth(30_000, now)).resolves.toEqual({
      status: "ok",
      activeWorkers: 1,
      lastHeartbeatAt: "2025-12-31T23:59:50.000Z",
    });
  });

  it("combines incident status and active filters instead of overwriting one", async () => {
    mockState.docs.set(collections.incidents, [
      { id: "open", status: "open", openedAt: new Date("2026-01-03T00:00:00Z") },
      { id: "closed", status: "closed", openedAt: new Date("2026-01-02T00:00:00Z") },
    ]);

    const result = await listIncidents({
      page: 1,
      pageSize: 10,
      status: "closed",
      active: "true",
      sort: "openedAt",
      order: "desc",
    });

    expect(result).toEqual({ items: [], total: 0 });
  });
});

describe("MongoDB repositories (Stage 1 & core entities)", () => {
  beforeEach(() => {
    mockState.docs.clear();
  });

  it("normalizes user email on insert and stores matching _id and id", async () => {
    const user = await insertUser({
      email: "  Admin@InfraPilot.Local ",
      name: "Ada Admin",
      passwordHash: "scrypt$test",
      role: "admin",
    });
    expect(user._id).toBe(user.id);
    expect(user.email).toBe("admin@infrapilot.local");
    expect(user.isActive).toBe(true);
    expect(getStore(collections.users)).toHaveLength(1);
  });

  it("rotates refresh tokens atomically inside a transaction", async () => {
    const first = await insertRefreshToken({
      userId: "user-1",
      tokenHash: "hash-1",
      familyId: "fam-1",
      expiresAt: new Date(Date.now() + 60_000),
      userAgent: "vitest",
      ipAddress: "127.0.0.1",
    });
    const second = await rotateRefreshTokenDoc(first.id, {
      userId: "user-1",
      tokenHash: "hash-2",
      familyId: "fam-1",
      expiresAt: new Date(Date.now() + 60_000),
      userAgent: "vitest",
      ipAddress: "127.0.0.1",
    });

    const stored = getStore(collections.refreshTokens);
    expect(stored).toHaveLength(2);
    expect(stored[0]?.revokedAt).toBeInstanceOf(Date);
    expect(stored[0]?.replacedById).toBe(second.id);
    expect(stored[1]?.revokedAt).toBeNull();
  });

  it("lists only unexpired active sessions and never returns refresh-token hashes", async () => {
    const now = new Date();
    const active = await insertRefreshToken({
      userId: "user-1",
      tokenHash: "secret-hash-active",
      familyId: "family-active",
      expiresAt: new Date(now.getTime() + 60_000),
      userAgent: "Test browser",
      ipAddress: "192.0.2.10",
    });
    await insertRefreshToken({
      userId: "user-1",
      tokenHash: "secret-hash-expired",
      familyId: "family-expired",
      expiresAt: new Date(now.getTime() - 60_000),
      userAgent: null,
      ipAddress: null,
    });
    await insertRefreshToken({
      userId: "user-1",
      tokenHash: "secret-hash-revoked",
      familyId: "family-revoked",
      expiresAt: new Date(now.getTime() + 60_000),
      userAgent: null,
      ipAddress: null,
    });
    await revokeRefreshTokenFamily("family-revoked");

    const sessions = await listActiveRefreshSessions("user-1", now);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: active.id,
      familyId: "family-active",
      userAgent: "Test browser",
      ipAddress: "192.0.2.10",
    });
    expect(sessions[0]).not.toHaveProperty("tokenHash");
    expect(await findActiveRefreshSessionById("user-1", active.id, now)).toMatchObject({ id: active.id });
  });

  it("creates assets, audit logs, and deduplicated user notifications", async () => {
    const asset = await insertAsset({
      name: "edge-router-01",
      assetType: "network_device",
      hostname: "edge-01.internal",
      ipAddress: "10.0.0.1",
      operatingSystem: "IOS-XE",
      environment: "production",
      location: "DC1",
      ownerId: "user-1",
      description: "Core edge router",
      createdById: "user-1",
    });
    expect(asset.status).toBe("unknown");
    expect(asset.archivedAt).toBeNull();
    const { countAssetsByIds } = await import("@/db/repositories/assets.repository");
    expect(await countAssetsByIds([asset.id, "missing"])).toBe(1);

    const audit = await insertAuditLog({
      actorId: "user-1",
      action: "asset.created",
      entityType: "asset",
      entityId: asset.id,
      summary: `Asset "${asset.name}" created`,
      ip: "127.0.0.1",
    });
    expect(audit.entityId).toBe(asset.id);

    await insertNotifications(["user-1", "user-1", "user-2", ""], {
      type: "general",
      title: "Asset registered",
      message: "edge-router-01 was added",
      link: `/assets/${asset.id}`,
    });
    expect(getStore(collections.notifications)).toHaveLength(2);
  });

  it("deletes monitoring history with its target", async () => {
    getStore(collections.monitoringTargets).push({ _id: "target-1", id: "target-1", name: "API" });
    getStore(collections.monitoringResults).push(
      { _id: "result-1", id: "result-1", targetId: "target-1" },
      { _id: "result-2", id: "result-2", targetId: "target-1" },
    );

    const deleted = await deleteMonitoringTargetById("target-1");

    expect(deleted?.id).toBe("target-1");
    expect(getStore(collections.monitoringTargets)).toHaveLength(0);
    expect(getStore(collections.monitoringResults)).toHaveLength(0);
  });

  it("creates maintenance records and asset links in a transaction", async () => {
    const maintenance = await insertMaintenanceWithAssets(
      {
        title: "Edge upgrade",
        description: "Upgrade the edge switches",
        startsAt: new Date("2026-12-01T02:00:00.000Z"),
        endsAt: new Date("2026-12-01T03:00:00.000Z"),
        ownerId: "user-1",
        createdById: "user-1",
        notes: null,
      },
      ["asset-1", "asset-2"],
    );

    expect(maintenance.status).toBe("scheduled");
    expect(maintenance.reminderSentAt).toBeNull();
    expect(getStore(collections.maintenanceAssets)).toHaveLength(2);
    expect(getStore(collections.maintenanceAssets).every((link) => link.maintenanceId === maintenance.id)).toBe(true);
  });

  it("creates a security finding with its initial history event atomically", async () => {
    const finding = await createSecurityFinding(
      {
        title: "Outdated package",
        description: "A production package is out of date.",
        severity: "high",
        assetId: "asset-1",
        assigneeId: "user-1",
        remediation: "Upgrade the package.",
        cveId: null,
        createdById: "user-1",
      },
      "user-1",
    );

    expect(finding.status).toBe("open");
    const events = getStore(collections.findingEvents);
    expect(events).toHaveLength(1);
    expect(events[0]?.findingId).toBe(finding.id);
    expect(events[0]?.toStatus).toBe("open");
  });

  it("allocates incident references and persists linked assets and opening timeline", async () => {
    const incident = await createIncident(
      {
        title: "Edge device offline",
        description: "The primary edge device stopped responding.",
        severity: "high",
        priority: "p2",
        assigneeId: "user-1",
      },
      "user-1",
      "Olu Operator",
      ["asset-1"],
    );

    expect(incident.number).toBe(1);
    expect(incident.status).toBe("open");
    expect(getStore(collections.incidentAssets)).toHaveLength(1);
    expect(getStore(collections.incidentComments)[0]?.incidentId).toBe(incident.id);
  });

  it("counts independent change approvals before advancing the workflow", async () => {
    const change = await createChangeRequest(
      {
        title: "Rotate edge certificates",
        description: "Replace expiring certificates.",
        reason: "Certificates expire soon.",
        riskLevel: "medium",
        riskAssessment: "Brief service interruption possible.",
        rollbackPlan: "Restore the prior certificate bundle.",
        implementerId: "user-2",
        plannedStartAt: null,
        plannedEndAt: null,
      },
      "requester",
      [],
    );
    getStore(collections.changeRequests)[0]!.status = "pending_approval";

    const first = await decideChangeRequest(change.id, "approver-1", "approved", null, 2);
    const second = await decideChangeRequest(change.id, "approver-2", "approved", null, 2);

    expect(first.change?.status).toBe("pending_approval");
    expect(second.change?.status).toBe("approved");
    expect(getStore(collections.changeApprovals)).toHaveLength(2);
  });
});
