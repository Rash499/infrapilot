"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Activity, CalendarClock, GitPullRequest, RefreshCw, Server, ShieldAlert, Siren } from "lucide-react";
import { DistributionChart, ResponseTrendChart } from "@/components/charts";
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Select, Skeleton, StatCard, StatusBadge } from "@/components/ui";
import { fetchData } from "@/lib/client/api";
import { useAsync } from "@/lib/client/use-async";
import { fmtDateTime, fmtPct, fmtRelative, humanize } from "@/lib/format";
import type { Dashboard } from "@/types/api";

export default function OverviewPage() {
  const [days, setDays] = useState(7);
  const { data: d, error, loading, reload } = useAsync(() => fetchData<Dashboard>("/dashboard", { days }), [days]);

  useEffect(() => {
    if (loading) return;
    const refresh = () => {
      if (document.visibilityState === "visible") reload();
    };
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loading, reload]);

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
            <Button variant="outline" onClick={reload} loading={loading && !!d}>
              <RefreshCw className="size-4" aria-hidden="true" />
              Refresh
            </Button>
          </>
        }
      />

      {error && !d ? <ErrorState message={error} onRetry={reload} /> : null}
      {!d && loading ? (
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
              <Link href="/assets" className="block rounded-xl transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500">
                <StatCard label="Registered assets" value={d.kpis.totalAssets} hint={`${d.kpis.maintenanceAssets} in maintenance`} icon={Server} />
              </Link>
              <Link href="/assets" className="block rounded-xl transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500">
                <StatCard label="Healthy assets" value={d.kpis.healthyAssets} hint={`${d.kpis.degradedAssets} degraded · ${d.kpis.unknownAssets} unknown`} icon={Activity} tone="success" />
              </Link>
              <Link href="/assets" className="block rounded-xl transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500">
                <StatCard label="Unavailable assets" value={d.kpis.unavailableAssets} hint="Based on monitoring and manual status" icon={Siren} tone="danger" />
              </Link>
              <Link href="/monitoring" className="block rounded-xl transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500">
                <StatCard
                  label="Monitored services"
                  value={d.kpis.monitoredServices}
                  hint={`${d.kpis.serviceHealthy} healthy · ${d.kpis.serviceDegraded} degraded · ${d.kpis.serviceUnavailable} down`}
                  icon={Activity}
                  tone={d.kpis.serviceUnavailable > 0 ? "danger" : "neutral"}
                />
              </Link>
              <Link href="/monitoring" className="block rounded-xl transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500">
                <StatCard
                  label={`Uptime · ${d.range.days === 1 ? "24 hours" : `${d.range.days} days`}`}
                  value={fmtPct(d.monitoringSummary.uptimePct)}
                  hint={d.monitoringSummary.checks > 0 ? `${d.monitoringSummary.checks.toLocaleString()} completed checks` : "No completed checks in this period"}
                  icon={Activity}
                  tone={d.monitoringSummary.uptimePct === null ? "neutral" : d.monitoringSummary.uptimePct < 95 ? "danger" : "success"}
                />
              </Link>
              <Link href="/incidents" className="block rounded-xl transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500">
                <StatCard label="Open incidents" value={d.kpis.openIncidents} hint="Not yet resolved or closed" icon={Siren} tone={d.kpis.openIncidents > 0 ? "warning" : "neutral"} />
              </Link>
              <Link href="/security" className="block rounded-xl transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500">
                <StatCard label="Critical & high findings" value={d.kpis.criticalHighOpenFindings} hint="Open or in progress" icon={ShieldAlert} tone={d.kpis.criticalHighOpenFindings > 0 ? "danger" : "neutral"} />
              </Link>
              <Link href="/maintenance" className="block rounded-xl transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500">
                <StatCard label="Upcoming maintenance" value={d.kpis.upcomingMaintenance} hint="Scheduled in the next 14 days" icon={CalendarClock} />
              </Link>
              <Link href="/changes" className="block rounded-xl transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500">
                <StatCard label="Recent changes" value={d.recentChanges.length} hint={`Updated in the last ${d.range.days === 1 ? "24 hours" : `${d.range.days} days`}`} icon={GitPullRequest} />
              </Link>
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
                <h2 className="text-sm font-semibold text-fg">Services needing attention</h2>
                <Link href="/monitoring" className="text-xs text-sky-500 hover:underline">
                  View all
                </Link>
              </div>
              {d.attentionServices.length === 0 ? (
                <EmptyState icon={Activity} title="All enabled checks are healthy" description="Degraded and unavailable services appear here." />
              ) : (
                <ul className="divide-y divide-line">
                  {d.attentionServices.map((service) => (
                    <li key={service.id}>
                      <Link
                        href={`/monitoring?target=${encodeURIComponent(service.id)}`}
                        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-fg">
                            {service.name} <span className="text-xs text-muted">{service.monitorType.toUpperCase()}</span>
                          </p>
                          <p className="truncate text-xs text-muted">
                            {service.assetName ? `Asset: ${service.assetName}` : "No linked asset"} · Checked {fmtRelative(service.lastCheckedAt)}
                          </p>
                          {service.lastError ? <p className="truncate text-xs text-rose-500">{service.lastError}</p> : null}
                        </div>
                        <StatusBadge value={service.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <h2 className="text-sm font-semibold text-fg">Monitoring checks overdue</h2>
                <Link href="/monitoring" className="text-xs text-sky-500 hover:underline">
                  View all
                </Link>
              </div>
              {d.overdueServices.length === 0 ? (
                <EmptyState icon={Activity} title="No overdue checks" description="Healthy and new targets overdue by more than two intervals appear here." />
              ) : (
                <ul className="divide-y divide-line">
                  {d.overdueServices.map((service) => (
                    <li key={service.id}>
                      <Link
                        href={`/monitoring?target=${encodeURIComponent(service.id)}`}
                        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-fg">
                            {service.name} <span className="text-xs text-muted">{service.monitorType.toUpperCase()}</span>
                          </p>
                          <p className="truncate text-xs text-muted">
                            {service.assetName ? `Asset: ${service.assetName}` : "No linked asset"} · Due {fmtRelative(service.nextCheckAt)}
                          </p>
                          <p className="text-xs text-muted">Last result: {fmtRelative(service.lastCheckedAt)}</p>
                        </div>
                        <StatusBadge value={service.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <h2 className="text-sm font-semibold text-fg">Active incidents</h2>
                <Link href="/incidents" className="text-xs text-sky-500 hover:underline">
                  View all
                </Link>
              </div>
              {d.recentIncidents.length === 0 ? (
                <EmptyState icon={Siren} title="No active incidents" description="Open incidents requiring investigation appear here." />
              ) : (
                <ul className="divide-y divide-line">
                  {d.recentIncidents.map((incident) => (
                    <li key={incident.id}>
                      <Link
                        href={`/incidents/${encodeURIComponent(incident.id)}`}
                        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-fg">
                            <span className="text-muted">{incident.reference}</span> {incident.title}
                          </p>
                          <p className="text-xs text-muted">
                            {incident.assigneeName ?? "Unassigned"} · Opened {fmtRelative(incident.openedAt)}
                          </p>
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <StatusBadge value={incident.severity} />
                          <StatusBadge value={incident.status} />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <h2 className="text-sm font-semibold text-fg">Critical & high findings</h2>
                <Link href="/security" className="text-xs text-sky-500 hover:underline">
                  View all
                </Link>
              </div>
              {d.criticalFindings.length === 0 ? (
                <EmptyState icon={ShieldAlert} title="No high-risk findings" description="Open critical and high findings appear here." />
              ) : (
                <ul className="divide-y divide-line">
                  {d.criticalFindings.map((finding) => (
                    <li key={finding.id}>
                      <Link
                        href={`/security?finding=${encodeURIComponent(finding.id)}`}
                        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-fg">{finding.title}</p>
                          <p className="text-xs text-muted">
                            {finding.cveId ?? finding.assetName ?? "No linked asset"} · Updated {fmtRelative(finding.updatedAt)}
                          </p>
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <StatusBadge value={finding.severity} />
                          <StatusBadge value={finding.status} />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
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
          <p className="text-right text-xs text-muted">
            Generated {fmtDateTime(d.generatedAt)} · Auto-refreshes every minute while this tab is visible
          </p>
        </>
      ) : null}
    </div>
  );
}
