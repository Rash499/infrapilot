import "../../../src/lib/load-env";
import { app } from "./app";
import { closeMongo, ensureMongoIndexes } from "@infrapilot/database";

const port = Number(process.env.API_PORT ?? process.env.BACKEND_PORT ?? process.env.PORT ?? 4000);
const host = process.env.API_HOST ?? "0.0.0.0";

async function start(): Promise<void> {
  await ensureMongoIndexes();
  const server = app.listen(port, host, () => {
    console.log(JSON.stringify({ event: "backend_started", host, port, pid: process.pid }));
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close(async () => {
      await closeMongo();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

void start();
