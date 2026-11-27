import type { CreateIndexesOptions, IndexSpecification } from "mongodb";
import type { CounterDoc } from "@/db/models/documents";
import { getMongoDb } from "./mongo";

/**
 * InfraPilot MongoDB database bootstrap.
 * Idempotent: creates missing collections and indexes only. It never drops data.
 */
const COLLECTIONS = [
  "users", "counters", "refresh_tokens", "password_reset_tokens", "assets",
  "monitoring_targets", "monitoring_results", "security_findings", "finding_events",
  "incidents", "incident_assets", "incident_comments", "maintenances",
  "maintenance_assets", "change_requests", "change_assets", "change_approvals",
  "notifications", "audit_logs",
  "worker_statuses", "alerts", "scan_imports",
] as const;

type CollectionName = (typeof COLLECTIONS)[number];
type IndexSpec = {
  collection: CollectionName;
  keys: IndexSpecification;
  options: CreateIndexesOptions & { name: string };
};

const INDEXES: IndexSpec[] = [
  { collection: "users", keys: { id: 1 }, options: { unique: true, name: "users_id_unique" } },
  { collection: "users", keys: { email: 1 }, options: { unique: true, name: "users_email_unique" } },
  { collection: "users", keys: { role: 1, isActive: 1 }, options: { name: "users_role_active" } },
  { collection: "counters", keys: { id: 1 }, options: { unique: true, name: "counters_id_unique" } },

  { collection: "refresh_tokens", keys: { id: 1 }, options: { unique: true, name: "refresh_tokens_id_unique" } },
  { collection: "refresh_tokens", keys: { tokenHash: 1 }, options: { unique: true, name: "refresh_tokens_hash_unique" } },
  { collection: "refresh_tokens", keys: { userId: 1, revokedAt: 1 }, options: { name: "refresh_tokens_user_revoked" } },
  { collection: "refresh_tokens", keys: { familyId: 1 }, options: { name: "refresh_tokens_family" } },
  { collection: "refresh_tokens", keys: { expiresAt: 1 }, options: { name: "refresh_tokens_expiry" } },

  { collection: "password_reset_tokens", keys: { id: 1 }, options: { unique: true, name: "password_reset_id_unique" } },
  { collection: "password_reset_tokens", keys: { tokenHash: 1 }, options: { unique: true, name: "password_reset_hash_unique" } },
  { collection: "password_reset_tokens", keys: { userId: 1, expiresAt: 1 }, options: { name: "password_reset_user_expiry" } },

  { collection: "assets", keys: { id: 1 }, options: { unique: true, name: "assets_id_unique" } },
  { collection: "assets", keys: { assetType: 1, environment: 1, status: 1 }, options: { name: "assets_type_environment_status" } },
  { collection: "assets", keys: { hostname: 1 }, options: { sparse: true, name: "assets_hostname" } },
  { collection: "assets", keys: { name: 1 }, options: { name: "assets_name" } },
  { collection: "assets", keys: { archivedAt: 1 }, options: { name: "assets_archived" } },
  { collection: "assets", keys: { ownerId: 1 }, options: { name: "assets_owner" } },

  { collection: "monitoring_targets", keys: { id: 1 }, options: { unique: true, name: "monitoring_targets_id_unique" } },
  { collection: "monitoring_targets", keys: { enabled: 1, nextCheckAt: 1 }, options: { name: "monitoring_due_targets" } },
  { collection: "monitoring_targets", keys: { assetId: 1 }, options: { name: "monitoring_targets_asset" } },
  { collection: "monitoring_targets", keys: { status: 1 }, options: { name: "monitoring_targets_status" } },

  { collection: "monitoring_results", keys: { id: 1 }, options: { unique: true, name: "monitoring_results_id_unique" } },
  { collection: "monitoring_results", keys: { targetId: 1, checkedAt: -1 }, options: { name: "monitoring_results_target_time" } },
  { collection: "monitoring_results", keys: { checkedAt: 1 }, options: { name: "monitoring_results_retention" } },

  { collection: "security_findings", keys: { id: 1 }, options: { unique: true, name: "security_findings_id_unique" } },
  { collection: "security_findings", keys: { status: 1, severity: 1 }, options: { name: "findings_status_severity" } },
  { collection: "security_findings", keys: { assetId: 1 }, options: { name: "findings_asset" } },
  { collection: "security_findings", keys: { assigneeId: 1 }, options: { name: "findings_assignee" } },

  { collection: "finding_events", keys: { id: 1 }, options: { unique: true, name: "finding_events_id_unique" } },
  { collection: "finding_events", keys: { findingId: 1, createdAt: -1 }, options: { name: "finding_events_history" } },

  { collection: "incidents", keys: { id: 1 }, options: { unique: true, name: "incidents_id_unique" } },
  { collection: "incidents", keys: { number: 1 }, options: { unique: true, name: "incidents_number_unique" } },
  { collection: "incidents", keys: { status: 1, openedAt: -1 }, options: { name: "incidents_status_opened" } },
  { collection: "incidents", keys: { severity: 1 }, options: { name: "incidents_severity" } },
  { collection: "incidents", keys: { assigneeId: 1 }, options: { name: "incidents_assignee" } },

  { collection: "incident_assets", keys: { incidentId: 1, assetId: 1 }, options: { unique: true, name: "incident_assets_pair_unique" } },
  { collection: "incident_assets", keys: { assetId: 1 }, options: { name: "incident_assets_asset" } },
  { collection: "incident_comments", keys: { id: 1 }, options: { unique: true, name: "incident_comments_id_unique" } },
  { collection: "incident_comments", keys: { incidentId: 1, createdAt: 1 }, options: { name: "incident_comments_timeline" } },

  { collection: "maintenances", keys: { id: 1 }, options: { unique: true, name: "maintenances_id_unique" } },
  { collection: "maintenances", keys: { status: 1, startsAt: 1 }, options: { name: "maintenances_status_start" } },
  { collection: "maintenances", keys: { ownerId: 1 }, options: { name: "maintenances_owner" } },
  { collection: "maintenance_assets", keys: { maintenanceId: 1, assetId: 1 }, options: { unique: true, name: "maintenance_assets_pair_unique" } },
  { collection: "maintenance_assets", keys: { assetId: 1 }, options: { name: "maintenance_assets_asset" } },

  { collection: "change_requests", keys: { id: 1 }, options: { unique: true, name: "change_requests_id_unique" } },
  { collection: "change_requests", keys: { number: 1 }, options: { unique: true, name: "changes_number_unique" } },
  { collection: "change_requests", keys: { status: 1, createdAt: -1 }, options: { name: "changes_status_created" } },
  { collection: "change_requests", keys: { requesterId: 1 }, options: { name: "changes_requester" } },
  { collection: "change_requests", keys: { riskLevel: 1 }, options: { name: "changes_risk" } },
  { collection: "change_assets", keys: { changeId: 1, assetId: 1 }, options: { unique: true, name: "change_assets_pair_unique" } },
  { collection: "change_assets", keys: { assetId: 1 }, options: { name: "change_assets_asset" } },
  { collection: "change_approvals", keys: { id: 1 }, options: { unique: true, name: "change_approvals_id_unique" } },
  { collection: "change_approvals", keys: { changeId: 1, approverId: 1 }, options: { unique: true, name: "change_approvals_change_approver_unique" } },

  { collection: "notifications", keys: { id: 1 }, options: { unique: true, name: "notifications_id_unique" } },
  { collection: "notifications", keys: { userId: 1, readAt: 1, createdAt: -1 }, options: { name: "notifications_user_read_created" } },
  { collection: "audit_logs", keys: { id: 1 }, options: { unique: true, name: "audit_logs_id_unique" } },
  { collection: "audit_logs", keys: { entityType: 1, entityId: 1, createdAt: -1 }, options: { name: "audit_entity_history" } },
  { collection: "audit_logs", keys: { entityType: 1, entityId: 1, action: 1, createdAt: -1 }, options: { name: "audit_login_history" } },
  { collection: "audit_logs", keys: { actorId: 1, createdAt: -1 }, options: { name: "audit_actor_history" } },
  { collection: "audit_logs", keys: { createdAt: -1 }, options: { name: "audit_created" } },
  { collection: "worker_statuses", keys: { id: 1 }, options: { unique: true, name: "worker_status_id_unique" } },
  { collection: "worker_statuses", keys: { status: 1, heartbeatAt: -1 }, options: { name: "worker_status_heartbeat" } },

  // Alerts: one active alert per monitored condition, enforced by a partial unique index.
  { collection: "alerts", keys: { id: 1 }, options: { unique: true, name: "alerts_id_unique" } },
  {
    collection: "alerts",
    keys: { dedupeKey: 1 },
    options: {
      unique: true,
      name: "alerts_active_dedupe_unique",
      partialFilterExpression: { status: { $in: ["triggered", "acknowledged", "suppressed"] } },
    },
  },
  { collection: "alerts", keys: { status: 1, severity: 1, triggeredAt: -1 }, options: { name: "alerts_status_severity_time" } },
  { collection: "alerts", keys: { targetId: 1, status: 1 }, options: { name: "alerts_target_status" } },
  { collection: "alerts", keys: { assetId: 1, status: 1 }, options: { name: "alerts_asset_status" } },
  { collection: "alerts", keys: { incidentId: 1 }, options: { name: "alerts_incident" } },

  // Automatic incidents are deduplicated by their originating alert.
  {
    collection: "incidents",
    keys: { sourceAlertId: 1 },
    options: { unique: true, sparse: true, name: "incidents_source_alert_unique" },
  },
  { collection: "incidents", keys: { acknowledgedAt: 1 }, options: { sparse: true, name: "incidents_acknowledged" } },

  // Vulnerability imports: one finding per asset/CVE/component, plus import audit rows.
  {
    collection: "security_findings",
    keys: { assetId: 1, cveId: 1, component: 1 },
    options: {
      unique: true,
      name: "findings_vulnerability_unique",
      partialFilterExpression: { cveId: { $type: "string" }, component: { $type: "string" } },
    },
  },
  { collection: "security_findings", keys: { remediationDeadline: 1, status: 1 }, options: { name: "findings_deadline_status" } },
  { collection: "scan_imports", keys: { id: 1 }, options: { unique: true, name: "scan_imports_id_unique" } },
  { collection: "scan_imports", keys: { assetId: 1, importedAt: -1 }, options: { name: "scan_imports_asset_time" } },

  // Monitoring thresholds and worker leases.
  { collection: "monitoring_targets", keys: { enabled: 1, status: 1 }, options: { name: "monitoring_targets_enabled_status" } },
  { collection: "monitoring_targets", keys: { claimExpiresAt: 1 }, options: { sparse: true, name: "monitoring_targets_claim_expiry" } },
];

