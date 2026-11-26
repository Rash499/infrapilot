import { authRoutes } from "@/controllers/auth.controller";
import { usersRoutes } from "@/controllers/users.controller";
import { assetRoutes } from "@/controllers/assets.controller";
import { monitoringRoutes } from "@/controllers/monitoring.controller";
import { workRoutes } from "@/controllers/work.controller";
import { opsRoutes } from "@/controllers/ops.controller";
import { getEnv } from "@/lib/env";
import { ApiError, clientIp, errors, requestId, toErrorResponse } from "@/lib/http";
import { logger } from "@/lib/logger";
import type { RouteDef } from "@/routes/types";
import { z } from "zod";

/** Static segments are matched before dynamic ones (e.g. `incidents/stats` before `incidents/:id`). */
const ROUTES: RouteDef[] = [
  ...authRoutes,
  ...usersRoutes,
  ...assetRoutes,
  ...monitoringRoutes,
  ...workRoutes,
  ...opsRoutes,
].sort((a, b) => b.path.split("/").filter((s) => !s.startsWith(":")).length - a.path.split("/").filter((s) => !s.startsWith(":")).length);

export function getApiRouteDefinitions(): Array<Pick<RouteDef, "method" | "path">> {
  return ROUTES.map(({ method, path }) => ({ method, path }));
}

type Match = { route: RouteDef; params: Record<string, string> } | "method" | null;

function matchRoute(method: string, segments: string[]): Match {
  let methodMismatch = false;
  for (const route of ROUTES) {
    const parts = route.path.split("/");
    if (parts.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let i = 0; i < parts.length; i += 1) {
      const pattern = parts[i]!;
      const segment = segments[i]!;
      if (pattern.startsWith(":")) {
        try {
          params[pattern.slice(1)] = decodeURIComponent(segment);
        } catch {
          matched = false;
          break;
        }
      } else if (pattern !== segment) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;
    if (route.method !== method) {
      methodMismatch = true;
      continue;
    }
    return { route, params };
  }
  return methodMismatch ? "method" : null;
}

const uuidCheck = z.uuid();

/** Blocks cross-origin state-changing requests when the Origin header does not match the app. */
function assertSameOrigin(req: Request): void {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  if (!origin) return;
  // Browsers state how the initiator relates to the target and forbid scripts from setting this header,
  // so "same-origin" stays trustworthy even behind a proxy that rewrites the Host header.
  if (req.headers.get("sec-fetch-site") === "same-origin") return;
  const allowed = getEnv().APP_ORIGIN;
  // Behind a proxy the internal request URL may differ from the public host, so compare with the host the browser used.
  const publicHost = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const originHost = (() => {
    try {
      return new URL(origin).host;
    } catch {
      return null;
    }
  })();
  const sameHost = !!publicHost && originHost === publicHost;
  if (!sameHost && origin !== allowed && origin !== new URL(req.url).origin) {
    throw errors.forbidden("Cross-origin request blocked");
  }
}

/** Central dispatcher for every /api/v1 request: routing, origin checks, error mapping, and access logging. */
export async function dispatch(req: Request, segments: string[]): Promise<Response> {
  const rid = requestId(req);
  const started = performance.now();
  const path = `/${segments.join("/")}`;
  let status = 500;
  try {
    assertSameOrigin(req);
    const match = matchRoute(req.method.toUpperCase(), segments);
    if (match === "method") throw new ApiError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
    if (!match) throw errors.notFound("Endpoint");
    if (match.params.id !== undefined && !uuidCheck.safeParse(match.params.id).success) {
      throw errors.badRequest("Invalid identifier");
    }
    const response = await match.route.handler({
      req,
      params: match.params,
      ip: clientIp(req),
      requestId: rid,
    });
    status = response.status;
    response.headers.set("X-Request-Id", rid);
    return response;
  } catch (err) {
    const response = toErrorResponse(err, rid);
    status = response.status;
    return response;
  } finally {
    logger.info("http_request", {
      requestId: rid,
      method: req.method,
      path,
      status,
      durationMs: Math.round(performance.now() - started),
    });
  }
}
