"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  GitPullRequest,
  RefreshCw,
  Server,
  ShieldAlert,
  Siren,
  TriangleAlert,
} from "lucide-react";
import { DistributionChart, ResponseTrendChart } from "@/components/charts";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PageContainer,
  PageHeader,
  ProgressBar,
  Segmented,
  Skeleton,
  StatCard,
  StatusBadge,
  cn,
} from "@/components/ui";
import { fetchData } from "@/lib/client/api";
import { useAsync } from "@/lib/client/use-async";
import { fmtDateTime, fmtPct, fmtRelative, humanize } from "@/lib/format";
import type { Dashboard } from "@/types/api";

const RANGES = [
  { value: "1", label: "24h" },
  { value: "7", label: "7d" },
  { value: "30", label: "30d" },
  { value: "90", label: "90d" },
] as const;

const HEALTH_SEGMENTS = [
  { key: "healthy", label: "Healthy", tone: "success", bar: "bg-emerald-500" },
  { key: "degraded", label: "Degraded", tone: "warning", bar: "bg-amber-500" },
  { key: "unavailable", label: "Unavailable", tone: "danger", bar: "bg-rose-500" },
  { key: "maintenance", label: "Maintenance", tone: "info", bar: "bg-accent" },
  { key: "unknown", label: "Unknown", tone: "neutral", bar: "bg-slate-400" },
] as const;

function PanelLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 rounded text-xs font-medium text-muted transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
    >
      {children}
      <ArrowRight className="size-3.5" aria-hidden="true" />
    </Link>
  );
}

