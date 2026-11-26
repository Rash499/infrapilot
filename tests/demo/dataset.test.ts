import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEMO_ASSETS,
  DEMO_BATCH,
  DEMO_CHANGES,
  DEMO_FINDINGS,
  DEMO_INCIDENTS,
  DEMO_MAINTENANCE,
  DEMO_MONITORS,
  DEMO_NOTIFICATIONS,
  DEMO_USERS,
} from "../../scripts/demo-data/dataset";
import { buildMonitoringHistory, formatPlan, isLocalAddress, planCounts, validateDataset } from "../../scripts/demo-data/plan";

const repoRoot = join(__dirname, "..", "..");

describe("demo dataset", () => {
  it("passes its own validation with no problems", () => {
    expect(validateDataset()).toEqual([]);
  });

  it("uses unique keys for every record type", () => {
    const unique = (keys: string[], label: string) => {
      const seen = new Set<string>();
      for (const key of keys) {
        expect(seen.has(key), `${label} has a duplicate key: ${key}`).toBe(false);
        seen.add(key);
      }
    };
    unique(DEMO_ASSETS.map((item) => item.key), "assets");
    unique(DEMO_MONITORS.map((item) => item.key), "monitors");
    unique(DEMO_INCIDENTS.map((item) => item.key), "incidents");
    unique(DEMO_FINDINGS.map((item) => item.key), "findings");
    unique(DEMO_MAINTENANCE.map((item) => item.key), "maintenance");
    unique(DEMO_CHANGES.map((item) => item.key), "changes");
    unique(DEMO_NOTIFICATIONS.map((item) => item.key), "notifications");
  });

  it("only uses the three roles the application implements", () => {
    expect(new Set(DEMO_USERS.map((user) => user.role))).toEqual(new Set(["admin", "operator", "viewer"]));
    expect(DEMO_USERS.every((user) => user.email.startsWith("demo."))).toBe(true);
  });

  it("resolves every asset owner, incident assignee and maintenance owner", () => {
    const users = new Set(DEMO_USERS.map((user) => user.key));
    const assets = new Set(DEMO_ASSETS.map((asset) => asset.key));
    expect(DEMO_ASSETS.every((asset) => users.has(asset.owner))).toBe(true);
    expect(DEMO_INCIDENTS.every((incident) => users.has(incident.assignee))).toBe(true);
    expect(DEMO_INCIDENTS.every((incident) => incident.assets.every((key) => assets.has(key)))).toBe(true);
    expect(DEMO_MAINTENANCE.every((window) => window.assets.every((key) => assets.has(key)))).toBe(true);
    expect(DEMO_CHANGES.every((change) => change.assets.every((key) => assets.has(key)))).toBe(true);
  });

  it("covers the operational states a demo needs to show", () => {
    expect(new Set(DEMO_INCIDENTS.map((incident) => incident.status))).toEqual(
      new Set(["open", "investigating", "in_progress", "resolved", "closed"]),
    );
    expect(new Set(DEMO_FINDINGS.map((finding) => finding.severity))).toEqual(
      new Set(["critical", "high", "medium", "low", "informational"]),
    );
    expect(new Set(DEMO_FINDINGS.map((finding) => finding.status))).toEqual(
      new Set(["open", "in_progress", "resolved", "accepted_risk"]),
    );
    expect(new Set(DEMO_CHANGES.map((change) => change.status))).toEqual(
      new Set(["draft", "pending_approval", "approved", "rejected", "implemented", "rolled_back", "cancelled"]),
    );
    expect(DEMO_MAINTENANCE.some((window) => window.status === "in_progress")).toBe(true);
    expect(DEMO_MAINTENANCE.some((window) => window.status === "cancelled")).toBe(true);
  });

  it("keeps scheduled maintenance inside the dashboard's 14-day horizon", () => {
    const upcoming = DEMO_MAINTENANCE.filter(
      (window) => window.status === "scheduled" && window.startOffsetHours > 0 && window.startOffsetHours <= 24 * 14,
    );
    expect(upcoming.length).toBeGreaterThanOrEqual(3);
    expect(DEMO_MAINTENANCE.every((window) => window.durationHours > 0)).toBe(true);
  });

  it("marks every finding as demonstration data and never cites a real CVE", () => {
    expect(DEMO_FINDINGS.every((finding) => finding.description.toLowerCase().includes("demonstration"))).toBe(true);
    expect(DEMO_FINDINGS.every((finding) => !("cveId" in finding))).toBe(true);
  });

  it("only monitors loopback or private destinations", () => {
    for (const monitor of DEMO_MONITORS) {
      const target = monitor.monitorType === "http" ? new URL(monitor.url!).hostname : monitor.host!;
      expect(isLocalAddress(target), `${monitor.key} points at ${target}`).toBe(true);
    }
    expect(DEMO_MONITORS.some((monitor) => !monitor.enabled)).toBe(true);
  });

  it("meets the change workflow prerequisites", () => {
    for (const change of DEMO_CHANGES) {
      if (change.status !== "draft") {
        expect(change.riskAssessment.length, change.key).toBeGreaterThan(0);
        expect(change.rollbackPlan.length, change.key).toBeGreaterThan(0);
      }
      if (["approved", "rejected", "implemented", "rolled_back", "cancelled"].includes(change.status)) {
        expect(change.decisionComment, change.key).toBeTruthy();
      }
      if (change.status === "rolled_back") expect(change.rollbackNotes, change.key).toBeTruthy();
      if (change.status === "implemented") expect(change.implementationNotes, change.key).toBeTruthy();
    }
  });

  it("contains no credentials or secrets", () => {
    const serialised = JSON.stringify([
      DEMO_USERS,
      DEMO_ASSETS,
      DEMO_MONITORS,
      DEMO_INCIDENTS,
      DEMO_FINDINGS,
      DEMO_MAINTENANCE,
      DEMO_CHANGES,
      DEMO_NOTIFICATIONS,
    ]).toLowerCase();
    // A finding may talk *about* password policy; what must never appear is credential material.
    for (const forbidden of ["passwordhash", "password_hash", "demo_seed_password", "passwd=", "secret=", "api_key", "apikey", "bearer ", "changeme", "token="]) {
      expect(serialised.includes(forbidden), `dataset must not contain "${forbidden}"`).toBe(false);
    }
  });

  it("rejects public destinations and accepts private ones", () => {
    expect(isLocalAddress("8.8.8.8")).toBe(false);
    expect(isLocalAddress("127.0.0.1")).toBe(true);
    expect(isLocalAddress("10.20.10.11")).toBe(true);
    expect(isLocalAddress("192.168.1.5")).toBe(true);
    expect(isLocalAddress("172.20.0.1")).toBe(true);
    expect(isLocalAddress("172.40.0.1")).toBe(false);
    expect(isLocalAddress("example.com")).toBe(false);
  });

  it("summarises the plan consistently with the dataset", () => {
    const counts = planCounts();
    expect(counts.users).toBe(DEMO_USERS.length);
    expect(counts.assets).toBe(DEMO_ASSETS.length);
    expect(counts.monitoringTargets).toBe(DEMO_MONITORS.length);
    expect(counts.incidents).toBe(DEMO_INCIDENTS.length);
    expect(counts.findings).toBe(DEMO_FINDINGS.length);
    expect(counts.maintenance).toBe(DEMO_MAINTENANCE.length);
    expect(counts.changes).toBe(DEMO_CHANGES.length);
    expect(counts.monitoringResults).toBe(DEMO_MONITORS.reduce((total, monitor) => total + monitor.historyPoints, 0));
    expect(formatPlan(counts)).toContain("assets");
  });
});

