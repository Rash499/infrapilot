import { getMongoDb } from "@/db/mongo";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const database = await getMongoDb();
    await database.command({ ping: 1 });

    return Response.json({
      ok: true,
      dependencies: {
        mongodb: "ok",
      },
    });
  } catch {
    return Response.json(
      {
        ok: false,
        dependencies: {
          mongodb: "unavailable",
        },
      },
      { status: 503 },
    );
  }
}
