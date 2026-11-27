import type { AlertDoc, AlertSeverity, AlertStatus, MonitoringTargetDoc, ServiceState } from "@/db/models/documents";
import { findAssetNamesByIds } from "@/db/repositories/assets.repository";
import {
  appendAlertEvent,
  countAlertsByState,
  findActiveAlert,
  findAlertById,
  getAlertTrend,
  listActiveAlertsForTarget,
  listAlerts,
  raiseAlert,
  releaseSuppressedAlerts,
  resolveActiveAlerts,
  suppressActiveAlerts,
  updateAlert,
  type NewAlertInput,
} from "@/db/repositories/alerts.repository";
import { createAutoIncident, findIncidentById, insertIncidentComment } from "@/db/repositories/incidents.repository";
import { findActiveMaintenanceForAssets } from "@/db/repositories/maintenance.repository";
import { findMonitoringTargetsByIds } from "@/db/repositories/monitoring.repository";
import type { AuthUser } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { errors, paginationMeta } from "@/lib/http";
import {
  alertDedupeKey,
  determineSuppression,
  effectiveThresholds,
  evaluateAlertSignal,
  incidentDefaultsForAlert,
  shouldAutoCreateIncident,
  type EffectiveThresholds,
} from "../monitoring/alerting";
import { recordAudit } from "@/services/audit.service";
import { iso, userNameMap } from "@/services/common";
import { notifyRoles } from "@/services/notifications.service";

/**
 * Alert lifecycle: raise, refresh, acknowledge, resolve, suppress.
 *
 * Raising happens in the worker after every check; the transitions below are the operator-facing
 * actions. Deduplication and state transitions live in the repository so concurrent workers and API
 * calls cannot open two alerts for the same condition or resolve one twice.
 */

interface AlertNames {
  targets: Map<string, string>;
  assets: Map<string, string>;
  users: Map<string, string>;
}

async function resolveNames(rows: AlertDoc[]): Promise<AlertNames> {
  const [targets, assets, users] = await Promise.all([
    findMonitoringTargetsByIds([...new Set(rows.map((row) => row.targetId))]),
    findAssetNamesByIds(rows.map((row) => row.assetId).filter((id): id is string => !!id)),
    userNameMap(rows.flatMap((row) => [row.acknowledgedById, row.resolvedById, ...row.events.map((event) => event.actorId)])),
  ]);
  return {
    targets: new Map(targets.map((row) => [row.id, row.name])),
    assets: new Map(assets.map((row) => [row.id, row.name])),
    users,
  };
}

function toAlertDto(row: AlertDoc, names: AlertNames) {
  return {
    id: row.id,
    dedupeKey: row.dedupeKey,
    kind: row.kind,
    severity: row.severity,
    status: row.status,
    title: row.title,
    message: row.message,
    triggerCondition: row.triggerCondition,
    occurrences: row.occurrences,
    triggeredAt: iso(row.triggeredAt),
    lastSeenAt: iso(row.lastSeenAt),
    acknowledgedAt: iso(row.acknowledgedAt),
    acknowledgedById: row.acknowledgedById,
    acknowledgedByName: row.acknowledgedById ? names.users.get(row.acknowledgedById) ?? null : null,
    resolvedAt: iso(row.resolvedAt),
    resolvedById: row.resolvedById,
    resolvedByName: row.resolvedById ? names.users.get(row.resolvedById) ?? null : null,
    resolutionNotes: row.resolutionNotes,
    suppressedUntil: iso(row.suppressedUntil),
    suppressionReason: row.suppressionReason,
    incidentId: row.incidentId,
    target: { id: row.targetId, name: names.targets.get(row.targetId) ?? "Deleted check" },
    asset: row.assetId ? { id: row.assetId, name: names.assets.get(row.assetId) ?? "Deleted asset" } : null,
    events: row.events.map((event) => ({
      at: iso(event.at),
      type: event.type,
      actorId: event.actorId,
      actorName: event.actorId ? names.users.get(event.actorId) ?? null : null,
      note: event.note,
    })),
  };
}

