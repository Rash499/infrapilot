/**
 * Demo environment seeder for InfraPilot.
 *
 * Populates a local MongoDB with a coherent, presentation-ready organisation: users, assets,
 * monitoring targets and history, incidents, findings, maintenance windows, change requests and
 * notifications. Everything is written through the existing service layer, so validation, audit
 * records, notifications and the change-approval workflow behave exactly as they do in the product.
 *
 * Guarantees:
 *  - Idempotent. Re-running updates only records carrying this dataset's owner marker.
 *  - Never destructive outside its own data. Records created by anyone else are never modified or
 *    deleted, and the cleanup mode refuses to run if a demo account owns non-demo records.
 *  - No secrets. The password is read from DEMO_SEED_PASSWORD and hashed with the application's own
 *    hasher; nothing is logged or stored in plain text.
 *  - No fabricated history in worker-executed collections beyond monitoring targets this seeder
 *    owns; those targets point at loopback endpoints only.
 *
 * Usage:
 *   npm run db:seed:demo -- --dry-run     validate the dataset and print what would be created
 *   npm run db:seed:demo                  create or refresh the demo data
 *   npm run db:seed:demo:cleanup -- --yes remove only the seeded demo records
 */

import "@infrapilot/server-core/load-env";
import type { Document, Filter } from "mongodb";
import {
  closeMongo,
  collections,
  ensureMongoIndexes,
  getCollection,
  insertAuditLog,
  insertNotifications,
  newEntityIds,
  insertUser,
  findUserByEmail,
  updateMonitoringTargetAfterCheck,
  updateUserById,
  type InfraPilotCollectionName,
  type MongoEntity,
} from "@infrapilot/database";
import {
  addIncidentComment,
  createAsset,
  createChange,
  createFinding,
  createIncident,
  createMaintenance,
  createTarget,
  decideChange,
  hashPassword,
  submitChange,
  transitionChange,
  updateAsset,
  updateFinding,
  updateIncident,
  updateMaintenance,
  updateTarget,
  type AuthUser,
} from "@infrapilot/server-core";
import {
  DEMO_ASSETS,
  DEMO_AUDIT_EVENTS,
  DEMO_BATCH,
  DEMO_CHANGES,
  DEMO_SOURCE,
  DEMO_FINDINGS,
  DEMO_INCIDENTS,
  DEMO_MAINTENANCE,
  DEMO_MONITORS,
  DEMO_NOTIFICATIONS,
  DEMO_USERS,
  type DemoAssetSpec,
  type DemoChangeSpec,
  type DemoIncidentSpec,
  type DemoMaintenanceSpec,
  type DemoMonitorSpec,
} from "./demo-data/dataset";
import { buildMonitoringHistory, formatPlan, planCounts, validateDataset } from "./demo-data/plan";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** Audit metadata for seeded writes; clearly distinguishable from real traffic. */
const SEED_IP = "127.0.0.1";

