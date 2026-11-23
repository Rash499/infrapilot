// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Dashboard } from "@/types/api";

const mocks = vi.hoisted(() => ({ useAsync: vi.fn() }));

vi.mock("@/lib/client/use-async", () => ({ useAsync: mocks.useAsync }));
vi.mock("@/components/charts", () => ({
  DistributionChart: () => null,
  ResponseTrendChart: () => null,
}));

import OverviewPage from "@/app/(app)/page";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const dashboard: Dashboard = {
  range: { days: 7, from: "2026-01-01T00:00:00.000Z", to: "2026-01-08T00:00:00.000Z" },
  kpis: {
    totalAssets: 10,
    healthyAssets: 8,
    degradedAssets: 1,
    unavailableAssets: 1,
    maintenanceAssets: 0,
    unknownAssets: 0,
    monitoredServices: 4,
    serviceHealthy: 3,
    serviceDegraded: 0,
    serviceUnavailable: 1,
    serviceUnknown: 0,
    openIncidents: 2,
    criticalHighOpenFindings: 1,
    upcomingMaintenance: 1,
  },
  assetDistribution: [],
  incidentBySeverity: [],
  findingsByStatus: [],
  monitoringSummary: { uptimePct: 99.25, checks: 400 },
  responseTrend: [],
  attentionServices: [
    {
      id: "monitor-1",
      name: "Checkout API",
      monitorType: "http",
      status: "unavailable",
      assetName: "api-server",
      lastCheckedAt: "2026-01-08T00:00:00.000Z",
      lastError: "Connection timed out",
      consecutiveFailures: 3,
    },
  ],
  overdueServices: [
    {
      id: "monitor-2",
      name: "Payments API",
      monitorType: "http",
      status: "healthy",
      assetName: "payments-server",
      nextCheckAt: "2026-01-08T00:00:00.000Z",
      lastCheckedAt: "2026-01-07T23:00:00.000Z",
      intervalSeconds: 60,
    },
  ],
  upcomingMaintenance: [],
  recentChanges: [],
  recentIncidents: [
    {
      id: "incident-1",
      reference: "INC-00001",
      title: "Checkout unavailable",
      severity: "critical",
      status: "investigating",
      assigneeName: "Ada",
      openedAt: "2026-01-08T00:00:00.000Z",
    },
  ],
  criticalFindings: [
    {
      id: "finding-1",
      title: "Critical library vulnerability",
      severity: "critical",
      status: "open",
      assetName: "api-server",
      cveId: "CVE-2026-0001",
      updatedAt: "2026-01-08T00:00:00.000Z",
    },
  ],
  generatedAt: "2026-01-08T00:00:00.000Z",
};

describe("overview KPI navigation", () => {
  it("links each KPI to its relevant module", () => {
    mocks.useAsync.mockReturnValue({ data: dashboard, error: null, loading: false, reload: vi.fn() });
    render(<OverviewPage />);

    const destinations = [
      ["Registered assets", "/assets"],
      ["Healthy assets", "/assets"],
      ["Unavailable assets", "/assets"],
      ["Monitored services", "/monitoring"],
      ["Uptime · 7 days", "/monitoring"],
      ["Open incidents", "/incidents"],
      ["Critical & high findings", "/security"],
      ["Upcoming maintenance", "/maintenance"],
      ["Recent changes", "/changes"],
    ] as const;

    for (const [label, href] of destinations) {
      expect(screen.getByRole("link", { name: new RegExp(label) })).toHaveAttribute("href", href);
    }
  });

  it("shows links for active incidents and high-risk findings", () => {
    mocks.useAsync.mockReturnValue({ data: dashboard, error: null, loading: false, reload: vi.fn() });
    render(<OverviewPage />);

    expect(screen.getByRole("link", { name: /INC-00001 Checkout unavailable/ })).toHaveAttribute("href", "/incidents/incident-1");
    expect(screen.getByRole("link", { name: /Critical library vulnerability/ })).toHaveAttribute("href", "/security?finding=finding-1");
  });

  it("links unhealthy monitoring checks to their details", () => {
    mocks.useAsync.mockReturnValue({ data: dashboard, error: null, loading: false, reload: vi.fn() });
    render(<OverviewPage />);

    expect(screen.getByRole("link", { name: /Checkout API HTTP.*Connection timed out/ })).toHaveAttribute(
      "href",
      "/monitoring?target=monitor-1",
    );
  });

  it("links overdue healthy checks to their details", () => {
    mocks.useAsync.mockReturnValue({ data: dashboard, error: null, loading: false, reload: vi.fn() });
    render(<OverviewPage />);

    expect(screen.getByRole("link", { name: /Payments API HTTP.*Due.*Last result/ })).toHaveAttribute(
      "href",
      "/monitoring?target=monitor-2",
    );
  });

  it("refreshes visible dashboards every minute and on returning to the tab", () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    mocks.useAsync.mockReturnValue({ data: dashboard, error: null, loading: false, reload });
    render(<OverviewPage />);

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(reload).not.toHaveBeenCalled();

    visibility.mockReturnValue("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(reload).toHaveBeenCalledOnce();
  });
});
