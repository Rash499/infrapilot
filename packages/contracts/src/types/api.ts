import type { Role } from "../permissions";

export type { Role } from "../permissions";

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface SessionPayload {
  accessToken: string;
  expiresIn: number;
  user: SessionUser;
}

export interface UserOption {
  id: string;
  name: string;
  role: Role;
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  metadata: unknown;
  ipAddress: string | null;
  createdAt: string;
  actorId: string | null;
  actorName: string;
}

export interface LoginHistoryEntry {
  id: string;
  action: "auth.login" | "auth.login_failed";
  createdAt: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export type AssetType =
  | "physical_server"
  | "virtual_machine"
  | "network_device"
  | "cloud_resource"
  | "container"
  | "database"
  | "application"
  | "other";
export type Environment = "development" | "testing" | "production";
export type AssetStatus = "healthy" | "degraded" | "unavailable" | "maintenance" | "unknown";
export type ServiceState = "healthy" | "degraded" | "unavailable" | "unknown";

export interface Asset {
  id: string;
  name: string;
  assetType: AssetType;
  hostname: string | null;
  ipAddress: string | null;
  operatingSystem: string | null;
  environment: Environment;
  location: string | null;
  ownerId: string | null;
  ownerName: string | null;
  description: string | null;
  status: AssetStatus;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssetDetail extends Asset {
  monitors: { id: string; name: string; status: ServiceState; monitorType: "http" | "tcp" }[];
  findings: { id: string; title: string; severity: string; status: string; createdAt: string }[];
  incidents: { id: string; reference: string; title: string; severity: string; status: string; openedAt: string }[];
}

export interface MonitorTarget {
  id: string;
  name: string;
  monitorType: "http" | "tcp";
  url: string | null;
  host: string | null;
  port: number | null;
  expectedStatusCode: number | null;
  intervalSeconds: number;
  timeoutMs: number;
  degradedThresholdMs: number;
  failureThreshold: number;
  recoveryThreshold: number;
  warningThresholdMs: number;
  criticalThresholdMs: number;
  autoIncidentEnabled: boolean;
  enabled: boolean;
  allowPrivateNetwork: boolean;
  assetId: string | null;
  assetName: string | null;
  status: ServiceState;
  consecutiveFailures: number;
  lastCheckedAt: string | null;
  nextCheckAt: string | null;
  lastResponseMs: number | null;
  lastError: string | null;
  uptime24hPct: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface MonitorResult {
  id: string;
  checkedAt: string;
  success: boolean;
  state: ServiceState;
  responseTimeMs: number | null;
  statusCode: number | null;
  errorMessage: string | null;
}

export interface MonitorOverview {
  summary: { total: number; healthy: number; degraded: number; unavailable: number; unknown: number; paused: number };
  uptime24hPct: number | null;
  avgResponse24hMs: number | null;
  checks24h: number;
  services: MonitorTarget[];
}

export interface TargetDetail extends MonitorTarget {
  stats: { uptime24hPct: number | null; uptime7dPct: number | null; uptime30dPct: number | null; avgResponse24hMs: number | null; checks24h: number };
  recentResults: MonitorResult[];
}

export interface MonitoringTrendPoint {
  ts: string;
  total: number;
  ok: number;
  avgMs: number | null;
  uptimePct: number | null;
}

export interface MonitoringTotals {
  total: number;
  ok: number;
  failed: number;
  avgMs: number | null;
  minMs: number | null;
  maxMs: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
}

export interface MonitoringTargetAnalyticsPoint {
  id: string;
  name: string;
  status: ServiceState;
  monitorType: "http" | "tcp";
  assetName: string | null;
  uptimePct: number | null;
  total: number;
  failed: number;
  avgMs: number | null;
  maxMs: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
}

export interface MonitoringAnalytics {
  range: "24h" | "7d" | "30d";
  since: string;
  uptime: { h24: number | null; d7: number | null; d30: number | null };
  totals: MonitoringTotals;
  uptimePct: number | null;
  trend: MonitoringTrendPoint[];
  targets: MonitoringTargetAnalyticsPoint[];
}

export type AlertStatus = "triggered" | "acknowledged" | "resolved" | "suppressed";
export type AlertSeverity = "critical" | "warning";
export type AlertKind = "availability" | "latency";

export interface AlertEventItem {
  at: string;
  type: string;
  actorId: string | null;
  actorName: string | null;
  note: string | null;
}

export interface Alert {
  id: string;
  dedupeKey: string;
  kind: AlertKind;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  message: string;
  triggerCondition: string;
  occurrences: number;
  triggeredAt: string;
  lastSeenAt: string;
  acknowledgedAt: string | null;
  acknowledgedById: string | null;
  acknowledgedByName: string | null;
  resolvedAt: string | null;
  resolvedById: string | null;
  resolvedByName: string | null;
  resolutionNotes: string | null;
  suppressedUntil: string | null;
  suppressionReason: string | null;
  incidentId: string | null;
  target: { id: string; name: string };
  asset: { id: string; name: string } | null;
  events: AlertEventItem[];
}

export interface AlertSummary {
  active: number;
  triggered: number;
  acknowledged: number;
  suppressed: number;
  resolved: number;
  criticalActive: number;
  warningActive: number;
  trend: { date: string; triggered: number; resolved: number }[];
}

export type FindingSeverity = "critical" | "high" | "medium" | "low" | "informational";
export type FindingStatus = "open" | "in_progress" | "resolved" | "accepted_risk";

export interface FindingEvent {
  id: string;
  fromStatus: string | null;
  toStatus: string | null;
  note: string;
  actorName: string;
  createdAt: string;
}

export interface Finding {
  id: string;
  title: string;
  description: string;
  severity: FindingSeverity;
  status: FindingStatus;
  assetId: string | null;
  assetName: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  remediation: string | null;
  cveId: string | null;
  cvssScore: number | null;
  component: string | null;
  installedVersion: string | null;
  fixedVersion: string | null;
  remediationDeadline: string | null;
  source: "manual" | "trivy";
  scanId: string | null;
  lastSeenAt: string | null;
  createdById: string | null;
  createdByName: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  history?: FindingEvent[];
}

export interface TimelineItem {
  id: string;
  kind: "comment" | "system";
  body: string;
  authorId: string | null;
  authorName: string;
  createdAt: string;
  source?: "comment" | "alert" | "change" | "finding";
  href?: string;
}

export interface IncidentSla {
  acknowledgeDueAt: string;
  resolveDueAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  acknowledgeBreached: boolean;
  resolveBreached: boolean;
  state: "met" | "pending" | "at_risk" | "breached";
  minutesToAcknowledge: number | null;
  minutesToResolve: number | null;
}

export interface IncidentSlaMetrics {
  days: number;
  openIncidents: number;
  resolvedIncidents: number;
  breachedSla: number;
  atRiskSla: number;
  mttaMinutes: number | null;
  mttrMinutes: number | null;
  volume: number;
  bySeverity: { severity: string; count: number }[];
  resolutionTrend: { date: string; opened: number; resolved: number }[];
  policy: Record<string, string>;
}

export interface Incident {
  id: string;
  reference: string;
  number: number;
  title: string;
  description: string;
  severity: "critical" | "high" | "medium" | "low";
  priority: "p1" | "p2" | "p3" | "p4";
  status: "open" | "investigating" | "in_progress" | "resolved" | "closed";
  assigneeId: string | null;
  assigneeName: string | null;
  reporterId: string | null;
  reporterName: string | null;
  rootCause: string | null;
  resolution: string | null;
  openedAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
  acknowledgedAt?: string | null;
  category?: string | null;
  impact?: string | null;
  urgency?: string | null;
  autoCreated?: boolean;
  sourceAlertId?: string | null;
  createdAt: string;
  updatedAt: string;
  assets?: { id: string; name: string; assetType: AssetType; status: AssetStatus }[];
  timeline?: TimelineItem[];
  sla?: IncidentSla;
  monitoringAlert?: { id: string; status: string; severity: string; title: string; triggeredAt: string } | null;
}

export interface Maintenance {
  id: string;
  title: string;
  description: string;
  status: "scheduled" | "in_progress" | "completed" | "cancelled";
  startsAt: string;
  endsAt: string;
  ownerId: string | null;
  ownerName: string | null;
  notes: string | null;
  assets: { id: string; name: string }[];
  createdAt: string;
  updatedAt: string;
  conflicts?: { id: string; title: string; startsAt: string; endsAt: string }[];
}

export interface ChangeApproval {
  id: string;
  decision: "approved" | "rejected";
  comment: string | null;
  approverName: string;
  decidedAt: string;
}

export interface Change {
  id: string;
  reference: string;
  title: string;
  description: string;
  reason: string;
  riskLevel: "low" | "medium" | "high";
  riskAssessment: string | null;
  rollbackPlan: string | null;
  status: "draft" | "pending_approval" | "approved" | "rejected" | "implemented" | "rolled_back" | "cancelled";
  requesterId: string | null;
  requesterName: string | null;
  implementerId: string | null;
  implementerName: string | null;
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  implementationNotes: string | null;
  rollbackNotes: string | null;
  implementedAt: string | null;
  approvalsCount: number;
  approvalsRequired?: number;
  createdAt: string;
  updatedAt: string;
  assets?: { id: string; name: string; assetType: AssetType }[];
  approvals?: ChangeApproval[];
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface AccountSession {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}

export interface Dashboard {
  range: { days: number; from: string; to: string };
  kpis: {
    totalAssets: number;
    healthyAssets: number;
    degradedAssets: number;
    unavailableAssets: number;
    maintenanceAssets: number;
    unknownAssets: number;
    monitoredServices: number;
    serviceHealthy: number;
    serviceDegraded: number;
    serviceUnavailable: number;
    serviceUnknown: number;
    openIncidents: number;
    criticalHighOpenFindings: number;
    upcomingMaintenance: number;
  };
  assetDistribution: { type: string; label: string; count: number }[];
  incidentBySeverity: { severity: string; count: number }[];
  findingsByStatus: { status: string; label: string; count: number }[];
  monitoringSummary: { uptimePct: number | null; checks: number };
  responseTrend: { ts: string; avgResponseMs: number | null; checks: number; uptimePct: number | null }[];
  attentionServices: {
    id: string;
    name: string;
    monitorType: "http" | "tcp";
    status: ServiceState;
    assetName: string | null;
    lastCheckedAt: string | null;
    lastError: string | null;
    consecutiveFailures: number;
  }[];
  overdueServices: {
    id: string;
    name: string;
    monitorType: "http" | "tcp";
    status: ServiceState;
    assetName: string | null;
    nextCheckAt: string;
    lastCheckedAt: string | null;
    intervalSeconds: number;
  }[];
  upcomingMaintenance: { id: string; title: string; startsAt: string; endsAt: string; ownerName: string | null }[];
  recentChanges: { id: string; reference: string; title: string; status: string; riskLevel: string; requesterName: string | null; updatedAt: string }[];
  recentIncidents: {
    id: string;
    reference: string;
    title: string;
    severity: string;
    status: string;
    assigneeName: string | null;
    openedAt: string;
  }[];
  criticalFindings: {
    id: string;
    title: string;
    severity: string;
    status: string;
    assetName: string | null;
    cveId: string | null;
    updatedAt: string;
  }[];
  generatedAt: string;
}

export interface SecurityDashboard {
  open: number;
  bySeverity: { severity: string; count: number }[];
  byStatus: { status: string; count: number }[];
  overdue: number;
  dueSoon: number;
  openCritical: number;
  topAssets: { id: string; name: string; count: number }[];
  createdTrend: { date: string; count: number }[];
}

export interface TrivyImportResult {
  scanId: string;
  asset: { id: string; name: string };
  scanner: "trivy";
  artifactName: string;
  artifactType: string | null;
  scannerVersion: string | null;
  scannedAt: string | null;
  importedAt: string | null;
  vulnerabilitiesSeen: number;
  findingsCreated: number;
  findingsUpdated: number;
  findingsSkipped: number;
  findingsReopened: number;
  criticalCount: number;
  highCount: number;
  duplicateCount: number;
  skipped: { id: string; reason: string }[];
  remediationPolicyDays: Record<string, number>;
}

export interface ScanImportSummary {
  id: string;
  scanner: string;
  artifactName: string | null;
  artifactType: string | null;
  vulnerabilitiesSeen: number;
  findingsCreated: number;
  findingsUpdated: number;
  findingsSkipped: number;
  importedAt: string;
}

export interface SearchHit {
  id: string;
  title: string;
  subtitle: string;
  href: string;
  meta?: string | null;
}

export interface SearchGroup {
  key: string;
  label: string;
  total: number;
  items: SearchHit[];
}

export interface SearchResults {
  q: string;
  groups: SearchGroup[];
  totalHits: number;
}
