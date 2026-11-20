import { ZodError, type ZodType } from "zod";
import { logger } from "@/lib/logger";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const errors = {
  badRequest: (message = "Invalid request", details?: unknown) => new ApiError(400, "BAD_REQUEST", message, details),
  unauthorized: (message = "Authentication required") => new ApiError(401, "UNAUTHORIZED", message),
  forbidden: (message = "You do not have permission to perform this action") => new ApiError(403, "FORBIDDEN", message),
  notFound: (what = "Resource") => new ApiError(404, "NOT_FOUND", `${what} not found`),
  conflict: (message: string) => new ApiError(409, "CONFLICT", message),
  unprocessable: (message: string, details?: unknown) => new ApiError(422, "UNPROCESSABLE", message, details),
  tooManyRequests: (message = "Too many requests, please try again later") =>
    new ApiError(429, "RATE_LIMITED", message),
};

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function jsonOk<T>(data: T, init?: { status?: number; meta?: Record<string, unknown>; headers?: HeadersInit }) {
  const body = init?.meta ? { data, meta: init.meta } : { data };
  return Response.json(body, { status: init?.status ?? 200, headers: init?.headers });
}

export function jsonList<T>(items: T[], pagination: PaginationMeta, extraMeta?: Record<string, unknown>) {
  return Response.json({ data: items, meta: { ...pagination, ...(extraMeta ?? {}) } }, { status: 200 });
}

export function errorResponse(status: number, code: string, message: string, details?: unknown, headers?: HeadersInit) {
  const body: { error: { code: string; message: string; details?: unknown } } = { error: { code, message } };
  if (details !== undefined) body.error.details = details;
  return Response.json(body, { status, headers });
}

/** Converts any thrown value into a safe API response without leaking internals. */
export function toErrorResponse(err: unknown, requestId: string): Response {
  if (err instanceof ApiError) {
    return errorResponse(err.status, err.code, err.message, err.details, { "X-Request-Id": requestId });
  }
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    return errorResponse(400, "VALIDATION_ERROR", "Request validation failed", details, { "X-Request-Id": requestId });
  }
  if (err instanceof SyntaxError) {
    return errorResponse(400, "MALFORMED_JSON", "Request body must be valid JSON", undefined, {
      "X-Request-Id": requestId,
    });
  }
  const pgCode = (err as { code?: string } | null)?.code;
  if (pgCode === "23505") {
    return errorResponse(409, "CONFLICT", "A record with the same unique value already exists", undefined, {
      "X-Request-Id": requestId,
    });
  }
  if (pgCode === "23503") {
    return errorResponse(422, "UNPROCESSABLE", "A referenced record does not exist", undefined, {
      "X-Request-Id": requestId,
    });
  }
  logger.error("unhandled_error", { requestId, error: err instanceof Error ? err.message : "unknown" });
  return errorResponse(500, "INTERNAL_ERROR", "An unexpected error occurred", undefined, { "X-Request-Id": requestId });
}

export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(400, "MALFORMED_JSON", "Request body must be valid JSON");
  }
  return schema.parse(raw);
}

export function parseQuery<T>(req: Request, schema: ZodType<T>): T {
  const params = Object.fromEntries(new URL(req.url).searchParams.entries());
  return schema.parse(params);
}

export function requestId(req: Request): string {
  return req.headers.get("x-request-id")?.slice(0, 64) || crypto.randomUUID();
}

export function clientIp(req: Request): string {
  if (process.env.TRUST_PROXY_HEADERS === "true") {
    const fwd = req.headers.get("x-forwarded-for");
    if (fwd) return fwd.split(",")[0]!.trim().slice(0, 64);
    const real = req.headers.get("x-real-ip");
    if (real) return real.slice(0, 64);
  }
  return "local";
}

export function paginationMeta(page: number, pageSize: number, total: number): PaginationMeta {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}