export async function listAlertPage(query: {
  page: number;
  pageSize: number;
  status?: AlertStatus;
  severity?: AlertSeverity;
  targetId?: string;
  assetId?: string;
  incidentId?: string;
  search?: string;
}) {
  const { items, total } = await listAlerts(query);
  const names = await resolveNames(items);
  return { items: items.map((row) => toAlertDto(row, names)), meta: paginationMeta(query.page, query.pageSize, total) };
}

export async function getAlertDetail(id: string) {
  const row = await findAlertById(id);
  if (!row) throw errors.notFound("Alert");
  return toAlertDto(row, await resolveNames([row]));
}

export async function alertSummary() {
  const [counts, trend] = await Promise.all([countAlertsByState(), getAlertTrend(new Date(Date.now() - 14 * 24 * 60 * 60 * 1000))]);
  const byStatus = (status: AlertStatus) => counts.filter((row) => row.status === status).reduce((sum, row) => sum + row.total, 0);
  const active = byStatus("triggered") + byStatus("acknowledged") + byStatus("suppressed");
  const criticalActive = counts
    .filter((row) => row.severity === "critical" && row.status !== "resolved")
    .reduce((sum, row) => sum + row.total, 0);
  return {
    active,
    triggered: byStatus("triggered"),
    acknowledged: byStatus("acknowledged"),
    suppressed: byStatus("suppressed"),
    resolved: byStatus("resolved"),
    criticalActive,
    warningActive: counts
      .filter((row) => row.severity === "warning" && row.status !== "resolved")
      .reduce((sum, row) => sum + row.total, 0),
    trend,
  };
}

export async function acknowledgeAlert(actor: AuthUser, id: string, note: string | undefined, ip: string) {
  const existing = await findAlertById(id);
  if (!existing) throw errors.notFound("Alert");
  if (existing.status === "resolved") throw errors.conflict("A resolved alert cannot be acknowledged");
  if (existing.status === "acknowledged") return getAlertDetail(id);
  const now = new Date();
  const updated = await updateAlert(
    id,
    {
      status: "acknowledged",
      acknowledgedAt: now,
      acknowledgedById: actor.id,
      suppressedUntil: null,
    },
    ["triggered", "suppressed"],
  );
  if (!updated) throw errors.conflict("The alert changed state; reload and try again");
  await appendAlertEvent(id, { at: now, type: "acknowledged", actorId: actor.id, note: note ?? null });
  await recordAudit({
    actorId: actor.id,
    action: "alert.acknowledged",
    entityType: "alert",
    entityId: id,
    summary: `Alert "${existing.title}" acknowledged`,
    metadata: { previousStatus: existing.status, note: note ?? null },
    ip,
  });
  return getAlertDetail(id);
}

export async function resolveAlert(actor: AuthUser, id: string, resolutionNotes: string, ip: string) {
  const existing = await findAlertById(id);
  if (!existing) throw errors.notFound("Alert");
  if (existing.status === "resolved") throw errors.conflict("The alert is already resolved");
  const now = new Date();
  const updated = await updateAlert(
    id,
    { status: "resolved", resolvedAt: now, resolvedById: actor.id, resolutionNotes },
    ["triggered", "acknowledged", "suppressed"],
  );
  if (!updated) throw errors.conflict("The alert changed state; reload and try again");
  await appendAlertEvent(id, { at: now, type: "resolved", actorId: actor.id, note: resolutionNotes });
  await recordAudit({
    actorId: actor.id,
    action: "alert.resolved",
    entityType: "alert",
    entityId: id,
    summary: `Alert "${existing.title}" resolved manually`,
    metadata: { resolutionNotes },
    ip,
  });
  return getAlertDetail(id);
}

