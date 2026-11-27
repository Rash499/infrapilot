import { describe, expect, it } from "vitest";
import {
  computeIncidentSla,
  DEFAULT_SLA_TARGETS,
  summarizeIncidents,
} from "../../packages/server-core/src/monitoring/sla";

const opened = new Date("2026-01-01T00:00:00.000Z");
const at = (minutes: number) => new Date(opened.getTime() + minutes * 60_000);

function incident(
  overrides: Partial<Parameters<typeof computeIncidentSla>[0] & { severity: "critical" | "high" | "medium" | "low" }> = {},
) {
  return {
    priority: "p1" as const,
    severity: "critical" as const,
    status: "open" as const,
    openedAt: opened,
    acknowledgedAt: null,
    resolvedAt: null,
    ...overrides,
  };
}

describe("SLA policy", () => {
  it("publishes documented targets per priority", () => {
    expect(DEFAULT_SLA_TARGETS.p1).toEqual({ acknowledgeMinutes: 15, resolveMinutes: 240 });
    expect(DEFAULT_SLA_TARGETS.p2.resolveMinutes).toBe(480);
    expect(DEFAULT_SLA_TARGETS.p3.resolveMinutes).toBe(1440);
    expect(DEFAULT_SLA_TARGETS.p4.acknowledgeMinutes).toBe(480);
  });

  it("computes due dates from the open time", () => {
    const sla = computeIncidentSla(incident(), at(1));
    expect(sla.acknowledgeDueAt.toISOString()).toBe("2026-01-01T00:15:00.000Z");
    expect(sla.resolveDueAt.toISOString()).toBe("2026-01-01T04:00:00.000Z");
  });
});

describe("computeIncidentSla", () => {
  it("never reports an unresolved incident as met", () => {
    expect(computeIncidentSla(incident(), at(1)).state).toBe("pending");
    const sla = computeIncidentSla(incident(), at(1));
    expect(sla.minutesToResolve).toBeNull();
    expect(sla.resolvedAt).toBeNull();
  });

  it("marks an overdue, still-open incident as breached but not resolved", () => {
    const sla = computeIncidentSla(incident({ acknowledgedAt: at(10) }), at(300));
    expect(sla.state).toBe("breached");
    expect(sla.resolveBreached).toBe(true);
    expect(sla.minutesToResolve).toBeNull();
  });

  it("marks an incident at 80% of the acknowledgement budget as at risk", () => {
    expect(computeIncidentSla(incident(), at(13)).state).toBe("at_risk");
    expect(computeIncidentSla(incident(), at(5)).state).toBe("pending");
  });

  it("records acknowledgement time and breach when acknowledgement was late", () => {
    const sla = computeIncidentSla(incident({ acknowledgedAt: at(20) }), at(21));
    expect(sla.acknowledgeBreached).toBe(true);
    expect(sla.minutesToAcknowledge).toBe(20);
    expect(sla.state).toBe("breached");
  });

  it("reports resolved incidents as met when inside both targets", () => {
    const sla = computeIncidentSla(
      incident({ status: "resolved", acknowledgedAt: at(5), resolvedAt: at(60) }),
      at(120),
    );
    expect(sla.state).toBe("met");
    expect(sla.minutesToAcknowledge).toBe(5);
    expect(sla.minutesToResolve).toBe(60);
  });

  it("flags incidents resolved after their resolve target", () => {
    const sla = computeIncidentSla(
      incident({ status: "resolved", acknowledgedAt: at(5), resolvedAt: at(300) }),
      at(400),
    );
    expect(sla.resolveBreached).toBe(true);
    expect(sla.state).toBe("breached");
  });

  it("honours policy overrides", () => {
    const sla = computeIncidentSla(incident(), at(1), { p1: { acknowledgeMinutes: 1, resolveMinutes: 2 } });
    expect(sla.acknowledgeDueAt.toISOString()).toBe("2026-01-01T00:01:00.000Z");
  });
});

describe("summarizeIncidents", () => {
  it("averages only acknowledged/resolved incidents and keeps open work separate", () => {
    const rows = [
      incident({ status: "resolved", acknowledgedAt: at(5), resolvedAt: at(30) }),
      incident({ status: "closed", acknowledgedAt: at(15), resolvedAt: at(90) }),
      incident({ status: "open", acknowledgedAt: at(10), severity: "medium" }),
      incident({ priority: "p3", status: "investigating", severity: "low" }),
    ];
    const metrics = summarizeIncidents(rows, at(120));
    expect(metrics.volume).toBe(4);
    expect(metrics.openIncidents).toBe(2);
    expect(metrics.resolvedIncidents).toBe(2);
    expect(metrics.mttaMinutes).toBe(10);
    expect(metrics.mttrMinutes).toBe(60);
    expect(metrics.bySeverity.find((row) => row.severity === "critical")?.count).toBe(2);
  });

  it("counts breaches separately from at-risk incidents", () => {
    const breached = summarizeIncidents([incident({ status: "open", acknowledgedAt: at(10) })], at(300));
    expect(breached.breachedSla).toBe(1);
    expect(breached.atRiskSla).toBe(0);

    // p3 acknowledgement target is 120 minutes; at 100 minutes the incident is at risk, not breached.
    const atRisk = summarizeIncidents([incident({ priority: "p3", status: "open" })], at(100));
    expect(atRisk.atRiskSla).toBe(1);
    expect(atRisk.breachedSla).toBe(0);
  });

  it("builds a daily opened/resolved trend from real timestamps", () => {
    const rows = [
      incident({ status: "resolved", resolvedAt: new Date("2026-01-02T05:00:00Z") }),
      incident({ status: "open" }),
    ];
    const metrics = summarizeIncidents(rows, at(60));
    expect(metrics.resolutionTrend).toEqual([
      { date: "2026-01-01", opened: 2, resolved: 0 },
      { date: "2026-01-02", opened: 0, resolved: 1 },
    ]);
  });
});
