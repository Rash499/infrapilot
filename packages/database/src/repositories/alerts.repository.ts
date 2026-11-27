import type { Filter, UpdateFilter } from "mongodb";
import { collections, getCollection, newEntityIds } from "@/db/collections";
import type { AlertDoc, AlertEvent, AlertSeverity, AlertStatus, AlertKind } from "@/db/models/documents";

/**
 * Alert persistence.
 *
 * Deduplication is enforced by the database, not by a read-then-write race: `alerts_active_dedupe_unique`
 * is a partial unique index over the active statuses, so two workers raising the same condition can
 * never create two open alerts.
 */

export const ACTIVE_ALERT_STATUSES: AlertStatus[] = ["triggered", "acknowledged", "suppressed"];

export interface NewAlertInput {
  dedupeKey: string;
  kind: AlertKind;
  targetId: string;
  assetId: string | null;
  severity: AlertSeverity;
  title: string;
  message: string;
  triggerCondition: string;
  incidentId?: string | null;
}

export async function insertAlert(input: NewAlertInput): Promise<AlertDoc> {
  const col = await getCollection<AlertDoc>(collections.alerts);
  const now = new Date();
  const doc: AlertDoc = {
    ...newEntityIds(),
    dedupeKey: input.dedupeKey,
    kind: input.kind,
    targetId: input.targetId,
    assetId: input.assetId,
    severity: input.severity,
    status: "triggered",
    title: input.title.slice(0, 200),
    message: input.message.slice(0, 2000),
    triggerCondition: input.triggerCondition.slice(0, 500),
    occurrences: 1,
    triggeredAt: now,
    lastSeenAt: now,
    acknowledgedAt: null,
    acknowledgedById: null,
    resolvedAt: null,
    resolvedById: null,
    resolutionNotes: null,
    suppressedAt: null,
    suppressedUntil: null,
    suppressionReason: null,
    incidentId: input.incidentId ?? null,
    events: [{ at: now, type: "triggered", actorId: null, note: input.message.slice(0, 500) }],
    createdAt: now,
    updatedAt: now,
  };
  await col.insertOne(doc);
  return doc;
}

/**
 * Raises an alert unless an active one already exists for the same condition, in which case the
 * existing alert is refreshed (occurrence count, last seen time, message).
 */
export async function raiseAlert(input: NewAlertInput): Promise<{ alert: AlertDoc; created: boolean }> {
  const col = await getCollection<AlertDoc>(collections.alerts);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return { alert: await insertAlert(input), created: true };
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      const now = new Date();
      const event: AlertEvent = { at: now, type: "refreshed", actorId: null, note: input.message.slice(0, 500) };
      const refreshed = await col.findOneAndUpdate(
        { dedupeKey: input.dedupeKey, status: { $in: ACTIVE_ALERT_STATUSES } } as Filter<AlertDoc>,
        {
          $set: {
            lastSeenAt: now,
            updatedAt: now,
            message: input.message.slice(0, 2000),
            severity: input.severity,
            triggerCondition: input.triggerCondition.slice(0, 500),
          },
          $inc: { occurrences: 1 },
          $push: { events: event },
        } as unknown as UpdateFilter<AlertDoc>,
        { returnDocument: "after" },
      );
      if (refreshed) return { alert: refreshed, created: false };
      // The active alert was resolved between the failed insert and this read; retry the insert.
    }
  }
  throw new Error("Could not raise alert: concurrent state change");
}

export async function findAlertById(id: string): Promise<AlertDoc | null> {
  const col = await getCollection<AlertDoc>(collections.alerts);
  return col.findOne({ id });
}

export async function findActiveAlert(dedupeKey: string): Promise<AlertDoc | null> {
  const col = await getCollection<AlertDoc>(collections.alerts);
  return col.findOne({ dedupeKey, status: { $in: ACTIVE_ALERT_STATUSES } } as Filter<AlertDoc>);
}

export async function findAlertByIncidentId(incidentId: string): Promise<AlertDoc | null> {
  const col = await getCollection<AlertDoc>(collections.alerts);
  return col.findOne({ incidentId });
}

export async function listActiveAlertsForTarget(targetId: string): Promise<AlertDoc[]> {
  const col = await getCollection<AlertDoc>(collections.alerts);
  return col.find({ targetId, status: { $in: ACTIVE_ALERT_STATUSES } } as Filter<AlertDoc>).toArray();
}

