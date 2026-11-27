import type { IncidentDoc, IncidentPriority, IncidentSeverity } from "@/db/models/documents";

/**
 * SLA policy and metric calculation for incidents.
 *
 * Targets are configuration, not data: they depend only on priority and are applied on read so that
 * existing incidents gain SLA tracking without a migration. Open incidents are never counted as
 * resolved: their MTTR contribution is excluded and they are reported separately.
 */

export interface SlaTargets {
  acknowledgeMinutes: number;
  resolveMinutes: number;
}

export const DEFAULT_SLA_TARGETS: Record<IncidentPriority, SlaTargets> = {
  p1: { acknowledgeMinutes: 15, resolveMinutes: 4 * 60 },
  p2: { acknowledgeMinutes: 30, resolveMinutes: 8 * 60 },
  p3: { acknowledgeMinutes: 120, resolveMinutes: 24 * 60 },
  p4: { acknowledgeMinutes: 480, resolveMinutes: 72 * 60 },
};

export type SlaState = "met" | "pending" | "at_risk" | "breached";

export interface IncidentSla {
  acknowledgeDueAt: Date;
  resolveDueAt: Date;
  acknowledgedAt: Date | null;
  resolvedAt: Date | null;
  acknowledgeBreached: boolean;
  resolveBreached: boolean;
  state: SlaState;
  minutesToAcknowledge: number | null;
  minutesToResolve: number | null;
}

const MINUTE = 60 * 1000;

/** SLA "at risk" once 80% of the remaining budget is consumed without acknowledgement/resolution. */
const AT_RISK_RATIO = 0.8;

export function slaTargetsFor(priority: IncidentPriority, overrides: Partial<Record<IncidentPriority, SlaTargets>> = {}): SlaTargets {
  return overrides[priority] ?? DEFAULT_SLA_TARGETS[priority];
}

export function computeIncidentSla(
  incident: Pick<IncidentDoc, "priority" | "openedAt" | "acknowledgedAt" | "resolvedAt" | "status">,
  now: Date,
  overrides: Partial<Record<IncidentPriority, SlaTargets>> = {},
): IncidentSla {
  const targets = slaTargetsFor(incident.priority, overrides);
  const opened = incident.openedAt.getTime();
  const acknowledgeDueAt = new Date(opened + targets.acknowledgeMinutes * MINUTE);
  const resolveDueAt = new Date(opened + targets.resolveMinutes * MINUTE);
  const acknowledgedAt = incident.acknowledgedAt ?? null;
  const resolvedAt = incident.resolvedAt ?? null;
  const closed = incident.status === "resolved" || incident.status === "closed";

  const acknowledgeBreached = acknowledgedAt
    ? acknowledgedAt.getTime() > acknowledgeDueAt.getTime()
    : !closed && now.getTime() > acknowledgeDueAt.getTime();
  const resolveBreached = resolvedAt
    ? resolvedAt.getTime() > resolveDueAt.getTime()
    : !closed && now.getTime() > resolveDueAt.getTime();

  let state: SlaState;
  if (resolveBreached || acknowledgeBreached) state = "breached";
  else if (closed) state = "met";
  else {
    const acknowledgeProgress = acknowledgedAt ? 0 : (now.getTime() - opened) / (acknowledgeDueAt.getTime() - opened);
    const resolveProgress = (now.getTime() - opened) / (resolveDueAt.getTime() - opened);
    state = acknowledgeProgress >= AT_RISK_RATIO || resolveProgress >= AT_RISK_RATIO ? "at_risk" : "pending";
  }

  return {
    acknowledgeDueAt,
    resolveDueAt,
    acknowledgedAt,
    resolvedAt,
    acknowledgeBreached,
    resolveBreached,
    state,
    minutesToAcknowledge: acknowledgedAt ? Math.round((acknowledgedAt.getTime() - opened) / MINUTE) : null,
    minutesToResolve: resolvedAt ? Math.round((resolvedAt.getTime() - opened) / MINUTE) : null,
  };
}

export interface IncidentMetrics {
  openIncidents: number;
  resolvedIncidents: number;
  breachedSla: number;
  atRiskSla: number;
  mttaMinutes: number | null;
  mttrMinutes: number | null;
  volume: number;
  bySeverity: Array<{ severity: IncidentSeverity; count: number }>;
  resolutionTrend: Array<{ date: string; opened: number; resolved: number }>;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((total, value) => total + value, 0) / values.length);
}

/**
 * Aggregates SLA performance. MTTA uses acknowledgedAt (or the first status change, backfilled by
 * the incident service) and MTTR only uses incidents that actually have a resolvedAt.
 */
export function summarizeIncidents(
  incidents: Pick<IncidentDoc, "priority" | "severity" | "status" | "openedAt" | "acknowledgedAt" | "resolvedAt">[],
  now: Date,
  overrides: Partial<Record<IncidentPriority, SlaTargets>> = {},
): IncidentMetrics {
  const open = incidents.filter((incident) => incident.status !== "resolved" && incident.status !== "closed");
  const resolved = incidents.filter((incident) => incident.status === "resolved" || incident.status === "closed");
  const slas = incidents.map((incident) => computeIncidentSla(incident, now, overrides));

  const severityOrder: IncidentSeverity[] = ["critical", "high", "medium", "low"];
  const bySeverity = severityOrder.map((severity) => ({
    severity,
    count: incidents.filter((incident) => incident.severity === severity).length,
  }));

  const trend = new Map<string, { opened: number; resolved: number }>();
  const dayKey = (date: Date) => date.toISOString().slice(0, 10);
  for (const incident of incidents) {
    const key = dayKey(incident.openedAt);
    const entry = trend.get(key) ?? { opened: 0, resolved: 0 };
    entry.opened += 1;
    trend.set(key, entry);
  }
  for (const incident of resolved) {
    if (!incident.resolvedAt) continue;
    const key = dayKey(incident.resolvedAt);
    const entry = trend.get(key) ?? { opened: 0, resolved: 0 };
    entry.resolved += 1;
    trend.set(key, entry);
  }

  return {
    openIncidents: open.length,
    resolvedIncidents: resolved.length,
    breachedSla: slas.filter((sla) => sla.state === "breached").length,
    atRiskSla: slas.filter((sla) => sla.state === "at_risk").length,
    mttaMinutes: average(slas.map((sla) => sla.minutesToAcknowledge).filter((value): value is number => value !== null)),
    mttrMinutes: average(slas.map((sla) => sla.minutesToResolve).filter((value): value is number => value !== null)),
    volume: incidents.length,
    bySeverity,
    resolutionTrend: [...trend.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, counts]) => ({ date, ...counts })),
  };
}
