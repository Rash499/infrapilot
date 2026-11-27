import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { initializeAppDatabase } from "../../packages/database/src/app_db";
import { closeMongo } from "../../packages/database/src/mongo";
import { collections, getCollection } from "../../packages/database/src/collections";
import {
  findActiveAlert,
  listAlerts,
  raiseAlert,
  releaseSuppressedAlerts,
  resolveActiveAlerts,
  suppressActiveAlerts,
  ACTIVE_ALERT_STATUSES,
  type NewAlertInput,
} from "../../packages/database/src/repositories/alerts.repository";
import {
  claimDueMonitoringTargets,
  findMonitoringTargetById,
  insertMonitoringTarget,
  releaseMonitoringClaim,
} from "../../packages/database/src/repositories/monitoring.repository";
import { createAutoIncident } from "../../packages/database/src/repositories/incidents.repository";
import { findActiveMaintenanceForAssets } from "../../packages/database/src/repositories/maintenance.repository";
import { determineSuppression } from "../../packages/server-core/src/monitoring/alerting";
import type { IncidentDoc, MaintenanceDoc, MonitoringTargetDoc } from "../../packages/database/src/models/documents";

/**
 * These tests run against a real MongoDB instance (the CI e2e job passes MONGODB_URI and a distinct
 * database name). Without MONGODB_URI they are skipped so `npm test` stays runnable offline.
 */
const hasMongo = Boolean(process.env.MONGODB_URI);
const suite = hasMongo ? describe : describe.skip;

const targetIds: string[] = [];
const incidentIds: string[] = [];
const maintenanceIds: string[] = [];

function alertInput(overrides: Partial<NewAlertInput> = {}): NewAlertInput {
  return {
    dedupeKey: `${randomUUID()}:availability`,
    kind: "availability",
    targetId: randomUUID(),
    assetId: null,
    severity: "critical",
    title: "Integration API unavailable",
    message: "connection refused",
    triggerCondition: "3 consecutive failures >= threshold 3",
    ...overrides,
  };
}

async function createTarget(overrides: Partial<Parameters<typeof insertMonitoringTarget>[0]> = {}) {
  const target = await insertMonitoringTarget({
    name: `integration-target-${randomUUID()}`,
    monitorType: "http",
    url: "https://example.com/health",
    host: null,
    port: null,
    expectedStatusCode: null,
    intervalSeconds: 60,
    timeoutMs: 1000,
    degradedThresholdMs: 1000,
    failureThreshold: 3,
    recoveryThreshold: 2,
    warningThresholdMs: 1500,
    criticalThresholdMs: 5000,
    autoIncidentEnabled: true,
    enabled: true,
    allowPrivateNetwork: false,
    assetId: null,
    createdById: null,
    ...overrides,
  });
  targetIds.push(target.id);
  return target;
}

