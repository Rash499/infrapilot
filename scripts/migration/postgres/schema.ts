import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["admin", "operator", "viewer"]);
export const assetTypeEnum = pgEnum("asset_type", [
  "physical_server",
  "virtual_machine",
  "network_device",
  "cloud_resource",
  "container",
  "database",
  "application",
  "other",
]);
export const environmentEnum = pgEnum("environment", ["development", "testing", "production"]);
export const assetStatusEnum = pgEnum("asset_status", ["healthy", "degraded", "unavailable", "maintenance", "unknown"]);
export const serviceStateEnum = pgEnum("service_state", ["healthy", "degraded", "unavailable", "unknown"]);
export const monitorTypeEnum = pgEnum("monitor_type", ["http", "tcp"]);
export const findingSeverityEnum = pgEnum("finding_severity", ["critical", "high", "medium", "low", "informational"]);
export const findingStatusEnum = pgEnum("finding_status", ["open", "in_progress", "resolved", "accepted_risk"]);
export const incidentSeverityEnum = pgEnum("incident_severity", ["critical", "high", "medium", "low"]);
export const incidentPriorityEnum = pgEnum("incident_priority", ["p1", "p2", "p3", "p4"]);
export const incidentStatusEnum = pgEnum("incident_status", ["open", "investigating", "in_progress", "resolved", "closed"]);
export const maintenanceStatusEnum = pgEnum("maintenance_status", ["scheduled", "in_progress", "completed", "cancelled"]);
export const changeStatusEnum = pgEnum("change_status", [
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "implemented",
  "rolled_back",
  "cancelled",
]);
export const riskLevelEnum = pgEnum("risk_level", ["low", "medium", "high"]);
export const approvalDecisionEnum = pgEnum("approval_decision", ["approved", "rejected"]);
export const notificationTypeEnum = pgEnum("notification_type", [
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
export const commentKindEnum = pgEnum("comment_kind", ["comment", "system"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 255 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    role: userRoleEnum("role").notNull().default("viewer"),
    isActive: boolean("is_active").notNull().default(true),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("users_email_uidx").on(t.email), index("users_role_idx").on(t.role)],
);

export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    familyId: uuid("family_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    replacedById: uuid("replaced_by_id"),
    userAgent: varchar("user_agent", { length: 255 }),
    ipAddress: varchar("ip_address", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("refresh_tokens_hash_uidx").on(t.tokenHash),
    index("refresh_tokens_user_idx").on(t.userId),
    index("refresh_tokens_family_idx").on(t.familyId),
  ],
);

export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("password_reset_hash_uidx").on(t.tokenHash), index("password_reset_user_idx").on(t.userId)],
);

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 160 }).notNull(),
    assetType: assetTypeEnum("asset_type").notNull(),
    hostname: varchar("hostname", { length: 255 }),
    ipAddress: varchar("ip_address", { length: 64 }),
    operatingSystem: varchar("operating_system", { length: 120 }),
    environment: environmentEnum("environment").notNull().default("development"),
    location: varchar("location", { length: 160 }),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    description: text("description"),
    status: assetStatusEnum("status").notNull().default("unknown"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("assets_type_idx").on(t.assetType),
    index("assets_environment_idx").on(t.environment),
    index("assets_status_idx").on(t.status),
    index("assets_hostname_idx").on(t.hostname),
    index("assets_name_idx").on(t.name),
    index("assets_archived_idx").on(t.archivedAt),
  ],
);

export const monitoringTargets = pgTable(
  "monitoring_targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 160 }).notNull(),
    monitorType: monitorTypeEnum("monitor_type").notNull(),
    url: text("url"),
    host: varchar("host", { length: 255 }),
    port: integer("port"),
    expectedStatusCode: integer("expected_status_code"),
    intervalSeconds: integer("interval_seconds").notNull().default(60),
    timeoutMs: integer("timeout_ms").notNull().default(5000),
    degradedThresholdMs: integer("degraded_threshold_ms").notNull().default(1000),
    enabled: boolean("enabled").notNull().default(true),
    allowPrivateNetwork: boolean("allow_private_network").notNull().default(false),
    assetId: uuid("asset_id").references(() => assets.id, { onDelete: "set null" }),
    status: serviceStateEnum("status").notNull().default("unknown"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    nextCheckAt: timestamp("next_check_at", { withTimezone: true }).notNull().defaultNow(),
    lastResponseMs: integer("last_response_ms"),
    lastError: text("last_error"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("monitoring_targets_next_check_idx").on(t.enabled, t.nextCheckAt),
    index("monitoring_targets_asset_idx").on(t.assetId),
    index("monitoring_targets_status_idx").on(t.status),
  ],
);

export const monitoringResults = pgTable(
  "monitoring_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetId: uuid("target_id")
      .notNull()
      .references(() => monitoringTargets.id, { onDelete: "cascade" }),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
    success: boolean("success").notNull(),
    state: serviceStateEnum("state").notNull(),
    responseTimeMs: integer("response_time_ms"),
    statusCode: integer("status_code"),
    errorMessage: text("error_message"),
  },
  (t) => [index("monitoring_results_target_time_idx").on(t.targetId, t.checkedAt), index("monitoring_results_time_idx").on(t.checkedAt)],
);

