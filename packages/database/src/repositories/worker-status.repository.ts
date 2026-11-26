import { collections, getCollection } from "@/db/collections";
import type { WorkerStatusDoc } from "@/db/models/documents";

export async function registerWorkerInstance(id: string): Promise<void> {
  const now = new Date();
  const statuses = await getCollection<WorkerStatusDoc>(collections.workerStatuses);
  await statuses.updateOne(
    { id },
    {
      $set: {
        status: "running",
        startedAt: now,
        heartbeatAt: now,
        lastTickAt: null,
        lastTickClaimed: 0,
        lastError: null,
        createdAt: now,
      },
      $setOnInsert: { _id: id, id },
    },
    { upsert: true },
  );
}

export async function recordWorkerTick(
  id: string,
  tick: { claimed: number; error?: string },
): Promise<void> {
  const now = new Date();
  const statuses = await getCollection<WorkerStatusDoc>(collections.workerStatuses);
  const result = await statuses.updateOne(
    { id, status: "running" },
    {
      $set: {
        heartbeatAt: now,
        lastTickAt: now,
        lastTickClaimed: tick.claimed,
        lastError: tick.error ?? null,
      },
    },
  );
  if (result.matchedCount === 0) throw new Error(`Worker status ${id} is not registered as running`);
}

export async function stopWorkerInstance(id: string): Promise<void> {
  const statuses = await getCollection<WorkerStatusDoc>(collections.workerStatuses);
  await statuses.updateOne(
    { id, status: "running" },
    { $set: { status: "stopped", heartbeatAt: new Date() } },
  );
}

export async function getWorkerHealth(
  staleAfterMs = 30_000,
  now = new Date(),
): Promise<{ status: "ok" | "unavailable"; activeWorkers: number; lastHeartbeatAt: string | null }> {
  const statuses = await getCollection<WorkerStatusDoc>(collections.workerStatuses);
  const active = await statuses
    .find(
      { status: "running", heartbeatAt: { $gte: new Date(now.getTime() - staleAfterMs) } },
      { projection: { _id: 0, heartbeatAt: 1 } },
    )
    .sort({ heartbeatAt: -1 })
    .toArray();
  return {
    status: active.length > 0 ? "ok" : "unavailable",
    activeWorkers: active.length,
    lastHeartbeatAt: active[0]?.heartbeatAt.toISOString() ?? null,
  };
}
