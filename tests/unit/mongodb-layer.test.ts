import { beforeEach, describe, expect, it, vi } from "vitest";
import { appDbCollectionNames, appDbIndexes } from "@/db/app_db";
import { collections, newEntityIds } from "@/db/collections";
import {
  insertAsset,
  insertAuditLog,
  insertNotifications,
  insertRefreshToken,
  insertUser,
  rotateRefreshTokenDoc,
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
    findOne: vi.fn(async (filter: Record<string, unknown>) => {
      return store.find((d) => Object.entries(filter).every(([k, v]) => d[k] === v)) ?? null;
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
  it("registers all 18 InfraPilot collections consistently across collections.ts and app_db.ts", () => {
    const registryNames = Object.values(collections).sort();
    const bootstrapNames = [...appDbCollectionNames].sort();
    expect(registryNames).toHaveLength(18);
    expect(registryNames).toEqual(bootstrapNames);
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
});