export const securityFindings = pgTable(
  "security_findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: varchar("title", { length: 200 }).notNull(),
    description: text("description").notNull(),
    severity: findingSeverityEnum("severity").notNull(),
    status: findingStatusEnum("status").notNull().default("open"),
    assetId: uuid("asset_id").references(() => assets.id, { onDelete: "set null" }),
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    remediation: text("remediation"),
    cveId: varchar("cve_id", { length: 32 }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("findings_severity_idx").on(t.severity),
    index("findings_status_idx").on(t.status),
    index("findings_asset_idx").on(t.assetId),
    index("findings_assignee_idx").on(t.assigneeId),
  ],
);

export const findingEvents = pgTable(
  "finding_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    findingId: uuid("finding_id")
      .notNull()
      .references(() => securityFindings.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    fromStatus: findingStatusEnum("from_status"),
    toStatus: findingStatusEnum("to_status"),
    note: text("note").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("finding_events_finding_idx").on(t.findingId)],
);

export const incidents = pgTable(
  "incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    number: serial("number").notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    description: text("description").notNull(),
    severity: incidentSeverityEnum("severity").notNull(),
    priority: incidentPriorityEnum("priority").notNull(),
    status: incidentStatusEnum("status").notNull().default("open"),
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    reporterId: uuid("reporter_id").references(() => users.id, { onDelete: "set null" }),
    rootCause: text("root_cause"),
    resolution: text("resolution"),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("incidents_number_uidx").on(t.number),
    index("incidents_status_idx").on(t.status),
    index("incidents_severity_idx").on(t.severity),
    index("incidents_assignee_idx").on(t.assigneeId),
    index("incidents_opened_idx").on(t.openedAt),
  ],
);

export const incidentAssets = pgTable(
  "incident_assets",
  {
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.incidentId, t.assetId] }), index("incident_assets_asset_idx").on(t.assetId)],
);

export const incidentComments = pgTable(
  "incident_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    kind: commentKindEnum("kind").notNull().default("comment"),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("incident_comments_incident_idx").on(t.incidentId)],
);

export const maintenances = pgTable(
  "maintenances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: varchar("title", { length: 200 }).notNull(),
    description: text("description").notNull(),
    status: maintenanceStatusEnum("status").notNull().default("scheduled"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    notes: text("notes"),
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("maintenances_starts_idx").on(t.startsAt), index("maintenances_status_idx").on(t.status)],
);

export const maintenanceAssets = pgTable(
  "maintenance_assets",
  {
    maintenanceId: uuid("maintenance_id")
      .notNull()
      .references(() => maintenances.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.maintenanceId, t.assetId] }), index("maintenance_assets_asset_idx").on(t.assetId)],
);

export const changeRequests = pgTable(
  "change_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    number: serial("number").notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    description: text("description").notNull(),
    reason: text("reason").notNull(),
    riskLevel: riskLevelEnum("risk_level").notNull().default("low"),
    riskAssessment: text("risk_assessment"),
    rollbackPlan: text("rollback_plan"),
    status: changeStatusEnum("status").notNull().default("draft"),
    requesterId: uuid("requester_id").references(() => users.id, { onDelete: "set null" }),
    implementerId: uuid("implementer_id").references(() => users.id, { onDelete: "set null" }),
    plannedStartAt: timestamp("planned_start_at", { withTimezone: true }),
    plannedEndAt: timestamp("planned_end_at", { withTimezone: true }),
    implementationNotes: text("implementation_notes"),
    rollbackNotes: text("rollback_notes"),
    implementedAt: timestamp("implemented_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("changes_number_uidx").on(t.number),
    index("changes_status_idx").on(t.status),
    index("changes_requester_idx").on(t.requesterId),
    index("changes_risk_idx").on(t.riskLevel),
  ],
);

export const changeAssets = pgTable(
  "change_assets",
  {
    changeId: uuid("change_id")
      .notNull()
      .references(() => changeRequests.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.changeId, t.assetId] }), index("change_assets_asset_idx").on(t.assetId)],
);

export const changeApprovals = pgTable(
  "change_approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    changeId: uuid("change_id")
      .notNull()
      .references(() => changeRequests.id, { onDelete: "cascade" }),
    approverId: uuid("approver_id").references(() => users.id, { onDelete: "set null" }),
    decision: approvalDecisionEnum("decision").notNull(),
    comment: text("comment"),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("change_approvals_unique_uidx").on(t.changeId, t.approverId)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: notificationTypeEnum("type").notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    message: text("message").notNull(),
    link: varchar("link", { length: 300 }),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notifications_user_read_idx").on(t.userId, t.readAt), index("notifications_created_idx").on(t.createdAt)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: varchar("action", { length: 80 }).notNull(),
    entityType: varchar("entity_type", { length: 60 }).notNull(),
    entityId: varchar("entity_id", { length: 64 }).notNull(),
    summary: text("summary").notNull(),
    metadata: jsonb("metadata"),
    ipAddress: varchar("ip_address", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_entity_idx").on(t.entityType, t.entityId),
    index("audit_created_idx").on(t.createdAt),
    index("audit_actor_idx").on(t.actorId),
  ],
);