function HealthPanel({ d }: { d: Dashboard }) {
  const counts = {
    healthy: d.kpis.healthyAssets,
    degraded: d.kpis.degradedAssets,
    unavailable: d.kpis.unavailableAssets,
    maintenance: d.kpis.maintenanceAssets,
    unknown: d.kpis.unknownAssets,
  };
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const percent = (value: number) => (total > 0 ? Math.round((value / total) * 1000) / 10 : 0);

  return (
    <Card className="flex h-full flex-col">
      <CardHeader
        title="Infrastructure health"
        description={`${total.toLocaleString()} registered assets`}
        icon={Server}
        action={<PanelLink href="/assets">Assets</PanelLink>}
      />
      {total === 0 ? (
        <EmptyState
          icon={Server}
          compact
          title="No assets registered"
          description="Register infrastructure to see health distribution here."
        />
      ) : (
        <div className="space-y-4 p-4">
          <div
            className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-surface-3"
            role="img"
            aria-label={HEALTH_SEGMENTS.map((segment) => `${segment.label}: ${counts[segment.key]}`).join(", ")}
          >
            {HEALTH_SEGMENTS.map((segment) => {
              const pct = percent(counts[segment.key]);
              if (pct === 0) return null;
              return <span key={segment.key} className={cn("h-full", segment.bar)} style={{ width: `${pct}%` }} />;
            })}
          </div>
          <ul className="grid gap-1.5">
            {HEALTH_SEGMENTS.map((segment) => (
              <li key={segment.key} className="flex items-center justify-between gap-3 rounded-md px-1 py-0.5">
                <span className="flex min-w-0 items-center gap-2 text-[13px] text-fg">
                  <span className={cn("dot", `dot-${segment.tone}`)} aria-hidden="true" />
                  <span className="truncate">{segment.label}</span>
                </span>
                <span className="flex items-baseline gap-2">
                  <span className="text-[13px] font-medium tabular-nums text-fg">{counts[segment.key]}</span>
                  <span className="w-11 text-right text-2xs tabular-nums text-muted">{percent(counts[segment.key])}%</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="space-y-3 border-t border-line pt-3.5">
            <div>
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="text-muted">Monitored services healthy</span>
                <span className="font-medium tabular-nums text-fg">
                  {d.kpis.serviceHealthy}/{d.kpis.monitoredServices}
                </span>
              </div>
              <ProgressBar
                label="Monitored services healthy"
                value={d.kpis.monitoredServices > 0 ? (d.kpis.serviceHealthy / d.kpis.monitoredServices) * 100 : 0}
                tone={d.kpis.serviceUnavailable > 0 ? "warning" : "success"}
              />
            </div>
            <dl className="grid grid-cols-3 gap-2 text-center">
              {[
                { label: "Degraded", value: d.kpis.serviceDegraded, tone: "text-amber-600 dark:text-amber-400" },
                { label: "Down", value: d.kpis.serviceUnavailable, tone: "text-rose-600 dark:text-rose-400" },
                { label: "Unknown", value: d.kpis.serviceUnknown, tone: "text-muted" },
              ].map((stat) => (
                <div key={stat.label} className="rounded-md border border-line bg-surface-2/60 py-1.5">
                  <dt className="text-2xs font-medium uppercase tracking-wide text-muted">{stat.label}</dt>
                  <dd className={cn("text-sm font-semibold tabular-nums", stat.tone)}>{stat.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}
    </Card>
  );
}

export default function OverviewPage() {
  const [range, setRange] = useState<(typeof RANGES)[number]["value"]>("7");
  const days = Number(range);
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

  const rangeLabel = days === 1 ? "24 hours" : `${days} days`;
  const criticalServices = (d?.kpis.serviceUnavailable ?? 0) + (d?.kpis.unavailableAssets ?? 0);
  const riskSignals = (d?.kpis.openIncidents ?? 0) + (d?.kpis.criticalHighOpenFindings ?? 0);
  const banner =
    !d
      ? null
      : d.kpis.monitoredServices === 0 && d.kpis.totalAssets === 0
        ? {
            tone: "neutral" as const,
            title: "Nothing registered yet",
            description: "Register assets and add monitoring checks to populate operational health.",
            icon: Activity,
          }
        : criticalServices > 0
          ? {
              tone: "danger" as const,
              title: "Attention required",
              description: `${criticalServices} ${criticalServices === 1 ? "resource is" : "resources are"} unavailable or down. ${d.kpis.openIncidents} open ${d.kpis.openIncidents === 1 ? "incident" : "incidents"} across the workspace.`,
              icon: TriangleAlert,
            }
          : riskSignals > 0
            ? {
                tone: "warning" as const,
                title: "Elevated risk",
                description: `${d.kpis.openIncidents} open ${d.kpis.openIncidents === 1 ? "incident" : "incidents"} and ${d.kpis.criticalHighOpenFindings} critical or high ${d.kpis.criticalHighOpenFindings === 1 ? "finding" : "findings"} need review. All monitored services are responding.`,
                icon: ShieldAlert,
              }
            : {
                tone: "success" as const,
                title: "All monitored services operational",
                description:
                  d.kpis.monitoredServices > 0
                    ? `${d.kpis.serviceHealthy} of ${d.kpis.monitoredServices} checks healthy · ${fmtPct(d.monitoringSummary.uptimePct)} uptime over the last ${rangeLabel}.`
                    : "No monitoring checks are configured yet.",
                icon: CheckCircle2,
              };

  const bannerStyles: Record<"neutral" | "success" | "warning" | "danger", string> = {
    neutral: "border-line bg-surface",
    success: "border-emerald-500/25 bg-emerald-500/[0.06]",
    warning: "border-amber-500/25 bg-amber-500/[0.07]",
    danger: "border-rose-500/30 bg-rose-500/[0.07]",
  };
  const bannerIcon: Record<"neutral" | "success" | "warning" | "danger", string> = {
    neutral: "text-muted",
    success: "text-emerald-600 dark:text-emerald-400",
    warning: "text-amber-600 dark:text-amber-400",
    danger: "text-rose-600 dark:text-rose-400",
  };

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Operations"
        title="Operations overview"
        description="Live infrastructure health, risk and change activity computed from the database."
        meta={
          d ? (
            <>
              <span className="inline-flex items-center gap-1.5">
                <span className="dot dot-success" aria-hidden="true" />
                Live data
              </span>
              <span>Updated {fmtRelative(d.generatedAt)}</span>
              <span className="hidden sm:inline">Auto-refreshes every minute</span>
            </>
          ) : null
        }
        actions={
          <>
            <Segmented
              label="Date range"
              options={RANGES.map((option) => ({ value: option.value, label: option.label }))}
              value={range}
              onChange={setRange}
            />
            <Button variant="outline" onClick={reload} loading={loading && !!d}>
              <RefreshCw className="size-4" aria-hidden="true" />
              Refresh
            </Button>
          </>
        }
      />

      {error && !d ? <ErrorState message={error} onRetry={reload} /> : null}

      {!d && loading ? (
        <div className="space-y-5" aria-busy="true">
          <Skeleton className="h-20 w-full" />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-[104px]" />
            ))}
          </div>
          <div className="grid gap-3 xl:grid-cols-3">
            <Skeleton className="h-72 xl:col-span-2" />
            <Skeleton className="h-72" />
          </div>
        </div>
      ) : null}

      {d && banner ? (
        <section aria-label="Workspace health" className={cn("rounded-card border p-4 shadow-card", bannerStyles[banner.tone])}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span className={cn("mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg border border-current/20 bg-surface/60", bannerIcon[banner.tone])}>
                <banner.icon className="size-[18px]" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-fg">{banner.title}</h2>
                <p className="mt-0.5 text-sm leading-relaxed text-muted">{banner.description}</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-4 sm:gap-6">
              <div>
                <p className="text-2xs font-semibold uppercase tracking-[0.08em] text-muted">Uptime</p>
                <p className="text-lg font-semibold tabular-nums text-fg">{fmtPct(d.monitoringSummary.uptimePct)}</p>
              </div>
              <div>
                <p className="text-2xs font-semibold uppercase tracking-[0.08em] text-muted">Checks</p>
                <p className="text-lg font-semibold tabular-nums text-fg">{d.monitoringSummary.checks.toLocaleString()}</p>
              </div>
              <div className="hidden sm:block">
                <p className="text-2xs font-semibold uppercase tracking-[0.08em] text-muted">Range</p>
                <p className="text-lg font-semibold text-fg">{days}d</p>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {d ? (
        <>
          <section aria-labelledby="kpi-heading">
            <h2 id="kpi-heading" className="sr-only">
              Key indicators
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Link
                href="/assets"
                className="rounded-card transition-shadow hover:shadow-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
              >
                <StatCard
                  label="Registered assets"
                  value={d.kpis.totalAssets}
                  hint={`${d.kpis.maintenanceAssets} in maintenance · ${d.kpis.unknownAssets} unknown state`}
                  icon={Server}
                />
              </Link>
              <Link
                href="/assets"
                className="rounded-card transition-shadow hover:shadow-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
              >
                <StatCard
                  label="Healthy assets"
                  value={d.kpis.healthyAssets}
                  hint={`${d.kpis.degradedAssets} degraded · ${d.kpis.unavailableAssets} unavailable`}
                  icon={CheckCircle2}
                  tone="success"
                />
              </Link>
              <Link
                href="/assets"
                className="rounded-card transition-shadow hover:shadow-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
              >
                <StatCard
                  label="Unavailable assets"
                  value={d.kpis.unavailableAssets}
                  hint="From monitoring roll-up and manual status"
                  icon={Siren}
                  tone={d.kpis.unavailableAssets > 0 ? "danger" : "neutral"}
                />
              </Link>
              <Link
                href="/monitoring"
                className="rounded-card transition-shadow hover:shadow-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
              >
                <StatCard
                  label="Monitored services"
                  value={d.kpis.monitoredServices}
                  hint={`${d.kpis.serviceHealthy} healthy · ${d.kpis.serviceDegraded} degraded · ${d.kpis.serviceUnavailable} down`}
                  icon={Activity}
                  tone={d.kpis.serviceUnavailable > 0 ? "danger" : "neutral"}
                />
              </Link>
              <Link
                href="/monitoring"
                className="rounded-card transition-shadow hover:shadow-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
              >
                <StatCard
                  label={`Uptime · ${rangeLabel}`}
                  value={fmtPct(d.monitoringSummary.uptimePct)}
                  hint={
                    d.monitoringSummary.checks > 0
                      ? `${d.monitoringSummary.checks.toLocaleString()} completed checks`
                      : "No completed checks in this period"
                  }
                  icon={Activity}
                  tone={
                    d.monitoringSummary.uptimePct === null
                      ? "neutral"
                      : d.monitoringSummary.uptimePct < 95
                        ? "danger"
                        : "success"
                  }
                />
              </Link>
              <Link
                href="/incidents"
                className="rounded-card transition-shadow hover:shadow-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
              >
                <StatCard
                  label="Open incidents"
                  value={d.kpis.openIncidents}
                  hint="Not yet resolved or closed"
                  icon={Siren}
                  tone={d.kpis.openIncidents > 0 ? "warning" : "neutral"}
                />
              </Link>
              <Link
                href="/security"
                className="rounded-card transition-shadow hover:shadow-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
              >
                <StatCard
                  label="Critical & high findings"
                  value={d.kpis.criticalHighOpenFindings}
                  hint="Open or in progress"
                  icon={ShieldAlert}
                  tone={d.kpis.criticalHighOpenFindings > 0 ? "danger" : "neutral"}
                />
              </Link>
              <Link
                href="/maintenance"
                className="rounded-card transition-shadow hover:shadow-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
              >
                <StatCard
                  label="Upcoming maintenance"
                  value={d.kpis.upcomingMaintenance}
                  hint="Scheduled in the next 14 days"
                  icon={CalendarClock}
                />
              </Link>
            </div>
          </section>

          <div className="grid gap-3 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader
                title="Monitoring activity"
                description={`Response latency and availability over the last ${rangeLabel}`}
                icon={Activity}
                action={
                  <>
                    <Badge tone="neutral">{d.monitoringSummary.checks.toLocaleString()} checks</Badge>
                    <PanelLink href="/monitoring">Monitoring</PanelLink>
                  </>
                }
              />
              <div className="p-3 pt-4">
                <ResponseTrendChart data={d.responseTrend} height={272} />
              </div>
            </Card>
            <HealthPanel d={d} />
          </div>

          <div className="grid gap-3 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader
                title="Services needing attention"
                description="Degraded and unavailable checks, most severe first"
                icon={Siren}
                action={<PanelLink href="/monitoring">View all</PanelLink>}
              />
              {d.attentionServices.length === 0 ? (
                <EmptyState
                  icon={CheckCircle2}
                  compact
                  title="All enabled checks are healthy"
                  description="Degraded and unavailable services appear here."
                />
              ) : (
                <ul className="divide-y divide-line">
                  {d.attentionServices.map((service) => (
                    <li key={service.id}>
                      <Link
                        href={`/monitoring?target=${encodeURIComponent(service.id)}`}
                        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-ring"
                      >
                        <span className={cn("dot shrink-0", service.status === "unavailable" ? "dot-danger" : "dot-warning")} aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-fg">
                            {service.name} <span className="ml-1 text-2xs font-normal uppercase tracking-wide text-muted">{service.monitorType.toUpperCase()} </span>
                          </p>
                          <p className="truncate text-xs text-muted">
                            {service.assetName ? `Asset: ${service.assetName}` : "No linked asset"} · Checked{" "}
                            {fmtRelative(service.lastCheckedAt)}
                            {service.consecutiveFailures > 0 ? ` · ${service.consecutiveFailures} consecutive failures` : ""}
                          </p>
                          {service.lastError ? <p className="truncate text-xs text-rose-600 dark:text-rose-400">{service.lastError}</p> : null}
                        </div>
                        <StatusBadge value={service.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <CardHeader
                title="Checks overdue"
                description="More than two intervals late"
                icon={CalendarClock}
                action={<PanelLink href="/monitoring">View all</PanelLink>}
              />
              {d.overdueServices.length === 0 ? (
                <EmptyState icon={CheckCircle2} compact title="No overdue checks" description="The worker is keeping up with every schedule." />
              ) : (
                <ul className="divide-y divide-line">
                  {d.overdueServices.map((service) => (
                    <li key={service.id}>
                      <Link
                        href={`/monitoring?target=${encodeURIComponent(service.id)}`}
                        className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-ring"
                      >
                        <span className="dot dot-warning mt-1.5 shrink-0" aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-fg">
                            {service.name} <span className="ml-1 text-2xs font-normal uppercase tracking-wide text-muted">{service.monitorType.toUpperCase()} </span>
                          </p>
                          <p className="truncate text-xs text-muted">
                            Due {fmtRelative(service.nextCheckAt)} · every {service.intervalSeconds}s
                          </p>
                          <p className="truncate text-xs text-muted">Last result: {fmtRelative(service.lastCheckedAt)}</p>
                        </div>
                        <StatusBadge value={service.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="grid gap-3 xl:grid-cols-3">
            <Card>
              <CardHeader
                title="Active incidents"
                description={`${d.kpis.openIncidents} open`}
                icon={Siren}
                action={<PanelLink href="/incidents">View all</PanelLink>}
              />
              {d.recentIncidents.length === 0 ? (
                <EmptyState icon={CheckCircle2} compact title="No active incidents" description="Open incidents requiring investigation appear here." />
              ) : (
                <ul className="divide-y divide-line">
                  {d.recentIncidents.map((incident) => (
                    <li key={incident.id}>
                      <Link
                        href={`/incidents/${encodeURIComponent(incident.id)}`}
                        className="block px-4 py-3 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-ring"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="truncate text-sm font-medium text-fg">
                            <span className="mr-1.5 font-mono text-2xs text-muted">{incident.reference}</span>{" "}
                            {incident.title}
                          </p>
                          <StatusBadge value={incident.severity} />
                        </div>
                        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                          <span>{incident.assigneeName ?? "Unassigned"}</span>
                          <span aria-hidden="true">·</span>
                          <span>Opened {fmtRelative(incident.openedAt)}</span>
                          <StatusBadge value={incident.status} dot={false} />
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <CardHeader
                title="Critical & high findings"
                description={`${d.kpis.criticalHighOpenFindings} open or in progress`}
                icon={ShieldAlert}
                action={<PanelLink href="/security">View all</PanelLink>}
              />
              {d.criticalFindings.length === 0 ? (
                <EmptyState icon={CheckCircle2} compact title="No high-risk findings" description="Open critical and high findings appear here." />
              ) : (
                <ul className="divide-y divide-line">
                  {d.criticalFindings.map((finding) => (
                    <li key={finding.id}>
                      <Link
                        href={`/security?finding=${encodeURIComponent(finding.id)}`}
                        className="block px-4 py-3 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-ring"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="truncate text-sm font-medium text-fg">{finding.title}</p>
                          <StatusBadge value={finding.severity} />
                        </div>
                        <p className="mt-1 truncate text-xs text-muted">
                          {finding.cveId ?? finding.assetName ?? "No linked asset"} · Updated {fmtRelative(finding.updatedAt)}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <CardHeader
                title={<Link href="/changes" className="hover:text-accent">Recent changes</Link>}
                description={`Updated in the last ${rangeLabel}`}
                icon={GitPullRequest}
                action={<PanelLink href="/changes">View all</PanelLink>}
              />
              {d.recentChanges.length === 0 ? (
                <EmptyState icon={GitPullRequest} compact title="No recent changes" description="Change requests updated in this range appear here." />
              ) : (
                <ul className="divide-y divide-line">
                  {d.recentChanges.map((change) => (
                    <li key={change.id} className="flex items-start gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-fg">
                          <span className="mr-1.5 font-mono text-2xs text-muted">{change.reference}</span>{" "}
                          {change.title}
                        </p>
                        <p className="mt-1 truncate text-xs text-muted">
                          {change.requesterName ?? "Unknown requester"} · {fmtRelative(change.updatedAt)}
                          {change.riskLevel ? ` · ${humanize(change.riskLevel)} risk` : ""}
                        </p>
                      </div>
                      <StatusBadge value={change.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="grid gap-3 xl:grid-cols-3">
            <Card>
              <CardHeader title="Assets by category" description="Current inventory" icon={Server} />
              <div className="p-3 pt-4">
                <DistributionChart data={d.assetDistribution} height={228} labelWidth={116} />
              </div>
            </Card>
            <Card>
              <CardHeader title="Incidents by severity" description={`Opened in the last ${rangeLabel}`} icon={Siren} />
              <div className="p-3 pt-4">
                <DistributionChart
                  data={d.incidentBySeverity.map((entry) => ({ label: humanize(entry.severity), count: entry.count }))}
                  color="#fb7185"
                  height={228}
                  labelWidth={96}
                />
              </div>
            </Card>
            <Card>
              <CardHeader title="Findings by status" description="Current security posture" icon={ShieldAlert} />
              <div className="p-3 pt-4">
                <DistributionChart
                  data={d.findingsByStatus.map((entry) => ({ label: entry.label, count: entry.count }))}
                  color="#f59e0b"
                  height={228}
                  labelWidth={116}
                />
              </div>
            </Card>
          </div>

          <div className="grid gap-3 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader
                title="Upcoming maintenance"
                description="Scheduled windows in the next 14 days"
                icon={CalendarClock}
                action={<PanelLink href="/maintenance">View all</PanelLink>}
              />
              {d.upcomingMaintenance.length === 0 ? (
                <EmptyState icon={CalendarClock} compact title="Nothing scheduled" description="Scheduled maintenance windows for the next 14 days appear here." />
              ) : (
                <ul className="divide-y divide-line">
                  {d.upcomingMaintenance.map((window) => (
                    <li key={window.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-fg">{window.title}</p>
                        <p className="truncate text-xs text-muted">
                          {fmtDateTime(window.startsAt)} → {fmtDateTime(window.endsAt)}
                        </p>
                      </div>
                      <Badge tone="info">{window.ownerName ?? "No owner"}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="flex flex-col justify-between p-4">
              <div>
                <p className="text-2xs font-semibold uppercase tracking-[0.07em] text-muted">Data freshness</p>
                <p className="mt-1.5 text-sm text-fg">Generated {fmtDateTime(d.generatedAt)}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  Every figure is aggregated from the database for the selected range and refreshes automatically while
                  this tab is visible.
                </p>
              </div>
              <div className="mt-4 space-y-1.5 border-t border-line pt-3 text-xs text-muted">
                <p>
                  Range: {fmtDateTime(d.range.from)} → {fmtDateTime(d.range.to)}
                </p>
                <p className="tabular-nums">
                  {d.monitoringSummary.checks.toLocaleString()} checks · {fmtPct(d.monitoringSummary.uptimePct)} uptime
                </p>
              </div>
            </Card>
          </div>
        </>
      ) : null}
    </PageContainer>
  );
}
