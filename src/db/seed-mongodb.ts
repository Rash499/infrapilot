import "@/lib/load-env";
import { initializeAppDatabase } from "@/db/app_db";
import { closeMongo } from "@/db/mongo";
import { findUserByEmail, insertUser } from "@/db/repositories/users.repository";
import { hashPassword } from "@/lib/security";

async function main(): Promise<void> {
  const password = process.env.SEED_PASSWORD;
  if (!password) throw new Error("SEED_PASSWORD is required to create the MongoDB seed administrator");

  await initializeAppDatabase();
  const email = (process.env.SEED_ADMIN_EMAIL ?? "admin@infrapilot.local").trim().toLowerCase();
  if (await findUserByEmail(email)) {
    console.log(`MongoDB seed skipped: ${email} already exists.`);
    return;
  }

  const user = await insertUser({
    email,
    name: process.env.SEED_ADMIN_NAME ?? "InfraPilot Administrator",
    passwordHash: await hashPassword(password),
    role: "admin",
  });
  console.log(`MongoDB seed administrator created: ${user.email}`);
}

main()
  .catch((error: unknown) => {
    console.error("MongoDB seed failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongo();
  });
