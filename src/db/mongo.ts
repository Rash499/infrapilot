import { MongoClient, type Db, type MongoClientOptions } from "mongodb";

const globalForMongo = globalThis as typeof globalThis & {
  __infrapilotMongoClient?: MongoClient;
  __infrapilotMongoPromise?: Promise<MongoClient>;
};

function mongoConfig(): { uri: string; database: string } {
  const uri = process.env.MONGODB_URI;
  const database = process.env.MONGODB_DB ?? "infrapilot";

  if (!uri) {
    throw new Error("MONGODB_URI is required before using the MongoDB data layer");
  }
  if (!/^mongodb(?:\+srv)?:\/\//i.test(uri)) {
    throw new Error("MONGODB_URI must use the mongodb:// or mongodb+srv:// scheme");
  }
  if (!database.trim()) {
    throw new Error("MONGODB_DB must not be empty");
  }

  return { uri, database };
}

const options: MongoClientOptions = {
  appName: "InfraPilot",
  maxPoolSize: 20,
  minPoolSize: 0,
  serverSelectionTimeoutMS: 5000,
  connectTimeoutMS: 10000,
  retryWrites: true,
};

export async function getMongoClient(): Promise<MongoClient> {
  if (globalForMongo.__infrapilotMongoClient) {
    return globalForMongo.__infrapilotMongoClient;
  }

  if (!globalForMongo.__infrapilotMongoPromise) {
    const { uri } = mongoConfig();
    const client = new MongoClient(uri, options);
    globalForMongo.__infrapilotMongoPromise = client.connect().then(
      (connected) => {
        globalForMongo.__infrapilotMongoClient = connected;
        return connected;
      },
      (error: unknown) => {
        globalForMongo.__infrapilotMongoPromise = undefined;
        throw error;
      },
    );
  }

  return globalForMongo.__infrapilotMongoPromise;
}

export async function getMongoDb(): Promise<Db> {
  const { database } = mongoConfig();
  const client = await getMongoClient();
  return client.db(database);
}

/** Close the shared pool during graceful process shutdown or in isolated tests. */
export async function closeMongo(): Promise<void> {
  const client = globalForMongo.__infrapilotMongoClient;
  globalForMongo.__infrapilotMongoClient = undefined;
  globalForMongo.__infrapilotMongoPromise = undefined;
  if (client) await client.close();
}

/**
 * Create the indexes relied on by the domain services.
 * This function is intentionally explicit and idempotent; it never drops collections or indexes.
 */
export async function ensureMongoIndexes(): Promise<void> {
  const db = await getMongoDb();

  await Promise.all([
    db.collection("users").createIndex({ email: 1 }, { unique: true, name: "users_email_unique" }),
    db.collection("users").createIndex({ role: 1, isActive: 1 }, { name: "users_role_active" }),
    db.collection("refresh_tokens").createIndex({ tokenHash: 1 }, { unique: true, name: "refresh_tokens_hash_unique" }),
    db.collection("refresh_tokens").createIndex({ userId: 1, revokedAt: 1 }, { name: "refresh_tokens_user_revoked" }),
    db.collection("refresh_tokens").createIndex({ familyId: 1 }, { name: "refresh_tokens_family" }),
    db.collection("password_reset_tokens").createIndex({ tokenHash: 1 }, { unique: true, name: "password_reset_hash_unique" }),
    db.collection("password_reset_tokens").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "password_reset_expiry_ttl" }),
    db.collection("assets").createIndex({ assetType: 1, environment: 1, status: 1 }, { name: "assets_type_environment_status" }),
    db.collection("assets").createIndex({ hostname: 1 }, { sparse: true, name: "assets_hostname" }),
    db.collection("monitoring_targets").createIndex({ enabled: 1, nextCheckAt: 1 }, { name: "monitoring_due_targets" }),
    db.collection("monitoring_results").createIndex({ targetId: 1, checkedAt: -1 }, { name: "monitoring_results_target_time" }),
    db.collection("monitoring_results").createIndex({ checkedAt: 1 }, { name: "monitoring_results_retention" }),
    db.collection("security_findings").createIndex({ status: 1, severity: 1 }, { name: "findings_status_severity" }),
    db.collection("incidents").createIndex({ number: 1 }, { unique: true, name: "incidents_number_unique" }),
    db.collection("incidents").createIndex({ status: 1, openedAt: -1 }, { name: "incidents_status_opened" }),
    db.collection("maintenances").createIndex({ status: 1, startsAt: 1 }, { name: "maintenances_status_start" }),
    db.collection("change_requests").createIndex({ number: 1 }, { unique: true, name: "changes_number_unique" }),
    db.collection("notifications").createIndex({ userId: 1, readAt: 1, createdAt: -1 }, { name: "notifications_user_read_created" }),
    db.collection("audit_logs").createIndex({ entityType: 1, entityId: 1, createdAt: -1 }, { name: "audit_entity_history" }),
    db.collection("audit_logs").createIndex({ createdAt: -1 }, { name: "audit_created" }),
  ]);
}
