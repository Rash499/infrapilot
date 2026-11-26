/**
 * Pure plan helpers for the demo seeder: validation, summary rendering and the deterministic
 * monitoring-history generator. No database or environment access, so it is unit-testable and the
 * `--dry-run` mode can run on a machine without MongoDB.
 */

import {
  DEMO_ASSETS,
  DEMO_AUDIT_EVENTS,
  DEMO_CHANGES,
  DEMO_FINDINGS,
  DEMO_INCIDENTS,
  DEMO_MAINTENANCE,
  DEMO_MONITORS,
  DEMO_NOTIFICATIONS,
  DEMO_USERS,
  type DemoMonitorSpec,
} from "./dataset";

export interface DemoPlanProblem {
  area: string;
  key: string;
  message: string;
}

export interface DemoPlanCounts {
  users: number;
  assets: number;
  monitoringTargets: number;
  monitoringResults: number;
  incidents: number;
  incidentComments: number;
  findings: number;
  maintenance: number;
  changes: number;
  notifications: number;
  auditEvents: number;
}

const ROLES = new Set(["admin", "operator", "viewer"]);
const ASSET_TYPES = new Set([
  "physical_server",
  "virtual_machine",
  "network_device",
  "cloud_resource",
  "container",
  "database",
  "application",
  "other",
]);
const ENVIRONMENTS = new Set(["development", "testing", "production"]);
const ASSET_STATUSES = new Set(["healthy", "degraded", "unavailable", "maintenance", "unknown"]);
const INCIDENT_STATUSES = new Set(["open", "investigating", "in_progress", "resolved", "closed"]);
const INCIDENT_SEVERITIES = new Set(["critical", "high", "medium", "low"]);
const INCIDENT_PRIORITIES = new Set(["p1", "p2", "p3", "p4"]);
const FINDING_STATUSES = new Set(["open", "in_progress", "resolved", "accepted_risk"]);
const FINDING_SEVERITIES = new Set(["critical", "high", "medium", "low", "informational"]);
const MAINTENANCE_STATUSES = new Set(["scheduled", "in_progress", "completed", "cancelled"]);
const CHANGE_STATUSES = new Set(["draft", "pending_approval", "approved", "rejected", "implemented", "rolled_back", "cancelled"]);
const RISK_LEVELS = new Set(["low", "medium", "high"]);
const NOTIFICATION_TYPES = new Set([
  "monitoring_unavailable",
  "monitoring_recovered",
  "critical_finding",
  "incident_assigned",
  "incident_updated",
  "maintenance_scheduled",
  "maintenance_reminder",
  "change_pending_approval",
  "change_decision",
  "general",
]);

