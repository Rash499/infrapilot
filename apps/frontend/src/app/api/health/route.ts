export const dynamic = "force-dynamic";

export async function GET() {
  const backendUrl = process.env.BACKEND_API_URL ?? "http://127.0.0.1:4000";
  try {
    return await fetch(`${backendUrl}/api/health`, { cache: "no-store" });
  } catch {
    return Response.json(
      { data: { status: "unavailable" }, error: { code: "BACKEND_UNAVAILABLE", message: "Backend API is unavailable" } },
      { status: 503 },
    );
  }
}
