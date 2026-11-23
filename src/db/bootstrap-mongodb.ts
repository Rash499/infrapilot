import "@/lib/load-env";
import { MongoClient } from "mongodb";
import { initializeAppDatabase } from "@/db/app_db";
import { closeMongo } from "@/db/mongo";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for MongoDB bootstrap`);
  return value;
}

async function main(): Promise<void> {
  const rootUser = required("MONGO_ROOT_USER");
  const rootPassword = required("MONGO_ROOT_PASSWORD");
  const appUser = required("MONGO_APP_USER");
  const appPassword = required("MONGO_APP_PASSWORD");
  const databaseName = required("MONGODB_DB");
  if (!/^[A-Za-z0-9_]+$/.test(appUser)) {
    throw new Error("MONGO_APP_USER must contain only letters, numbers, and underscores");
  }
  if (!/^[a-fA-F0-9]{64,}$/.test(appPassword)) {
    throw new Error("MONGO_APP_PASSWORD must be at least 32 bytes encoded as hexadecimal for a URI-safe Compose connection");
  }
  const host = process.env.MONGO_HOST ?? "mongo";
  const rootUri = new URL(`mongodb://${host}:27017/admin`);
  rootUri.username = rootUser;
  rootUri.password = rootPassword;
  rootUri.searchParams.set("authSource", "admin");
  rootUri.searchParams.set("directConnection", "true");

  const rootClient = new MongoClient(rootUri.toString(), { serverSelectionTimeoutMS: 5000 });
  try {
    await rootClient.connect();
    const admin = rootClient.db("admin");
    try {
      await admin.command({ replSetGetStatus: 1 });
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === 94)) throw error;
      await admin.command({
        replSetInitiate: {
          _id: "rs0",
          members: [{ _id: 0, host: `${host}:27017` }],
        },
      });
    }

    const deadline = Date.now() + 60_000;
    let isPrimary = false;
    while (Date.now() < deadline) {
      const hello = await admin.command({ hello: 1 });
      if (hello.isWritablePrimary === true) {
        isPrimary = true;
        break;
      }
      await delay(1000);
    }
    if (!isPrimary) throw new Error("MongoDB replica set did not elect a primary within 60 seconds");

    const appDatabase = rootClient.db(databaseName);
    const userInfo = await appDatabase.command({ usersInfo: appUser });
    if (userInfo.users.length === 0) {
      await appDatabase.command({
        createUser: appUser,
        pwd: appPassword,
        roles: [{ role: "readWrite", db: databaseName }],
      });
    } else {
      await appDatabase.command({
        updateUser: appUser,
        pwd: appPassword,
        roles: [{ role: "readWrite", db: databaseName }],
      });
    }
  } finally {
    await rootClient.close();
  }

  const result = await initializeAppDatabase();
  console.log(`MongoDB database "${result.database}" ready: ${result.collectionsCreated} collections created; ${result.indexesEnsured} indexes ensured.`);
}

main()
  .catch((error: unknown) => {
    console.error("MongoDB bootstrap failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongo();
  });
