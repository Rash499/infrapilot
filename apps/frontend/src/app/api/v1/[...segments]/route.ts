export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ segments: string[] }> };

async function handle(req: Request, ctx: Ctx): Promise<Response> {
  const { segments } = await ctx.params;
  const backendUrl = process.env.BACKEND_API_URL ?? "http://127.0.0.1:4000";
  const url = new URL(`/api/v1/${segments.join("/")}`, backendUrl);
  url.search = new URL(req.url).search;
  const headers = new Headers(req.headers);
  headers.delete("host");
  return fetch(url, {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.text(),
  });
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
