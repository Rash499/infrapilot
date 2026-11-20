export type Role = "admin" | "operator" | "viewer";

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
  createdAt: string;
  updatedAt: string;
  assets?: { id: string; name: string; assetType: AssetType; status: AssetStatus }[];
  timeline?: TimelineItem[];
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
  responseTrend: { ts: string; avgResponseMs: number | null; checks: number; uptimePct: number | null }[];
  upcomingMaintenance: { id: string; title: string; startsAt: string; endsAt: string; ownerName: string | null }[];
  recentChanges: { id: string; reference: string; title: string; status: string; riskLevel: string; requesterName: string | null; updatedAt: string }[];
  generatedAt: string;
}
