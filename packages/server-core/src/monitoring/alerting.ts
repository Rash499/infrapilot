import type { AlertKind, AlertSeverity, ServiceState } from "@/db/models/documents";

/**
 * Pure alerting rules shared by the worker and the API layer.
 *
 * The worker decides whether a completed check should raise, refresh or resolve an alert, and
 * whether maintenance suppresses it. Keeping the decision logic here makes it testable without a
 * database and keeps the repository free of business rules.
 */

export interface EffectiveThresholds {
  failureThreshold: number;
  recoveryThreshold: number;
  warningThresholdMs: number;
  criticalThresholdMs: number;
}

export const DEFAULT_THRESHOLDS: EffectiveThresholds = {
  failureThreshold: 3,
  recoveryThreshold: 2,
  warningThresholdMs: 1500,
  criticalThresholdMs: 5000,
};

const ACTIVE_FOR_INCIDENT: AlertSeverity[] = ["critical"];

/** Applies per-target configuration with safe defaults for targets created before thresholds existed. */
export function effectiveThresholds(
  target: {
    failureThreshold?: number | null;
    recoveryThreshold?: number | null;
    warningThresholdMs?: number | null;
    criticalThresholdMs?: number | null;
    degradedThresholdMs?: number | null;
  },
  defaults: Partial<EffectiveThresholds> = {},
): EffectiveThresholds {
  const base = { ...DEFAULT_THRESHOLDS, ...defaults };
  const warning = target.warningThresholdMs ?? target.degradedThresholdMs ?? base.warningThresholdMs;
  const critical = Math.max(target.criticalThresholdMs ?? base.criticalThresholdMs, warning);
  return {
    failureThreshold: Math.max(1, target.failureThreshold ?? base.failureThreshold),
    recoveryThreshold: Math.max(1, target.recoveryThreshold ?? base.recoveryThreshold),
    warningThresholdMs: Math.max(1, warning),
    criticalThresholdMs: Math.max(1, critical),
  };
}

export interface AlertSignal {
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  message: string;
  condition: string;
}

/**
 * Classifies a completed check. Availability failures win over latency, and a critical latency
 * breach is reported as such only when the check succeeded.
 */
export function evaluateAlertSignal(input: {
  targetName: string;
  state: ServiceState;
  consecutiveFailures: number;
  responseTimeMs: number | null;
  lastError?: string | null;
  thresholds: EffectiveThresholds;
}): AlertSignal | null {
  const { targetName, state, consecutiveFailures, responseTimeMs, thresholds } = input;
  if (state === "unavailable" || consecutiveFailures >= thresholds.failureThreshold) {
    return {
      kind: "availability",
      severity: "critical",
      title: `${targetName} is unavailable`,
      message:
        input.lastError ??
        `${consecutiveFailures} consecutive failed checks (threshold ${thresholds.failureThreshold})`,
      condition: `${consecutiveFailures} consecutive failures >= threshold ${thresholds.failureThreshold}`,
    };
  }
  if (responseTimeMs === null || state === "unknown") return null;
  if (responseTimeMs >= thresholds.criticalThresholdMs) {
    return {
      kind: "latency",
      severity: "critical",
      title: `${targetName} response time is critical`,
      message: `${responseTimeMs} ms exceeds the critical threshold of ${thresholds.criticalThresholdMs} ms`,
      condition: `responseTimeMs >= ${thresholds.criticalThresholdMs}`,
    };
  }
  if (responseTimeMs >= thresholds.warningThresholdMs) {
    return {
      kind: "latency",
      severity: "warning",
      title: `${targetName} response time is degraded`,
      message: `${responseTimeMs} ms exceeds the warning threshold of ${thresholds.warningThresholdMs} ms`,
      condition: `responseTimeMs >= ${thresholds.warningThresholdMs}`,
    };
  }
  return null;
}

/** One active alert per target and condition kind; resolved alerts free the key again. */
export function alertDedupeKey(targetId: string, kind: AlertKind): string {
  return `${targetId}:${kind}`;
}

export interface MaintenanceWindowLike {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
}

/** Maintenance that is currently running (or explicitly in progress) suppresses alert escalation. */
export function determineSuppression(
  windows: MaintenanceWindowLike[],
  now: Date,
): { suppressed: boolean; until: Date | null; reason: string | null; windowId: string | null } {
  const active = windows
    .filter((window) => window.startsAt.getTime() <= now.getTime() && window.endsAt.getTime() > now.getTime())
    .sort((a, b) => b.endsAt.getTime() - a.endsAt.getTime())[0];
  if (!active) return { suppressed: false, until: null, reason: null, windowId: null };
  return {
    suppressed: true,
    until: active.endsAt,
    reason: `Maintenance window "${active.title}"`,
    windowId: active.id,
  };
}

/** True when a target leaves the unavailable state, which closes its availability alert. */
export function isRecovered(previous: ServiceState, next: ServiceState): boolean {
  return previous === "unavailable" && (next === "healthy" || next === "degraded");
}

/** Automatic incident creation is opt-in per environment and per target, never during maintenance. */
export function shouldAutoCreateIncident(input: {
  environmentEnabled: boolean;
  targetEnabled: boolean;
  suppressed: boolean;
  existingIncidentId: string | null;
  severity: AlertSeverity;
}): boolean {
  if (!input.environmentEnabled || !input.targetEnabled || input.suppressed) return false;
  if (input.existingIncidentId) return false;
  return ACTIVE_FOR_INCIDENT.includes(input.severity);
}

/** Maps alert severity to incident severity/priority for automatically created incidents. */
export function incidentDefaultsForAlert(severity: AlertSeverity): {
  severity: "critical" | "high";
  priority: "p1" | "p2";
} {
  return severity === "critical" ? { severity: "critical", priority: "p1" } : { severity: "high", priority: "p2" };
}

/** Suppression must never rewrite the service health state, only the alert lifecycle. */
export function suppressedAlertPatch(reason: string, until: Date | null, now: Date): {
  status: "suppressed";
  suppressionReason: string;
  suppressedAt: Date;
  suppressedUntil: Date | null;
} {
  return { status: "suppressed", suppressionReason: reason, suppressedAt: now, suppressedUntil: until };
}
