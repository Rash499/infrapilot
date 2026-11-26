import "dotenv/config";
import "@infrapilot/server-core/load-env";
import { closeMongo, ensureMongoIndexes, getMongoDb } from "@infrapilot/database";

async function main(): Promise<void> {
  try {
    const database = await getMongoDb();
    await database.command({ ping: 1 });
    console.log(`MongoDB connection OK (database: ${database.databaseName})`);

    await ensureMongoIndexes();
    console.log("MongoDB indexes verified/created (no collections or data were dropped).");
  } finally {
    await closeMongo();
  }
}

main().catch((error: unknown) => {
  console.error("MongoDB check failed:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
});
