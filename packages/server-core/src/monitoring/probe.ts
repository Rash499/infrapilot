import http from "node:http";
import https from "node:https";
import net, { isIP } from "node:net";
import { DestinationError, assertSafeDestination, parseMonitorUrl, validatePort } from "@/lib/ssrf";

export type ServiceState = "healthy" | "degraded" | "unavailable" | "unknown";

export interface ProbeConfig {
  monitorType: "http" | "tcp";
  url: string | null;
  host: string | null;
  port: number | null;
  expectedStatusCode: number | null;
  timeoutMs: number;
  allowPrivateNetwork: boolean;
}

export interface ProbeResult {
  success: boolean;
  responseTimeMs: number | null;
  statusCode: number | null;
  errorMessage: string | null;
}

function failure(started: number, message: string, statusCode: number | null = null): ProbeResult {
  return { success: false, responseTimeMs: Math.round(performance.now() - started), statusCode, errorMessage: message };
}

/** Maps low-level network errors to short, non-sensitive messages suitable for display. */
export function describeNetworkError(err: unknown): string {
  if (err instanceof DestinationError) return err.message;
  const code = (err as NodeJS.ErrnoException | undefined)?.code ?? "";
  switch (code) {
    case "ECONNREFUSED":
      return "Connection refused";
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "Host could not be resolved";
    case "ECONNRESET":
      return "Connection reset by peer";
    case "ETIMEDOUT":
      return "Timed out";
    case "CERT_HAS_EXPIRED":
      return "TLS certificate has expired";
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "SELF_SIGNED_CERT_IN_CHAIN":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
      return "TLS certificate is not trusted";
    case "ERR_TLS_CERT_ALTNAME_INVALID":
      return "TLS certificate does not match the host name";
    default:
      return "Request failed";
  }
}

type LookupCallback = (err: Error | null, address: string | Array<{ address: string; family: number }>, family?: number) => void;

/** Forces the transport to use an address that was already validated, defeating DNS rebinding. */
function pinnedLookup(address: string) {
  return (_hostname: string, options: { all?: boolean } | number, callback: LookupCallback) => {
    const family = isIP(address);
    if (typeof options === "object" && options !== null && options.all) {
      callback(null, [{ address, family }]);
    } else {
      callback(null, address, family);
    }
  };
}

async function probeHttp(cfg: ProbeConfig, started: number): Promise<ProbeResult> {
  if (!cfg.url) return failure(started, "No URL configured");
  const url = parseMonitorUrl(cfg.url);
  const isHttps = url.protocol === "https:";
  const port = url.port ? Number(url.port) : isHttps ? 443 : 80;
  validatePort(port);
  const [pinned] = await assertSafeDestination(url.hostname, cfg.allowPrivateNetwork);
  if (!pinned) throw new DestinationError("Host could not be resolved");

  const transport = isHttps ? https : http;
  return new Promise<ProbeResult>((resolve) => {
    let settled = false;
    const finish = (result: ProbeResult) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    const req = transport.request(
      {
        hostname: url.hostname,
        port,
        path: `${url.pathname}${url.search}` || "/",
        method: "GET",
        headers: { "User-Agent": "InfraPilot-Monitor/1.0", Accept: "*/*" },
        timeout: cfg.timeoutMs,
        // The cast is required because @types/node models custom lookups loosely; behaviour is verified above.
        lookup: pinnedLookup(pinned) as never,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        res.resume();
        const ok = cfg.expectedStatusCode !== null ? status === cfg.expectedStatusCode : status >= 200 && status < 400;
        finish({
          success: ok,
          responseTimeMs: Math.round(performance.now() - started),
          statusCode: status,
          errorMessage: ok ? null : `Unexpected HTTP status ${status}`,
        });
      },
    );
    req.on("timeout", () => {
      finish(failure(started, "Timed out"));
      req.destroy();
    });
    req.on("error", (err) => finish(failure(started, describeNetworkError(err))));
    req.end();
  });
}

async function probeTcp(cfg: ProbeConfig, started: number): Promise<ProbeResult> {
  if (!cfg.host || cfg.port === null) return failure(started, "Host and port are required");
  const port = cfg.port;
  validatePort(port);
  const [pinned] = await assertSafeDestination(cfg.host, cfg.allowPrivateNetwork);
  if (!pinned) throw new DestinationError("Host could not be resolved");

  return new Promise<ProbeResult>((resolve) => {
    let settled = false;
    const finish = (result: ProbeResult) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    const socket = net.connect({ host: pinned, port });
    socket.setTimeout(cfg.timeoutMs, () => {
      finish(failure(started, "Timed out"));
      socket.destroy();
    });
    socket.once("connect", () => {
      finish({
        success: true,
        responseTimeMs: Math.round(performance.now() - started),
        statusCode: null,
        errorMessage: null,
      });
      socket.destroy();
    });
    socket.once("error", (err) => finish(failure(started, describeNetworkError(err))));
  });
}

/** Executes one availability probe. Never throws: every failure becomes a structured result. */
export async function runProbe(cfg: ProbeConfig): Promise<ProbeResult> {
  const started = performance.now();
  try {
    return cfg.monitorType === "http" ? await probeHttp(cfg, started) : await probeTcp(cfg, started);
  } catch (err) {
    return failure(started, describeNetworkError(err));
  }
}

/**
 * Pure state machine. A successful check is Healthy unless it exceeds the degraded latency threshold.
 * Failures are Degraded until `failureThreshold` consecutive failures, then Unavailable.
 */
export function computeState(
  prev: { status: ServiceState; consecutiveFailures: number },
  result: { success: boolean; responseTimeMs: number | null },
  opts: { failureThreshold: number; degradedThresholdMs: number },
): { status: ServiceState; consecutiveFailures: number } {
  if (result.success) {
    const slow = (result.responseTimeMs ?? 0) > opts.degradedThresholdMs;
    return { status: slow ? "degraded" : "healthy", consecutiveFailures: 0 };
  }
  const failures = prev.consecutiveFailures + 1;
  return {
    status: failures >= opts.failureThreshold ? "unavailable" : "degraded",
    consecutiveFailures: failures,
  };
}

/** Rolls up monitored service states into an asset status. Unavailable dominates, then degraded, then healthy. */
export function rollupAssetStatus(states: ServiceState[]): ServiceState {
  if (states.length === 0) return "unknown";
  if (states.includes("unavailable")) return "unavailable";
  if (states.includes("degraded")) return "degraded";
  if (states.includes("healthy")) return "healthy";
  return "unknown";
}