suite("alert lifecycle against MongoDB", () => {
  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET ??= "integration-test-secret-0000000000000000";
    process.env.MONGODB_DB ??= "infrapilot_integration";
    await initializeAppDatabase();
  });

  afterAll(async () => {
    const alerts = await getCollection(collections.alerts);
    const targets = await getCollection<MonitoringTargetDoc>(collections.monitoringTargets);
    const incidents = await getCollection<IncidentDoc>(collections.incidents);
    const maintenances = await getCollection<MaintenanceDoc>(collections.maintenances);
    await alerts.deleteMany({ targetId: { $in: targetIds } });
    await targets.deleteMany({ id: { $in: targetIds } });
    await incidents.deleteMany({ id: { $in: incidentIds } });
    await maintenances.deleteMany({ id: { $in: maintenanceIds } });
    const links = await getCollection(collections.maintenanceAssets);
    await links.deleteMany({ maintenanceId: { $in: maintenanceIds } });
    await closeMongo();
  });

  it("deduplicates concurrent raises into a single active alert", async () => {
    const input = alertInput();
    const [first, second] = await Promise.all([raiseAlert(input), raiseAlert(input)]);

    const active = await findActiveAlert(input.dedupeKey);
    expect(active).not.toBeNull();
    const createdCount = [first.created, second.created].filter(Boolean).length;
    expect(createdCount).toBe(1);

    const stored = await listAlerts({ page: 1, pageSize: 10, targetId: input.targetId });
    expect(stored.items).toHaveLength(1);
    expect(stored.items[0].occurrences).toBeGreaterThanOrEqual(2);
    expect(stored.items[0].events.length).toBeGreaterThanOrEqual(2);
  });

  it("frees the dedupe key after resolution so a new occurrence opens a new alert", async () => {
    const input = alertInput();
    const { alert } = await raiseAlert(input);
    const resolved = await resolveActiveAlerts(input.targetId, { notes: "Recovered" });
    expect(resolved).toBe(1);
    expect(await findActiveAlert(input.dedupeKey)).toBeNull();

    const again = await raiseAlert(input);
    expect(again.created).toBe(true);
    expect(again.alert.id).not.toBe(alert.id);

    const stored = await listAlerts({ page: 1, pageSize: 10, targetId: input.targetId });
    expect(stored.total).toBe(2);
    expect(stored.items.filter((row) => ACTIVE_ALERT_STATUSES.includes(row.status))).toHaveLength(1);
  });

  it("suppresses active alerts until the end of maintenance and releases them afterwards", async () => {
    const input = alertInput();
    await raiseAlert(input);
    const now = new Date();
    const until = new Date(now.getTime() + 60_000);
    const suppressed = await suppressActiveAlerts(input.targetId, { reason: "Maintenance window", until, now });
    expect(suppressed).toBe(1);

    const active = await findActiveAlert(input.dedupeKey);
    expect(active?.status).toBe("suppressed");
    expect(active?.suppressedUntil?.getTime()).toBe(until.getTime());

    // Not yet expired: release must leave it suppressed.
    expect(await releaseSuppressedAlerts(input.targetId, now)).toBe(0);
    expect((await findActiveAlert(input.dedupeKey))?.status).toBe("suppressed");

    // After the window ends the alert re-opens for acknowledgement.
    expect(await releaseSuppressedAlerts(input.targetId, new Date(until.getTime() + 1000))).toBe(1);
    expect((await findActiveAlert(input.dedupeKey))?.status).toBe("triggered");
  });

  it("creates at most one incident per source alert", async () => {
    const input = alertInput();
    const { alert } = await raiseAlert(input);
    const payload = {
      title: "Auto incident",
      description: "created from an alert",
      severity: "critical" as const,
      priority: "p1" as const,
      sourceAlertId: alert.id,
      sourceMonitoringTargetId: input.targetId,
      assetIds: [],
      category: "availability",
    };
    const [first, second] = await Promise.all([createAutoIncident(payload), createAutoIncident(payload)]);
    const created = [first, second].filter((row): row is IncidentDoc => row !== null);
    expect(created).toHaveLength(1);
    incidentIds.push(created[0]!.id);
  });

  it("leases targets so two workers cannot claim the same check, and reclaims expired leases", async () => {
    const dueAt = new Date(Date.now() - 60_000);
    const first = await createTarget({ nextCheckAt: dueAt });
    const second = await createTarget({ nextCheckAt: dueAt });

    const firstClaim = await claimDueMonitoringTargets(1);
    expect(firstClaim).toHaveLength(1);
    const firstClaimedId = firstClaim[0]!.id;
    expect([first.id, second.id]).toContain(firstClaimedId);

    const secondClaim = await claimDueMonitoringTargets(1);
    expect(secondClaim).toHaveLength(1);
    expect(secondClaim[0]!.id).not.toBe(firstClaimedId);

    const claimed = await findMonitoringTargetById(firstClaimedId);
    expect(claimed?.claimExpiresAt).toBeInstanceOf(Date);
    expect(claimed?.claimExpiresAt?.getTime()).toBeGreaterThan(Date.now());

    // Simulate a crashed worker: the next check is far away but the lease has expired.
    const targets = await getCollection<MonitoringTargetDoc>(collections.monitoringTargets);
    await targets.updateOne(
      { id: firstClaimedId },
      { $set: { nextCheckAt: new Date(Date.now() + 3_600_000), claimExpiresAt: new Date(Date.now() - 1000) } },
    );
    const reclaimed = await claimDueMonitoringTargets(1);
    expect(reclaimed.map((row) => row.id)).toContain(firstClaimedId);

    await releaseMonitoringClaim(first.id);
    const released = await findMonitoringTargetById(first.id);
    expect(released?.claimExpiresAt).toBeUndefined();
  });

  it("finds active maintenance windows for an asset", async () => {
    const assetId = randomUUID();
    const now = new Date();
    const maintenance = {
      id: randomUUID(),
      title: "Integration patch window",
      description: "test",
      status: "in_progress" as const,
      startsAt: new Date(now.getTime() - 60_000),
      endsAt: new Date(now.getTime() + 3_600_000),
      ownerId: null,
      createdById: null,
      notes: null,
      reminderSentAt: null,
      createdAt: now,
      updatedAt: now,
    };
    maintenanceIds.push(maintenance.id);
    const maintenances = await getCollection<MaintenanceDoc>(collections.maintenances);
    await maintenances.insertOne(maintenance);
    const links = await getCollection(collections.maintenanceAssets);
    await links.insertOne({ id: randomUUID(), _id: randomUUID(), maintenanceId: maintenance.id, assetId } as never);

    const active = await findActiveMaintenanceForAssets([assetId], now);
    expect(active).toHaveLength(1);
    expect(active[0]!.window.title).toBe("Integration patch window");

    const suppression = determineSuppression(active.map((row) => row.window), now);
    expect(suppression.suppressed).toBe(true);

    const outside = await findActiveMaintenanceForAssets([assetId], new Date(maintenance.endsAt.getTime() + 1000));
    expect(outside).toHaveLength(0);
  });
});