export async function suppressAlert(
  actor: AuthUser,
  id: string,
  input: { reason: string; until: Date | null },
  ip: string,
) {
  const existing = await findAlertById(id);
  if (!existing) throw errors.notFound("Alert");
  if (existing.status === "resolved") throw errors.conflict("A resolved alert cannot be suppressed");
  const now = new Date();
  const until = input.until ?? new Date(now.getTime() + 60 * 60 * 1000);
  if (until.getTime() <= now.getTime()) throw errors.unprocessable("Suppression must end in the future");
  const updated = await updateAlert(
    id,
    {
      status: "suppressed",
      suppressionReason: input.reason,
      suppressedAt: now,
      suppressedUntil: until,
      acknowledgedAt: existing.acknowledgedAt ?? now,
      acknowledgedById: existing.acknowledgedById ?? actor.id,
    },
    ["triggered", "acknowledged"],
  );
  if (!updated) throw errors.conflict("The alert changed state; reload and try again");
  await appendAlertEvent(id, { at: now, type: "suppressed", actorId: actor.id, note: input.reason });
  await recordAudit({
    actorId: actor.id,
    action: "alert.suppressed",
    entityType: "alert",
    entityId: id,
    summary: `Alert "${existing.title}" suppressed until ${until.toISOString()}`,
    metadata: { reason: input.reason, until: until.toISOString() },
    ip,
  });
  return getAlertDetail(id);
}

export interface CheckAlertContext {
  target: MonitoringTargetDoc;
  assetId: string | null;
  previousState: ServiceState;
  state: ServiceState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  responseTimeMs: number | null;
  lastError: string | null;
  now?: Date;
}

export interface CheckAlertResult {
  suppressed: boolean;
  suppressedUntil: Date | null;
  alertId: string | null;
  incidentId: string | null;
  resolvedCount: number;
}

/** Posts a system comment when monitoring recovers; the incident itself stays open for humans. */
async function commentOnRecoveredIncidents(rows: AlertDoc[], now: Date): Promise<void> {
  for (const row of rows) {
    if (!row.incidentId) continue;
    const incident = await findIncidentById(row.incidentId);
    if (!incident) continue;
    await insertIncidentComment(incident.id, {
      authorId: null,
      kind: "system",
      body: `Monitoring recovered at ${now.toISOString()}: ${row.title}. The alert was resolved automatically. This comment does not close the incident; confirm the fix and resolve it manually.`,
    });
  }
}

/**
 * Worker-facing alert evaluation for one completed check.
 *
 * Order matters: expired suppressions are released, active maintenance suppresses escalation, recovery
 * resolves availability/latency alerts, and only then is a new signal evaluated. Suppression never
 * changes the recorded service state.
 */
