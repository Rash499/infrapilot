import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import swaggerUi from "swagger-ui-express";
import { dispatch } from "@infrapilot/server-core";

const app = express();

app.disable("x-powered-by");
app.use(helmet());
app.use(express.json({ limit: "1mb" }));
app.use(cors({
  origin(origin, callback) {
    const allowed = (process.env.APP_ORIGIN ?? "http://localhost:3000").split(",");
    callback(null, !origin || allowed.includes(origin));
  },
  credentials: true,
}));
app.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: "draft-7", legacyHeaders: false }));

app.get("/api/health", (_req, res) => res.json({ data: { status: "ok", timestamp: new Date().toISOString() } }));
app.use("/api/docs", swaggerUi.serve, swaggerUi.setup({
  openapi: "3.1.0",
  info: { title: "InfraPilot API", version: "1.0.0" },
  servers: [{ url: "/api/v1" }],
  paths: {},
}));

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
  const message = error instanceof Error ? error.message : "Internal server error";
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message } });
});

export { app };
