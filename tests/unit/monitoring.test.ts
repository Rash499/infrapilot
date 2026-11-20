import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeState, rollupAssetStatus, runProbe } from "@/workers/probe";

const opts = { failureThreshold: 3, degradedThresholdMs: 1000 };

describe("service state machine", () => {
  it("is healthy for a fast successful check", () => {
    expect(computeState({ status: "unknown", consecutiveFailures: 0 }, { success: true, responseTimeMs: 120 }, opts)).toEqual({
      status: "healthy",
      consecutiveFailures: 0,
    });
  });

  it("is degraded when a successful check exceeds the latency threshold", () => {
    expect(computeState({ status: "healthy", consecutiveFailures: 0 }, { success: true, responseTimeMs: 1500 }, opts).status).toBe("degraded");
  });

  it("is degraded on the first failure and unavailable after the failure threshold", () => {
    const first = computeState({ status: "healthy", consecutiveFailures: 0 }, { success: false, responseTimeMs: 50 }, opts);
    expect(first).toEqual({ status: "degraded", consecutiveFailures: 1 });
    const second = computeState(first, { success: false, responseTimeMs: 50 }, opts);
    expect(second.status).toBe("degraded");
    const third = computeState(second, { success: false, responseTimeMs: 50 }, opts);
    expect(third).toEqual({ status: "unavailable", consecutiveFailures: 3 });
  });

  it("recovers to healthy and resets the failure counter", () => {
    expect(computeState({ status: "unavailable", consecutiveFailures: 5 }, { success: true, responseTimeMs: 90 }, opts)).toEqual({
      status: "healthy",
      consecutiveFailures: 0,
    });
  });
});

describe("asset status roll-up", () => {
  it("returns unknown without monitored services", () => {
    expect(rollupAssetStatus([])).toBe("unknown");
  });

  it("prefers the worst state across services", () => {
    expect(rollupAssetStatus(["healthy", "degraded"])).toBe("degraded");
    expect(rollupAssetStatus(["healthy", "unavailable", "degraded"])).toBe("unavailable");
    expect(rollupAssetStatus(["healthy", "healthy"])).toBe("healthy");
    expect(rollupAssetStatus(["unknown", "unknown"])).toBe("unknown");
  });
});

describe("probe execution against a real local listener", () => {
  let server: Server;
  let port: number;
  let slowServer: Server;
  let slowPort: number;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("ok");
      } else {
        res.writeHead(500);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    port = (server.address() as { port: number }).port;

    slowServer = createServer(() => {
      // Intentionally never responds so the probe must enforce its timeout.
    });
    await new Promise<void>((resolve) => slowServer.listen(0, "127.0.0.1", () => resolve()));
    slowPort = (slowServer.address() as { port: number }).port;
  });

  afterAll(async () => {
    server.close();
    slowServer.closeAllConnections?.();
    slowServer.close();
  });

  it("reports success for an authorised private HTTP endpoint returning 200", async () => {
    const result = await runProbe({
      monitorType: "http",
      url: `http://127.0.0.1:${port}/health`,
      host: null,
      port: null,
      expectedStatusCode: 200,
      timeoutMs: 3000,
      allowPrivateNetwork: true,
    });
    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
  });

  it("blocks the same endpoint when private networks are not authorised", async () => {
    const result = await runProbe({
      monitorType: "http",
      url: `http://127.0.0.1:${port}/health`,
      host: null,
      port: null,
      expectedStatusCode: null,
      timeoutMs: 3000,
      allowPrivateNetwork: false,
    });
    expect(result.success).toBe(false);
    expect(result.errorMessage).toMatch(/not permitted/);
  });

  it("reports an unexpected HTTP status as a failure", async () => {
    const result = await runProbe({
      monitorType: "http",
      url: `http://127.0.0.1:${port}/broken`,
      host: null,
      port: null,
      expectedStatusCode: null,
      timeoutMs: 3000,
      allowPrivateNetwork: true,
    });
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(500);
  });

  it("times out when the endpoint never answers", async () => {
    const result = await runProbe({
      monitorType: "http",
      url: `http://127.0.0.1:${slowPort}/`,
      host: null,
      port: null,
      expectedStatusCode: null,
      timeoutMs: 700,
      allowPrivateNetwork: true,
    });
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe("Timed out");
  });

  it("checks TCP connectivity to an authorised private port", async () => {
    const ok = await runProbe({ monitorType: "tcp", url: null, host: "127.0.0.1", port, expectedStatusCode: null, timeoutMs: 2000, allowPrivateNetwork: true });
    expect(ok.success).toBe(true);
  });

  it("reports refused TCP connections as unavailable", async () => {
    const closedPort = port + 1000 > 65535 ? 1 : port + 1000;
    const result = await runProbe({ monitorType: "tcp", url: null, host: "127.0.0.1", port: closedPort, expectedStatusCode: null, timeoutMs: 2000, allowPrivateNetwork: true });
    expect(result.success).toBe(false);
    expect(["Connection refused", "Timed out"]).toContain(result.errorMessage);
  });
});
