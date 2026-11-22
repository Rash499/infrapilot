import { randomBytes } from "node:crypto";
// Must be evaluated before `@/db`, which reads DATABASE_URL at import time.
import "@/lib/load-env";
import { eq, inArray, sql } from "drizzle-orm";
import { db, pool } from "@/db";
import {
  assets,
  auditLogs,
  changeApprovals,
  changeAssets,
  changeRequests,
  findingEvents,
  incidentAssets,
  incidentComments,
  incidents,
  maintenanceAssets,
  maintenances,
  monitoringResults,
  monitoringTargets,
  notifications,
  securityFindings,
  users,
} from "@/db/schema";
import { hashPassword } from "@/lib/security";

/**
 * Development seed for the InfraPilot demo workspace.
 *
 *   npx tsx src/db/seed.ts                     # skipped when users already exist
 *   SEED_RESET=true npx tsx src/db/seed.ts     # removes all data and rebuilds the demo
 *
 * Contains no production data. Besides current records it writes a deterministic, synthetic 30-day
 * monitoring history so uptime, response-time charts and incident statistics are populated on first load.
 * Set SEED_PASSWORD to choose the shared password; otherwise a random one is generated and printed once.
 */

type UserRow = typeof users.$inferSelect;
type AssetRow = typeof assets.$inferSelect;
type TargetRow = typeof monitoringTargets.$inferSelect;
type FindingRow = typeof securityFindings.$inferSelect;
type IncidentRow = typeof incidents.$inferSelect;
type ChangeRow = typeof changeRequests.$inferSelect;
type ResultInsert = typeof monitoringResults.$inferInsert;
type CommentInsert = typeof incidentComments.$inferInsert;
type NotificationInsert = typeof notifications.$inferInsert;
type AuditInsert = typeof auditLogs.$inferInsert;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const HISTORY_DAYS = 30;
const INSERT_CHUNK = 1000;
/** Same setting as the monitoring worker: failures are "degraded" until this many consecutive misses. */
/** Same setting as the monitoring worker: failures are "degraded" until this many consecutive misses. */
const FAILURE_THRESHOLD = Number(process.env.MONITOR_FAILURE_THRESHOLD ?? 3);

/** Every InfraPilot table, so `SEED_RESET=true` can rebuild the workspace. */
const SEED_TABLES = [
  "audit_logs",
  "notifications",
  "change_approvals",
  "change_assets",
  "change_requests",
  "maintenance_assets",
  "maintenances",
  "incident_comments",
  "incident_assets",
  "incidents",
  "finding_events",
  "security_findings",
  "monitoring_results",
  "monitoring_targets",
  "assets",
  "password_reset_tokens",
  "refresh_tokens",
  "users",
] as const;

/** Timestamp relative to now: positive values are in the past, negative values in the future. */
function ago(hours: number): Date {
  return new Date(Date.now() - hours * HOUR_MS);
}
const days = (value: number) => value * 24;
const mins = (value: number) => value / 60;

function must<T>(value: T | undefined, label: string): T {
  if (!value) throw new Error(`Seed failed: ${label} was not created`);
  return value;
}

/** Small deterministic generator (mulberry32) so the synthetic history is identical on every run. */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface HistoryProfile {
  /** Time between synthetic checks. */
  stepMs: number;
  /** Typical successful response time. */
  baseMs: number;
  jitterMs: number;
  statusCode: number | null;
  /** Occasional latency spikes. */
  spike?: { chance: number; minMs: number; maxMs: number };
  /** Failed checks from `fromHoursAgo` until `toHoursAgo`; a large negative end keeps the outage ongoing. */
  outage?: { fromHoursAgo: number; toHoursAgo: number; error: string; timedOut?: boolean };
}

/**
 * Builds synthetic check results for one target using the same state machine as the worker:
 * success is healthy unless slower than the degraded threshold, and failures become unavailable
 * once they reach the failure threshold.
 */
function syntheticHistory(
  target: TargetRow,
  profile: HistoryProfile,
  seed: number,
): { rows: ResultInsert[]; trailingFailures: number } {
  const rand = prng(seed);
  const between = (min: number, max: number) => Math.round(min + rand() * (max - min));
  const now = Date.now();
  const end = now - 5 * MINUTE_MS;
  // Start just inside the retention window so the first pruning pass does not discard the oldest day.
  const start = end - HISTORY_DAYS * DAY_MS + HOUR_MS;
  const rows: ResultInsert[] = [];
  let consecutiveFailures = 0;

  for (let at = start; at <= end; at += profile.stepMs) {
    const hoursAgo = (now - at) / HOUR_MS;
    const outage = profile.outage;
    if (outage && hoursAgo <= outage.fromHoursAgo && hoursAgo >= outage.toHoursAgo) {
      consecutiveFailures += 1;
      rows.push({
        targetId: target.id,
        checkedAt: new Date(at),
        success: false,
        state: consecutiveFailures >= FAILURE_THRESHOLD ? "unavailable" : "degraded",
        responseTimeMs: outage.timedOut ? target.timeoutMs : between(20, 120),
        statusCode: null,
        errorMessage: outage.error,
      });
      continue;
    }
    consecutiveFailures = 0;
    let responseMs = between(profile.baseMs - profile.jitterMs, profile.baseMs + profile.jitterMs);
    if (profile.spike && rand() < profile.spike.chance) {
      responseMs = between(profile.spike.minMs, profile.spike.maxMs);
    }
    rows.push({
      targetId: target.id,
      checkedAt: new Date(at),
      success: true,
      state: responseMs > target.degradedThresholdMs ? "degraded" : "healthy",
      responseTimeMs: responseMs,
      statusCode: profile.statusCode,
      errorMessage: null,
    });
  }
  return { rows, trailingFailures: consecutiveFailures };
}

