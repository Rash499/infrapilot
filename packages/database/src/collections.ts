import { randomUUID } from "node:crypto";
import type { Collection, Document, ClientSession } from "mongodb";
import { getMongoClient, getMongoDb } from "@/db/mongo";

/**
 * Stable collection names for the MongoDB data layer.
 * Domain references remain UUID strings so API identifiers do not change during migration.
 */
export const collections = {
  users: "users",
  counters: "counters",
  refreshTokens: "refresh_tokens",
  passwordResetTokens: "password_reset_tokens",
  assets: "assets",
  monitoringTargets: "monitoring_targets",
  monitoringResults: "monitoring_results",
  securityFindings: "security_findings",
  findingEvents: "finding_events",
  incidents: "incidents",
  incidentAssets: "incident_assets",
  incidentComments: "incident_comments",
  maintenances: "maintenances",
  maintenanceAssets: "maintenance_assets",
  changeRequests: "change_requests",
  changeAssets: "change_assets",
  changeApprovals: "change_approvals",
  notifications: "notifications",
  auditLogs: "audit_logs",
  workerStatuses: "worker_statuses",
  alerts: "alerts",
  scanImports: "scan_imports",
} as const;

export type InfraPilotCollectionName = (typeof collections)[keyof typeof collections];

export interface MongoEntity extends Document {
  /** UUID string retained as the public/domain identifier. */
  _id: string;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Returns a typed collection without creating or modifying it. */
export async function getCollection<T extends MongoEntity = MongoEntity>(
  name: InfraPilotCollectionName,
): Promise<Collection<T>> {
  const database = await getMongoDb();
  return database.collection<T>(name);
}

/** Generate an application-level UUID for a new document. */
export function newDocumentId(): string {
  return randomUUID();
}

/** Generate matching `_id` and `id` UUID fields for collections indexed on `{ id: 1 }`. */
export function newEntityIds(): { _id: string; id: string } {
  const id = newDocumentId();
  return { _id: id, id };
}

/**
 * Run a multi-document operation atomically.
 * Requires MongoDB to run as a replica set (the local development set is rs0).
 */
export async function withMongoTransaction<T>(
  operation: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const client = await getMongoClient();
  const session = client.startSession();

  try {
    let outcome: { value: T } | undefined;
    await session.withTransaction(async () => {
      const value = await operation(session);
      outcome = { value };
      return value;
    });
    if (!outcome) {
      throw new Error("MongoDB transaction completed without producing a result");
    }
    return outcome.value;
  } finally {
    await session.endSession();
  }
}