describe("monitoring history", () => {
  const now = new Date("2026-07-15T12:00:00.000Z");

  it("is deterministic and ordered oldest to newest", () => {
    const monitor = DEMO_MONITORS.find((item) => item.key === "mon-web-01")!;
    const first = buildMonitoringHistory(monitor, now);
    const second = buildMonitoringHistory(monitor, now);
    expect(first).toEqual(second);
    expect(first).toHaveLength(monitor.historyPoints);
    expect(first[0]!.checkedAt.getTime()).toBeLessThan(first[first.length - 1]!.checkedAt.getTime());
    expect(first.every((row) => row.success)).toBe(true);
    expect(first[first.length - 1]!.checkedAt.getTime()).toBeLessThanOrEqual(now.getTime());
  });

  it("produces a genuine outage window for unavailable services", () => {
    const monitor = DEMO_MONITORS.find((item) => item.key === "mon-db-02")!;
    const history = buildMonitoringHistory(monitor, now);
    const failures = history.filter((row) => !row.success);
    expect(failures.length).toBeGreaterThan(5);
    expect(failures.every((row) => row.state === "unavailable" && row.errorMessage)).toBe(true);
    expect(failures[failures.length - 1]!.checkedAt.getTime()).toBeGreaterThan(history[0]!.checkedAt.getTime());
  });

  it("shows recovery for the kubelet monitor", () => {
    const monitor = DEMO_MONITORS.find((item) => item.key === "mon-k8s-node-01")!;
    const history = buildMonitoringHistory(monitor, now);
    expect(history.some((row) => !row.success)).toBe(true);
    expect(history[history.length - 1]!.success).toBe(true);
  });

  it("generates no history for paused or unknown targets", () => {
    for (const key of ["mon-win-files-01", "mon-nas-01"]) {
      const monitor = DEMO_MONITORS.find((item) => item.key === key)!;
      expect(buildMonitoringHistory(monitor, now)).toEqual([]);
    }
  });
});

describe("demo tooling boundaries", () => {
  const sources = ["scripts/seed-demo.ts", "scripts/verify-demo.ts"].map((path) => ({
    path,
    text: readFileSync(join(repoRoot, path), "utf8"),
  }));

  it("never reintroduces SQL drivers or PostgreSQL", () => {
    for (const source of sources) {
      expect(source.text.includes('from "pg"'), source.path).toBe(false);
      expect(source.text.includes("drizzle"), source.path).toBe(false);
      expect(source.text.toLowerCase().includes("postgres://"), source.path).toBe(false);
    }
  });

  it("tags demo writes with the ownership marker and requires explicit cleanup confirmation", () => {
    for (const source of sources) {
      expect(source.text).toContain("demoBatch");
      expect(source.text).toContain("DEMO_BATCH");
    }
    const seeder = sources.find((source) => source.path === "scripts/seed-demo.ts")!.text;
    expect(seeder).toContain("--confirm-demo-data");
    expect(seeder).toContain("Refusing to delete anything without confirmation");
    expect(seeder).toContain("DEMO_SEED_PASSWORD");
    expect(seeder).not.toContain("logo");
  });
});
