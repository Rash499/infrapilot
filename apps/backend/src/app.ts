import cors from "cors";
import { randomUUID } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import swaggerUi from "swagger-ui-express";
import { dispatch } from "@infrapilot/server-core";
import { getMongoDb } from "@infrapilot/database";
import { openApiSpecification } from "./openapi";

const app = express();

app.disable("x-powered-by");
app.use(helmet());
app.use((req, res, next) => {
  const suppliedId = req.header("x-request-id");
  const requestId = suppliedId && /^[A-Za-z0-9._-]{1,128}$/.test(suppliedId) ? suppliedId : randomUUID();
  req.headers["x-request-id"] = requestId;
  res.setHeader("X-Request-Id", requestId);
  res.locals.requestId = requestId;
  next();
});
app.use(express.json({ limit: "1mb" }));
app.use(cors({
  origin(origin, callback) {
    const allowed = (process.env.FRONTEND_ORIGIN ?? process.env.APP_ORIGIN ?? "http://localhost:3000").split(",");
    callback(null, !origin || allowed.includes(origin));
  },
  credentials: true,
}));
app.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: "draft-7", legacyHeaders: false }));

app.get("/health/live", (_req, res) => res.json({ status: "ok" }));
app.get("/health/ready", async (_req, res) => {
  try {
    const db = await getMongoDb();
    await db.command({ ping: 1 });
    res.json({ status: "ok" });
  } catch {
    console.error(JSON.stringify({
      event: "backend_readiness_failed",
      requestId: res.locals.requestId,
    }));
    res.status(503).json({ status: "not_ready" });
  }
});
app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.get("/api/health", async (_req, res) => {
  try {
    const db = await getMongoDb();
    await db.command({ ping: 1 });
    res.json({ data: { status: "ok", timestamp: new Date().toISOString() } });
  } catch {
    console.error(JSON.stringify({
      event: "backend_readiness_failed",
      requestId: res.locals.requestId,
    }));
    res.status(503).json({ data: { status: "not_ready", timestamp: new Date().toISOString() } });
  }
});
app.get("/api/openapi.json", (_req, res) => res.json(openApiSpecification));
app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openApiSpecification));

app.use("/api/v1", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const segments = req.path.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
    const webRequest = new Request(new URL(req.originalUrl, `http://localhost:${process.env.PORT ?? 4000}`), {
      method: req.method,
      headers: req.headers as unknown as HeadersInit,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : JSON.stringify(req.body),
    });
    const response = await dispatch(webRequest, segments);
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() !== "content-length") res.setHeader(key, value);
    });
    res.status(response.status).send(await response.text());
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const requestId = res.locals.requestId as string | undefined;
  const status = typeof error === "object" && error !== null && "status" in error &&
    typeof error.status === "number" && error.status >= 400 && error.status < 500
    ? error.status
    : 500;
  const name = error instanceof Error ? error.name : "UnknownError";
  console.error(JSON.stringify({ event: "backend_request_failed", requestId, status, errorName: name }));
  res.status(status).json({
    error: {
      code: status < 500 ? (status === 400 ? "BAD_REQUEST" : "REQUEST_ERROR") : "INTERNAL_ERROR",
      message: status < 500 ? "Invalid request" : "Internal server error",
      requestId,
    },
  });
});

export { app };
