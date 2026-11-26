import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { app } from "../../apps/backend/src/app";

vi.mock("@infrapilot/database", () => ({
  getMongoDb: async () => ({
    command: async () => {
      throw new Error("database unavailable");
    },
  }),
}));

describe("backend health endpoints", () => {
  let server: ReturnType<typeof app.listen>;
  let baseUrl: string;

  beforeAll(async () => {
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    server.close();
    await once(server, "close");
  });

  it("reports process liveness without requiring database access", async () => {
    const response = await fetch(`${baseUrl}/health/live`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(response.headers.get("x-request-id")).toMatch(/^[A-Za-z0-9._-]{1,128}$/);
  });

  it("reports readiness failure without exposing database errors", async () => {
    const response = await fetch(`${baseUrl}/health/ready`);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "not_ready" });
  });

  it("publishes OpenAPI paths from the registered API routes", async () => {
    const response = await fetch(`${baseUrl}/api/openapi.json`);
    const specification = await response.json() as { paths: Record<string, unknown> };

    expect(response.status).toBe(200);
    expect(specification.paths["/auth/login"]).toBeDefined();
    expect(specification.paths["/incidents/{id}"]).toBeDefined();
  });

  it("returns a safe client error for malformed JSON", async () => {
    const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{invalid",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: {
        code: "BAD_REQUEST",
        message: "Invalid request",
      },
    });
  });
});
