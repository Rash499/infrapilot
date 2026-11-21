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
  const { initializeAppDatabase } = await import("./app_db");
  await initializeAppDatabase();
}

