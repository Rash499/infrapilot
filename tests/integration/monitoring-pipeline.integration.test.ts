import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { collections, getCollection } from "../../packages/database/src/collections";
import { initializeAppDatabase } from "../../packages/database/src/app_db";
import { closeMongo } from "../../packages/database/src/mongo";
import {
  insertMonitoringTarget,
  recordMonitoringCheck,
  listMonitoringResults,
} from "../../packages/database/src/repositories/monitoring.repository";
import { findAlertById, listActiveAlertsForTarget } from "../../packages/database/src/repositories/alerts.repository";
import {
  findIncidentById,
  listIncidentComments,
} from "../../packages/database/src/repositories/incidents.repository";
import type {
  AlertDoc,
  AssetDoc,
  IncidentDoc,
  MaintenanceAssetDoc,
  MaintenanceDoc,
} from "../../packages/database/src/models/documents";
import { computeState, runProbe } from "../../packages/server-core/src/monitoring/probe";
import { processCheckAlerts } from "../../packages/server-core/src/services/alerts.service";

/**
 * End-to-end worker pipeline against a real MongoDB and a real local HTTP server.
 *
 * This is the same sequence the worker performs for every claimed target: probe → computeState →
 * recordMonitoringCheck → processCheckAlerts. It proves alert deduplication, automatic incident
 * creation, maintenance suppression and recovery comments without mocking the database or the probe.
 */
const hasMongo = Boolean(process.env.MONGODB_URI);
const suite = hasMongo ? describe : describe.skip;

let server: Server;
let baseUrl: string;
let failResponse = true;
const assetIds: string[] = [];
const targetIds: string[] = [];
const maintenanceIds: string[] = [];

async function createAsset(): Promise<AssetDoc> {
  const assets = await getCollection<AssetDoc>(collections.assets);
  const now = new Date();
  const asset: AssetDoc = {
    id: randomUUID(),
    _id: randomUUID(),
    name: `integration-asset-${randomUUID().slice(0, 8)}`,
    assetType: "virtual_machine",
    hostname: "integration.local",
    ipAddress: "127.0.0.1",
    operatingSystem: "Linux",
    environment: "testing",
    location: "CI",
    ownerId: null,
    description: null,
    status: "operational",
    archivedAt: null,
    createdById: null,
    createdAt: now,
    updatedAt: now,
  };
  await assets.insertOne(asset);
  assetIds.push(asset.id);
  return asset;
}

async function createTarget(assetId: string) {
  const target = await insertMonitoringTarget({
    name: "integration-pipeline-check",
    monitorType: "http",
    url: `${baseUrl}/health`,
    host: null,
    port: null,
    expectedStatusCode: 200,
    intervalSeconds: 60,
    timeoutMs: 2000,
    degradedThresholdMs: 500,
    failureThreshold: 1,
    recoveryThreshold: 2,
    warningThresholdMs: 500,
    criticalThresholdMs: 1000,
    autoIncidentEnabled: true,
    enabled: true,
    allowPrivateNetwork: true,
    assetId,
    createdById: null,
  });
  targetIds.push(target.id);
  return target;
}

/** Mirrors the worker's per-check sequence. */
async function runCheck(target: Awaited<ReturnType<typeof createTarget>>) {
  const result = await runProbe({
    monitorType: target.monitorType,
    url: target.url,
    host: target.host,
    port: target.port,
    expectedStatusCode: target.expectedStatusCode,
    timeoutMs: target.timeoutMs,
    allowPrivateNetwork: true,
  });
  const next = computeState(
    { status: target.status, consecutiveFailures: target.consecutiveFailures },
    result,
    { failureThreshold: 1, degradedThresholdMs: 500 },
  );
  const now = new Date();
  const consecutiveSuccesses = result.success ? (target.consecutiveSuccesses ?? 0) + 1 : 0;
  await recordMonitoringCheck(
    target.id,
    {
      checkedAt: now,
      success: result.success,
      state: next.status,
      responseTimeMs: result.responseTimeMs,
      statusCode: result.statusCode,
      errorMessage: result.errorMessage,
    },
    {
      status: next.status,
      consecutiveFailures: next.consecutiveFailures,
      consecutiveSuccesses,
      lastCheckedAt: now,
      lastResponseMs: result.responseTimeMs,
      lastError: result.errorMessage,
    },
  );
  const alertResult = await processCheckAlerts({
    target: { ...target, status: next.status, consecutiveFailures: next.consecutiveFailures, consecutiveSuccesses },
    assetId: target.assetId,
    previousState: target.status,
    state: next.status,
    consecutiveFailures: next.consecutiveFailures,
    consecutiveSuccesses,
    responseTimeMs: result.responseTimeMs,
    lastError: result.errorMessage,
    now,
  });
  return { next, alertResult };
}