/** Private (RFC 1918), loopback or link-local literals only. Demo data must never point outside. */
export function isLocalAddress(value: string): boolean {
  const octets = value.split(".");
  if (octets.length !== 4) return value === "::1" || value.startsWith("fd") || value.startsWith("fc");
  const parts = octets.map((part) => Number(part));
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts as [number, number, number, number];
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

export function validateDataset(): DemoPlanProblem[] {
  const problems: DemoPlanProblem[] = [];
  const add = (area: string, key: string, message: string) => problems.push({ area, key, message });

  const userIds = new Set<string>();
  const emails = new Set<string>();
  for (const user of DEMO_USERS) {
    if (!user.key) add("users", user.key, "key is required");
    if (userIds.has(user.key)) add("users", user.key, "duplicate user key");
    userIds.add(user.key);
    const email = user.email.toLowerCase();
    if (emails.has(email)) add("users", user.key, `duplicate email ${user.email}`);
    emails.add(email);
    if (!/^[^@\s]+@[^@\s]+\.[a-z]+$/.test(email)) add("users", user.key, `email ${user.email} is not valid`);
    if (!ROLES.has(user.role)) add("users", user.key, `role ${user.role} is not implemented by the application`);
    if (!user.name.trim()) add("users", user.key, "display name is required");
  }
  if (DEMO_USERS.filter((user) => user.role === "admin").length === 0) add("users", "admin", "at least one admin is required");
  if (DEMO_USERS.filter((user) => user.role === "viewer").length === 0) add("users", "viewer", "at least one viewer is required for the read-only scenario");

  const assetKeys = new Set<string>();
  const assetNames = new Set<string>();
  const assetHosts = new Set<string>();
  const assetIps = new Set<string>();
  for (const item of DEMO_ASSETS) {
    if (assetKeys.has(item.key)) add("assets", item.key, "duplicate asset key");
    assetKeys.add(item.key);
    if (assetNames.has(item.name)) add("assets", item.key, `duplicate asset name ${item.name}`);
    assetNames.add(item.name);
    if (assetHosts.has(item.hostname)) add("assets", item.key, `duplicate hostname ${item.hostname}`);
    assetHosts.add(item.hostname);
    if (assetIps.has(item.ipAddress)) add("assets", item.key, `duplicate IP address ${item.ipAddress}`);
    assetIps.add(item.ipAddress);
    if (!ASSET_TYPES.has(item.assetType)) add("assets", item.key, `unsupported asset type ${item.assetType}`);
    if (!ENVIRONMENTS.has(item.environment)) add("assets", item.key, `unsupported environment ${item.environment}`);
    if (!ASSET_STATUSES.has(item.status)) add("assets", item.key, `unsupported status ${item.status}`);
    if (!isLocalAddress(item.ipAddress)) add("assets", item.key, `IP address ${item.ipAddress} is not a private or loopback address`);
    if (!userIds.has(item.owner)) add("assets", item.key, `owner ${item.owner} is not a demo user`);
    if (!item.tag || !item.department) add("assets", item.key, "support fields (tag, department) are required");
  }
  if (DEMO_ASSETS.length < 20) add("assets", "-", "the demo needs at least 20 assets to look convincing");

  const monitorKeys = new Set<string>();
  for (const monitor of DEMO_MONITORS) {
    if (monitorKeys.has(monitor.key)) add("monitoring", monitor.key, "duplicate monitor key");
    monitorKeys.add(monitor.key);
    if (!assetKeys.has(monitor.asset)) add("monitoring", monitor.key, `asset ${monitor.asset} is unknown`);
    if (monitor.monitorType === "http") {
      if (!monitor.url) add("monitoring", monitor.key, "http monitors need a url");
      else {
        let url: URL | null = null;
        try {
          url = new URL(monitor.url);
        } catch {
          add("monitoring", monitor.key, `url ${monitor.url} is not valid`);
        }
        if (url && url.protocol !== "http:" && url.protocol !== "https:") add("monitoring", monitor.key, "only http and https are supported");
        if (url && (url.username || url.password)) add("monitoring", monitor.key, "urls must not contain credentials");
        if (url && !isLocalAddress(url.hostname)) add("monitoring", monitor.key, `url host ${url.hostname} must be a local or private address`);
      }
    } else {
      if (!monitor.host) add("monitoring", monitor.key, "tcp monitors need a host");
      if (monitor.host && !isLocalAddress(monitor.host)) add("monitoring", monitor.key, `tcp host ${monitor.host} must be local or private`);
      if (!monitor.port || monitor.port < 1 || monitor.port > 65535) add("monitoring", monitor.key, "tcp monitors need a valid port");
    }
    if (monitor.intervalSeconds < 30 || monitor.intervalSeconds > 86400) add("monitoring", monitor.key, "intervalSeconds must be between 30 and 86400");
    if (monitor.timeoutMs < 500 || monitor.timeoutMs > 30000) add("monitoring", monitor.key, "timeoutMs must be between 500 and 30000");
    if (monitor.degradedThresholdMs >= monitor.timeoutMs) add("monitoring", monitor.key, "degraded threshold must be below the timeout");
    if (monitor.expectedStatusCode !== undefined && (monitor.expectedStatusCode < 100 || monitor.expectedStatusCode > 599)) {
      add("monitoring", monitor.key, "expectedStatusCode must be a valid HTTP status");
    }
    if (!monitor.enabled && monitor.pattern !== "none") add("monitoring", monitor.key, "disabled monitors must not generate history");
  }
  if (DEMO_MONITORS.filter((m) => m.enabled && m.state === "unavailable").length === 0) add("monitoring", "-", "the demo needs at least one unavailable service for the attention view");
  if (DEMO_MONITORS.filter((m) => m.enabled && m.state === "healthy").length < 3) add("monitoring", "-", "the demo needs at least three healthy services");
  if (DEMO_MONITORS.filter((m) => !m.enabled).length === 0) add("monitoring", "-", "the demo needs at least one paused monitor");

  const incidentKeys = new Set<string>();
  for (const incident of DEMO_INCIDENTS) {
    if (incidentKeys.has(incident.key)) add("incidents", incident.key, "duplicate incident key");
    incidentKeys.add(incident.key);
    if (!INCIDENT_STATUSES.has(incident.status)) add("incidents", incident.key, `unsupported status ${incident.status}`);
    if (!INCIDENT_SEVERITIES.has(incident.severity)) add("incidents", incident.key, `unsupported severity ${incident.severity}`);
    if (!INCIDENT_PRIORITIES.has(incident.priority)) add("incidents", incident.key, `unsupported priority ${incident.priority}`);
    if (!userIds.has(incident.assignee)) add("incidents", incident.key, `assignee ${incident.assignee} is unknown`);
    if (incident.assets.length === 0) add("incidents", incident.key, "at least one affected asset is required");
    for (const key of incident.assets) if (!assetKeys.has(key)) add("incidents", incident.key, `asset ${key} is unknown`);
    if (incident.openedHoursAgo < 0) add("incidents", incident.key, "openedHoursAgo must not be negative");
    if ((incident.status === "resolved" || incident.status === "closed") && !incident.resolution) {
      add("incidents", incident.key, "resolved and closed incidents need a resolution");
    }
    if (incident.status === "closed" && !incident.rootCause) add("incidents", incident.key, "closed incidents need a root cause");
    for (const comment of incident.comments ?? []) {
      if (!userIds.has(comment.author)) add("incidents", incident.key, `comment author ${comment.author} is unknown`);
      if (comment.hoursAgo >= incident.openedHoursAgo) add("incidents", incident.key, "comments must be newer than the incident");
      if (comment.hoursAgo < 0) add("incidents", incident.key, "comments must not be in the future");
    }
  }
  for (const status of ["open", "investigating", "in_progress", "resolved", "closed"]) {
    if (!DEMO_INCIDENTS.some((incident) => incident.status === status)) add("incidents", status, `no incident demonstrates the ${status} state`);
  }

  const findingKeys = new Set<string>();
  for (const finding of DEMO_FINDINGS) {
    if (findingKeys.has(finding.key)) add("findings", finding.key, "duplicate finding key");
    findingKeys.add(finding.key);
    if (!FINDING_STATUSES.has(finding.status)) add("findings", finding.key, `unsupported status ${finding.status}`);
    if (!FINDING_SEVERITIES.has(finding.severity)) add("findings", finding.key, `unsupported severity ${finding.severity}`);
    if (!userIds.has(finding.assignee)) add("findings", finding.key, `assignee ${finding.assignee} is unknown`);
    if (finding.asset && !assetKeys.has(finding.asset)) add("findings", finding.key, `asset ${finding.asset} is unknown`);
    if (!finding.remediation.trim()) add("findings", finding.key, "remediation text is required");
    if (!finding.description.toLowerCase().includes("demonstration")) add("findings", finding.key, "description must say the finding is demonstration data");
    if (finding.status === "accepted_risk" && !finding.acceptNote) add("findings", finding.key, "accepted_risk findings need a note");
    if (finding.status === "resolved" && finding.resolvedDaysAgo === undefined) add("findings", finding.key, "resolved findings need resolvedDaysAgo");
    if (finding.resolvedDaysAgo !== undefined && finding.resolvedDaysAgo > finding.detectedDaysAgo) add("findings", finding.key, "resolvedDaysAgo must not exceed detectedDaysAgo");
  }
  for (const severity of ["critical", "high", "medium", "low", "informational"]) {
    if (!DEMO_FINDINGS.some((finding) => finding.severity === severity)) add("findings", severity, `no finding demonstrates the ${severity} severity`);
  }
  for (const status of ["open", "in_progress", "resolved", "accepted_risk"]) {
    if (!DEMO_FINDINGS.some((finding) => finding.status === status)) add("findings", status, `no finding demonstrates the ${status} state`);
  }

  const maintenanceKeys = new Set<string>();
  for (const item of DEMO_MAINTENANCE) {
    if (maintenanceKeys.has(item.key)) add("maintenance", item.key, "duplicate maintenance key");
    maintenanceKeys.add(item.key);
    if (!MAINTENANCE_STATUSES.has(item.status)) add("maintenance", item.key, `unsupported status ${item.status}`);
    if (!userIds.has(item.owner)) add("maintenance", item.key, `owner ${item.owner} is unknown`);
    if (item.assets.length === 0) add("maintenance", item.key, "at least one asset is required");
    for (const key of item.assets) if (!assetKeys.has(key)) add("maintenance", item.key, `asset ${key} is unknown`);
    if (item.durationHours <= 0) add("maintenance", item.key, "durationHours must be positive");
    if (item.status === "scheduled" && item.startOffsetHours <= 0) add("maintenance", item.key, "scheduled maintenance must start in the future");
    if (item.status === "completed" && item.startOffsetHours + item.durationHours > 0) add("maintenance", item.key, "completed maintenance must be in the past");
    if (item.status === "in_progress" && (item.startOffsetHours > 0 || item.startOffsetHours + item.durationHours < 0)) {
      add("maintenance", item.key, "in_progress maintenance must span the current time");
    }
  }
  const upcoming = DEMO_MAINTENANCE.filter((item) => item.status === "scheduled" && item.startOffsetHours <= 14 * 24);
  if (upcoming.length < 3) add("maintenance", "-", "at least three scheduled windows must fall inside the dashboard 14-day horizon");
  if (!DEMO_MAINTENANCE.some((item) => item.status === "completed")) add("maintenance", "completed", "no completed maintenance window");
  if (!DEMO_MAINTENANCE.some((item) => item.status === "cancelled")) add("maintenance", "cancelled", "no cancelled maintenance window");

  const changeKeys = new Set<string>();
  for (const change of DEMO_CHANGES) {
    if (changeKeys.has(change.key)) add("changes", change.key, "duplicate change key");
    changeKeys.add(change.key);
    if (!CHANGE_STATUSES.has(change.status)) add("changes", change.key, `unsupported status ${change.status}`);
    if (!RISK_LEVELS.has(change.riskLevel)) add("changes", change.key, `unsupported risk level ${change.riskLevel}`);
    if (!userIds.has(change.requester)) add("changes", change.key, `requester ${change.requester} is unknown`);
    if (!userIds.has(change.implementer)) add("changes", change.key, `implementer ${change.implementer} is unknown`);
    for (const key of change.assets) if (!assetKeys.has(key)) add("changes", change.key, `asset ${key} is unknown`);
    if (change.status !== "draft") {
      if (!change.riskAssessment.trim()) add("changes", change.key, "submitted changes need a risk assessment");
      if (!change.rollbackPlan.trim()) add("changes", change.key, "submitted changes need a rollback plan");
    }
    if (["rejected", "approved", "implemented", "rolled_back", "cancelled"].includes(change.status) && !change.decisionComment) {
      add("changes", change.key, "decided changes need a decision comment");
    }
    if (change.status === "implemented" && !change.implementationNotes) add("changes", change.key, "implemented changes need implementation notes");
    if (change.status === "rolled_back" && !change.rollbackNotes) add("changes", change.key, "rolled back changes need rollback notes");
    if (change.plannedDurationHours <= 0) add("changes", change.key, "plannedDurationHours must be positive");
  }
  for (const status of ["draft", "pending_approval", "approved", "rejected", "implemented", "rolled_back", "cancelled"]) {
    if (!DEMO_CHANGES.some((change) => change.status === status)) add("changes", status, `no change request demonstrates the ${status} state`);
  }

  const notificationKeys = new Set<string>();
  for (const notification of DEMO_NOTIFICATIONS) {
    if (notificationKeys.has(notification.key)) add("notifications", notification.key, "duplicate notification key");
    notificationKeys.add(notification.key);
    if (!userIds.has(notification.recipient)) add("notifications", notification.key, `recipient ${notification.recipient} is unknown`);
    if (!NOTIFICATION_TYPES.has(notification.type)) add("notifications", notification.key, `unsupported type ${notification.type}`);
    if (notification.hoursAgo < 0) add("notifications", notification.key, "hoursAgo must not be negative");
    if (notification.link.kind === "incident" && !incidentKeys.has(notification.link.key)) add("notifications", notification.key, "incident link is unknown");
    if (notification.link.kind === "finding" && !findingKeys.has(notification.link.key)) add("notifications", notification.key, "finding link is unknown");
    if (notification.link.kind === "change" && !changeKeys.has(notification.link.key)) add("notifications", notification.key, "change link is unknown");
    if (notification.link.kind === "maintenance" && !maintenanceKeys.has(notification.link.key)) add("notifications", notification.key, "maintenance link is unknown");
  }
  if (!DEMO_NOTIFICATIONS.some((notification) => !notification.read)) add("notifications", "-", "at least one unread notification is required");
  if (!DEMO_NOTIFICATIONS.some((notification) => notification.read)) add("notifications", "-", "at least one read notification is required");

  for (const event of DEMO_AUDIT_EVENTS) {
    if (!userIds.has(event.actor)) add("audit", event.key, `actor ${event.actor} is unknown`);
    if (event.hoursAgo < 0) add("audit", event.key, "hoursAgo must not be negative");
    const kind = event.entity.kind;
    if (kind === "asset" && !assetKeys.has(event.entity.key ?? "")) add("audit", event.key, "asset reference is unknown");
    if (kind === "incident" && !incidentKeys.has(event.entity.key ?? "")) add("audit", event.key, "incident reference is unknown");
    if (kind === "finding" && !findingKeys.has(event.entity.key ?? "")) add("audit", event.key, "finding reference is unknown");
    if (kind === "change" && !changeKeys.has(event.entity.key ?? "")) add("audit", event.key, "change reference is unknown");
    if (kind === "maintenance" && !maintenanceKeys.has(event.entity.key ?? "")) add("audit", event.key, "maintenance reference is unknown");
    if (kind === "user" && !userIds.has(event.entity.key ?? "")) add("audit", event.key, "user reference is unknown");
  }

  return problems;
}

export function planCounts(): DemoPlanCounts {
  return {
    users: DEMO_USERS.length,
    assets: DEMO_ASSETS.length,
    monitoringTargets: DEMO_MONITORS.length,
    monitoringResults: DEMO_MONITORS.reduce((total, monitor) => total + monitor.historyPoints, 0),
    incidents: DEMO_INCIDENTS.length,
    incidentComments: DEMO_INCIDENTS.reduce((total, incident) => total + 1 + (incident.comments?.length ?? 0), 0),
    findings: DEMO_FINDINGS.length,
    maintenance: DEMO_MAINTENANCE.length,
    changes: DEMO_CHANGES.length,
    notifications: DEMO_NOTIFICATIONS.length,
    auditEvents: DEMO_AUDIT_EVENTS.length,
  };
}

export function formatPlan(counts: DemoPlanCounts = planCounts()): string {
  const rows: Array<[string, number]> = [
    ["users", counts.users],
    ["assets", counts.assets],
    ["monitoring targets", counts.monitoringTargets],
    ["monitoring results (history)", counts.monitoringResults],
    ["incidents", counts.incidents],
    ["incident comments", counts.incidentComments],
    ["security findings", counts.findings],
    ["maintenance windows", counts.maintenance],
    ["change requests", counts.changes],
    ["notifications", counts.notifications],
    ["audit narration rows", counts.auditEvents],
  ];
  const width = Math.max(...rows.map(([label]) => label.length));
  return rows.map(([label, value]) => `  ${label.padEnd(width)}  ${value}`).join("\n");
}

/**
 * Deterministic monitoring history for one target. `now` is injected so tests can pin time.
 * Failures are clustered at the end for outage patterns and in the middle for recovery patterns,
 * which is what the dashboard trend chart renders.
 */
export function buildMonitoringHistory(
  monitor: DemoMonitorSpec,
  now: Date,
): Array<{ checkedAt: Date; success: boolean; state: "healthy" | "degraded" | "unavailable"; responseTimeMs: number | null; statusCode: number | null; errorMessage: string | null }> {
  if (!monitor.enabled || monitor.pattern === "none" || monitor.historyPoints === 0) return [];
  const rows: ReturnType<typeof buildMonitoringHistory> = [];
  const stepMs = (7 * 24 * 60 * 60 * 1000) / monitor.historyPoints;
  const baseline = monitor.lastResponseMs ?? (monitor.monitorType === "tcp" ? 14 : 130);
  for (let index = 0; index < monitor.historyPoints; index += 1) {
    const age = (monitor.historyPoints - 1 - index) * stepMs;
    const checkedAt = new Date(now.getTime() - age);
    const progress = index / Math.max(1, monitor.historyPoints - 1);
    const wobble = Math.round(Math.sin(index * 1.7) * Math.max(6, baseline * 0.12));
    const responseMs = Math.max(4, baseline + wobble);

    switch (monitor.pattern) {
      case "stable":
        rows.push({ checkedAt, success: true, state: responseMs > monitor.degradedThresholdMs ? "degraded" : "healthy", responseTimeMs: responseMs, statusCode: monitor.expectedStatusCode ?? 200, errorMessage: null });
        break;
      case "slow":
        rows.push({ checkedAt, success: true, state: responseMs > monitor.degradedThresholdMs ? "degraded" : "healthy", responseTimeMs: Math.max(responseMs, Math.round(monitor.degradedThresholdMs * 1.35)), statusCode: monitor.expectedStatusCode ?? 200, errorMessage: null });
        break;
      case "outage": {
        const failing = progress > 0.72;
        rows.push(
          failing
            ? { checkedAt, success: false, state: "unavailable", responseTimeMs: null, statusCode: null, errorMessage: monitor.lastError ?? "connect ECONNREFUSED" }
            : { checkedAt, success: true, state: "healthy", responseTimeMs: responseMs, statusCode: monitor.expectedStatusCode ?? 200, errorMessage: null },
        );
        break;
      }
      case "recovery": {
        const failing = progress > 0.55 && progress < 0.92;
        rows.push(
          failing
            ? { checkedAt, success: false, state: "unavailable", responseTimeMs: null, statusCode: null, errorMessage: "connect ETIMEDOUT" }
            : { checkedAt, success: true, state: responseMs > monitor.degradedThresholdMs ? "degraded" : "healthy", responseTimeMs: responseMs, statusCode: monitor.expectedStatusCode ?? 200, errorMessage: null },
        );
        break;
      }
      case "flapping": {
        const failing = index % 11 === 0;
        rows.push(
          failing
            ? { checkedAt, success: false, state: "unavailable", responseTimeMs: null, statusCode: null, errorMessage: "connect ECONNRESET" }
            : { checkedAt, success: true, state: "healthy", responseTimeMs: responseMs, statusCode: monitor.expectedStatusCode ?? 200, errorMessage: null },
        );
        break;
      }
      default:
        break;
    }
  }
  return rows;
}