/** Applies a lifecycle transition, guarded by the expected statuses to keep transitions atomic. */
export async function updateAlert(
  id: string,
  patch: Partial<Omit<AlertDoc, "id" | "_id" | "events">>,
  expectedStatuses?: AlertStatus[],
): Promise<AlertDoc | null> {
  const col = await getCollection<AlertDoc>(collections.alerts);
  const filter: Filter<AlertDoc> = { id };
  if (expectedStatuses) filter.status = { $in: expectedStatuses } as never;
  return col.findOneAndUpdate(
    filter,
    { $set: { ...patch, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
}

export async function appendAlertEvent(id: string, event: AlertEvent): Promise<void> {
  const col = await getCollection<AlertDoc>(collections.alerts);
  const entry: AlertEvent = { ...event, note: event.note ? event.note.slice(0, 500) : null };
  await col.updateOne({ id }, { $push: { events: entry } } as unknown as UpdateFilter<AlertDoc>);
}

/** Resolves every active alert of a target (optionally one kind) when the service recovers. */
export async function resolveActiveAlerts(
  targetId: string,
  input: { kind?: AlertKind; resolvedById?: string | null; notes: string; now?: Date },
): Promise<number> {
  const col = await getCollection<AlertDoc>(collections.alerts);
  const now = input.now ?? new Date();
  const filter: Filter<AlertDoc> = {
    targetId,
    status: { $in: ACTIVE_ALERT_STATUSES },
  };
  if (input.kind) filter.kind = input.kind;
  const event: AlertEvent = {
    at: now,
    type: "resolved",
    actorId: input.resolvedById ?? null,
    note: input.notes.slice(0, 500),
  };
  const result = await col.updateMany(filter, {
    $set: {
      status: "resolved",
      resolvedAt: now,
      resolvedById: input.resolvedById ?? null,
      resolutionNotes: input.notes.slice(0, 2000),
      updatedAt: now,
    },
    $push: { events: event },
  } as unknown as UpdateFilter<AlertDoc>);
  return result.modifiedCount;
}

/** Marks active alerts suppressed (e.g. a maintenance window) without changing service health. */
export async function suppressActiveAlerts(
  targetId: string,
  input: { reason: string; until: Date | null; now?: Date; kind?: AlertKind },
): Promise<number> {
  const col = await getCollection<AlertDoc>(collections.alerts);
  const now = input.now ?? new Date();
  const filter: Filter<AlertDoc> = { targetId, status: { $in: ["triggered", "acknowledged"] } };
  if (input.kind) filter.kind = input.kind;
  const event: AlertEvent = { at: now, type: "suppressed", actorId: null, note: input.reason.slice(0, 500) };
  const result = await col.updateMany(filter, {
    $set: {
      status: "suppressed",
      suppressionReason: input.reason.slice(0, 500),
      suppressedAt: now,
      suppressedUntil: input.until,
      updatedAt: now,
    },
    $push: { events: event },
  } as unknown as UpdateFilter<AlertDoc>);
  return result.modifiedCount;
}

/** Re-opens suppressed alerts once maintenance ends (they stay resolved if the service recovered). */
export async function releaseSuppressedAlerts(targetId: string, now = new Date()): Promise<number> {
  const col = await getCollection<AlertDoc>(collections.alerts);
  const event: AlertEvent = { at: now, type: "unsuppressed", actorId: null, note: "Maintenance window ended" };
  const result = await col.updateMany(
    { targetId, status: "suppressed", $or: [{ suppressedUntil: null }, { suppressedUntil: { $lte: now } }] } as Filter<AlertDoc>,
    {
      $set: { status: "triggered", suppressedUntil: null, updatedAt: now },
      $push: { events: event },
    } as unknown as UpdateFilter<AlertDoc>,
  );
  return result.modifiedCount;
}

export async function listAlerts(query: {
  page: number;
  pageSize: number;
  status?: AlertStatus;
  severity?: AlertSeverity;
  targetId?: string;
  assetId?: string;
  incidentId?: string;
  search?: string;
}): Promise<{ items: AlertDoc[]; total: number }> {
  const col = await getCollection<AlertDoc>(collections.alerts);
  const filter: Filter<AlertDoc> = {};
  if (query.status) filter.status = query.status;
  if (query.severity) filter.severity = query.severity;
  if (query.targetId) filter.targetId = query.targetId;
  if (query.assetId) filter.assetId = query.assetId;
  if (query.incidentId) filter.incidentId = query.incidentId;
  if (query.search) {
    const term = query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rx = new RegExp(term, "i");
    filter.$or = [{ title: rx }, { message: rx }, { triggerCondition: rx }];
  }
  const skip = (query.page - 1) * query.pageSize;
  const [items, total] = await Promise.all([
    col.find(filter).sort({ triggeredAt: -1 }).skip(skip).limit(query.pageSize).toArray(),
    col.countDocuments(filter),
  ]);
  return { items, total };
}

export async function countAlertsByState(): Promise<Array<{ status: AlertStatus; severity: AlertSeverity; total: number }>> {
  const col = await getCollection<AlertDoc>(collections.alerts);
  return col
    .aggregate<{ status: AlertStatus; severity: AlertSeverity; total: number }>([
      { $group: { _id: { status: "$status", severity: "$severity" }, total: { $sum: 1 } } },
      { $project: { _id: 0, status: "$_id.status", severity: "$_id.severity", total: 1 } },
    ])
    .toArray();
}

/** Alert volume per day for the trend widget; uses real timestamps only. */
export async function getAlertTrend(since: Date): Promise<Array<{ date: string; triggered: number; resolved: number }>> {
  const col = await getCollection<AlertDoc>(collections.alerts);
  const [triggered, resolved] = await Promise.all([
    col
      .aggregate<{ _id: string; count: number }>([
        { $match: { triggeredAt: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$triggeredAt" } }, count: { $sum: 1 } } },
      ])
      .toArray(),
    col
      .aggregate<{ _id: string; count: number }>([
        { $match: { resolvedAt: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$resolvedAt" } }, count: { $sum: 1 } } },
      ])
      .toArray(),
  ]);
  const map = new Map<string, { date: string; triggered: number; resolved: number }>();
  for (const row of triggered) map.set(row._id, { date: row._id, triggered: row.count, resolved: 0 });
  for (const row of resolved) {
    const entry = map.get(row._id) ?? { date: row._id, triggered: 0, resolved: 0 };
    entry.resolved = row.count;
    map.set(row._id, entry);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}