suite("monitoring → alert → incident pipeline", () => {
  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET ??= "integration-test-secret-0000000000000000";
    process.env.MONGODB_DB ??= "infrapilot_integration";
    process.env.AUTO_INCIDENT_ENABLED = "true";
    server = createServer((_req, res) => {
      if (failResponse) {
        res.statusCode = 503;
        res.end("unavailable");
        return;
      }
      res.statusCode = 200;
      res.end("ok");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address && typeof address === "object") baseUrl = `http://127.0.0.1:${address.port}`;
    await initializeAppDatabase();
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const alerts = await getCollection<AlertDoc>(collections.alerts);
    const assets = await getCollection<AssetDoc>(collections.assets);
    const targets = await getCollection(collections.monitoringTargets);
    const incidents = await getCollection<IncidentDoc>(collections.incidents);
    const maintenances = await getCollection<MaintenanceDoc>(collections.maintenances);
    await alerts.deleteMany({ targetId: { $in: targetIds } });
    await targets.deleteMany({ id: { $in: targetIds } });
    await assets.deleteMany({ id: { $in: assetIds } });
    await incidents.deleteMany({ sourceMonitoringTargetId: { $in: targetIds } });
    await maintenances.deleteMany({ id: { $in: maintenanceIds } });
    const results = await getCollection(collections.monitoringResults);
    await results.deleteMany({ targetId: { $in: targetIds } });
    const links = await getCollection(collections.maintenanceAssets);
    await links.deleteMany({ maintenanceId: { $in: maintenanceIds } });
    await closeMongo();
  });

  it("raises one alert and one incident for a failing check, then deduplicates on repeat", async () => {
    const asset = await createAsset();
    const target = await createTarget(asset.id);
    failResponse = true;

    const first = await runCheck(target);
    expect(first.next.status).toBe("unavailable");
    expect(first.alertResult.alertId).toBeTruthy();
    expect(first.alertResult.incidentId).toBeTruthy();

    const alert = await findAlertById(first.alertResult.alertId!);
    expect(alert?.status).toBe("triggered");
    expect(alert?.severity).toBe("critical");
    expect(alert?.assetId).toBe(asset.id);

    const incident = await findIncidentById(first.alertResult.incidentId!);
    expect(incident?.status).toBe("open");
    expect(incident?.autoCreated).toBe(true);
    expect(incident?.sourceAlertId).toBe(alert?.id);

    // A second failing check refreshes the same alert and never opens a second incident.
    const refreshed = { ...target, status: first.next.status, consecutiveFailures: first.next.consecutiveFailures, consecutiveSuccesses: 0 };
    const second = await runCheck(refreshed);
    expect(second.alertResult.alertId).toBe(alert?.id);
    expect(second.alertResult.incidentId).toBeNull();

    const active = await listActiveAlertsForTarget(target.id);
    expect(active).toHaveLength(1);
    expect(active[0].occurrences).toBeGreaterThanOrEqual(2);

    const results = await listMonitoringResults(target.id, { since: new Date(Date.now() - 60_000), page: 1, pageSize: 10 });
    expect(results.total).toBe(2);
    expect(results.items.every((row) => row.success === false)).toBe(true);
  });

  it("suppresses escalation while a maintenance window covers the asset", async () => {
    const asset = await createAsset();
    const target = await createTarget(asset.id);
    failResponse = true;

    const now = new Date();
    const maintenance: MaintenanceDoc = {
      id: randomUUID(),
      _id: randomUUID(),
      title: "Integration maintenance",
      description: "test window",
      status: "in_progress",
      startsAt: new Date(now.getTime() - 60_000),
      endsAt: new Date(now.getTime() + 600_000),
      ownerId: null,
      createdById: null,
      notes: null,
      reminderSentAt: null,
      createdAt: now,
      updatedAt: now,
    };
    maintenanceIds.push(maintenance.id);
    await (await getCollection<MaintenanceDoc>(collections.maintenances)).insertOne(maintenance);
    await (await getCollection<MaintenanceAssetDoc>(collections.maintenanceAssets)).insertOne({
      id: randomUUID(),
      _id: randomUUID(),
      maintenanceId: maintenance.id,
      assetId: asset.id,
    });

    const result = await runCheck(target);
    expect(result.next.status).toBe("unavailable");
    expect(result.alertResult.suppressed).toBe(true);
    expect(result.alertResult.incidentId).toBeNull();

    const incident = await (await getCollection<IncidentDoc>(collections.incidents)).findOne({
      sourceMonitoringTargetId: target.id,
    });
    expect(incident).toBeNull();

    // Health is still recorded truthfully even though alerting is suppressed.
    const results = await listMonitoringResults(target.id, { since: new Date(Date.now() - 60_000), page: 1, pageSize: 5 });
    expect(results.items[0]?.state).toBe("unavailable");
  });

  it("resolves alerts on recovery but leaves the incident open for humans", async () => {
    const asset = await createAsset();
    const target = await createTarget(asset.id);

    failResponse = true;
    const failing = await runCheck(target);
    const alertId = failing.alertResult.alertId!;
    const incidentId = failing.alertResult.incidentId!;
    expect(alertId).toBeTruthy();
    expect(incidentId).toBeTruthy();

    failResponse = false;
    const recovering = { ...target, status: failing.next.status, consecutiveFailures: 1, consecutiveSuccesses: 0 };
    const firstSuccess = await runCheck(recovering);
    // recoveryThreshold is 2, so one success is not enough to resolve the alert.
    expect(firstSuccess.alertResult.resolvedCount).toBe(0);
    expect((await findAlertById(alertId))?.status).toBe("triggered");

    const secondSuccess = await runCheck({
      ...recovering,
      status: firstSuccess.next.status,
      consecutiveFailures: 0,
      consecutiveSuccesses: 1,
    });
    expect(secondSuccess.alertResult.resolvedCount).toBe(1);

    const resolved = await findAlertById(alertId);
    expect(resolved?.status).toBe("resolved");
    expect(resolved?.resolutionNotes).toContain("Recovered automatically");

    const incident = await findIncidentById(incidentId);
    expect(incident?.status).toBe("open");
    expect(incident?.resolvedAt).toBeNull();

    const comments = await listIncidentComments(incidentId);
    expect(comments.some((comment) => comment.kind === "system" && comment.body.includes("Monitoring recovered"))).toBe(true);
  });
});
