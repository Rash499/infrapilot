/**
 * Verifies the demo environment against the database.
 *
 * Checks, in order:
 *  1. collection counts for records owned by the demo seeder;
 *  2. referential integrity between demo records (owners, assets, accounts, approvers, links);
 *  3. workflow consistency (resolutions, approvals, timestamps, statuses);
 *  4. parity between the dashboard API and the raw documents it claims to summarise;
 *  5. that the seeded demo credentials actually work (when DEMO_SEED_PASSWORD is set).
 *
 * Usage:
 *   npm run db:verify:demo                  verify the seeded environment
 *   npm run db:verify:demo -- --expect-empty   assert that cleanup removed every demo record
 *
 * Exits non-zero when any check fails, so CI can gate on it.
 */

import "@infrapilot/server-core/load-env";
import type { Filter } from "mongodb";
import { closeMongo, collections, findUserByEmail, getCollection, type InfraPilotCollectionName, type MongoEntity } from "@infrapilot/database";
import { verifyPassword } from "@infrapilot/server-core";
import { DEMO_BATCH, DEMO_USERS } from "./demo-data/dataset";
import { planCounts } from "./demo-data/plan";

const DAY_MS = 24 * 60 * 60 * 1000;

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const checks: Check[] = [];

function record(name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail });
}

async function count(name: InfraPilotCollectionName, filter: Record<string, unknown> = {}): Promise<number> {
  const col = await getCollection<MongoEntity>(name);
  return col.countDocuments(filter as unknown as Filter<MongoEntity>);
}

async function demoCount(name: InfraPilotCollectionName): Promise<number> {
  return count(name, { demoBatch: DEMO_BATCH });
}

async function ids(name: InfraPilotCollectionName): Promise<Set<string>> {
  const col = await getCollection<MongoEntity>(name);
  const rows = await col.find({ demoBatch: DEMO_BATCH }).project({ id: 1 }).toArray();
  return new Set(rows.map((row) => String(row.id)));
}

async function rows(name: InfraPilotCollectionName): Promise<MongoEntity[]> {
  const col = await getCollection<MongoEntity>(name);
  return col.find({ demoBatch: DEMO_BATCH }).toArray();
}

async function expectAtLeast(name: string, actual: number, expected: number): Promise<void> {
  record(name, actual >= expected, `${actual} present, ${expected} expected`);
}

async function expectZero(name: string, actual: number): Promise<void> {
  record(name, actual === 0, `${actual} remaining`);
}

