import { collections, getCollection } from "@/db/collections";
import type { CounterDoc } from "@/db/models/documents";

export async function nextSequenceValue(id: "incident_number" | "change_number"): Promise<number> {
  const col = await getCollection<CounterDoc>(collections.counters);
  const counter = await col.findOneAndUpdate(
    { id },
    { $inc: { value: 1 }, $setOnInsert: { _id: id, id } },
    { upsert: true, returnDocument: "after" },
  );
  if (!counter) throw new Error(`Could not allocate sequence value for ${id}`);
  return counter.value;
}
