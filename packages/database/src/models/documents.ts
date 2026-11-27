import type { MongoEntity } from "@/db/collections";

/**
 * MongoDB document contracts for the InfraPilot collections.
 *
 * Design rules from the MongoDB migration specification:
 * - Domain identifiers remain UUID strings stored on both `_id` and `id` (matching the unique `{ id: 1 }`
 *   indexes in `src/db/app_db.ts`) so REST routes and DTOs do not change.
 * - Cross-document references remain UUID strings.
 * - Join collections (`incident_assets`, `maintenance_assets`, `change_assets`) preserve composite pair uniqueness.
 */

export type UserRole = "admin" | "operator" | "viewer";
export type AssetType =
  | "physical_server"
  | "virtual_machine"
  | "network_device"
  | "cloud_resource"
  | "container"
  | "database"
  | "application"
  | "other";
export type EnvironmentType = "development" | "testing" | "production";
export type AssetStatus = "healthy" | "degraded" | "unavailable" | "maintenance" | "unknown";
export type ServiceState = "healthy" | "degraded" | "unavailable" | "unknown";
export type MonitorType = "http" | "tcp";
export type FindingSeverity = "critical" | "high" | "medium" | "low" | "informational";
export type FindingStatus = "open" | "in_progress" | "resolved" | "accepted_risk";
export type IncidentSeverity = "critical" | "high" | "medium" | "low";
export type IncidentPriority = "p1" | "p2" | "p3" | "p4";
export type IncidentStatus = "open" | "investigating" | "in_progress" | "resolved" | "closed";
export type MaintenanceStatus = "scheduled" | "in_progress" | "completed" | "cancelled";
export type ChangeStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "implemented"
  | "rolled_back"
  | "cancelled";
export type RiskLevel = "low" | "medium" | "high";
export type ApprovalDecision = "approved" | "rejected";
export type CommentKind = "comment" | "system";
export type AlertStatus = "triggered" | "acknowledged" | "resolved" | "suppressed";
export type AlertSeverity = "critical" | "warning";
export type AlertKind = "availability" | "latency";
export type AlertEventType =
  | "triggered"
  | "refreshed"
  | "acknowledged"
  | "resolved"
  | "suppressed"
  | "unsuppressed"
  | "incident_created";
export type AssetCriticality = "tier_1" | "tier_2" | "tier_3" | "tier_4";
export type AssetLifecycle = "in_service" | "staging" | "retired" | "planned";

export type NotificationType =
  | "monitoring_unavailable"
  | "monitoring_recovered"
  | "critical_finding"
  | "incident_assigned"
  | "incident_updated"
  | "maintenance_scheduled"
  | "maintenance_reminder"
  | "change_pending_approval"
  | "change_decision"
  | "alert_triggered"
  | "alert_acknowledged"
  | "alert_resolved"
  | "incident_auto_created"
  | "security_import"
  | "general";