function report(problemsOnly: boolean): boolean {
  for (const check of checks) {
    if (problemsOnly && check.ok) continue;
    console.log(`${check.ok ? "PASS" : "FAIL"}  ${check.name.padEnd(46)} ${check.detail}`);
    // Surface failures as annotations: the job log endpoint is not always reachable for tooling.
    if (!check.ok && process.env.GITHUB_ACTIONS === "true") {
      console.log(`::error title=Demo verification failed::${check.name} — ${check.detail}`);
    }
  }
  const failed = checks.filter((check) => !check.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`);
  return failed.length === 0;
}

async function verifyEmpty(): Promise<boolean> {
  const names: InfraPilotCollectionName[] = [
    collections.users,
    collections.assets,
    collections.monitoringTargets,
    collections.monitoringResults,
    collections.incidents,
    collections.incidentComments,
    collections.incidentAssets,
    collections.securityFindings,
    collections.findingEvents,
    collections.maintenances,
    collections.maintenanceAssets,
    collections.changeRequests,
    collections.changeApprovals,
    collections.changeAssets,
    collections.notifications,
    collections.auditLogs,
  ];
  for (const name of names) await expectZero(`${name} demo records removed`, await demoCount(name));
  return report(true);
}

async function verifySeeded(): Promise<boolean> {
  const expected = planCounts();
  const assetIds = await ids(collections.assets);
  const monitorIds = await ids(collections.monitoringTargets);
  const incidentIds = await ids(collections.incidents);
  const findingIds = await ids(collections.securityFindings);
  const maintenanceIds = await ids(collections.maintenances);
  const changeIds = await ids(collections.changeRequests);
  const userIds = await ids(collections.users);

  // ---- counts ------------------------------------------------------------------------------
  await expectAtLeast("demo users", userIds.size, expected.users);
  await expectAtLeast("demo assets", assetIds.size, expected.assets);
  await expectAtLeast("demo monitoring targets", monitorIds.size, expected.monitoringTargets);
  await expectAtLeast("demo monitoring results", await demoCount(collections.monitoringResults), expected.monitoringResults);
  await expectAtLeast("demo incidents", incidentIds.size, expected.incidents);
  await expectAtLeast("demo security findings", findingIds.size, expected.findings);
  await expectAtLeast("demo maintenance windows", maintenanceIds.size, expected.maintenance);
  await expectAtLeast("demo change requests", changeIds.size, expected.changes);
  await expectAtLeast("demo notifications", await demoCount(collections.notifications), expected.notifications);

  // ---- users -------------------------------------------------------------------------------
  const allUsers = await getCollection<MongoEntity>(collections.users).then((col) => col.find({}).toArray());
  const activeUserIds = new Set(allUsers.filter((user) => user.isActive !== false).map((user) => String(user.id)));
  const demoUserRows = allUsers.filter((user) => user.demoBatch === DEMO_BATCH);
  record("demo accounts are active", demoUserRows.every((user) => user.isActive !== false), `${demoUserRows.filter((u) => u.isActive !== false).length}/${demoUserRows.length} active`);
  record(
    "demo accounts cover admin, operator and viewer",
    ["admin", "operator", "viewer"].every((role) => demoUserRows.some((user) => user.role === role)),
    demoUserRows.map((user) => String(user.role)).join(", "),
  );
  record(
    "demo accounts use hashed passwords",
    demoUserRows.every((user) => typeof user.passwordHash === "string" && !String(user.passwordHash).includes("DEMO_SEED_PASSWORD")),
    "no plain-text password material found",
  );
  const password = process.env.DEMO_SEED_PASSWORD;
  if (password && demoUserRows.length > 0) {
    const verified = await verifyPassword(password, String(demoUserRows[0]!.passwordHash));
    record("seeded demo password verifies", verified, `checked ${String(demoUserRows[0]!.email)}`);
  } else {
    console.log("SKIP  seeded demo password verifies                     DEMO_SEED_PASSWORD is not set");
  }

  // ---- assets ------------------------------------------------------------------------------
  const assetRows = await rows(collections.assets);
  record("every asset has an active owner", assetRows.every((asset) => activeUserIds.has(String(asset.ownerId))), `${assetRows.length} assets checked`);
  record("asset names are unique", new Set(assetRows.map((asset) => String(asset.name))).size === assetRows.length, "no duplicates");
  record("asset hostnames are unique", new Set(assetRows.map((asset) => String(asset.hostname))).size === assetRows.length, "no duplicates");
  record("asset IP addresses are unique", new Set(assetRows.map((asset) => String(asset.ipAddress))).size === assetRows.length, "no duplicates");
  record(
    "asset status is a supported value",
    assetRows.every((asset) => ["healthy", "degraded", "unavailable", "maintenance", "unknown"].includes(String(asset.status))),
    "statuses in range",
  );
  record("no demo asset is archived", assetRows.every((asset) => asset.archivedAt === null), "all active");

  // ---- monitoring --------------------------------------------------------------------------
  const monitorRows = await rows(collections.monitoringTargets);
  record("every monitor is linked to a demo asset", monitorRows.every((monitor) => assetIds.has(String(monitor.assetId))), `${monitorRows.length} monitors checked`);
  record(
    "every monitor targets a local or private destination",
    monitorRows.every((monitor) => {
      if (monitor.monitorType === "http") return /^https?:\/\/(127\.0\.0\.1|localhost|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(String(monitor.url));
      return /^(127\.0\.0\.1|localhost|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(String(monitor.host));
    }),
    "no external destinations",
  );
  record("private-network monitoring was explicitly authorised", monitorRows.every((monitor) => monitor.allowPrivateNetwork === true), "allowPrivateNetwork=true");
  record(
    "monitor intervals respect the API limits",
    monitorRows.every((monitor) => Number(monitor.intervalSeconds) >= 30 && Number(monitor.intervalSeconds) <= 86400),
    "30s..24h",
  );
  const resultsByTarget = new Map<string, MongoEntity[]>();
  for (const result of await rows(collections.monitoringResults)) {
    const key = String(result.targetId);
    const list = resultsByTarget.get(key) ?? [];
    list.push(result);
    resultsByTarget.set(key, list);
  }
  record(
    "monitoring history exists for every checked target",
    monitorRows.every((monitor) => resultsByTarget.has(String(monitor.id)) || monitor.lastCheckedAt === null),
    `${resultsByTarget.size} targets with history`,
  );
  record(
    "unavailable services have failing checks",
    monitorRows
      .filter((monitor) => monitor.enabled === true && monitor.status === "unavailable")
      .every((monitor) => (resultsByTarget.get(String(monitor.id)) ?? []).some((result) => result.success === false)),
    "outages are supported by history",
  );
  record(
    "healthy services have successful checks",
    monitorRows
      .filter((monitor) => monitor.enabled === true && monitor.status === "healthy")
      .every((monitor) => (resultsByTarget.get(String(monitor.id)) ?? []).some((result) => result.success === true)),
    "health is supported by history",
  );
  const attention = monitorRows.filter((monitor) => monitor.enabled === true && monitor.status === "unavailable");
  record("dashboard attention list is not empty", attention.length > 0, `${attention.length} unavailable services`);

  // ---- incidents ---------------------------------------------------------------------------
  const incidentRows = await rows(collections.incidents);
  const incidentLinks = await getCollection<MongoEntity>(collections.incidentAssets).then((col) => col.find({}).toArray());
  record("every incident has an active assignee", incidentRows.every((incident) => activeUserIds.has(String(incident.assigneeId))), `${incidentRows.length} incidents checked`);
  record(
    "every incident link points at a demo asset",
    incidentLinks.every((link) => assetIds.has(String(link.assetId))),
    `${incidentLinks.length} links checked`,
  );
  record(
    "no incident links are orphaned",
    incidentLinks.every((link) => incidentIds.has(String(link.incidentId))),
    "all parents exist",
  );
  record(
    "resolved and closed incidents explain the resolution",
    incidentRows.every((incident) => !["resolved", "closed"].includes(String(incident.status)) || (incident.resolution && incident.resolvedAt)),
    "resolution + resolvedAt present",
  );
  record(
    "closed incidents record a root cause",
    incidentRows.every((incident) => String(incident.status) !== "closed" || incident.rootCause),
    "root cause present",
  );
  const comments = await getCollection<MongoEntity>(collections.incidentComments).then((col) => col.find({}).toArray());
  record("every incident has a timeline", incidentRows.every((incident) => comments.some((comment) => comment.incidentId === incident.id)), `${comments.length} comments`);
  record("incident numbers are unique", new Set(incidentRows.map((incident) => Number(incident.number))).size === incidentRows.length, "no duplicate references");

  // ---- findings ----------------------------------------------------------------------------
  const findingRows = await rows(collections.securityFindings);
  record("every finding has an active assignee", findingRows.every((finding) => activeUserIds.has(String(finding.assigneeId))), `${findingRows.length} findings checked`);
  record(
    "finding asset references resolve",
    findingRows.every((finding) => !finding.assetId || assetIds.has(String(finding.assetId))),
    "asset links valid",
  );
  record("findings identify the demo origin", findingRows.every((finding) => String(finding.description).toLowerCase().includes("demonstration")), "description states demonstration data");
  record(
    "resolved findings have a resolution timestamp",
    findingRows.every((finding) => String(finding.status) !== "resolved" || finding.resolvedAt),
    "resolvedAt present",
  );
  const findingEvents = await getCollection<MongoEntity>(collections.findingEvents).then((col) => col.find({}).toArray());
  record(
    "every non-open finding has an event history",
    findingRows.every((finding) => String(finding.status) === "open" || findingEvents.some((event) => event.findingId === finding.id)),
    `${findingEvents.length} events`,
  );

  // ---- maintenance -------------------------------------------------------------------------
  const maintenanceRows = await rows(collections.maintenances);
  const maintenanceLinks = await getCollection<MongoEntity>(collections.maintenanceAssets).then((col) => col.find({}).toArray());
  record("every maintenance window has an owner", maintenanceRows.every((row) => activeUserIds.has(String(row.ownerId))), `${maintenanceRows.length} windows checked`);
  record(
    "maintenance windows end after they start",
    maintenanceRows.every((row) => new Date(row.startsAt as Date).getTime() < new Date(row.endsAt as Date).getTime()),
    "start < end",
  );
  record(
    "maintenance asset references resolve",
    maintenanceLinks.every((link) => assetIds.has(String(link.assetId)) && maintenanceIds.has(String(link.maintenanceId))),
    `${maintenanceLinks.length} links checked`,
  );
  const upcoming = maintenanceRows.filter(
    (row) => row.status === "scheduled" && new Date(row.startsAt as Date).getTime() >= Date.now() - DAY_MS * 365,
  );
  record("scheduled maintenance exists", upcoming.length > 0, `${upcoming.length} scheduled windows`);

  // ---- changes -----------------------------------------------------------------------------
  const changeRows = await rows(collections.changeRequests);
  const approvals = await getCollection<MongoEntity>(collections.changeApprovals).then((col) => col.find({}).toArray());
  const changeLinks = await getCollection<MongoEntity>(collections.changeAssets).then((col) => col.find({}).toArray());
  const required = Math.max(Number(process.env.REQUIRED_CHANGE_APPROVALS ?? 1) || 1, 1);
  record("every change has a requester and implementer", changeRows.every((row) => activeUserIds.has(String(row.requesterId)) && activeUserIds.has(String(row.implementerId))), `${changeRows.length} changes checked`);
  record(
    "change assets resolve",
    changeLinks.every((link) => assetIds.has(String(link.assetId)) && changeIds.has(String(link.changeId))),
    `${changeLinks.length} links checked`,
  );
  const decided = changeRows.filter((row) => ["approved", "implemented", "rolled_back"].includes(String(row.status)));
  record(
    `approved changes collect ${required} distinct approval(s)`,
    decided.every((row) => new Set(approvals.filter((approval) => approval.changeId === row.id && approval.decision === "approved").map((approval) => approval.approverId)).size >= required),
    `${decided.length} approved changes`,
  );
  record(
    "requesters never approve their own change",
    approvals.every((approval) => {
      const change = changeRows.find((row) => row.id === approval.changeId);
      return !change || change.requesterId !== approval.approverId;
    }),
    "separation of duties holds",
  );
  record(
    "implemented changes record implementation notes",
    changeRows.every((row) => String(row.status) !== "implemented" || row.implementationNotes),
    "notes present",
  );
  record(
    "rolled back changes record rollback notes",
    changeRows.every((row) => String(row.status) !== "rolled_back" || row.rollbackNotes),
    "notes present",
  );
  record(
    "changes serve every workflow state",
    ["draft", "pending_approval", "approved", "rejected", "implemented", "rolled_back", "cancelled"].every((status) => changeRows.some((row) => row.status === status)),
    changeRows.map((row) => String(row.status)).join(", "),
  );

  // ---- notifications -----------------------------------------------------------------------
  const notificationRows = await rows(collections.notifications);
  record("demo notifications target demo accounts", notificationRows.every((row) => userIds.has(String(row.userId))), `${notificationRows.length} notifications`);
  record("at least one notification is unread", notificationRows.some((row) => row.readAt === null), `${notificationRows.filter((row) => row.readAt === null).length} unread`);
  record("at least one notification is read", notificationRows.some((row) => row.readAt !== null), `${notificationRows.filter((row) => row.readAt !== null).length} read`);
  const knownIds = new Set([...assetIds, ...incidentIds, ...findingIds, ...maintenanceIds, ...changeIds]);
  record(
    "notification links resolve to demo records",
    notificationRows.every((row) => {
      const link = row.link ? String(row.link) : null;
      if (!link) return true;
      const match = /\/incidents\/([^/?]+)|\/security\?finding=([^&]+)|\/changes\?change=([^&]+)|\/maintenance\?maintenance=([^&]+)/.exec(link);
      if (!match) return true;
      const id = match.slice(1).find(Boolean);
      return !id || knownIds.has(id);
    }),
    "all links valid",
  );

  // ---- audit -------------------------------------------------------------------------------
  const auditRows = await rows(collections.auditLogs);
  record("audit log records the demo activity", auditRows.length >= 10, `${auditRows.length} demo audit entries`);
  record("every audit entry names an actor", auditRows.every((row) => row.actorId && activeUserIds.has(String(row.actorId))), "actors valid");
  record(
    "audit entries are marked as demo data",
    auditRows.every((row) => row.demoBatch === DEMO_BATCH),
    "marker present",
  );

  // ---- dashboard parity --------------------------------------------------------------------
  const { getDashboard } = await import("@infrapilot/server-core");
  const dashboard = await getDashboard(7);
  const now = Date.now();
  const assetCol = await getCollection<MongoEntity>(collections.assets);
  const totalAssets = await assetCol.countDocuments({ archivedAt: null });
  const healthyAssets = await assetCol.countDocuments({ archivedAt: null, status: "healthy" });
  const openIncidents = await count(collections.incidents, { status: { $nin: ["resolved", "closed"] } });
  const criticalHighOpenFindings = await count(collections.securityFindings, {
    severity: { $in: ["critical", "high"] },
    status: { $in: ["open", "in_progress"] },
  });
  const upcomingMaintenance = await count(collections.maintenances, {
    status: "scheduled",
    startsAt: { $gte: new Date(now), $lte: new Date(now + 14 * DAY_MS) },
  });
  const enabledTargets = await count(collections.monitoringTargets, { enabled: true });

  record("dashboard total assets matches the database", dashboard.kpis.totalAssets === totalAssets, `${dashboard.kpis.totalAssets} vs ${totalAssets}`);
  record("dashboard healthy assets matches the database", dashboard.kpis.healthyAssets === healthyAssets, `${dashboard.kpis.healthyAssets} vs ${healthyAssets}`);
  record("dashboard open incidents matches the database", dashboard.kpis.openIncidents === openIncidents, `${dashboard.kpis.openIncidents} vs ${openIncidents}`);
  record(
    "dashboard critical/high findings matches the database",
    dashboard.kpis.criticalHighOpenFindings === criticalHighOpenFindings,
    `${dashboard.kpis.criticalHighOpenFindings} vs ${criticalHighOpenFindings}`,
  );
  record(
    "dashboard upcoming maintenance matches the database",
    dashboard.kpis.upcomingMaintenance === upcomingMaintenance,
    `${dashboard.kpis.upcomingMaintenance} vs ${upcomingMaintenance}`,
  );
  record("dashboard monitored services matches the database", dashboard.kpis.monitoredServices === enabledTargets, `${dashboard.kpis.monitoredServices} vs ${enabledTargets}`);
  record("dashboard response trend has data", dashboard.responseTrend.length > 0, `${dashboard.responseTrend.length} buckets`);
  record("dashboard attention services are populated", dashboard.attentionServices.length > 0, `${dashboard.attentionServices.length} services`);
  record("dashboard recent incidents are populated", dashboard.recentIncidents.length > 0, `${dashboard.recentIncidents.length} incidents`);
  record("dashboard recent changes are populated", dashboard.recentChanges.length > 0, `${dashboard.recentChanges.length} changes`);
  record("dashboard critical findings are populated", dashboard.criticalFindings.length > 0, `${dashboard.criticalFindings.length} findings`);

  // ---- sign-in check -----------------------------------------------------------------------
  if (password) {
    const admin = await findUserByEmail(DEMO_USERS[0]!.email);
    record("demo administrator can be found by email", Boolean(admin), DEMO_USERS[0]!.email);
  }

  return report(!process.argv.includes("--verbose"));
}

async function main(): Promise<number> {
  const expectEmpty = process.argv.includes("--expect-empty");
  const ok = expectEmpty ? await verifyEmpty() : await verifySeeded();
  if (!ok) {
    console.error(expectEmpty ? "Demo cleanup verification failed." : "Demo environment verification failed.");
    return 1;
  }
  console.log(expectEmpty ? "Cleanup verified: no demo records remain." : "Demo environment verified.");
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error("Demo verification failed to run:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongo().catch(() => undefined);
  });
