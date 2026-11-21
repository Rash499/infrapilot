import "dotenv/config";
import { closeMongo } from "./mongo";
import { initializeAppDatabase } from "./app_db";

async function main(): Promise<void> {
  const result = await initializeAppDatabase();
  console.log(`MongoDB database "${result.database}" ready: ${result.collectionsCreated} collections created; ${result.indexesEnsured} indexes ensured.`);
}

main()
  .catch((error: unknown) => {
    console.error("MongoDB initialization failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongo();
  });
