import { randomUUID } from "node:crypto";
import type { Collection, Document, ClientSession } from "mongodb";
import { getMongoClient, getMongoDb } from "@/db/mongo";

/**
 * Stable collection names for the MongoDB data layer.
 * Domain references remain UUID strings so API identifiers do not change during migration.
 */
export const collections = {
  users: "users",
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
    let result: T | undefined;
    await session.withTransaction(async () => {
      result = await operation(session);
      return result;
    });
    if (result === undefined) {
      throw new Error("MongoDB transaction completed without producing a result");
    }
    return result;
  } finally {
    await session.endSession();
  }
}
