export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface HandlerContext {
  req: Request;
  params: Record<string, string>;
  ip: string;
  requestId: string;
}

export type RouteHandler = (ctx: HandlerContext) => Promise<Response>;

/** Declarative route definition. `path` is relative to /api/v1 and may contain `:param` segments. */
export interface RouteDef {
  method: HttpMethod;
  path: string;
  handler: RouteHandler;
}
