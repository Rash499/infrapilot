import { getApiRouteDefinitions } from "@infrapilot/server-core";

const publicEndpoints = new Set([
  "POST /auth/register",
  "POST /auth/login",
  "POST /auth/forgot-password",
  "POST /auth/reset-password",
]);
const refreshEndpoints = new Set(["POST /auth/refresh", "POST /auth/logout"]);
const bodylessEndpoints = new Set([
  ...refreshEndpoints,
  "POST /notifications/read-all",
  "POST /notifications/:id/read",
  "POST /monitoring/targets/:id/check",
  "POST /changes/:id/submit",
]);

function openApiPath(path: string): string {
  return `/${path.replace(/:([A-Za-z0-9_]+)/g, "{$1}")}`;
}

function operationId(method: string, path: string): string {
  return `${method.toLowerCase()}_${path.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;
}

function buildPaths(): Record<string, Record<string, unknown>> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of getApiRouteDefinitions()) {
    const key = openApiPath(route.path);
    const method = route.method.toLowerCase();
    const endpoint = `${route.method} /${route.path}`;
    const parameters = [...route.path.matchAll(/:([A-Za-z0-9_]+)/g)].map(([, name]) => ({
      name,
      in: "path",
      required: true,
      schema: { type: "string" },
    }));
    const responses = {
      "200": { description: "Request completed successfully" },
      "201": { description: "Resource created" },
      "202": { description: "Request accepted for processing" },
      "400": { description: "Invalid request" },
      "401": { description: "Authentication required or invalid" },
      "403": { description: "Insufficient permission" },
      "404": { description: "Resource or endpoint not found" },
      "409": { description: "Request conflicts with current state" },
      "422": { description: "Request rejected by a business rule" },
      "429": { description: "Rate limit exceeded" },
      "500": { description: "Unexpected server error" },
    };
    const operation: Record<string, unknown> = {
      operationId: operationId(route.method, route.path),
      summary: `${route.method} /${route.path}`,
      description: refreshEndpoints.has(endpoint)
        ? "Requires the HTTP-only refresh cookie and the X-InfraPilot-Request header."
        : "Request validation and authorization are enforced by the registered route handler.",
      tags: [route.path.split("/")[0]],
      responses,
      ...(parameters.length ? { parameters } : {}),
      ...(publicEndpoints.has(endpoint) || refreshEndpoints.has(endpoint)
        ? { security: [] }
        : { security: [{ bearerAuth: [] }] }),
      ...(!bodylessEndpoints.has(endpoint) && ["POST", "PATCH"].includes(route.method)
        ? {
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: { type: "object", additionalProperties: true },
                },
              },
            },
          }
        : {}),
    };
    paths[key] = { ...(paths[key] ?? {}), [method]: operation };
  }
  return paths;
}

export const openApiSpecification = {
  openapi: "3.1.0",
  info: {
    title: "InfraPilot API",
    version: "1.0.0",
    description: "Route inventory is generated from the active API registrations. See docs/api.md for request fields and role details.",
  },
  servers: [{ url: "/api/v1" }],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
    schemas: {
      ApiError: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message"],
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              details: { type: "array", items: { type: "object" } },
              requestId: { type: "string" },
            },
          },
        },
      },
    },
  },
  paths: buildPaths(),
};
