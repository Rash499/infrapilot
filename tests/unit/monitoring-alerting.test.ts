import { describe, expect, it } from "vitest";
import {
  alertDedupeKey,
  DEFAULT_THRESHOLDS,
  determineSuppression,
  effectiveThresholds,
  evaluateAlertSignal,
  incidentDefaultsForAlert,
  isRecovered,
  shouldAutoCreateIncident,
  suppressedAlertPatch,
} from "../../packages/server-core/src/monitoring/alerting";

const now = new Date("2026-02-01T10:00:00.000Z");
const window = (startsAt: string, endsAt: string, id = "m1", title = "Patch window") => ({
  id,
  title,
  startsAt: new Date(startsAt),
  endsAt: new Date(endsAt),
});

describe("effectiveThresholds", () => {
  it("falls back to documented defaults for targets created before thresholds existed", () => {
    expect(effectiveThresholds({})).toEqual(DEFAULT_THRESHOLDS);
  });

  it("uses the degraded threshold as the warning threshold when none is configured", () => {
    const resolved = effectiveThresholds({ degradedThresholdMs: 800 });
    expect(resolved.warningThresholdMs).toBe(800);
  });

  it("never lets a critical threshold sit below the warning threshold", () => {
    const resolved = effectiveThresholds({ warningThresholdMs: 4000, criticalThresholdMs: 1000 });
    expect(resolved.criticalThresholdMs).toBe(4000);
  });

  it("clamps thresholds to at least one and applies environment defaults", () => {
    const resolved = effectiveThresholds({ failureThreshold: 0, recoveryThreshold: 0 }, { failureThreshold: 5 });
    expect(resolved.failureThreshold).toBe(1);
    expect(resolved.recoveryThreshold).toBe(1);
  });
});

describe("evaluateAlertSignal", () => {
  const thresholds = effectiveThresholds({});

  it("raises a critical availability alert once the failure threshold is reached", () => {
    const signal = evaluateAlertSignal({
      targetName: "Checkout API",
      state: "unavailable",
      consecutiveFailures: 3,
      responseTimeMs: null,
      lastError: "connection refused",
      thresholds,
    });
    expect(signal).toMatchObject({
      kind: "availability",
      severity: "critical",
      title: "Checkout API is unavailable",
      message: "connection refused",
    });
  });

  it("treats reaching the failure threshold as unavailable even if state has not flipped yet", () => {
    const signal = evaluateAlertSignal({
      targetName: "API",
      state: "healthy",
      consecutiveFailures: 3,
      responseTimeMs: 100,
      thresholds,
    });
    expect(signal?.kind).toBe("availability");
  });

  it("classifies latency as warning or critical using configured thresholds", () => {
    const warning = evaluateAlertSignal({
      targetName: "API",
      state: "degraded",
      consecutiveFailures: 0,
      responseTimeMs: 2000,
      thresholds,
    });
    expect(warning).toMatchObject({ kind: "latency", severity: "warning" });

    const critical = evaluateAlertSignal({
      targetName: "API",
      state: "healthy",
      consecutiveFailures: 0,
      responseTimeMs: 6000,
      thresholds,
    });
    expect(critical).toMatchObject({ kind: "latency", severity: "critical" });
  });

  it("returns no signal for a fast, successful check or an unknown state", () => {
    expect(
      evaluateAlertSignal({ targetName: "API", state: "healthy", consecutiveFailures: 0, responseTimeMs: 120, thresholds }),
    ).toBeNull();
    expect(
      evaluateAlertSignal({ targetName: "API", state: "unknown", consecutiveFailures: 0, responseTimeMs: 120, thresholds }),
    ).toBeNull();
  });
});

describe("deduplication keys", () => {
  it("keys an alert by target and condition kind", () => {
    expect(alertDedupeKey("t-1", "availability")).toBe("t-1:availability");
    expect(alertDedupeKey("t-1", "latency")).not.toBe(alertDedupeKey("t-1", "availability"));
  });
});

describe("determineSuppression", () => {
  it("suppresses inside an active window and reports its end", () => {
    const result = determineSuppression([window("2026-02-01T09:00:00Z", "2026-02-01T12:00:00Z")], now);
    expect(result.suppressed).toBe(true);
    expect(result.until?.toISOString()).toBe("2026-02-01T12:00:00.000Z");
    expect(result.reason).toContain("Patch window");
  });

  it("does not suppress before or after the window", () => {
    expect(determineSuppression([window("2026-02-01T11:00:00Z", "2026-02-01T12:00:00Z")], now).suppressed).toBe(false);
    expect(determineSuppression([window("2026-02-01T08:00:00Z", "2026-02-01T09:59:00Z")], now).suppressed).toBe(false);
  });

  it("uses the window that ends last when several overlap", () => {
    const result = determineSuppression(
      [
        window("2026-02-01T09:00:00Z", "2026-02-01T11:00:00Z", "a", "A"),
        window("2026-02-01T09:30:00Z", "2026-02-01T13:00:00Z", "b", "B"),
      ],
      now,
    );
    expect(result.windowId).toBe("b");
    expect(result.until?.toISOString()).toBe("2026-02-01T13:00:00.000Z");
  });
});

describe("automatic incidents", () => {
  const base = {
    environmentEnabled: true,
    targetEnabled: true,
    suppressed: false,
    existingIncidentId: null,
    severity: "critical" as const,
  };

  it("creates incidents only for critical alerts with every gate open", () => {
    expect(shouldAutoCreateIncident(base)).toBe(true);
    expect(shouldAutoCreateIncident({ ...base, environmentEnabled: false })).toBe(false);
    expect(shouldAutoCreateIncident({ ...base, targetEnabled: false })).toBe(false);
    expect(shouldAutoCreateIncident({ ...base, suppressed: true })).toBe(false);
    expect(shouldAutoCreateIncident({ ...base, existingIncidentId: "i-1" })).toBe(false);
    expect(shouldAutoCreateIncident({ ...base, severity: "warning" })).toBe(false);
  });

  it("maps alert severity to incident severity and priority", () => {
    expect(incidentDefaultsForAlert("critical")).toEqual({ severity: "critical", priority: "p1" });
    expect(incidentDefaultsForAlert("warning")).toEqual({ severity: "high", priority: "p2" });
  });
});

describe("recovery and suppression helpers", () => {
  it("treats only unavailable → healthy/degraded as a recovery", () => {
    expect(isRecovered("unavailable", "healthy")).toBe(true);
    expect(isRecovered("unavailable", "degraded")).toBe(true);
    expect(isRecovered("degraded", "healthy")).toBe(false);
    expect(isRecovered("unavailable", "unavailable")).toBe(false);
  });

  it("builds a suppression patch that leaves service health untouched", () => {
    const patch = suppressedAlertPatch("Maintenance window", new Date("2026-02-01T12:00:00Z"), now);
    expect(patch.status).toBe("suppressed");
    expect(patch.suppressedAt).toBe(now);
    expect(Object.keys(patch)).not.toContain("state");
  });
});
