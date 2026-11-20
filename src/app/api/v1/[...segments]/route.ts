import { dispatch } from "@/routes";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ segments: string[] }> };

async function handle(req: Request, ctx: Ctx): Promise<Response> {
  const { segments } = await ctx.params;
  return dispatch(req, segments);
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