interface Args {
  dryRun: boolean;
  cleanup: boolean;
  confirmed: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false, cleanup: false, confirmed: false };
  for (const arg of argv) {
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--cleanup") args.cleanup = true;
    else if (arg === "--yes" || arg === "--confirm-demo-data") args.confirmed = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: tsx scripts/seed-demo.ts [--dry-run] [--cleanup --yes]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

interface Registry {
  users: Map<string, string>;
  assets: Map<string, string>;
  monitors: Map<string, string>;
  incidents: Map<string, string>;
  findings: Map<string, string>;
  maintenance: Map<string, string>;
  changes: Map<string, string>;
}

function emptyRegistry(): Registry {
  return {
    users: new Map(),
    assets: new Map(),
    monitors: new Map(),
    incidents: new Map(),
    findings: new Map(),
    maintenance: new Map(),
    changes: new Map(),
  };
}

function registryIds(registry: Registry): string[] {
  return [
    ...registry.users.values(),
    ...registry.assets.values(),
    ...registry.monitors.values(),
    ...registry.incidents.values(),
    ...registry.findings.values(),
    ...registry.maintenance.values(),
    ...registry.changes.values(),
  ];
}

/** All demo records are MongoEntity documents; filters are cast once, in one place. */
async function collection(name: InfraPilotCollectionName) {
  return getCollection<MongoEntity>(name);
}

const filter = <T>(value: Record<string, unknown>) => value as unknown as Filter<T>;

/** Marks a document as owned by this dataset. Only ever applied to records the seeder created. */
async function tag(name: InfraPilotCollectionName, id: string, demoKey: string): Promise<void> {
  const col = await collection(name);
  await col.updateOne(filter({ id }), {
    $set: { demoBatch: DEMO_BATCH, demoSource: DEMO_SOURCE, demoKey },
  });
}

async function findByDemoKey(name: InfraPilotCollectionName, demoKey: string): Promise<MongoEntity | null> {
  const col = await collection(name);
  return col.findOne(filter({ demoBatch: DEMO_BATCH, demoKey }));
}

async function markTimestamps(
  name: InfraPilotCollectionName,
  id: string,
  patch: { createdAt?: Date; updatedAt?: Date; [key: string]: unknown },
): Promise<void> {
  const col = await collection(name);
  await col.updateOne(filter({ id }), { $set: patch });
}

function at(now: Date, hoursAgo: number): Date {
  return new Date(now.getTime() - hoursAgo * HOUR_MS);
}

function actorFrom(key: string, registry: Registry): AuthUser {
  const spec = DEMO_USERS.find((user) => user.key === key);
  const id = registry.users.get(key);
  if (!spec || !id) throw new Error(`Demo user ${key} is not available`);
  return { id, email: spec.email, name: spec.name, role: spec.role };
}

function requireAsset(key: string, registry: Registry): string {
  const id = registry.assets.get(key);
  if (!id) throw new Error(`Demo asset ${key} has not been created yet`);
  return id;
}

// ---------------------------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------------------------

async function seedUsers(args: Args, registry: Registry, now: Date): Promise<void> {
  const password = process.env.DEMO_SEED_PASSWORD;
  if (!password && !args.dryRun) {
    throw new Error(
      "DEMO_SEED_PASSWORD is required. Set it in .env (local only) or the shell, then re-run. It is hashed with the application's hasher and never logged.",
    );
  }

  for (const spec of DEMO_USERS) {
    const email = spec.email.trim().toLowerCase();
    const existing = await findUserByEmail(email);
    if (existing) {
      const tagged = await findByDemoKey(collections.users, spec.key).catch(() => null);
      const marker = (existing as unknown as Record<string, unknown>).demoBatch;
      if (marker !== DEMO_BATCH && tagged?.id !== existing.id) {
        throw new Error(
          `Refusing to modify ${email}: the account already exists and was not created by the demo seeder. Choose another DEMO_EMAIL_DOMAIN or remove the account manually.`,
        );
      }
      registry.users.set(spec.key, existing.id);
      if (!args.dryRun && (existing.name !== spec.name || existing.role !== spec.role)) {
        await updateUserById(existing.id, { name: spec.name, role: spec.role });
      }
      if (!args.dryRun && password && process.env.DEMO_RESET_PASSWORDS === "true") {
        await updateUserById(existing.id, { passwordHash: await hashPassword(password) });
      }
      await tag(collections.users, existing.id, spec.key);
      if (existing.lastLoginAt === null && !args.dryRun) {
        await markTimestamps(collections.users, existing.id, { lastLoginAt: at(now, 20 + registry.users.size) });
      }
      continue;
    }

    if (args.dryRun) {
      registry.users.set(spec.key, `dry-run-${spec.key}`);
      continue;
    }

    const created = await insertUser({ email, name: spec.name, passwordHash: await hashPassword(password!), role: spec.role });
    await tag(collections.users, created.id, spec.key);
    await markTimestamps(collections.users, created.id, { lastLoginAt: at(now, 20 + registry.users.size) });
    registry.users.set(spec.key, created.id);
    console.log(`  user        created  ${spec.email} (${spec.role})`);
  }
}

// ---------------------------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------------------------

function assetInput(spec: DemoAssetSpec, registry: Registry) {
  return {
    name: spec.name,
    assetType: spec.assetType,
    hostname: spec.hostname,
    ipAddress: spec.ipAddress,
    operatingSystem: spec.operatingSystem,
    environment: spec.environment,
    location: spec.location,
    ownerId: registry.users.get(spec.owner)!,
    description: spec.description,
    status: spec.status,
  };
}

function assetChanged(row: Document, spec: DemoAssetSpec, variant: ReturnType<typeof assetInput>): boolean {
  return (
    row.name !== spec.name ||
    row.assetType !== spec.assetType ||
    row.hostname !== spec.hostname ||
    row.ipAddress !== spec.ipAddress ||
    row.operatingSystem !== spec.operatingSystem ||
    row.environment !== spec.environment ||
    row.location !== spec.location ||
    row.ownerId !== variant.ownerId ||
    row.description !== variant.description ||
    row.status !== variant.status
  );
}

async function seedAssets(args: Args, registry: Registry, now: Date): Promise<void> {
  for (const spec of DEMO_ASSETS) {
    const existing = await findByDemoKey(collections.assets, spec.key);
    const input = assetInput(spec, registry);
    const actor = actorFrom(spec.owner, registry);

    if (!existing) {
      if (args.dryRun) {
        registry.assets.set(spec.key, `dry-run-${spec.key}`);
        continue;
      }
      const row = await createAsset(actor, input, SEED_IP);
      await tag(collections.assets, row.id, spec.key);
      await markTimestamps(collections.assets, row.id, {
        createdAt: at(now, spec.ageDays * 24 + 3),
        updatedAt: at(now, Math.min(spec.ageDays * 24, 30) + 1),
      });
      registry.assets.set(spec.key, row.id);
      console.log(`  asset       created  ${spec.name} (${spec.assetType}, ${spec.environment})`);
      continue;
    }

    registry.assets.set(spec.key, existing.id as string);
    if (args.dryRun) continue;
    if (assetChanged(existing, spec, input)) {
      await updateAsset(actor, existing.id as string, input, SEED_IP);
      console.log(`  asset       refreshed ${spec.name}`);
    }
    await tag(collections.assets, existing.id as string, spec.key);
  }
}

// ---------------------------------------------------------------------------------------------
// Monitoring targets and history
// ---------------------------------------------------------------------------------------------

function monitorInput(spec: DemoMonitorSpec, assetId: string) {
  const http = spec.monitorType === "http";
  return {
    name: spec.name,
    monitorType: spec.monitorType,
    url: http ? spec.url! : undefined,
    host: http ? null : spec.host!,
    port: http ? undefined : spec.port!,
    expectedStatusCode: http ? spec.expectedStatusCode ?? 200 : undefined,
    intervalSeconds: spec.intervalSeconds,
    timeoutMs: spec.timeoutMs,
    degradedThresholdMs: spec.degradedThresholdMs,
    enabled: spec.enabled,
    allowPrivateNetwork: true,
    assetId,
  };
}

function monitorChanged(row: Document, variant: ReturnType<typeof monitorInput>): boolean {
  return Object.entries(variant).some(([key, value]) => row[key] !== value);
}

async function seedMonitoring(args: Args, registry: Registry, now: Date): Promise<void> {
  const admin = actorFrom("admin", registry);
  for (const spec of DEMO_MONITORS) {
    const assetId = requireAsset(spec.asset, registry);
    const input = monitorInput(spec, assetId);
    const existing = await findByDemoKey(collections.monitoringTargets, spec.key);

    let targetId: string;
    if (!existing) {
      if (args.dryRun) {
        registry.monitors.set(spec.key, `dry-run-${spec.key}`);
        continue;
      }
      const row = await createTarget(admin, input, SEED_IP);
      targetId = row.id;
      await tag(collections.monitoringTargets, targetId, spec.key);
      console.log(`  monitor     created  ${spec.name}`);
    } else {
      targetId = existing.id as string;
      if (!args.dryRun && monitorChanged(existing, input)) {
        await updateTarget(admin, targetId, input, SEED_IP);
        console.log(`  monitor     refreshed ${spec.name}`);
      }
      await tag(collections.monitoringTargets, targetId, spec.key);
    }
    registry.monitors.set(spec.key, targetId);
    if (args.dryRun) continue;

    // Presentation state. The worker will replace this with a real result on its next tick,
    // which is the honest behaviour for a live monitoring product.
    const history = buildMonitoringHistory(spec, now);
    await updateMonitoringTargetAfterCheck(targetId, {
      status: spec.state,
      consecutiveFailures: spec.consecutiveFailures,
      // A target without history has genuinely never been checked.
      lastCheckedAt: history.length > 0 ? at(now, 0.25) : null,
      lastResponseMs: history.length > 0 ? spec.lastResponseMs : null,
      lastError: spec.lastError,
    });
    await markTimestamps(collections.monitoringTargets, targetId, {
      nextCheckAt: new Date(now.getTime() + Math.min(spec.intervalSeconds, 120) * 1000),
    });

    // Rebuild this target's history from scratch; the rows belong to demo targets only.
    const results = await collection(collections.monitoringResults);
    await results.deleteMany({ targetId });
    if (history.length > 0) {
      await results.insertMany(
        history.map((point) => ({
          ...newEntityIds(),
          targetId,
          ...point,
          demoBatch: DEMO_BATCH,
          demoSource: DEMO_SOURCE,
        })) as MongoEntity[],
      );
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Incidents
// ---------------------------------------------------------------------------------------------

async function seedIncidents(args: Args, registry: Registry, now: Date): Promise<void> {
  const reporter = actorFrom("operator", registry);
  for (const spec of DEMO_INCIDENTS) {
    const assigneeId = registry.users.get(spec.assignee)!;
    const assetIds = spec.assets.map((key) => requireAsset(key, registry));
    const existing = await findByDemoKey(collections.incidents, spec.key);

    let id: string;
    if (!existing) {
      if (args.dryRun) {
        registry.incidents.set(spec.key, `dry-run-${spec.key}`);
        continue;
      }
      const row = await createIncident(reporter, {
        title: spec.title,
        description: spec.description,
        severity: spec.severity,
        priority: spec.priority,
        assigneeId,
        assetIds,
      }, SEED_IP);
      id = row.id;
      await tag(collections.incidents, id, spec.key);
      console.log(`  incident    created  ${row.reference} ${spec.title}`);
    } else {
      id = existing.id as string;
      await tag(collections.incidents, id, spec.key);
      if (!args.dryRun) console.log(`  incident    present  ${spec.title}`);
    }
    registry.incidents.set(spec.key, id);
    if (args.dryRun) continue;

    await ensureIncidentState(spec, id, registry, now);
    await syncIncidentComments(spec, id, registry, now);
  }
}

async function ensureIncidentState(spec: DemoIncidentSpec, id: string, registry: Registry, now: Date): Promise<void> {
  const current = await findByDemoKey(collections.incidents, spec.key);
  if (!current) return;
  const needsResolution = spec.status === "resolved" || spec.status === "closed";
  const patch: Record<string, unknown> = {};
  if (spec.rootCause && current.rootCause !== spec.rootCause) patch.rootCause = spec.rootCause;
  if (needsResolution && current.resolution !== spec.resolution) patch.resolution = spec.resolution;
  if (current.status !== spec.status) patch.status = spec.status;

  if (Object.keys(patch).length > 0) {
    await updateIncident(actorFrom(spec.assignee, registry), id, patch as { status?: DemoIncidentSpec["status"]; resolution?: string; rootCause?: string }, SEED_IP);
  }

  const resolutionHours = spec.status === "resolved" || spec.status === "closed" ? Math.max(1, spec.openedHoursAgo - 24) : null;
  await markTimestamps(collections.incidents, id, {
    openedAt: at(now, spec.openedHoursAgo),
    createdAt: at(now, spec.openedHoursAgo),
    updatedAt: at(now, spec.comments?.length ? Math.min(...spec.comments.map((c) => c.hoursAgo), spec.openedHoursAgo - 1) : Math.max(0, spec.openedHoursAgo - 2)),
    resolvedAt: spec.status === "closed" ? at(now, Math.max(1, spec.openedHoursAgo - 48)) : resolutionHours !== null ? at(now, resolutionHours) : null,
    closedAt: spec.status === "closed" ? at(now, Math.max(0, spec.openedHoursAgo - 72)) : null,
  });
}

/**
 * Incident comments are the only place where re-running must reconcile existing rows. System
 * comments written by the workflow are preserved; authored demo comments are replaced when the
 * dataset changes.
 */
async function syncIncidentComments(spec: DemoIncidentSpec, id: string, registry: Registry, now: Date): Promise<void> {
  const comments = await collection(collections.incidentComments);
  const wanted = spec.comments ?? [];
  // Only the authored comments carry a demoKey; the workflow's system comments must survive.
  const authored = await comments.find({ incidentId: id, demoKey: { $exists: true } }).toArray();
  const currentBodies = authored.map((row) => String(row.body)).sort();
  const wantedBodies = wanted.map((comment) => comment.body).sort();
  if (currentBodies.length === wantedBodies.length && currentBodies.every((body, index) => body === wantedBodies[index])) {
    return;
  }

  await comments.deleteMany({ incidentId: id, demoKey: { $exists: true } });
  for (const [index, comment] of wanted.entries()) {
    await addIncidentComment(actorFrom(comment.author, registry), id, comment.body, SEED_IP);
    const created = await comments.findOne({ incidentId: id, authorId: registry.users.get(comment.author), body: comment.body });
    if (created) {
      await comments.updateOne({ _id: created._id }, {
        $set: {
          demoBatch: DEMO_BATCH,
          demoSource: DEMO_SOURCE,
          demoKey: `${spec.key}-comment-${index}`,
          createdAt: at(now, comment.hoursAgo),
        },
      });
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Security findings
// ---------------------------------------------------------------------------------------------

async function seedFindings(args: Args, registry: Registry, now: Date): Promise<void> {
  const security = actorFrom("security", registry);
  for (const spec of DEMO_FINDINGS) {
    const assetId = spec.asset ? requireAsset(spec.asset, registry) : null;
    const assigneeId = registry.users.get(spec.assignee)!;
    const existing = await findByDemoKey(collections.securityFindings, spec.key);

    let id: string;
    if (!existing) {
      if (args.dryRun) {
        registry.findings.set(spec.key, `dry-run-${spec.key}`);
        continue;
      }
      const row = await createFinding(security, {
        title: spec.title,
        description: spec.description,
        severity: spec.severity,
        assetId,
        assigneeId,
        remediation: spec.remediation,
        cveId: null,
      }, SEED_IP);
      id = row.id;
      await tag(collections.securityFindings, id, spec.key);
      console.log(`  finding     created  ${spec.severity.padEnd(13)} ${spec.title}`);
    } else {
      id = existing.id as string;
      await tag(collections.securityFindings, id, spec.key);
    }
    registry.findings.set(spec.key, id);
    if (args.dryRun) continue;

    const current = await findByDemoKey(collections.securityFindings, spec.key);
    if (current && current.status !== spec.status) {
      await updateFinding(actorFrom(spec.assignee, registry), id, {
        status: spec.status,
        note: spec.acceptNote ?? spec.progressNote ?? `Status set to ${spec.status} by the demo dataset.`,
      }, SEED_IP);
    }

    await markTimestamps(collections.securityFindings, id, {
      createdAt: at(now, spec.detectedDaysAgo * 24),
      updatedAt: at(now, (spec.resolvedDaysAgo ?? Math.max(0, spec.detectedDaysAgo - 1)) * 24 + 2),
      resolvedAt: spec.status === "resolved" && spec.resolvedDaysAgo !== undefined ? at(now, spec.resolvedDaysAgo * 24) : null,
    });
    const events = await collection(collections.findingEvents);
    await events.updateMany({ findingId: id }, { $set: { demoBatch: DEMO_BATCH, demoSource: DEMO_SOURCE } });
    if (spec.status === "resolved" && spec.resolvedDaysAgo !== undefined) {
      await events.updateMany(
        { findingId: id, toStatus: "resolved" },
        { $set: { createdAt: at(now, spec.resolvedDaysAgo * 24) } },
      );
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Maintenance windows
// ---------------------------------------------------------------------------------------------

function maintenanceInput(spec: DemoMaintenanceSpec, registry: Registry, now: Date) {
  return {
    title: spec.title,
    description: spec.description,
    startsAt: new Date(now.getTime() + spec.startOffsetHours * HOUR_MS).toISOString(),
    endsAt: new Date(now.getTime() + (spec.startOffsetHours + spec.durationHours) * HOUR_MS).toISOString(),
    ownerId: registry.users.get(spec.owner)!,
    assetIds: spec.assets.map((key) => requireAsset(key, registry)),
    notes: spec.notes ?? null,
  };
}

async function seedMaintenance(args: Args, registry: Registry, now: Date): Promise<void> {
  const operator = actorFrom("operator", registry);
  for (const spec of DEMO_MAINTENANCE) {
    const input = maintenanceInput(spec, registry, now);
    const existing = await findByDemoKey(collections.maintenances, spec.key);

    let id: string;
    if (!existing) {
      if (args.dryRun) {
        registry.maintenance.set(spec.key, `dry-run-${spec.key}`);
        continue;
      }
      const row = await createMaintenance(operator, input, SEED_IP);
      id = row.id;
      await tag(collections.maintenances, id, spec.key);
      console.log(`  maintenance created  ${spec.title}`);
    } else {
      id = existing.id as string;
      await tag(collections.maintenances, id, spec.key);
      if (!args.dryRun) {
        const current = existing as unknown as Record<string, unknown>;
        const changed =
          current.title !== input.title ||
          current.description !== input.description ||
          new Date(current.startsAt as Date).getTime() !== new Date(input.startsAt).getTime() ||
          new Date(current.endsAt as Date).getTime() !== new Date(input.endsAt).getTime() ||
          current.ownerId !== input.ownerId;
        if (changed && (current.status === "scheduled" || current.status === "in_progress")) {
          await updateMaintenance(operator, id, input, SEED_IP);
        }
      }
    }
    registry.maintenance.set(spec.key, id);
    if (args.dryRun) continue;

    const current = await findByDemoKey(collections.maintenances, spec.key);
    if (current && current.status !== spec.status) {
      await updateMaintenance(operator, id, { status: spec.status }, SEED_IP);
    }
    const maintenanceAssets = await collection(collections.maintenanceAssets);
    await maintenanceAssets.updateMany({ maintenanceId: id }, {
      $set: { demoBatch: DEMO_BATCH, demoSource: DEMO_SOURCE },
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Change requests (full approval workflow)
// ---------------------------------------------------------------------------------------------

function changeInput(spec: DemoChangeSpec, registry: Registry, now: Date) {
  return {
    title: spec.title,
    description: spec.description,
    reason: spec.reason,
    riskLevel: spec.riskLevel,
    riskAssessment: spec.riskAssessment,
    rollbackPlan: spec.rollbackPlan,
    plannedStartAt: new Date(now.getTime() + spec.plannedStartOffsetHours * HOUR_MS).toISOString(),
    plannedEndAt: new Date(now.getTime() + (spec.plannedStartOffsetHours + spec.plannedDurationHours) * HOUR_MS).toISOString(),
    implementerId: registry.users.get(spec.implementer)!,
    assetIds: spec.assets.map((key) => requireAsset(key, registry)),
  };
}

/** Approvers are any demo admin/operator that is not the requester; the seeder records real approvals. */
function approversFor(requesterKey: string): string[] {
  return DEMO_USERS.filter((user) => user.role !== "viewer" && user.key !== requesterKey).map((user) => user.key);
}

async function seedChanges(args: Args, registry: Registry, now: Date): Promise<void> {
  for (const spec of DEMO_CHANGES) {
    const requester = actorFrom(spec.requester, registry);
    const input = changeInput(spec, registry, now);
    const existing = await findByDemoKey(collections.changeRequests, spec.key);

    let id: string;
    let status: string;
    if (!existing) {
      if (args.dryRun) {
        registry.changes.set(spec.key, `dry-run-${spec.key}`);
        continue;
      }
      const row = await createChange(requester, input, SEED_IP);
      id = row.id;
      status = row.status;
      await tag(collections.changeRequests, id, spec.key);
      console.log(`  change      created  ${row.reference} ${spec.title}`);
    } else {
      id = existing.id as string;
      status = existing.status as string;
      await tag(collections.changeRequests, id, spec.key);
    }
    registry.changes.set(spec.key, id);
    if (args.dryRun) continue;

    if (status === "draft" && spec.status !== "draft") {
      await submitChange(requester, id, SEED_IP);
      status = "pending_approval";
    }

    // Walk the real approval workflow until the requested status is reached or the workflow stops.
    const approvers = approversFor(spec.requester);
    const maxApprovals = Math.max(Number(process.env.REQUIRED_CHANGE_APPROVALS ?? 1) || 1, 1);
    let approvals = 0;
    const targetNeedsApproval = ["approved", "implemented", "rolled_back", "cancelled"].includes(spec.status);

    if (status === "pending_approval" && spec.status === "rejected") {
      const approver = actorFrom(approvers[0]!, registry);
      await decideChange(approver, id, "rejected", spec.decisionComment ?? "Rejected by the demo dataset.", SEED_IP);
      status = "rejected";
    } else if (status === "pending_approval" && targetNeedsApproval) {
      for (const key of approvers) {
        if (approvals >= maxApprovals) break;
        const approver = actorFrom(key, registry);
        await decideChange(approver, id, "approved", spec.decisionComment ?? "Approved by the demo dataset.", SEED_IP);
        approvals += 1;
        const current = await findByDemoKey(collections.changeRequests, spec.key);
        status = (current?.status as string) ?? status;
        if (status !== "pending_approval") break;
      }
    }

    const afterApproval = await findByDemoKey(collections.changeRequests, spec.key);
    status = (afterApproval?.status as string) ?? status;
    const implementer = actorFrom(spec.implementer, registry);

    if (spec.status === "implemented" || spec.status === "rolled_back") {
      if (status === "approved") {
        await transitionChange(implementer, id, { action: "implement", notes: spec.implementationNotes ?? "Implemented by the demo dataset." }, SEED_IP);
        status = "implemented";
      }
      if (spec.status === "rolled_back" && status === "implemented") {
        await transitionChange(implementer, id, { action: "rollback", notes: spec.rollbackNotes ?? "Rolled back by the demo dataset." }, SEED_IP);
        status = "rolled_back";
      }
    } else if (spec.status === "cancelled" && status !== "cancelled") {
      await transitionChange(requester, id, { action: "cancel", notes: spec.decisionComment ?? "Cancelled by the demo dataset." }, SEED_IP);
      status = "cancelled";
    }

    const final = await findByDemoKey(collections.changeRequests, spec.key);
    if (final && final.status !== spec.status) {
      throw new Error(`Change ${spec.key} ended in status ${String(final.status)} instead of ${spec.status}. Check REQUIRED_CHANGE_APPROVALS.`);
    }

    await markTimestamps(collections.changeRequests, id, {
      createdAt: at(now, 6 * 24),
      updatedAt: at(now, Math.max(1, Math.abs(spec.plannedStartOffsetHours) - 12)),
      implementedAt: spec.status === "implemented" || spec.status === "rolled_back" ? at(now, Math.max(1, Math.abs(spec.plannedStartOffsetHours))) : null,
    });
    const approvalsCol = await collection(collections.changeApprovals);
    await approvalsCol.updateMany({ changeId: id }, { $set: { demoBatch: DEMO_BATCH, demoSource: DEMO_SOURCE } });
    const changeAssets = await collection(collections.changeAssets);
    await changeAssets.updateMany({ changeId: id }, { $set: { demoBatch: DEMO_BATCH, demoSource: DEMO_SOURCE } });
  }
}

// ---------------------------------------------------------------------------------------------
// Notifications and audit narration
// ---------------------------------------------------------------------------------------------

function notificationLink(
  spec: (typeof DEMO_NOTIFICATIONS)[number],
  registry: Registry,
): string | null {
  switch (spec.link.kind) {
    case "incident":
      return `/incidents/${registry.incidents.get(spec.link.key)!}`;
    case "finding":
      return `/security?finding=${registry.findings.get(spec.link.key)!}`;
    case "change":
      return `/changes?change=${registry.changes.get(spec.link.key)!}`;
    case "maintenance":
      return `/maintenance?maintenance=${registry.maintenance.get(spec.link.key)!}`;
    default:
      return null;
  }
}

async function seedNotifications(args: Args, registry: Registry, now: Date): Promise<void> {
  const notifications = await collection(collections.notifications);
  for (const spec of DEMO_NOTIFICATIONS) {
    const userId = registry.users.get(spec.recipient)!;
    const link = notificationLink(spec, registry);
    const existing = await notifications.findOne({ demoBatch: DEMO_BATCH, demoKey: spec.key });
    if (existing) {
      if (!args.dryRun) {
        await notifications.updateOne({ _id: existing._id }, {
          $set: { userId, type: spec.type, title: spec.title, message: spec.message, link, readAt: spec.read ? at(now, spec.hoursAgo) : null },
        });
      }
      continue;
    }
    if (args.dryRun) continue;
    await insertNotifications([userId], { type: spec.type, title: spec.title, message: spec.message, link });
    const created = await notifications.findOne(
      { userId, title: spec.title, demoBatch: { $exists: false } },
      { sort: { createdAt: -1 } },
    );
    if (created) {
      await notifications.updateOne({ _id: created._id }, {
        $set: {
          demoBatch: DEMO_BATCH,
          demoSource: DEMO_SOURCE,
          demoKey: spec.key,
          createdAt: at(now, spec.hoursAgo),
          readAt: spec.read ? at(now, Math.max(0, spec.hoursAgo - 1)) : null,
        },
      });
    }
    console.log(`  notification created ${spec.recipient}: ${spec.title}`);
  }
}

async function seedAuditNarration(args: Args, registry: Registry, now: Date): Promise<void> {
  if (args.dryRun) return;
  const audit = await collection(collections.auditLogs);
  for (const event of DEMO_AUDIT_EVENTS) {
    const entityId =
      event.entity.kind === "asset"
        ? registry.assets.get(event.entity.key!)
        : event.entity.kind === "incident"
          ? registry.incidents.get(event.entity.key!)
          : event.entity.kind === "finding"
            ? registry.findings.get(event.entity.key!)
            : event.entity.kind === "change"
              ? registry.changes.get(event.entity.key!)
              : event.entity.kind === "maintenance"
                ? registry.maintenance.get(event.entity.key!)
                : event.entity.kind === "user"
                  ? registry.users.get(event.entity.key!)
                  : null;
    const existing = await audit.findOne({ demoBatch: DEMO_BATCH, demoKey: event.key });
    if (existing) continue;
    const row = await insertAuditLog({
      actorId: registry.users.get(event.actor) ?? null,
      action: event.action,
      entityType: event.entityType,
      entityId: entityId ?? registry.users.get(event.actor)!,
      summary: event.summary,
      metadata: { demo: true, demoBatch: DEMO_BATCH, demoKey: event.key },
      ip: SEED_IP,
    });
    await audit.updateOne({ _id: row._id }, {
      $set: { demoBatch: DEMO_BATCH, demoSource: DEMO_SOURCE, demoKey: event.key, createdAt: at(now, event.hoursAgo) },
    });
  }
}

/**
 * Tags everything the workflow wrote while seeding: audit rows about demo entities and
 * notifications addressed to demo accounts. Without this, cleanup could not find them.
 */
async function tagWorkflowArtifacts(registry: Registry): Promise<void> {
  const ids = registryIds(registry);
  if (ids.length === 0) return;
  const marker = { $set: { demoBatch: DEMO_BATCH, demoSource: DEMO_SOURCE } };
  const userIds = [...registry.users.values()];
  const incidentIds = [...registry.incidents.values()];
  const findingIds = [...registry.findings.values()];
  const maintenanceIds = [...registry.maintenance.values()];
  const changeIds = [...registry.changes.values()];
  const targetIds = [...registry.monitors.values()];

  // Rows the workflow wrote on behalf of demo parents (system comments, approvals, links) must be
  // owned too, otherwise the cleanup guard rightly refuses to delete their parents.
  const children: Array<[InfraPilotCollectionName, string, string[]]> = [
    [collections.incidentComments, "incidentId", incidentIds],
    [collections.incidentAssets, "incidentId", incidentIds],
    [collections.findingEvents, "findingId", findingIds],
    [collections.maintenanceAssets, "maintenanceId", maintenanceIds],
    [collections.changeApprovals, "changeId", changeIds],
    [collections.changeAssets, "changeId", changeIds],
    [collections.monitoringResults, "targetId", targetIds],
  ];
  for (const [name, field, parentIds] of children) {
    if (parentIds.length === 0) continue;
    const col = await collection(name);
    await col.updateMany(filter({ [field]: { $in: parentIds } }), marker);
  }

  const audit = await collection(collections.auditLogs);
  await audit.updateMany(filter({ $or: [{ entityId: { $in: ids } }, { actorId: { $in: userIds } }] }), marker);
  const notifications = await collection(collections.notifications);
  await notifications.updateMany(filter({ userId: { $in: userIds } }), marker);
}

// ---------------------------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------------------------

interface CleanupCounts {
  collections: Array<[string, number]>;
  total: number;
}

async function collectRegistryFromDatabase(): Promise<Registry> {
  const registry = emptyRegistry();
  const load = async (name: InfraPilotCollectionName, target: Map<string, string>) => {
    const col = await collection(name);
    const rows = await col.find({ demoBatch: DEMO_BATCH }).project({ id: 1, demoKey: 1 }).toArray();
    for (const row of rows) {
      if (typeof row.demoKey === "string" && typeof row.id === "string") target.set(row.demoKey, row.id);
    }
  };
  await load(collections.users, registry.users);
  await load(collections.assets, registry.assets);
  await load(collections.monitoringTargets, registry.monitors);
  await load(collections.incidents, registry.incidents);
  await load(collections.securityFindings, registry.findings);
  await load(collections.maintenances, registry.maintenance);
  await load(collections.changeRequests, registry.changes);
  return registry;
}

async function assertOwnershipIsSafe(registry: Registry): Promise<void> {
  if (registry.users.size === 0) return;
  const userIds = [...registry.users.values()];
  const atRisk: string[] = [];
  const probes: Array<[InfraPilotCollectionName, string]> = [
    [collections.assets, "ownerId"],
    [collections.incidents, "assigneeId"],
    [collections.incidents, "reporterId"],
    [collections.securityFindings, "assigneeId"],
    [collections.maintenances, "ownerId"],
    [collections.changeRequests, "requesterId"],
    [collections.changeRequests, "implementerId"],
    [collections.changeApprovals, "approverId"],
    [collections.incidentComments, "authorId"],
    [collections.findingEvents, "actorId"],
    [collections.auditLogs, "actorId"],
  ];
  for (const [name, field] of probes) {
    const col = await collection(name);
    const count = await col.countDocuments({ [field]: { $in: userIds }, demoBatch: { $ne: DEMO_BATCH } });
    if (count > 0) atRisk.push(`${name}.${field}: ${count}`);
  }
  if (atRisk.length > 0) {
    throw new Error(
      `Cleanup aborted: demo accounts own records that the seeder did not create (${atRisk.join(", ")}). ` +
        "Remove or reassign those records first, then retry.",
    );
  }
}

async function runCleanup(args: Args): Promise<number> {
  if (!args.confirmed) {
    console.error(
      "Refusing to delete anything without confirmation.\n" +
        "Re-run with --yes (or --confirm-demo-data) to remove only records tagged " +
        `${DEMO_BATCH}.`,
    );
    return 2;
  }

  await ensureMongoIndexes();
  const registry = await collectRegistryFromDatabase();
  await assertOwnershipIsSafe(registry);

  const counts: Array<[string, number]> = [];
  const remove = async (name: InfraPilotCollectionName, filter: Document) => {
    const col = await collection(name);
    const result = await col.deleteMany(filter);
    if (result.deletedCount > 0) counts.push([name, result.deletedCount]);
  };

  const userList = [...registry.users.values()];
  const incidentIds = [...registry.incidents.values()];
  const findingIds = [...registry.findings.values()];
  const maintenanceIds = [...registry.maintenance.values()];
  const changeIds = [...registry.changes.values()];
  const targetIds = [...registry.monitors.values()];

  // Session artifacts of the demo accounts disappear with the accounts.
  if (userList.length > 0) {
    await remove(collections.refreshTokens, { userId: { $in: userList } });
    await remove(collections.passwordResetTokens, { userId: { $in: userList } });
  }

  // Children first so that no dangling references remain if a later step is interrupted.
  await remove(collections.findingEvents, { findingId: { $in: findingIds } });
  await remove(collections.incidentComments, { incidentId: { $in: incidentIds } });
  await remove(collections.incidentAssets, { incidentId: { $in: incidentIds } });
  await remove(collections.maintenanceAssets, { maintenanceId: { $in: maintenanceIds } });
  await remove(collections.changeApprovals, { changeId: { $in: changeIds } });
  await remove(collections.changeAssets, { changeId: { $in: changeIds } });
  await remove(collections.monitoringResults, { targetId: { $in: targetIds } });
  await remove(collections.notifications, { demoBatch: DEMO_BATCH });
  await remove(collections.auditLogs, { demoBatch: DEMO_BATCH });
  await remove(collections.changeRequests, { demoBatch: DEMO_BATCH });
  await remove(collections.maintenances, { demoBatch: DEMO_BATCH });
  await remove(collections.incidents, { demoBatch: DEMO_BATCH });
  await remove(collections.securityFindings, { demoBatch: DEMO_BATCH });
  await remove(collections.monitoringTargets, { demoBatch: DEMO_BATCH });
  await remove(collections.assets, { demoBatch: DEMO_BATCH });
  // Only demo accounts that still exist and are not referenced by anything else.
  if (userList.length > 0) await remove(collections.users, { id: { $in: userList }, demoBatch: DEMO_BATCH });

  const total = counts.reduce((sum, [, value]) => sum + value, 0);
  if (total === 0) {
    console.log(`No records tagged ${DEMO_BATCH} were found. Nothing was deleted.`);
    return 0;
  }
  console.log(`Removed ${total} demo records tagged ${DEMO_BATCH}:`);
  for (const [name, value] of counts) console.log(`  ${name.padEnd(22)} ${value}`);
  console.log("Pre-existing records, users and counters were left untouched.");
  return 0;
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

async function runSeed(args: Args): Promise<number> {
  const now = new Date();
  const problems = validateDataset();
  if (problems.length > 0) {
    console.error("The demo dataset failed validation:");
    for (const problem of problems) console.error(`  [${problem.area}/${problem.key}] ${problem.message}`);
    return 1;
  }

  console.log(`InfraPilot demo dataset ${DEMO_BATCH}`);
  console.log(formatPlan(planCounts()));
  if (args.dryRun) {
    console.log("\nDry run: validation passed, nothing was written. Unset --dry-run to seed the database.");
    return 0;
  }
  if (!process.env.DEMO_SEED_PASSWORD) {
    console.error("\nDEMO_SEED_PASSWORD is required to create demo accounts. Nothing was written.");
    return 1;
  }

  await ensureMongoIndexes();
  const registry = emptyRegistry();
  try {
    console.log("\nSeeding:");
    await seedUsers(args, registry, now);
    await seedAssets(args, registry, now);
    await seedMonitoring(args, registry, now);
    await seedIncidents(args, registry, now);
    await seedFindings(args, registry, now);
    await seedMaintenance(args, registry, now);
    await seedChanges(args, registry, now);
    await seedNotifications(args, registry, now);
    await seedAuditNarration(args, registry, now);
    await tagWorkflowArtifacts(registry);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nDemo seeding stopped: ${message}`);
    console.error("Re-run after fixing the cause; the seeder is idempotent and will resume safely.");
    return 1;
  }

  console.log("\nDemo data ready.");
  console.log(`  sign in as   ${DEMO_USERS[0]!.email}`);
  console.log("  password     the value of DEMO_SEED_PASSWORD");
  console.log(`  ownership    every record is tagged ${DEMO_BATCH}`);
  console.log("  cleanup      npm run db:seed:demo:cleanup -- --yes");
  console.log("  verify       npm run db:verify:demo");
  return 0;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.cleanup) {
    if (args.dryRun) throw new Error("--cleanup and --dry-run cannot be combined");
    return runCleanup(args);
  }
  if (args.confirmed) throw new Error("--yes only applies to --cleanup");
  return runSeed(args);
}

main()
  .then(async (code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error("Demo seeder failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongo().catch(() => undefined);
  });