export interface UserDoc extends MongoEntity {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: UserRole;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CounterDoc extends MongoEntity {
  id: string;
  value: number;
}

export interface RefreshTokenDoc extends MongoEntity {
  id: string;
  userId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedById: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Date;
}

export interface PasswordResetTokenDoc extends MongoEntity {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

export interface AssetDoc extends MongoEntity {
  id: string;
  name: string;
  assetType: AssetType;
  hostname: string | null;
  ipAddress: string | null;
  operatingSystem: string | null;
  environment: EnvironmentType;
  location: string | null;
  ownerId: string | null;
  description: string | null;
  status: AssetStatus;
  archivedAt: Date | null;
  createdById: string | null;
  // Optional CMDB attributes: documents created before these existed simply omit them.
  assetTag?: string | null;
  department?: string | null;
  criticality?: AssetCriticality | null;
  lifecycleStatus?: AssetLifecycle | null;
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MonitoringTargetDoc extends MongoEntity {
  id: string;
  name: string;
  monitorType: MonitorType;
  url: string | null;
  host: string | null;
  port: number | null;
  expectedStatusCode: number | null;
  intervalSeconds: number;
  timeoutMs: number;
  degradedThresholdMs: number;
  /** Consecutive failures before the target is reported unavailable. Defaults are applied on read. */
  failureThreshold?: number;
  /** Consecutive successes required to leave the unavailable state. */
  recoveryThreshold?: number;
  /** Response time that raises a warning alert. */
  warningThresholdMs?: number;
  /** Response time that raises a critical latency alert. */
  criticalThresholdMs?: number;
  /** Monitored targets may opt out of automatic incident creation. */
  autoIncidentEnabled?: boolean;
  enabled: boolean;
  allowPrivateNetwork: boolean;
  assetId: string | null;
  status: ServiceState;
  consecutiveFailures: number;
  lastCheckedAt: Date | null;
  nextCheckAt: Date;
  lastResponseMs: number | null;
  lastError: string | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MonitoringResultDoc extends MongoEntity {
  id: string;
  targetId: string;
  checkedAt: Date;
  success: boolean;
  state: ServiceState;
  responseTimeMs: number | null;
  statusCode: number | null;
  errorMessage: string | null;
}

export interface SecurityFindingDoc extends MongoEntity {
  id: string;
  title: string;
  description: string;
  severity: FindingSeverity;
  status: FindingStatus;
  assetId: string | null;
  assigneeId: string | null;
  remediation: string | null;
  cveId: string | null;
  createdById: string | null;
  // Optional vulnerability metadata, populated by the Trivy importer or manual edits.
  cvssScore?: number | null;
  component?: string | null;
  installedVersion?: string | null;
  fixedVersion?: string | null;
  remediationDeadline?: Date | null;
  source?: "manual" | "trivy";
  scanId?: string | null;
  lastSeenAt?: Date | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FindingEventDoc extends MongoEntity {
  id: string;
  findingId: string;
  actorId: string | null;
  fromStatus: FindingStatus | null;
  toStatus: FindingStatus | null;
  note: string;
  createdAt: Date;
}

export interface IncidentDoc extends MongoEntity {
  id: string;
  number: number;
  title: string;
  description: string;
  severity: IncidentSeverity;
  priority: IncidentPriority;
  status: IncidentStatus;
  assigneeId: string | null;
  reporterId: string | null;
  // Added for SLA tracking, richer triage and automatic incident creation.
  category?: string | null;
  impact?: string | null;
  urgency?: string | null;
  acknowledgedAt?: Date | null;
  sourceAlertId?: string | null;
  sourceMonitoringTargetId?: string | null;
  autoCreated?: boolean;
  rootCause: string | null;
  resolution: string | null;
  openedAt: Date;
  resolvedAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IncidentAssetDoc extends MongoEntity {
  incidentId: string;
  assetId: string;
}

export interface IncidentCommentDoc extends MongoEntity {
  id: string;
  incidentId: string;
  authorId: string | null;
  kind: CommentKind;
  body: string;
  createdAt: Date;
}

export interface MaintenanceDoc extends MongoEntity {
  id: string;
  title: string;
  description: string;
  status: MaintenanceStatus;
  startsAt: Date;
  endsAt: Date;
  ownerId: string | null;
  createdById: string | null;
  notes: string | null;
  reminderSentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MaintenanceAssetDoc extends MongoEntity {
  maintenanceId: string;
  assetId: string;
}

export interface ChangeRequestDoc extends MongoEntity {
  id: string;
  number: number;
  title: string;
  description: string;
  reason: string;
  riskLevel: RiskLevel;
  riskAssessment: string | null;
  rollbackPlan: string | null;
  status: ChangeStatus;
  requesterId: string | null;
  implementerId: string | null;
  plannedStartAt: Date | null;
  plannedEndAt: Date | null;
  implementationNotes: string | null;
  rollbackNotes: string | null;
  implementedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChangeAssetDoc extends MongoEntity {
  changeId: string;
  assetId: string;
}

export interface ChangeApprovalDoc extends MongoEntity {
  id: string;
  changeId: string;
  approverId: string | null;
  decision: ApprovalDecision;
  comment: string | null;
  decidedAt: Date;
}

export interface NotificationDoc extends MongoEntity {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  link: string | null;
  readAt: Date | null;
  createdAt: Date;
}

export interface AuditLogDoc extends MongoEntity {
  id: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: Date;
}

export interface WorkerStatusDoc extends MongoEntity {
  id: string;
  status: "running" | "stopped";
  startedAt: Date;
  heartbeatAt: Date;
  lastTickAt: Date | null;
  lastTickClaimed: number;
  lastError: string | null;
}

export interface AlertEvent {
  at: Date;
  type: AlertEventType;
  actorId: string | null;
  note: string | null;
}

export interface AlertDoc extends MongoEntity {
  id: string;
  /** Stable key for the monitored condition; only one active alert may exist per key. */
  dedupeKey: string;
  kind: AlertKind;
  targetId: string;
  assetId: string | null;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  message: string;
  triggerCondition: string;
  occurrences: number;
  triggeredAt: Date;
  lastSeenAt: Date;
  acknowledgedAt: Date | null;
  acknowledgedById: string | null;
  resolvedAt: Date | null;
  resolvedById: string | null;
  resolutionNotes: string | null;
  suppressedAt: Date | null;
  suppressedUntil: Date | null;
  suppressionReason: string | null;
  incidentId: string | null;
  events: AlertEvent[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ScanImportDoc extends MongoEntity {
  id: string;
  assetId: string;
  scanner: "trivy";
  artifactName: string | null;
  artifactType: string | null;
  reportVersion: number | null;
  importedById: string;
  vulnerabilitiesSeen: number;
  findingsCreated: number;
  findingsUpdated: number;
  findingsSkipped: number;
  importedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