export async function processCheckAlerts(context: CheckAlertContext): Promise<CheckAlertResult> {
  const env = getEnv();
  const now = context.now ?? new Date();
  const thresholds: EffectiveThresholds = effectiveThresholds(context.target, {
    failureThreshold: env.MONITOR_FAILURE_THRESHOLD,
    recoveryThreshold: env.MONITOR_RECOVERY_THRESHOLD,
    warningThresholdMs: env.MONITOR_WARNING_THRESHOLD_MS,
    criticalThresholdMs: env.MONITOR_CRITICAL_THRESHOLD_MS,
  });

  const windows = context.assetId ? (await findActiveMaintenanceForAssets([context.assetId], now)).map((row) => row.window) : [];
  const suppression = determineSuppression(windows, now);
  await releaseSuppressedAlerts(context.target.id, now);

  if (suppression.suppressed) {
    const suppressed = await suppressActiveAlerts(context.target.id, {
      reason: suppression.reason ?? "Maintenance window",
      until: suppression.until,
      now,
    });
    if (suppressed > 0) {
      await recordAudit({
        actorId: null,
        action: "alert.suppressed_by_maintenance",
        entityType: "monitoring_target",
        entityId: context.target.id,
        summary: `${suppressed} alert(s) for "${context.target.name}" suppressed during ${suppression.reason}`,
        metadata: { windowId: suppression.windowId, until: iso(suppression.until) },
      });
    }
    return { suppressed: true, suppressedUntil: suppression.until, alertId: null, incidentId: null, resolvedCount: 0 };
  }

  const activeAlerts = await listActiveAlertsForTarget(context.target.id);
  const availabilityAlerts = activeAlerts.filter((row) => row.kind === "availability");
  let resolvedCount = 0;
  let alertId: string | null = null;
  let incidentId: string | null = null;

  const recoveredEnough =
    (context.state === "healthy" || context.state === "degraded") &&
    context.consecutiveSuccesses >= thresholds.recoveryThreshold;
  if (recoveredEnough && availabilityAlerts.length > 0) {
    resolvedCount += await resolveActiveAlerts(context.target.id, {
      kind: "availability",
      notes: `Recovered automatically at ${now.toISOString()} after ${context.consecutiveSuccesses} consecutive successful check(s)`,
      now,
    });
    await commentOnRecoveredIncidents(availabilityAlerts, now);
  }

  const signal = evaluateAlertSignal({
    targetName: context.target.name,
    state: context.state,
    consecutiveFailures: context.consecutiveFailures,
    responseTimeMs: context.responseTimeMs,
    lastError: context.lastError,
    thresholds,
  });

  if (!signal || signal.kind !== "latency") {
    const latencyAlerts = activeAlerts.filter((row) => row.kind === "latency");
    if (latencyAlerts.length > 0) {
      resolvedCount += await resolveActiveAlerts(context.target.id, {
        kind: "latency",
        notes: "Response time returned within the configured thresholds",
        now,
      });
    }
  }

  if (!signal) return { suppressed: false, suppressedUntil: null, alertId: null, incidentId: null, resolvedCount };

  const input: NewAlertInput = {
    dedupeKey: alertDedupeKey(context.target.id, signal.kind),
    kind: signal.kind,
    targetId: context.target.id,
    assetId: context.assetId,
    severity: signal.severity,
    title: signal.title,
    message: signal.message,
    triggerCondition: signal.condition,
  };
  const existing = await findActiveAlert(input.dedupeKey);
  const { alert, created } = await raiseAlert(input);
  alertId = alert.id;

  if (created) {
    await recordAudit({
      actorId: null,
      action: "alert.triggered",
      entityType: "alert",
      entityId: alert.id,
      summary: `Alert "${alert.title}" triggered (${alert.severity})`,
      metadata: { condition: alert.triggerCondition, targetId: context.target.id },
    });
    await notifyRoles(["admin", "operator"], {
      type: "alert_triggered",
      title: `${alert.severity === "critical" ? "Critical" : "Warning"} alert: ${alert.title}`,
      message: alert.message,
      link: "/alerts",
    });
  }

  const targetAutoIncident = context.target.autoIncidentEnabled !== false;
  const existingIncidentId = alert.incidentId ?? existing?.incidentId ?? null;
  const defaults = incidentDefaultsForAlert(alert.severity);
  if (
    shouldAutoCreateIncident({
      environmentEnabled: env.AUTO_INCIDENT_ENABLED,
      targetEnabled: targetAutoIncident,
      suppressed: suppression.suppressed,
      existingIncidentId,
      severity: alert.severity,
    })
  ) {
    const incident = await createAutoIncident({
      title: `${signal.title} (auto)`,
      description: [
        `Automatically opened from monitoring alert ${alert.id}.`,
        "",
        `Check: ${context.target.name} (${context.target.monitorType.toUpperCase()})`,
        `Condition: ${signal.condition}`,
        `Observed: ${signal.message}`,
        `Consecutive failures: ${context.consecutiveFailures}`,
        "",
        "Acknowledge and investigate, then resolve the incident after the service is confirmed healthy.",
      ].join("\n"),
      severity: defaults.severity,
      priority: defaults.priority,
      sourceAlertId: alert.id,
      sourceMonitoringTargetId: context.target.id,
      assetIds: context.assetId ? [context.assetId] : [],
      category: "availability",
    });
    if (incident) {
      incidentId = incident.id;
      await updateAlert(alert.id, { incidentId: incident.id });
      await appendAlertEvent(alert.id, {
        at: now,
        type: "incident_created",
        actorId: null,
        note: `Incident #${incident.number} created automatically`,
      });
      await recordAudit({
        actorId: null,
        action: "incident.auto_created",
        entityType: "incident",
        entityId: incident.id,
        summary: `Incident #${incident.number} created from alert "${alert.title}"`,
        metadata: { alertId: alert.id, targetId: context.target.id },
      });
      await notifyRoles(["admin", "operator"], {
        type: "incident_auto_created",
        title: `Incident #${incident.number} opened automatically`,
        message: incident.title,
        link: `/incidents/${incident.id}`,
      });
    }
  }

  return { suppressed: false, suppressedUntil: null, alertId, incidentId, resolvedCount };
}