/** Create the InfraPilot collections and indexes without deleting existing documents. */
export async function initializeAppDatabase(): Promise<{
  database: string;
  collectionsCreated: number;
  indexesEnsured: number;
}> {
  const db = await getMongoDb();
  let collectionsCreated = 0;

  for (const name of COLLECTIONS) {
    const exists = await db.listCollections({ name }, { nameOnly: true }).hasNext();
    if (!exists) {
      await db.createCollection(name);
      collectionsCreated += 1;
    }
  }

  for (const spec of INDEXES) {
    await db.collection(spec.collection).createIndex(spec.keys, spec.options);
  }

  const counters = db.collection<CounterDoc>("counters");
  for (const [id, collection] of [
    ["incident_number", "incidents"],
    ["change_number", "change_requests"],
  ] as const) {
    const latest = await db.collection<{ number: number }>(collection).find().sort({ number: -1 }).limit(1).next();
    const maxValue = latest?.number ?? 0;
    await counters.updateOne(
      { id },
      { $max: { value: maxValue }, $setOnInsert: { _id: id, id } },
      { upsert: true },
    );
  }

  return { database: db.databaseName, collectionsCreated, indexesEnsured: INDEXES.length };
}

export const appDbCollectionNames = COLLECTIONS;
export const appDbIndexes = INDEXES;
