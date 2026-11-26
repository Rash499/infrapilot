import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collections } from "@/db/collections";
import { getDashboard } from "@/services/dashboard.service";

type MockCollectionData = {
  aggregates: unknown[][];
  finds: unknown[][];
  counts: number[];
};

const mocks = vi.hoisted(() => ({
  collectionData: new Map<string, MockCollectionData>(),
  collections: new Map<string, {
    find: { mock: { calls: unknown[][] } };
    aggregate: { mock: { calls: unknown[][] } };
  }>(),
  getCollection: vi.fn(),
  findAssetNamesByIds: vi.fn(),
  userNameMap: vi.fn(),
}));
const originalMongoUri = process.env.MONGODB_URI;

function makeCollection(name: string) {
  const data = mocks.collectionData.get(name) ?? { aggregates: [], finds: [], counts: [] };
  const collection = {
    aggregate: vi.fn(() => ({ toArray: vi.fn(async () => data.aggregates.shift() ?? []) })),
    countDocuments: vi.fn(async () => data.counts.shift() ?? 0),
    find: vi.fn(() => {
      const cursor = {
        sort: vi.fn(),
        limit: vi.fn(),
        toArray: vi.fn(async () => data.finds.shift() ?? []),
      };
      cursor.sort.mockReturnValue(cursor);
      cursor.limit.mockReturnValue(cursor);
      return cursor;
    }),
  };
  mocks.collections.set(name, collection);
  return collection;
}

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/db/collections", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/collections")>();
  return {
    ...actual,
    getCollection: mocks.getCollection,
  };
});
vi.mock("@/db/repositories/assets.repository", () => ({
  findAssetNamesByIds: mocks.findAssetNamesByIds,
}));
vi.mock("@/services/common", () => ({
  humanize: (value: string) => value.replace(/_/g, " "),
  userNameMap: mocks.userNameMap,
}));
vi.mock("@/services/changes.service", () => ({
  changeReference: (number: number) => `CHG-${number}`,
}));
vi.mock("@/services/incidents.service", () => ({
  incidentReference: (number: number) => `INC-${String(number).padStart(5, "0")}`,
}));

describe("MongoDB dashboard priority panels", () => {
  afterEach(() => {
    if (originalMongoUri === undefined) delete process.env.MONGODB_URI;
    else process.env.MONGODB_URI = originalMongoUri;
  });

  beforeEach(() => {
    process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/test?replicaSet=rs0";
    mocks.collectionData.clear();
    mocks.collections.clear();
    mocks.getCollection.mockImplementation(async (name: string) => makeCollection(name));
    mocks.findAssetNamesByIds.mockResolvedValue([
      { id: "asset-1", name: "api-server" },
      { id: "asset-2", name: "payments-server" },
    ]);
    mocks.userNameMap.mockImplementation(async (ids: string[]) =>
      new Map(ids.filter(Boolean).map((id) => [id, "Ada"])),
    );

    mocks.collectionData.set(collections.assets, {
      aggregates: [[{ _id: "healthy", count: 2 }], [{ _id: "application", count: 2 }]],
      finds: [],
      counts: [],
    });
    mocks.collectionData.set(collections.monitoringTargets, {
      aggregates: [
        [{ _id: "healthy", count: 1 }],
        [{
          id: "monitor-1",
          name: "Checkout API",
          monitorType: "http",
          status: "unavailable",
          assetId: "asset-1",
          lastCheckedAt: new Date("2026-01-08T00:00:00.000Z"),
          lastError: "Connection timed out",
          consecutiveFailures: 3,
        }],
        [{
          id: "monitor-2",
          name: "Payments API",
          monitorType: "http",
          status: "healthy",
          assetId: "asset-2",
          nextCheckAt: new Date("2026-01-08T00:00:00.000Z"),
          lastCheckedAt: new Date("2026-01-07T23:00:00.000Z"),
          intervalSeconds: 60,
        }],
      ],
      finds: [],
      counts: [],
    });
    mocks.collectionData.set(collections.incidents, {
      aggregates: [[{
        id: "incident-1",
        number: 7,
        title: "Checkout unavailable",
        severity: "critical",
        status: "investigating",
        assigneeId: "user-1",
        openedAt: new Date("2026-01-08T00:00:00.000Z"),
        updatedAt: new Date("2026-01-08T00:01:00.000Z"),
      }], [{ _id: "critical", count: 1 }]],
      finds: [],
      counts: [1],
    });
    mocks.collectionData.set(collections.securityFindings, {
      aggregates: [[{ _id: "open", count: 1 }]],
      finds: [[{
        id: "finding-1",
        title: "Critical library vulnerability",
        severity: "critical",
        status: "open",
        assetId: "asset-1",
        cveId: "CVE-2026-0001",
        updatedAt: new Date("2026-01-08T00:02:00.000Z"),
      }]],
      counts: [1],
    });
    mocks.collectionData.set(collections.maintenances, { aggregates: [], finds: [[]], counts: [0] });
    mocks.collectionData.set(collections.changeRequests, { aggregates: [], finds: [[]], counts: [] });
    mocks.collectionData.set(collections.monitoringResults, {
      aggregates: [[{
        _id: new Date("2026-01-08T00:00:00.000Z"),
        avgMs: 120,
        total: 10,
        ok: 9,
      }]],
      finds: [],
      counts: [],
    });
  });

  it("returns active incident and critical-finding details with related names", async () => {
    const dashboard = await getDashboard(7);

    expect(dashboard.recentIncidents).toEqual([
      {
        id: "incident-1",
        reference: "INC-00007",
        title: "Checkout unavailable",
        severity: "critical",
        status: "investigating",
        assigneeName: "Ada",
        openedAt: "2026-01-08T00:00:00.000Z",
      },
    ]);
    expect(dashboard.criticalFindings).toEqual([
      {
        id: "finding-1",
        title: "Critical library vulnerability",
        severity: "critical",
        status: "open",
        assetName: "api-server",
        cveId: "CVE-2026-0001",
        updatedAt: "2026-01-08T00:02:00.000Z",
      },
    ]);
    expect(dashboard.attentionServices).toEqual([
      {
        id: "monitor-1",
        name: "Checkout API",
        monitorType: "http",
        status: "unavailable",
        assetName: "api-server",
        lastCheckedAt: "2026-01-08T00:00:00.000Z",
        lastError: "Connection timed out",
        consecutiveFailures: 3,
      },
    ]);
    expect(dashboard.overdueServices).toEqual([
      {
        id: "monitor-2",
        name: "Payments API",
        monitorType: "http",
        status: "healthy",
        assetName: "payments-server",
        nextCheckAt: "2026-01-08T00:00:00.000Z",
        lastCheckedAt: "2026-01-07T23:00:00.000Z",
        intervalSeconds: 60,
      },
    ]);
    expect(dashboard.monitoringSummary).toEqual({ uptimePct: 90, checks: 10 });
    expect(mocks.collections.get(collections.incidents)?.aggregate.mock.calls[0][0]).toContainEqual({
      $match: { status: { $nin: ["resolved", "closed"] } },
    });
    expect(mocks.collections.get(collections.securityFindings)?.find).toHaveBeenCalledWith({
      severity: { $in: ["critical", "high"] },
      status: { $in: ["open", "in_progress"] },
    });
  });

  it("reports unavailable uptime when the range has no completed checks", async () => {
    mocks.collectionData.set(collections.monitoringResults, { aggregates: [[]], finds: [], counts: [] });

    const dashboard = await getDashboard(7);

    expect(dashboard.monitoringSummary).toEqual({ uptimePct: null, checks: 0 });
  });
});
