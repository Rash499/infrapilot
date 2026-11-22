import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

type DependencyState = "ok" | "unavailable" | "invalid";

/**
 * Readiness probe. Every API handler depends on all of these:
 * - configuration: the validated environment (details are never exposed here)
 * - postgresql: the active datastore for every service module
 * - mongodb: staged migration target, only probed when MONGODB_URI is configured
 */
export async function GET() {
  const dependencies: Record<string, DependencyState> = { configuration: "invalid", postgresql: "unavailable" };

  try {
    getEnv();
    dependencies.configuration = "ok";
  } catch {
    return Response.json({ ok: false, dependencies }, { status: 503 });
  }

  try {
    await db.execute(sql`select 1`);
    dependencies.postgresql = "ok";
  } catch {
    return Response.json({ ok: false, dependencies }, { status: 503 });
  }

  if (process.env.MONGODB_URI) {
    try {
      const { getMongoDb } = await import("@/db/mongo");
      const database = await getMongoDb();
      await database.command({ ping: 1 });
      dependencies.mongodb = "ok";
    } catch {
      dependencies.mongodb = "unavailable";
    }
  }

  return Response.json({ ok: true, dependencies });
}
