import "../../../src/lib/load-env";
import { app } from "./app";
import { closeMongo, ensureMongoIndexes } from "@infrapilot/database";

const port = Number(process.env.BACKEND_PORT ?? process.env.PORT ?? 4000);

async function start(): Promise<void> {
  await ensureMongoIndexes();
  const server = app.listen(port, "127.0.0.1", () => {
    console.log(JSON.stringify({ event: "backend_started", port, pid: process.pid }));
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
