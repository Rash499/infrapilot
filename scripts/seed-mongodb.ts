import "@infrapilot/server-core/load-env";
import { closeMongo, ensureMongoIndexes, findUserByEmail, insertUser } from "@infrapilot/database";
import { hashPassword } from "@infrapilot/server-core";

async function main(): Promise<void> {
  const password = process.env.SEED_PASSWORD;
  if (!password) throw new Error("SEED_PASSWORD is required to create MongoDB seed users");

  await ensureMongoIndexes();
  const users = [
    { email: process.env.SEED_ADMIN_EMAIL ?? "admin@infrapilot.local", name: process.env.SEED_ADMIN_NAME ?? "InfraPilot Administrator", role: "admin" as const },
    { email: process.env.SEED_OPERATOR_EMAIL ?? "operator@infrapilot.local", name: "InfraPilot Operator", role: "operator" as const },
    { email: process.env.SEED_VIEWER_EMAIL ?? "viewer@infrapilot.local", name: "InfraPilot Viewer", role: "viewer" as const },
  ];
  for (const seed of users) {
    const email = seed.email.trim().toLowerCase();
    if (await findUserByEmail(email)) {
      console.log(`MongoDB seed skipped: ${email} already exists.`);
      continue;
    }

    const user = await insertUser({
      email,
      name: seed.name,
      passwordHash: await hashPassword(password),
      role: seed.role,
    });
    console.log(`MongoDB seed user created: ${user.email} (${user.role}).`);
  }
}

main()
  .catch((error: unknown) => {
    console.error("MongoDB seed failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongo();
  });
