"use client";

import Link from "next/link";
import { useState } from "react";
import { Activity, CalendarClock, GitPullRequest, RefreshCw, Server, ShieldAlert, Siren } from "lucide-react";
import { DistributionChart, ResponseTrendChart } from "@/components/charts";
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Select, Skeleton, StatCard, StatusBadge } from "@/components/ui";
import { fetchData } from "@/lib/client/api";
import { useAsync } from "@/lib/client/use-async";
import { fmtDateTime, fmtRelative, humanize } from "@/lib/format";
import type { Dashboard } from "@/types/api";

export default function OverviewPage() {
  const [days, setDays] = useState(7);
  const dash = useAsync(() => fetchData<Dashboard>("/dashboard", { days }), [days]);
  const d = dash.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Operations overview"
        description="Live infrastructure health, risk and change activity computed from the database."
        actions={
          <>
            <Select aria-label="Date range" value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-40">
              <option value={1}>Last 24 hours</option>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </Select>
            <Button variant="outline" onClick={dash.reload} loading={dash.loading && !!d}>
              <RefreshCw className="size-4" aria-hidden="true" />
              Refresh
            </Button>
          </>
        }
      />

      {dash.error && !d ? <ErrorState message={dash.error} onRetry={dash.reload} /> : null}
      {!d && dash.loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : null}

      {d ? (
        <>
          <section aria-labelledby="kpi-heading" className="space-y-3">
            <h2 id="kpi-heading" className="sr-only">
              Key indicators
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Registered assets" value={d.kpis.totalAssets} hint={`${d.kpis.maintenanceAssets} in maintenance`} icon={Server} />
              <StatCard label="Healthy assets" value={d.kpis.healthyAssets} hint={`${d.kpis.degradedAssets} degraded · ${d.kpis.unknownAssets} unknown`} icon={Activity} tone="success" />
              <StatCard label="Unavailable assets" value={d.kpis.unavailableAssets} hint="Based on monitoring and manual status" icon={Siren} tone="danger" />
              <StatCard
                label="Monitored services"
                value={d.kpis.monitoredServices}
                hint={`${d.kpis.serviceHealthy} healthy · ${d.kpis.serviceDegraded} degraded · ${d.kpis.serviceUnavailable} down`}
                icon={Activity}
                tone={d.kpis.serviceUnavailable > 0 ? "danger" : "neutral"}
              />
              <StatCard label="Open incidents" value={d.kpis.openIncidents} hint="Not yet resolved or closed" icon={Siren} tone={d.kpis.openIncidents > 0 ? "warning" : "neutral"} />
              <StatCard label="Critical & high findings" value={d.kpis.criticalHighOpenFindings} hint="Open or in progress" icon={ShieldAlert} tone={d.kpis.criticalHighOpenFindings > 0 ? "danger" : "neutral"} />
              <StatCard label="Upcoming maintenance" value={d.kpis.upcomingMaintenance} hint="Scheduled in the next 14 days" icon={CalendarClock} />
              <StatCard label="Recent changes" value={d.recentChanges.length} hint={`Updated in the last ${d.range.days === 1 ? "24 hours" : `${d.range.days} days`}`} icon={GitPullRequest} />
            </div>
          </section>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="p-4 xl:col-span-2">
              <h2 className="mb-3 text-sm font-semibold text-fg">Response time and uptime</h2>
              <ResponseTrendChart data={d.responseTrend} />
            </Card>
            <Card className="p-4">
              <h2 className="mb-3 text-sm font-semibold text-fg">Asset distribution by category</h2>
              <DistributionChart data={d.assetDistribution} />
            </Card>
            <Card className="p-4">
              <h2 className="mb-3 text-sm font-semibold text-fg">Incidents by severity</h2>
              <DistributionChart data={d.incidentBySeverity.map((s) => ({ label: humanize(s.severity), count: s.count }))} color="#fb7185" height={200} />
            </Card>
            <Card className="p-4">
              <h2 className="mb-3 text-sm font-semibold text-fg">Security findings by status</h2>
              <DistributionChart data={d.findingsByStatus.map((s) => ({ label: s.label, count: s.count }))} color="#fbbf24" height={200} />
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <h2 className="text-sm font-semibold text-fg">Recent infrastructure changes</h2>
                <Link href="/changes" className="text-xs text-sky-500 hover:underline">
                  View all
                </Link>
              </div>
              {d.recentChanges.length === 0 ? (
                <EmptyState icon={GitPullRequest} title="No recent changes" description="Change requests updated in this range appear here." />
              ) : (
                <ul className="divide-y divide-line">
                  {d.recentChanges.map((c) => (
                    <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-fg">
                          <span className="text-muted">{c.reference}</span> {c.title}
                        </p>
                        <p className="text-xs text-muted">
                          {c.requesterName ?? "Unknown requester"} · {fmtRelative(c.updatedAt)}
                        </p>
                      </div>
                      <StatusBadge value={c.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <h2 className="text-sm font-semibold text-fg">Upcoming maintenance</h2>
                <Link href="/maintenance" className="text-xs text-sky-500 hover:underline">
                  View all
                </Link>
              </div>
              {d.upcomingMaintenance.length === 0 ? (
                <EmptyState icon={CalendarClock} title="Nothing scheduled" description="Scheduled maintenance windows for the next 14 days appear here." />
              ) : (
                <ul className="divide-y divide-line">
                  {d.upcomingMaintenance.map((m) => (
                    <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-fg">{m.title}</p>
                        <p className="text-xs text-muted">
                          {fmtDateTime(m.startsAt)} → {fmtDateTime(m.endsAt)}
                        </p>
                      </div>
                      <Badge tone="info">{m.ownerName ?? "No owner"}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
          <p className="text-right text-xs text-muted">Generated {fmtDateTime(d.generatedAt)}</p>
        </>
      ) : null}
    </div>
  );
}