async function main(): Promise<void> {
  if (process.env.SEED_RESET === "true") {
    await db.execute(
      sql`truncate table ${sql.join(SEED_TABLES.map((name) => sql.raw(name)), sql`, `)} restart identity cascade`,
    );
    console.log("SEED_RESET=true: existing InfraPilot data removed.");
  }

  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(users);
  if (total > 0) {
    console.log("Seed skipped: users already exist. Set SEED_RESET=true to rebuild the demo workspace.");
    return;
  }

  const generated = !process.env.SEED_PASSWORD;
  const password = process.env.SEED_PASSWORD ?? `${randomBytes(12).toString("base64url")}Aa1`;
  const passwordHash = await hashPassword(password);

  // ---------- users ----------
  const userRows = await db
    .insert(users)
    .values([
      { email: "admin@infrapilot.local", name: "Ada Admin", passwordHash, role: "admin", lastLoginAt: ago(2), createdAt: ago(days(120)), updatedAt: ago(2) },
      { email: "operator@infrapilot.local", name: "Olu Operator", passwordHash, role: "operator", lastLoginAt: ago(5), createdAt: ago(days(110)), updatedAt: ago(5) },
      { email: "viewer@infrapilot.local", name: "Vera Viewer", passwordHash, role: "viewer", lastLoginAt: ago(30), createdAt: ago(days(105)), updatedAt: ago(30) },
    ])
    .returning();
  const admin = must(userRows.find((u) => u.email === "admin@infrapilot.local"), "administrator");
  const operator = must(userRows.find((u) => u.email === "operator@infrapilot.local"), "operator");
  must(userRows.find((u) => u.email === "viewer@infrapilot.local"), "viewer");

  // ---------- assets ----------
  const assetRows = await db
    .insert(assets)
    .values([
      { name: "web-prod-01", assetType: "virtual_machine", hostname: "web-prod-01.internal", ipAddress: "10.20.0.11", operatingSystem: "Ubuntu 24.04 LTS", environment: "production", location: "eu-west-1a", ownerId: operator.id, description: "Customer-facing web tier", status: "healthy", createdById: admin.id, createdAt: ago(days(120)), updatedAt: ago(days(6)) },
      { name: "web-prod-02", assetType: "virtual_machine", hostname: "web-prod-02.internal", ipAddress: "10.20.0.12", operatingSystem: "Ubuntu 24.04 LTS", environment: "production", location: "eu-west-1b", ownerId: operator.id, description: "Second web tier node behind the load balancer", status: "healthy", createdById: admin.id, createdAt: ago(days(120)), updatedAt: ago(days(6)) },
      { name: "api-gateway", assetType: "application", hostname: "api.internal", ipAddress: "10.20.0.31", operatingSystem: "Debian 12 (containerised)", environment: "production", location: "eu-west-1a", ownerId: operator.id, description: "Public API gateway", status: "degraded", createdById: admin.id, createdAt: ago(days(96)), updatedAt: ago(5) },
      { name: "orders-db", assetType: "database", hostname: "orders-db.internal", ipAddress: "10.20.0.21", operatingSystem: "Debian 12 / PostgreSQL 16", environment: "production", location: "eu-west-1b", ownerId: admin.id, description: "PostgreSQL 16 primary for orders", status: "healthy", createdById: admin.id, createdAt: ago(days(120)), updatedAt: ago(days(9)) },
      { name: "cache-redis-01", assetType: "database", hostname: "cache-redis-01.internal", ipAddress: "10.20.0.22", operatingSystem: "Redis 7.2 on Ubuntu 22.04", environment: "production", location: "eu-west-1a", ownerId: operator.id, description: "Session and hot-key cache", status: "healthy", createdById: admin.id, createdAt: ago(days(88)), updatedAt: ago(days(12)) },
      { name: "core-switch-a", assetType: "network_device", hostname: "core-sw-a", ipAddress: "10.20.0.1", operatingSystem: "IOS-XE 17", environment: "production", location: "DC1 Rack A3", ownerId: operator.id, description: "Core distribution switch", status: "healthy", createdById: admin.id, createdAt: ago(days(150)), updatedAt: ago(days(61)) },
      { name: "edge-firewall", assetType: "network_device", hostname: "fw-edge-01", ipAddress: "10.20.0.254", operatingSystem: "PAN-OS 10.2", environment: "production", location: "DC1 Rack A1", ownerId: admin.id, description: "Perimeter firewall pair (active node)", status: "healthy", createdById: admin.id, createdAt: ago(days(150)), updatedAt: ago(days(8)) },
      { name: "backup-nas", assetType: "physical_server", hostname: "backup-nas", ipAddress: "10.20.0.40", operatingSystem: "TrueNAS SCALE", environment: "production", location: "DC1 Rack B2", ownerId: admin.id, description: "Primary backup repository", status: "maintenance", createdById: admin.id, createdAt: ago(days(140)), updatedAt: ago(mins(40)) },
      { name: "legacy-ftp", assetType: "virtual_machine", hostname: "legacy-ftp.internal", ipAddress: "10.20.1.15", operatingSystem: "Ubuntu 18.04 LTS (end of life)", environment: "development", location: "On-prem rack 4", ownerId: operator.id, description: "Legacy file transfer server pending decommission", status: "unavailable", createdById: admin.id, createdAt: ago(days(400)), updatedAt: ago(16) },
      { name: "k8s-staging", assetType: "container", operatingSystem: "Kubernetes 1.29", environment: "testing", location: "eu-central-1", ownerId: operator.id, description: "Staging Kubernetes cluster", status: "healthy", createdById: admin.id, createdAt: ago(days(70)), updatedAt: ago(days(19)) },
      { name: "s3-exports", assetType: "cloud_resource", environment: "production", location: "eu-west-1", ownerId: admin.id, description: "Nightly export bucket", status: "healthy", createdById: admin.id, createdAt: ago(days(64)), updatedAt: ago(days(5)) },
      { name: "dev-sandbox-01", assetType: "virtual_machine", hostname: "dev-sandbox-01.internal", ipAddress: "10.30.0.9", operatingSystem: "Ubuntu 22.04 LTS", environment: "development", location: "eu-central-1", ownerId: admin.id, description: "Developer sandbox (not monitored)", status: "unknown", createdById: admin.id, createdAt: ago(days(30)), updatedAt: ago(days(30)) },
      { name: "decommissioned-web-03", assetType: "virtual_machine", hostname: "web-prod-03.internal", ipAddress: "10.20.0.13", operatingSystem: "Ubuntu 20.04 LTS", environment: "production", location: "eu-west-1c", ownerId: admin.id, description: "Retired web node, replaced by web-prod-02", status: "healthy", createdById: admin.id, createdAt: ago(days(200)), updatedAt: ago(days(12)), archivedAt: ago(days(12)) },
    ])
    .returning();
  const asset = (name: string): AssetRow => must(assetRows.find((a) => a.name === name), `asset ${name}`);

  // ---------- monitoring targets ----------
  const targetRows = await db
    .insert(monitoringTargets)
    .values([
      { name: "Public website (HTTPS)", monitorType: "http", url: "https://www.iana.org/", host: "www.iana.org", intervalSeconds: 60, timeoutMs: 5000, degradedThresholdMs: 1500, enabled: true, assetId: asset("web-prod-01").id, status: "healthy", createdById: admin.id, createdAt: ago(days(118)), updatedAt: ago(1) },
      { name: "Customer portal (HTTPS)", monitorType: "http", url: "https://example.com/", host: "example.com", intervalSeconds: 60, timeoutMs: 5000, degradedThresholdMs: 50, enabled: true, assetId: asset("api-gateway").id, status: "degraded", createdById: admin.id, createdAt: ago(days(94)), updatedAt: ago(1) },
      { name: "Public DNS resolver (TCP 53)", monitorType: "tcp", host: "1.1.1.1", port: 53, intervalSeconds: 120, timeoutMs: 3000, degradedThresholdMs: 500, enabled: true, assetId: asset("core-switch-a").id, status: "healthy", createdById: admin.id, createdAt: ago(days(149)), updatedAt: ago(1) },
      { name: "Firewall egress test (TCP 443)", monitorType: "tcp", host: "www.iana.org", port: 443, intervalSeconds: 120, timeoutMs: 3000, degradedThresholdMs: 500, enabled: true, assetId: asset("edge-firewall").id, status: "healthy", createdById: admin.id, createdAt: ago(days(149)), updatedAt: ago(1) },
      { name: "Legacy FTP server (TCP 21)", monitorType: "tcp", host: "legacy-ftp.invalid", port: 21, intervalSeconds: 300, timeoutMs: 3000, degradedThresholdMs: 500, enabled: true, assetId: asset("legacy-ftp").id, status: "unavailable", createdById: admin.id, createdAt: ago(days(60)), updatedAt: ago(16) },
      // Paused while the backup repository is under maintenance.
      { name: "Backup repository (HTTPS)", monitorType: "http", url: "https://www.iana.org/help", host: "www.iana.org", intervalSeconds: 300, timeoutMs: 5000, degradedThresholdMs: 1000, enabled: false, assetId: asset("backup-nas").id, status: "unknown", createdById: admin.id, createdAt: ago(days(30)), updatedAt: ago(days(3)) },
    ])
    .returning();
  const target = (name: string): TargetRow => must(targetRows.find((t) => t.name === name), `monitoring target ${name}`);
  // When seeding against a running instance, keep the live worker off the new checks until the history is in place.
  await db
    .update(monitoringTargets)
    .set({ nextCheckAt: new Date(Date.now() + 2 * MINUTE_MS) })
    .where(inArray(monitoringTargets.id, targetRows.map((t) => t.id)));

  // ---------- synthetic 30-day monitoring history ----------
  const history: Array<{ target: TargetRow; profile: HistoryProfile }> = [
    {
      target: target("Public website (HTTPS)"),
      profile: {
        stepMs: 5 * MINUTE_MS,
        baseMs: 260,
        jitterMs: 170,
        statusCode: 200,
        spike: { chance: 0.015, minMs: 1600, maxMs: 2600 },
        outage: { fromHoursAgo: 50, toHoursAgo: 49.5, error: "Timed out", timedOut: true },
      },
    },
    {
      // Always slower than its 50 ms threshold: a persistent "degraded" service.
      target: target("Customer portal (HTTPS)"),
      profile: { stepMs: 5 * MINUTE_MS, baseMs: 420, jitterMs: 240, statusCode: 200 },
    },
    {
      target: target("Public DNS resolver (TCP 53)"),
      profile: {
        stepMs: 5 * MINUTE_MS,
        baseMs: 24,
        jitterMs: 16,
        statusCode: null,
        spike: { chance: 0.01, minMs: 900, maxMs: 1800 },
        outage: { fromHoursAgo: 73, toHoursAgo: 72.67, error: "Connection refused" },
      },
    },
    {
      target: target("Firewall egress test (TCP 443)"),
      profile: {
        stepMs: 5 * MINUTE_MS,
        baseMs: 46,
        jitterMs: 30,
        statusCode: null,
        outage: { fromHoursAgo: 240.75, toHoursAgo: 240, error: "Timed out", timedOut: true },
      },
    },
    {
      target: target("Legacy FTP server (TCP 21)"),
      profile: {
        stepMs: 5 * MINUTE_MS,
        baseMs: 38,
        jitterMs: 20,
        statusCode: null,
        // Down for the last six and a half days and still down.
        outage: { fromHoursAgo: 158, toHoursAgo: -1_000_000, error: "Host could not be resolved" },
      },
    },
  ];

  let historyRows = 0;
  for (const [index, entry] of history.entries()) {
    const { rows, trailingFailures } = syntheticHistory(entry.target, entry.profile, 421 + index);
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      await db.insert(monitoringResults).values(rows.slice(i, i + INSERT_CHUNK));
    }
    historyRows += rows.length;
    // Align the target's current state with the most recent synthetic check.
    const latest = must(rows[rows.length - 1], "history row");
    await db
      .update(monitoringTargets)
      .set({
        status: latest.state,
        consecutiveFailures: trailingFailures,
        lastCheckedAt: latest.checkedAt,
        lastResponseMs: latest.responseTimeMs,
        lastError: latest.errorMessage,
      })
      .where(eq(monitoringTargets.id, entry.target.id));
  }

  // The checks and their history are consistent now: hand them to the live worker.
  await db.update(monitoringTargets).set({ nextCheckAt: new Date() }).where(inArray(monitoringTargets.id, targetRows.map((t) => t.id)));

  // ---------- security findings ----------
  const findingRows = await db
    .insert(securityFindings)
    .values([
      { title: "Default HTTP TRACE method enabled", description: "The web tier answers TRACE requests, which can help map internal proxies.", severity: "low", status: "resolved", assetId: asset("web-prod-01").id, assigneeId: operator.id, remediation: "Disable TraceEnable in the web server configuration.", createdById: admin.id, createdAt: ago(days(40)), updatedAt: ago(days(30)), resolvedAt: ago(days(30)) },
      { title: "Self-signed certificate on internal backup endpoint", description: "The backup API presents a self-signed certificate.", severity: "medium", status: "accepted_risk", assetId: asset("backup-nas").id, assigneeId: admin.id, remediation: "Issue the certificate from the internal CA.", createdById: admin.id, createdAt: ago(days(25)), updatedAt: ago(days(13)) },
      { title: "Outdated OpenSSH on switch management plane", description: "Management SSH banner reports a version with known advisories.", severity: "medium", status: "in_progress", assetId: asset("core-switch-a").id, assigneeId: operator.id, remediation: "Upgrade firmware in the next maintenance window.", createdById: admin.id, createdAt: ago(days(21)), updatedAt: ago(days(6)) },
      { title: "Weak SSH cipher suites on legacy hosts", description: "Legacy hosts still offer CBC-mode ciphers and SHA-1 based key exchange.", severity: "medium", status: "open", assetId: asset("legacy-ftp").id, assigneeId: operator.id, remediation: "Remove weak ciphers from sshd_config and redeploy.", createdById: admin.id, createdAt: ago(days(18)) },
      { title: "Container running as root in staging cluster", description: "Several staging workloads run with a root security context.", severity: "medium", status: "resolved", assetId: asset("k8s-staging").id, assigneeId: operator.id, remediation: "Enforce a non-root user with a pod security context.", createdById: admin.id, createdAt: ago(days(16)), updatedAt: ago(days(5)), resolvedAt: ago(days(5)) },
      { title: "Unauthenticated Redis instance exposed", description: "The cache listener accepted connections without authentication from the application subnet.", severity: "critical", status: "resolved", assetId: asset("cache-redis-01").id, assigneeId: operator.id, remediation: "Require a password and bind to the private interface only.", cveId: "CVE-2025-09412", createdById: admin.id, createdAt: ago(days(8)), updatedAt: ago(days(2)), resolvedAt: ago(days(2)) },
      { title: "Export bucket permits public read", description: "Nightly export objects are readable by anonymous requests.", severity: "high", status: "open", assetId: asset("s3-exports").id, assigneeId: admin.id, remediation: "Disable public access and review the bucket policy.", createdById: admin.id, createdAt: ago(days(5)) },
      { title: "Verbose error messages expose stack traces", description: "API error responses include framework stack traces.", severity: "low", status: "open", assetId: asset("web-prod-02").id, remediation: "Return a generic error body and log details server side.", createdById: operator.id, createdAt: ago(days(4)) },
      { title: "TLS 1.0 enabled on load balancer", description: "The public listener accepts TLS 1.0 handshakes.", severity: "high", status: "open", assetId: asset("web-prod-01").id, assigneeId: operator.id, remediation: "Disable TLS 1.0 and 1.1 and enforce TLS 1.2+.", createdById: admin.id, createdAt: ago(days(14)) },
      { title: "Remote code execution in image processing library", description: "The gateway bundles an image processing library with a public exploit. Uploads reach the vulnerable code path.", severity: "critical", status: "in_progress", assetId: asset("api-gateway").id, assigneeId: operator.id, remediation: "Upgrade to the patched release and rebuild the gateway image.", cveId: "CVE-2025-17123", createdById: admin.id, createdAt: ago(74), updatedAt: ago(20) },
      { title: "Security headers missing on staging", description: "Staging responses omit Strict-Transport-Security and Content-Security-Policy.", severity: "informational", status: "open", assetId: asset("k8s-staging").id, remediation: "Add the headers at the ingress.", createdById: operator.id, createdAt: ago(days(2)) },
      { title: "Database superuser used by application", description: "The orders service connects with the superuser role.", severity: "critical", status: "open", assetId: asset("orders-db").id, assigneeId: admin.id, remediation: "Create a least-privilege application role.", createdById: admin.id, createdAt: ago(days(9)) },
    ])
    .returning();
  const finding = (title: string): FindingRow => must(findingRows.find((f) => f.title === title), `finding ${title}`);

  await db.insert(findingEvents).values([
    { findingId: finding("Default HTTP TRACE method enabled").id, actorId: operator.id, fromStatus: "open", toStatus: "resolved", note: "Trace disabled in the web server configuration.", createdAt: ago(days(30)) },
    { findingId: finding("Self-signed certificate on internal backup endpoint").id, actorId: admin.id, fromStatus: "open", toStatus: "accepted_risk", note: "Endpoint is reachable from the backup VLAN only. Revisit at the next certificate rotation.", createdAt: ago(days(13)) },
    { findingId: finding("Container running as root in staging cluster").id, actorId: operator.id, fromStatus: "open", toStatus: "in_progress", note: "Identified three workloads without a security context.", createdAt: ago(days(12)) },
    { findingId: finding("Container running as root in staging cluster").id, actorId: operator.id, fromStatus: "in_progress", toStatus: "resolved", note: "Pod security context now enforces a non-root user.", createdAt: ago(days(5)) },
    { findingId: finding("Outdated OpenSSH on switch management plane").id, actorId: operator.id, fromStatus: "open", toStatus: "in_progress", note: "Firmware upgrade scheduled with the next maintenance window.", createdAt: ago(days(6)) },
    { findingId: finding("Unauthenticated Redis instance exposed").id, actorId: operator.id, fromStatus: "open", toStatus: "in_progress", note: "Access restricted to the application subnet while the fix is prepared.", createdAt: ago(days(2) + 3) },
    { findingId: finding("Unauthenticated Redis instance exposed").id, actorId: admin.id, fromStatus: "in_progress", toStatus: "resolved", note: "Authentication enforced and listener rebound. Verified with an external scan.", createdAt: ago(days(2)) },
    { findingId: finding("Remote code execution in image processing library").id, actorId: operator.id, fromStatus: "open", toStatus: "in_progress", note: "Investigation started; patched image is building.", createdAt: ago(20) },
  ]);

  // ---------- incidents (oldest first so reference numbers follow the timeline) ----------
  interface IncidentSpec {
    title: string;
    description: string;
    severity: "critical" | "high" | "medium" | "low";
    priority: "p1" | "p2" | "p3" | "p4";
    status: "open" | "investigating" | "in_progress" | "resolved" | "closed";
    assigneeId: string | null;
    openedHoursAgo: number;
    durationMinutes?: number;
    closedAfterHours?: number;
    rootCause?: string;
    resolution?: string;
    assetNames: string[];
    /** Minutes after the incident was opened. `by` is relative to the incident. */
    comments: Array<{ atMin: number; kind: "comment" | "system"; by: "reporter" | "assignee" | null; body: string }>;
  }

  const statusLine = (from: string, to: string) => `Status changed from ${from} to ${to}`;
  const incidentSpecs: IncidentSpec[] = [
    {
      title: "Certificate expired on partner endpoint",
      description: "The partner API rejected calls because the client certificate had expired at midnight.",
      severity: "low",
      priority: "p4",
      status: "resolved",
      assigneeId: operator.id,
      openedHoursAgo: days(75),
      durationMinutes: 25,
      resolution: "Renewed the client certificate and rotated it in the secrets store.",
      assetNames: ["web-prod-01"],
      comments: [
        { atMin: 0, kind: "system", by: "reporter", body: "Incident opened by Ada Admin (Low severity, P4)" },
        { atMin: 5, kind: "system", by: null, body: statusLine("Open", "Investigating") },
        { atMin: 25, kind: "comment", by: "assignee", body: "Certificate renewed; the partner confirmed calls are succeeding again." },
      ],
    },
    {
      title: "Packet loss on core uplink",
      description: "Intermittent packet loss between rack A and the edge affected all production traffic.",
      severity: "high",
      priority: "p2",
      status: "closed",
      assigneeId: operator.id,
      openedHoursAgo: days(61),
      durationMinutes: 140,
      closedAfterHours: 30,
      rootCause: "A faulty optic on uplink 1 caused intermittent frame loss.",
      resolution: "Optic replaced and traffic re-routed; loss is back under 0.01%.",
      assetNames: ["core-switch-a"],
      comments: [
        { atMin: 0, kind: "system", by: "reporter", body: "Incident opened by Ada Admin (High severity, P2)" },
        { atMin: 4, kind: "comment", by: "assignee", body: "Seeing 4% packet loss between rack A and the edge." },
        { atMin: 12, kind: "system", by: null, body: statusLine("Open", "Investigating") },
        { atMin: 45, kind: "system", by: null, body: statusLine("Investigating", "In progress") },
        { atMin: 140, kind: "system", by: null, body: statusLine("In progress", "Resolved") },
        { atMin: 1800, kind: "system", by: null, body: statusLine("Resolved", "Closed") },
      ],
    },
    {
      title: "Storage latency spike on backup NAS",
      description: "Read latency on the backup volume rose to several seconds during the nightly job.",
      severity: "medium",
      priority: "p3",
      status: "closed",
      assigneeId: admin.id,
      openedHoursAgo: days(34),
      durationMinutes: 330,
      closedAfterHours: 26,
      rootCause: "A scrub ran at the same time as the nightly backup.",
      resolution: "Moved the scrub to the weekend and throttled the backup job.",
      assetNames: ["backup-nas"],
      comments: [
        { atMin: 0, kind: "system", by: "reporter", body: "Incident opened by Ada Admin (Medium severity, P3)" },
        { atMin: 330, kind: "comment", by: "assignee", body: "Scrub rescheduled; latency is back to normal." },
        { atMin: 1560, kind: "system", by: null, body: statusLine("Resolved", "Closed") },
      ],
    },
    {
      title: "DNS resolution failures in staging",
      description: "Staging workloads intermittently failed to resolve external host names.",
      severity: "medium",
      priority: "p3",
      status: "resolved",
      assigneeId: operator.id,
      openedHoursAgo: days(19),
      durationMinutes: 125,
      resolution: "Increased the CoreDNS cache TTL and raised the replica count.",
      assetNames: ["k8s-staging"],
      comments: [
        { atMin: 0, kind: "system", by: "reporter", body: "Incident opened by Ada Admin (Medium severity, P3)" },
        { atMin: 30, kind: "comment", by: "assignee", body: "CoreDNS pods are saturating under load. Scaling out." },
        { atMin: 125, kind: "comment", by: "assignee", body: "Resolution is stable for an hour. Closing out." },
      ],
    },
    {
      title: "Redis cache eviction storm",
      description: "A burst of evictions pushed load to the primary database and raised API latency.",
      severity: "high",
      priority: "p2",
      status: "resolved",
      assigneeId: operator.id,
      openedHoursAgo: days(12),
      durationMinutes: 220,
      rootCause: "A deployment doubled the size of cached session payloads.",
      resolution: "Reverted the session payload format and raised the maxmemory policy limit.",
      assetNames: ["cache-redis-01", "api-gateway"],
      comments: [
        { atMin: 0, kind: "system", by: "reporter", body: "Incident opened by Ada Admin (High severity, P2)" },
        { atMin: 20, kind: "comment", by: "assignee", body: "Eviction rate is 40x the baseline since the last deploy." },
        { atMin: 220, kind: "system", by: null, body: statusLine("Investigating", "Resolved") },
      ],
    },
    {
      title: "Checkout returning 5xx errors",
      description: "The checkout endpoint returned HTTP 503 for roughly one in seven requests.",
      severity: "critical",
      priority: "p1",
      status: "resolved",
      assigneeId: operator.id,
      openedHoursAgo: days(6),
      durationMinutes: 70,
      rootCause: "A release exhausted the database connection pool.",
      resolution: "Rolled back the release and raised the pool limit.",
      assetNames: ["web-prod-01", "web-prod-02", "orders-db"],
      comments: [
        { atMin: 0, kind: "system", by: "reporter", body: "Incident opened by Ada Admin (Critical severity, P1)" },
        { atMin: 3, kind: "system", by: null, body: statusLine("Open", "Investigating") },
        { atMin: 12, kind: "comment", by: "assignee", body: "Error rate is 14% on /checkout. web-prod-02 was patched fifteen minutes ago." },
        { atMin: 18, kind: "system", by: null, body: statusLine("Investigating", "In progress") },
        { atMin: 40, kind: "comment", by: "reporter", body: "Rolled back the release on web-prod-02." },
        { atMin: 70, kind: "system", by: null, body: statusLine("In progress", "Resolved") },
      ],
    },
    {
      title: "Elevated checkout latency",
      description: "p95 latency on checkout exceeded 2 seconds for 15 minutes.",
      severity: "high",
      priority: "p2",
      status: "investigating",
      assigneeId: operator.id,
      openedHoursAgo: days(2),
      assetNames: ["web-prod-01", "orders-db"],
      comments: [
        { atMin: 0, kind: "system", by: "reporter", body: "Incident opened by Ada Admin (High severity, P2)" },
        { atMin: 25, kind: "comment", by: "assignee", body: "Connection pool saturation suspected on orders-db." },
      ],
    },
    {
      title: "Legacy FTP server unreachable",
      description: "The monitoring check for the legacy file transfer server started failing.",
      severity: "medium",
      priority: "p3",
      status: "investigating",
      assigneeId: operator.id,
      openedHoursAgo: 16,
      assetNames: ["legacy-ftp"],
      comments: [
        { atMin: 0, kind: "system", by: "reporter", body: "Incident opened by Ada Admin (Medium severity, P3)" },
        { atMin: 40, kind: "comment", by: "assignee", body: "Host does not resolve. Confirming whether the server was already retired." },
      ],
    },
    {
      title: "Customer portal slow response times",
      description: "The customer portal health check is consistently slower than its latency threshold.",
      severity: "low",
      priority: "p4",
      status: "open",
      assigneeId: null,
      openedHoursAgo: 5,
      assetNames: ["api-gateway"],
      comments: [{ atMin: 0, kind: "system", by: "reporter", body: "Incident opened by Ada Admin (Low severity, P4)" }],
    },
  ];

  const incidentRows: IncidentRow[] = [];
  for (const spec of incidentSpecs) {
    const openedAt = ago(spec.openedHoursAgo);
    const [row] = await db
      .insert(incidents)
      .values({
        title: spec.title,
        description: spec.description,
        severity: spec.severity,
        priority: spec.priority,
        status: spec.status,
        assigneeId: spec.assigneeId,
        reporterId: admin.id,
        rootCause: spec.rootCause ?? null,
        resolution: spec.resolution ?? null,
        openedAt,
        resolvedAt: spec.durationMinutes ? new Date(openedAt.getTime() + spec.durationMinutes * MINUTE_MS) : null,
        closedAt: spec.closedAfterHours ? ago(spec.openedHoursAgo - spec.closedAfterHours) : null,
        createdAt: openedAt,
        updatedAt: spec.closedAfterHours ? ago(spec.openedHoursAgo - spec.closedAfterHours) : spec.durationMinutes ? new Date(openedAt.getTime() + spec.durationMinutes * MINUTE_MS) : openedAt,
      })
      .returning();
    incidentRows.push(must(row, `incident ${spec.title}`));
  }
  const incident = (title: string): IncidentRow => must(incidentRows.find((i) => i.title === title), `incident ${title}`);

  await db
    .insert(incidentAssets)
    .values(incidentSpecs.flatMap((spec) => spec.assetNames.map((assetName) => ({ incidentId: incident(spec.title).id, assetId: asset(assetName).id }))));
  const commentRows: CommentInsert[] = incidentSpecs.flatMap((spec) =>
    spec.comments.map((comment) => ({
      incidentId: incident(spec.title).id,
      authorId: comment.by === "reporter" ? admin.id : comment.by === "assignee" ? spec.assigneeId : null,
      kind: comment.kind,
      body: comment.body,
      createdAt: new Date(incident(spec.title).openedAt.getTime() + comment.atMin * MINUTE_MS),
    })),
  );
  await db.insert(incidentComments).values(commentRows);

  // ---------- maintenance windows ----------
  const tlsStart = ago(-20);
  const backupStart = ago(mins(40));
  const maintenanceRows = await db
    .insert(maintenances)
    .values([
      { title: "Firewall rule review", description: "Quarterly review of perimeter rules with the network team.", status: "cancelled", startsAt: ago(days(7.5)), endsAt: ago(days(7.5) - 2), ownerId: admin.id, createdById: admin.id, notes: "Cancelled: the supporting change request was rejected.", createdAt: ago(days(20)), updatedAt: ago(days(8)) },
      { title: "Redis cluster failover drill", description: "Force a failover to the replica and measure the interruption.", status: "completed", startsAt: ago(days(4)), endsAt: ago(days(4) - 1), ownerId: operator.id, createdById: admin.id, notes: "Failover completed in 41 seconds. Runbook updated.", createdAt: ago(days(10)), updatedAt: ago(days(4) - 1) },
      { title: "Backup NAS firmware update", description: "Apply the storage controller firmware update and verify the backup volume.", status: "in_progress", startsAt: backupStart, endsAt: ago(-80 / 60), ownerId: admin.id, createdById: admin.id, createdAt: ago(days(3)), updatedAt: backupStart },
      { title: "Replace TLS certificates on web tier", description: "Install the renewed wildcard certificate on both web nodes.", status: "scheduled", startsAt: tlsStart, endsAt: ago(-22), ownerId: operator.id, createdById: admin.id, createdAt: ago(days(2)), updatedAt: ago(days(2)) },
      { title: "Orders database minor upgrade", description: "Apply PostgreSQL minor version update and restart the primary.", status: "scheduled", startsAt: ago(-72), endsAt: ago(-74), ownerId: operator.id, createdById: admin.id, createdAt: ago(days(5)), updatedAt: ago(days(5)) },
      { title: "Core switch A OS upgrade", description: "Upgrade the core switch to the recommended IOS-XE release.", status: "scheduled", startsAt: ago(-144), endsAt: ago(-145.5), ownerId: operator.id, createdById: admin.id, createdAt: ago(days(6)), updatedAt: ago(days(6)) },
      { title: "Legacy FTP decommission", description: "Archive remaining files and power the server down.", status: "scheduled", startsAt: ago(-288), endsAt: ago(-291), ownerId: operator.id, createdById: admin.id, createdAt: ago(days(1)), updatedAt: ago(days(1)) },
    ])
    .returning();
  const maintenance = (title: string) => must(maintenanceRows.find((m) => m.title === title), `maintenance ${title}`);
  await db.insert(maintenanceAssets).values([
    { maintenanceId: maintenance("Firewall rule review").id, assetId: asset("edge-firewall").id },
    { maintenanceId: maintenance("Redis cluster failover drill").id, assetId: asset("cache-redis-01").id },
    { maintenanceId: maintenance("Backup NAS firmware update").id, assetId: asset("backup-nas").id },
    { maintenanceId: maintenance("Replace TLS certificates on web tier").id, assetId: asset("web-prod-01").id },
    { maintenanceId: maintenance("Replace TLS certificates on web tier").id, assetId: asset("web-prod-02").id },
    { maintenanceId: maintenance("Orders database minor upgrade").id, assetId: asset("orders-db").id },
    { maintenanceId: maintenance("Core switch A OS upgrade").id, assetId: asset("core-switch-a").id },
    { maintenanceId: maintenance("Legacy FTP decommission").id, assetId: asset("legacy-ftp").id },
  ]);

  // ---------- change requests (oldest first so reference numbers follow the timeline) ----------
  interface ChangeSpec {
    title: string;
    description: string;
    reason: string;
    riskLevel: "low" | "medium" | "high";
    status: "draft" | "pending_approval" | "approved" | "rejected" | "implemented" | "rolled_back" | "cancelled";
    createdHoursAgo: number;
    updatedHoursAgo: number;
    plannedStartHoursAgo?: number;
    plannedEndHoursAgo?: number;
    riskAssessment?: string;
    rollbackPlan?: string;
    implementationNotes?: string;
    rollbackNotes?: string;
    implementedHoursAgo?: number;
    assetNames: string[];
    decisions: Array<{ decision: "approved" | "rejected"; comment: string | null; hoursAgo: number }>;
  }

  const changeSpecs: ChangeSpec[] = [
    {
      title: "Open temporary firewall port for vendor access",
      description: "Allow a vendor support appliance to reach the staging network on a fixed port for two weeks.",
      reason: "The vendor needs access to finish a support engagement.",
      riskLevel: "low",
      status: "rejected",
      createdHoursAgo: days(22),
      updatedHoursAgo: days(21.5),
      riskAssessment: "Exposes one staging host to a single external address.",
      rollbackPlan: "Remove the firewall rule.",
      assetNames: ["edge-firewall"],
      decisions: [{ decision: "rejected", comment: "Vendor access will go through the VPN concentrator instead of a firewall exception.", hoursAgo: days(21.5) }],
    },
    {
      title: "Replace core uplink optics",
      description: "Swap the uplink 1 optic on the core switch for a replacement unit.",
      reason: "Error counters on uplink 1 keep rising.",
      riskLevel: "medium",
      status: "rolled_back",
      createdHoursAgo: days(20),
      updatedHoursAgo: days(18) - 5,
      plannedStartHoursAgo: days(18),
      plannedEndHoursAgo: days(18) - 2,
      riskAssessment: "Brief interruption on uplink 1 while the optic is swapped.",
      rollbackPlan: "Re-insert the original optic and revert the port configuration.",
      implementationNotes: "Optic replaced; the link came up at 40G but error counters kept rising.",
      rollbackNotes: "Rolled back to the original optic; errors stopped. Replacement returned to the vendor.",
      implementedHoursAgo: days(18),
      assetNames: ["core-switch-a"],
      decisions: [{ decision: "approved", comment: null, hoursAgo: days(19.5) }],
    },
    {
      title: "Deploy orders service 2.14.0",
      description: "Release orders service 2.14.0 to both web nodes.",
      reason: "Includes the connection pool fix and the new export endpoint.",
      riskLevel: "low",
      status: "implemented",
      createdHoursAgo: days(9),
      updatedHoursAgo: days(3),
      plannedStartHoursAgo: days(3),
      plannedEndHoursAgo: days(3) - 1,
      riskAssessment: "Standard rolling deploy with health checks.",
      rollbackPlan: "Redeploy 2.13.9 from the artifact store.",
      implementationNotes: "Deployed to both web nodes. Error rate flat for 24 hours.",
      implementedHoursAgo: days(3),
      assetNames: ["web-prod-01", "web-prod-02"],
      decisions: [{ decision: "approved", comment: "Proceed after the staging soak.", hoursAgo: days(8.5) }],
    },
    {
      title: "Upgrade monitoring agents to 3.2",
      description: "Roll out monitoring agent 3.2 to all production hosts.",
      reason: "Pick up the fixed memory leak in the log tailer.",
      riskLevel: "low",
      status: "cancelled",
      createdHoursAgo: days(5),
      updatedHoursAgo: days(4),
      assetNames: [],
      decisions: [],
    },
    {
      title: "Enable TLS 1.3 only on public load balancer",
      description: "Remove TLS 1.2 support from the public listener.",
      reason: "Security finding: weak protocol versions should not be offered.",
      riskLevel: "medium",
      status: "approved",
      createdHoursAgo: days(4),
      updatedHoursAgo: days(3),
      plannedStartHoursAgo: -24,
      plannedEndHoursAgo: -25,
      riskAssessment: "A small share of older clients cannot negotiate TLS 1.3.",
      rollbackPlan: "Re-enable TLS 1.2 in the listener policy.",
      assetNames: ["web-prod-01"],
      decisions: [{ decision: "approved", comment: "Agreed. Announce it on the status page.", hoursAgo: days(3) }],
    },
    {
      title: "Rotate TLS certificates on web tier",
      description: "Replace the wildcard certificate on the public load balancer.",
      reason: "Current certificate expires in 21 days.",
      riskLevel: "medium",
      status: "pending_approval",
      createdHoursAgo: days(2),
      updatedHoursAgo: 24,
      plannedStartHoursAgo: -20,
      plannedEndHoursAgo: -22,
      riskAssessment: "Brief connection resets possible during reload.",
      rollbackPlan: "Re-attach previous certificate bundle from the secrets store.",
      assetNames: ["web-prod-01", "web-prod-02"],
      decisions: [],
    },
    {
      title: "Upgrade Redis to 7.4",
      description: "Upgrade the cache cluster to Redis 7.4 with a rolling restart.",
      reason: "7.4 brings the improved eviction behaviour we need.",
      riskLevel: "medium",
      status: "draft",
      createdHoursAgo: 6,
      updatedHoursAgo: 6,
      assetNames: ["cache-redis-01"],
      decisions: [],
    },
  ];

  const changeRows: ChangeRow[] = [];
  for (const spec of changeSpecs) {
    const [row] = await db
      .insert(changeRequests)
      .values({
        title: spec.title,
        description: spec.description,
        reason: spec.reason,
        riskLevel: spec.riskLevel,
        riskAssessment: spec.riskAssessment ?? null,
        rollbackPlan: spec.rollbackPlan ?? null,
        status: spec.status,
        requesterId: operator.id,
        implementerId: operator.id,
        plannedStartAt: spec.plannedStartHoursAgo !== undefined ? ago(spec.plannedStartHoursAgo) : null,
        plannedEndAt: spec.plannedEndHoursAgo !== undefined ? ago(spec.plannedEndHoursAgo) : null,
        implementationNotes: spec.implementationNotes ?? null,
        rollbackNotes: spec.rollbackNotes ?? null,
        implementedAt: spec.implementedHoursAgo !== undefined ? ago(spec.implementedHoursAgo) : null,
        createdAt: ago(spec.createdHoursAgo),
        updatedAt: ago(spec.updatedHoursAgo),
      })
      .returning();
    changeRows.push(must(row, `change ${spec.title}`));
  }
  const change = (title: string): ChangeRow => must(changeRows.find((c) => c.title === title), `change ${title}`);
  await db
    .insert(changeAssets)
    .values(changeSpecs.flatMap((spec) => spec.assetNames.map((assetName) => ({ changeId: change(spec.title).id, assetId: asset(assetName).id }))));
  await db.insert(changeApprovals).values(
    changeSpecs.flatMap((spec) =>
      spec.decisions.map((decision) => ({
        changeId: change(spec.title).id,
        approverId: admin.id,
        decision: decision.decision,
        comment: decision.comment,
        decidedAt: ago(decision.hoursAgo),
      })),
    ),
  );

  // ---------- notifications ----------
  const ref = (n: number) => `CHG-${String(n).padStart(5, "0")}`;
  const targetLink = (name: string) => `/monitoring?target=${target(name).id}`;
  const incidentLink = (title: string) => `/incidents/${incident(title).id}`;
  const findingLink = (title: string) => `/security?finding=${finding(title).id}`;
  const changeLink = (title: string) => `/changes?change=${change(title).id}`;

  const notificationSpecs: Array<[user: UserRow, type: NotificationInsert["type"], title: string, message: string, link: string | null, at: Date, read: boolean]> = [
    // Administrator feed (two unread).
    [admin, "change_decision", `${ref(1)} rejected`, `Ada Admin rejected "${change("Open temporary firewall port for vendor access").title}": Vendor access will go through the VPN concentrator instead of a firewall exception.`, changeLink("Open temporary firewall port for vendor access"), ago(days(21.5)), true],
    [admin, "maintenance_scheduled", "Maintenance assigned to you", `${maintenance("Backup NAS firmware update").title} starts ${backupStart.toUTCString()}`, "/maintenance", ago(days(3)), true],
    [admin, "monitoring_unavailable", "Service unavailable: Legacy FTP server (TCP 21)", "Legacy FTP server (TCP 21) is failing checks: Host could not be resolved", targetLink("Legacy FTP server (TCP 21)"), ago(158), true],
    [admin, "monitoring_unavailable", "Service unavailable: Public website (HTTPS)", "Public website (HTTPS) is failing checks: Timed out", targetLink("Public website (HTTPS)"), ago(49.6), true],
    [admin, "monitoring_recovered", "Service recovered: Public website (HTTPS)", "Public website (HTTPS) is responding again", targetLink("Public website (HTTPS)"), ago(49.5), true],
    [admin, "incident_updated", "New update on INC-00007", "Olu Operator: Connection pool saturation suspected on orders-db.", incidentLink("Elevated checkout latency"), ago(47.5), true],
    [admin, "critical_finding", "New critical security finding", `${finding("Remote code execution in image processing library").title} was recorded by Ada Admin`, findingLink("Remote code execution in image processing library"), ago(74), false],
    [admin, "change_pending_approval", `${ref(6)} awaiting approval`, change("Rotate TLS certificates on web tier").title, changeLink("Rotate TLS certificates on web tier"), ago(24), false],
    // Operator feed (three unread).
    [operator, "monitoring_unavailable", "Service unavailable: Legacy FTP server (TCP 21)", "Legacy FTP server (TCP 21) is failing checks: Host could not be resolved", targetLink("Legacy FTP server (TCP 21)"), ago(158), true],
    [operator, "incident_updated", "New update on INC-00006", "Ada Admin: Rolled back the release on web-prod-02.", incidentLink("Checkout returning 5xx errors"), ago(days(6) - 40 / 60), true],
    [operator, "change_decision", `${ref(3)} implemented`, change("Deploy orders service 2.14.0").title, changeLink("Deploy orders service 2.14.0"), ago(days(3)), true],
    [operator, "change_decision", `${ref(5)} approved`, `Ada Admin approved "${change("Enable TLS 1.3 only on public load balancer").title}": Agreed. Announce it on the status page.`, changeLink("Enable TLS 1.3 only on public load balancer"), ago(days(3)), true],
    [operator, "incident_assigned", "INC-00007 assigned to you", incident("Elevated checkout latency").title, incidentLink("Elevated checkout latency"), ago(days(2)), true],
    [operator, "general", "Security finding assigned to you", `${finding("Remote code execution in image processing library").title} (critical severity)`, findingLink("Remote code execution in image processing library"), ago(74), false],
    [operator, "maintenance_scheduled", "Maintenance assigned to you", `${maintenance("Replace TLS certificates on web tier").title} starts ${tlsStart.toUTCString()}`, "/maintenance", ago(days(2)), false],
    [operator, "incident_assigned", "INC-00008 assigned to you", incident("Legacy FTP server unreachable").title, incidentLink("Legacy FTP server unreachable"), ago(16), false],
  ];
  await db.insert(notifications).values(
    notificationSpecs.map(([user, type, title, message, link, at, read]) => ({
      userId: user.id,
      type,
      title,
      message,
      link,
      createdAt: at,
      readAt: read ? new Date(at.getTime() + 20 * MINUTE_MS) : null,
    })),
  );

  // ---------- audit trail ----------
  const auditRows: AuditInsert[] = [
    { actorId: admin.id, action: "auth.register", entityType: "user", entityId: admin.id, summary: "Account registered with role admin", createdAt: ago(days(120)) },
    { actorId: admin.id, action: "asset.created", entityType: "asset", entityId: asset("web-prod-01").id, summary: `Asset "${asset("web-prod-01").name}" registered (virtual machine, production)`, createdAt: ago(days(120)) },
    { actorId: admin.id, action: "asset.created", entityType: "asset", entityId: asset("orders-db").id, summary: `Asset "${asset("orders-db").name}" registered (database, production)`, createdAt: ago(days(120)) },
    { actorId: admin.id, action: "monitoring_target.created", entityType: "monitoring_target", entityId: target("Public website (HTTPS)").id, summary: `Monitoring target "${target("Public website (HTTPS)").name}" created (http)`, createdAt: ago(days(118)) },
    { actorId: operator.id, action: "auth.register", entityType: "user", entityId: operator.id, summary: "Account registered with role operator", createdAt: ago(days(110)) },
    { actorId: admin.id, action: "asset.created", entityType: "asset", entityId: asset("api-gateway").id, summary: `Asset "${asset("api-gateway").name}" registered (application, production)`, createdAt: ago(days(96)) },
    { actorId: admin.id, action: "incident.created", entityType: "incident", entityId: incident("Packet loss on core uplink").id, summary: `INC-00002 opened: ${incident("Packet loss on core uplink").title}`, createdAt: incident("Packet loss on core uplink").openedAt },
    { actorId: admin.id, action: "maintenance.scheduled", entityType: "maintenance", entityId: maintenance("Firewall rule review").id, summary: `Maintenance "${maintenance("Firewall rule review").title}" scheduled`, createdAt: ago(days(20)) },
    { actorId: operator.id, action: "change.created", entityType: "change_request", entityId: change("Open temporary firewall port for vendor access").id, summary: `${ref(1)} drafted: ${change("Open temporary firewall port for vendor access").title}`, createdAt: ago(days(22)) },
    { actorId: admin.id, action: "change.rejected", entityType: "change_request", entityId: change("Open temporary firewall port for vendor access").id, summary: `${ref(1)} rejected by Ada Admin (status: Rejected)`, createdAt: ago(days(21.5)) },
    { actorId: operator.id, action: "change.submitted", entityType: "change_request", entityId: change("Replace core uplink optics").id, summary: `${ref(2)} submitted for approval`, createdAt: ago(days(20) - 1) },
    { actorId: admin.id, action: "change.approved", entityType: "change_request", entityId: change("Replace core uplink optics").id, summary: `${ref(2)} approved by Ada Admin (status: Approved)`, createdAt: ago(days(19.5)) },
    { actorId: operator.id, action: "change.implement", entityType: "change_request", entityId: change("Replace core uplink optics").id, summary: `${ref(2)} Approved → Implemented`, createdAt: ago(days(18)) },
    { actorId: operator.id, action: "change.rollback", entityType: "change_request", entityId: change("Replace core uplink optics").id, summary: `${ref(2)} Implemented → Rolled back`, createdAt: ago(days(18) - 5) },
    { actorId: operator.id, action: "change.submitted", entityType: "change_request", entityId: change("Deploy orders service 2.14.0").id, summary: `${ref(3)} submitted for approval`, createdAt: ago(days(9) - 1) },
    { actorId: admin.id, action: "change.approved", entityType: "change_request", entityId: change("Deploy orders service 2.14.0").id, summary: `${ref(3)} approved by Ada Admin (status: Approved)`, createdAt: ago(days(8.5)) },
    { actorId: operator.id, action: "incident.created", entityType: "incident", entityId: incident("Checkout returning 5xx errors").id, summary: `INC-00006 opened: ${incident("Checkout returning 5xx errors").title}`, createdAt: incident("Checkout returning 5xx errors").openedAt },
    { actorId: operator.id, action: "change.implement", entityType: "change_request", entityId: change("Deploy orders service 2.14.0").id, summary: `${ref(3)} Approved → Implemented`, createdAt: ago(days(3)) },
    { actorId: admin.id, action: "finding.created", entityType: "security_finding", entityId: finding("Remote code execution in image processing library").id, summary: `Finding recorded: ${finding("Remote code execution in image processing library").title} (critical)`, createdAt: ago(74) },
    { actorId: admin.id, action: "incident.created", entityType: "incident", entityId: incident("Elevated checkout latency").id, summary: `INC-00007 opened: ${incident("Elevated checkout latency").title}`, createdAt: incident("Elevated checkout latency").openedAt },
    { actorId: operator.id, action: "change.submitted", entityType: "change_request", entityId: change("Rotate TLS certificates on web tier").id, summary: `${ref(6)} submitted for approval`, createdAt: ago(24) },
    { actorId: admin.id, action: "incident.created", entityType: "incident", entityId: incident("Legacy FTP server unreachable").id, summary: `INC-00008 opened: ${incident("Legacy FTP server unreachable").title}`, createdAt: incident("Legacy FTP server unreachable").openedAt },
    { actorId: admin.id, action: "auth.login", entityType: "user", entityId: admin.id, summary: "Ada Admin signed in", createdAt: ago(2) },
  ];
  await db.insert(auditLogs).values(auditRows);

  console.log(
    `Seed complete: ${userRows.length} users, ${assetRows.length} assets (${assetRows.length - 12} archived), ${targetRows.length} monitoring checks, ` +
      `${historyRows.toLocaleString("en-US")} monitoring results over ${HISTORY_DAYS} days, ${findingRows.length} findings, ${incidentRows.length} incidents, ` +
      `${maintenanceRows.length} maintenance windows, ${changeRows.length} change requests, ${notificationSpecs.length} notifications, ${auditRows.length} audit entries.`,
  );
  console.log("Accounts: admin@infrapilot.local (Administrator), operator@infrapilot.local (Operator), viewer@infrapilot.local (Viewer).");
  if (generated) console.log(`Generated shared password (store it now, it will not be shown again): ${password}`);
}

main()
  .catch((err: unknown) => {
    console.error("Seed failed:", err instanceof Error ? err.message : "unknown error");
    process.exitCode = 1;
  })
  .finally(() => {
    void pool.end();
  });
