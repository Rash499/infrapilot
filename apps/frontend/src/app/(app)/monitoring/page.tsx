"use client";

import { useEffect, useRef, useState } from "react";
import { Activity, Pencil, Play, Plus, Search, Trash2 } from "lucide-react";
import { ResponseTrendChart, type TrendPoint } from "@/components/charts";
import { Alert, Badge, Button, Card, CardHeader, ConfirmDialog, DataTable, EmptyState, ErrorState, Field, FormSection, Input, Modal, PageHeader, Pagination, Select, StatCard, StatusBadge, StatusDot, Switch, TableSkeleton, Td, Th, Toolbar } from "@/components/ui";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/context/toast-context";
import { fetchData, fetchList, getErrorMessage, sendData } from "@/lib/client/api";
import { focusFirstInvalid, serverFieldErrors, validateFields } from "@/lib/client/form";
import { useAsync } from "@/lib/client/use-async";
import { fmtMs, fmtPct, fmtRelative, humanize } from "@/lib/format";
import { monitorCreateSchema } from "@/validators/schemas";
import type { Asset, MonitoringAnalytics, MonitorOverview, MonitorResult, MonitorTarget, TargetDetail } from "@/types/api";
import { useForm } from "react-hook-form";

interface MonitorFormValues {
  name: string;
  monitorType: "http" | "tcp";
  url: string;
  host: string;
  port: string;
  expectedStatusCode: string;
  intervalSeconds: string;
  timeoutMs: string;
  degradedThresholdMs: string;
  warningThresholdMs: string;
  criticalThresholdMs: string;
  failureThreshold: string;
  recoveryThreshold: string;
  autoIncidentEnabled: boolean;
  enabled: boolean;
  allowPrivateNetwork: boolean;
  assetId: string;
}

function toValues(t?: MonitorTarget | null): MonitorFormValues {
  return {
    name: t?.name ?? "",
    monitorType: t?.monitorType ?? "http",
    url: t?.url ?? "https://",
    host: t?.host ?? "",
    port: t?.port ? String(t.port) : "",
    expectedStatusCode: t?.expectedStatusCode ? String(t.expectedStatusCode) : "",
    intervalSeconds: String(t?.intervalSeconds ?? 60),
    timeoutMs: String(t?.timeoutMs ?? 5000),
    degradedThresholdMs: String(t?.degradedThresholdMs ?? 1000),
    warningThresholdMs: String(t?.warningThresholdMs ?? t?.degradedThresholdMs ?? 1500),
    criticalThresholdMs: String(t?.criticalThresholdMs ?? 5000),
    failureThreshold: String(t?.failureThreshold ?? 3),
    recoveryThreshold: String(t?.recoveryThreshold ?? 2),
    autoIncidentEnabled: t?.autoIncidentEnabled ?? true,
    enabled: t?.enabled ?? true,
    allowPrivateNetwork: t?.allowPrivateNetwork ?? false,
    assetId: t?.assetId ?? "",
  };
}

type MonitorField = keyof MonitorFormValues;

const MONITOR_FIELDS: MonitorField[] = [
  "name",
  "monitorType",
  "url",
  "host",
  "port",
  "expectedStatusCode",
  "intervalSeconds",
  "timeoutMs",
  "degradedThresholdMs",
  "warningThresholdMs",
  "criticalThresholdMs",
  "failureThreshold",
  "recoveryThreshold",
  "autoIncidentEnabled",
  "enabled",
  "allowPrivateNetwork",
  "assetId",
];

function MonitorFormModal({
  open,
  onClose,
  onSaved,
  target,
  assets,
  isAdmin,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  target: MonitorTarget | null;
  assets: Asset[];
  isAdmin: boolean;
}) {
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setError,
    clearErrors,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<MonitorFormValues>({ defaultValues: toValues(target) });
  useEffect(() => {
    if (open) reset(toValues(target));
  }, [open, target, reset]);
  const type = watch("monitorType");

  const requestClose = () => {
    if (isSubmitting) return;
    if (isDirty) setConfirmDiscard(true);
    else onClose();
  };

  // Non-blocking advisory: the API accepts these combinations, but an inverted ladder means the
  // operator will not see the state they expect, so it is worth saying out loud.
  const numbers = {
    timeout: Number(watch("timeoutMs")),
    degraded: Number(watch("degradedThresholdMs")),
    warning: Number(watch("warningThresholdMs")),
    critical: Number(watch("criticalThresholdMs")),
    interval: Number(watch("intervalSeconds")),
  };
  const ladder = [numbers.degraded, numbers.warning, numbers.critical];
  const advisory =
    numbers.timeout > numbers.interval * 1000
      ? "The timeout is longer than the check interval, so checks will overlap."
      : ladder.some((value, index) => index > 0 && value < ladder[index - 1]!)
        ? "Thresholds are not in ascending order (degraded → warning → critical)."
        : null;

  const onSubmit = handleSubmit(async (v) => {
    clearErrors("root");
    const isHttp = v.monitorType === "http";
    const payload = {
      name: v.name.trim(),
      monitorType: v.monitorType,
      // Conditional fields are dropped rather than submitted stale, so switching the check type
      // never sends a TCP host alongside an HTTP target (or the reverse).
      url: isHttp ? v.url.trim() || undefined : undefined,
      host: isHttp ? null : v.host.trim() || null,
      port: isHttp ? null : v.port ? Number(v.port) : null,
      expectedStatusCode: isHttp && v.expectedStatusCode ? Number(v.expectedStatusCode) : null,
      intervalSeconds: Number(v.intervalSeconds),
      timeoutMs: Number(v.timeoutMs),
      degradedThresholdMs: Number(v.degradedThresholdMs),
      warningThresholdMs: Number(v.warningThresholdMs),
      criticalThresholdMs: Number(v.criticalThresholdMs),
      failureThreshold: Number(v.failureThreshold),
      recoveryThreshold: Number(v.recoveryThreshold),
      autoIncidentEnabled: v.autoIncidentEnabled,
      enabled: v.enabled,
      allowPrivateNetwork: v.allowPrivateNetwork,
      assetId: v.assetId || null,
    };

    const validation = validateFields(monitorCreateSchema, payload, setError, MONITOR_FIELDS);
    if (!validation.valid) {
      if (validation.formError) setError("root", { message: validation.formError });
      requestAnimationFrame(() => focusFirstInvalid(formRef.current));
      return;
    }

    try {
      if (target) await sendData("patch", `/monitoring/targets/${target.id}`, payload);
      else await sendData("post", "/monitoring/targets", payload);
      toast.success(target ? "Monitoring target updated" : "Monitoring target created — first check is queued");
      onSaved();
      reset(toValues(target));
      onClose();
    } catch (err) {
      const mapped = serverFieldErrors(err, setError, MONITOR_FIELDS);
      if (!mapped.firstField) setError("root", { message: getErrorMessage(err) });
      requestAnimationFrame(() => focusFirstInvalid(formRef.current));
    }
  });

  return (
    <>
      <Modal
        open={open}
        onClose={requestClose}
        size="lg"
        title={target ? "Edit monitoring check" : "Add monitoring check"}
        description="Checks run in the background worker. Private, loopback and metadata destinations are blocked unless an administrator authorises them."
        footer={
          <>
            <Button variant="outline" onClick={requestClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" form="monitor-form" loading={isSubmitting}>
              {target ? "Save check" : "Create check"}
            </Button>
          </>
        }
      >
        <form ref={formRef} id="monitor-form" onSubmit={onSubmit} className="space-y-5" noValidate>
          {errors.root?.message ? (
            <Alert tone="danger" title="Could not save this check">
              {errors.root.message}
            </Alert>
          ) : null}

          <FormSection title="Target" description="What the worker probes and how it is identified.">
            <Field label="Name" htmlFor="m-name" error={errors.name?.message} required className="sm:col-span-2">
              <Input id="m-name" {...register("name")} maxLength={160} placeholder="Checkout API health" />
            </Field>
            <Field
              label="Check type"
              htmlFor="m-type"
              error={errors.monitorType?.message}
              hint="HTTP checks request a URL; TCP checks only open a socket."
              required
            >
              <Select id="m-type" {...register("monitorType")}>
                <option value="http">HTTP / HTTPS endpoint</option>
                <option value="tcp">TCP connectivity</option>
              </Select>
            </Field>
            <Field label="Linked asset" htmlFor="m-asset" error={errors.assetId?.message} hint="Rolls check state up to the asset status.">
              <Select id="m-asset" {...register("assetId")}>
                <option value="">Not linked</option>
                {assets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </Field>
            {type === "http" ? (
              <>
                <Field
                  label="URL"
                  htmlFor="m-url"
                  className="sm:col-span-2"
                  error={errors.url?.message}
                  hint="http or https. Credentials in the URL are rejected and redirects are not followed."
                  required
                >
                  <Input id="m-url" type="url" inputMode="url" {...register("url")} placeholder="https://status.example.com/health" />
                </Field>
                <Field
                  label="Expected status code"
                  htmlFor="m-status"
                  error={errors.expectedStatusCode?.message}
                  hint="Leave empty to accept any 2xx or 3xx response."
                >
                  <Input id="m-status" type="number" inputMode="numeric" min={100} max={599} step={1} {...register("expectedStatusCode")} placeholder="200" />
                </Field>
              </>
            ) : (
              <>
                <Field label="Host" htmlFor="m-host" error={errors.host?.message} hint="DNS name or IP address." required>
                  <Input id="m-host" {...register("host")} maxLength={255} placeholder="db.example.com" />
                </Field>
                <Field label="Port" htmlFor="m-port" error={errors.port?.message} hint="1 – 65535." required>
                  <Input id="m-port" type="number" inputMode="numeric" min={1} max={65535} step={1} {...register("port")} placeholder="5432" />
                </Field>
              </>
            )}
          </FormSection>

          <FormSection title="Schedule and thresholds" description="Defaults apply when a value is left empty.">
            <Field label="Interval (seconds)" htmlFor="m-interval" error={errors.intervalSeconds?.message} hint="How often the worker checks. 30 – 86,400.">
              <Input id="m-interval" type="number" inputMode="numeric" min={30} max={86400} step={1} {...register("intervalSeconds")} />
            </Field>
            <Field label="Timeout (ms)" htmlFor="m-timeout" error={errors.timeoutMs?.message} hint="Give up after this long. 500 – 30,000.">
              <Input id="m-timeout" type="number" inputMode="numeric" min={500} max={30000} step={100} {...register("timeoutMs")} />
            </Field>
            <Field label="Degraded above (ms)" htmlFor="m-degraded" error={errors.degradedThresholdMs?.message} hint="Successful checks slower than this are shown as Degraded.">
              <Input id="m-degraded" type="number" inputMode="numeric" min={50} max={60000} step={100} {...register("degradedThresholdMs")} />
            </Field>
            <Field label="Warning alert above (ms)" htmlFor="m-warning" error={errors.warningThresholdMs?.message} hint="Latency that raises a warning alert.">
              <Input id="m-warning" type="number" inputMode="numeric" min={50} max={120000} step={100} {...register("warningThresholdMs")} />
            </Field>
            <Field label="Critical latency above (ms)" htmlFor="m-critical" error={errors.criticalThresholdMs?.message} hint="Latency that raises a critical alert and may open an incident.">
              <Input id="m-critical" type="number" inputMode="numeric" min={50} max={300000} step={100} {...register("criticalThresholdMs")} />
            </Field>
            <Field label="Failures before unavailable" htmlFor="m-failures" error={errors.failureThreshold?.message} hint="Consecutive failed checks. 1 – 20.">
              <Input id="m-failures" type="number" inputMode="numeric" min={1} max={20} step={1} {...register("failureThreshold")} />
            </Field>
            <Field label="Successes before recovery" htmlFor="m-recovery" error={errors.recoveryThreshold?.message} hint="Successful checks needed to resolve availability alerts.">
              <Input id="m-recovery" type="number" inputMode="numeric" min={1} max={20} step={1} {...register("recoveryThreshold")} />
            </Field>
            <div className="flex flex-col gap-3 sm:col-span-2">
              <Switch id="m-enabled" label="Check enabled" description="Disabled checks stay configured but are not scheduled." {...register("enabled")} />
              <Switch
                id="m-auto-incident"
                label="Open incidents automatically for critical alerts"
                description="Critical alerts open one incident per asset, respecting maintenance windows."
                {...register("autoIncidentEnabled")}
              />
              {isAdmin ? (
                <Switch
                  id="m-private"
                  label="Authorise private network targets"
                  description="Administrators only. Required for loopback, RFC1918 and link-local addresses."
                  {...register("allowPrivateNetwork")}
                />
              ) : null}
            </div>
          </FormSection>

          {advisory ? <Alert tone="warning" title="Check configuration">{advisory}</Alert> : null}
        </form>
      </Modal>

      <ConfirmDialog
        open={confirmDiscard}
        title="Discard changes?"
        description="This monitoring check has unsaved changes. Closing the dialog will discard them."
        confirmLabel="Discard changes"
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={() => {
          setConfirmDiscard(false);
          reset(toValues(target));
          onClose();
        }}
      />
    </>
  );
}

function TargetDetailModal({ id, onClose, onEdit }: { id: string | null; onClose: () => void; onEdit: (t: MonitorTarget) => void }) {
  const detail = useAsync(() => (id ? fetchData<TargetDetail>(`/monitoring/targets/${id}`) : Promise.resolve(null)), [id]);
  const results = useAsync(
    () => (id ? fetchList<MonitorResult>(`/monitoring/targets/${id}/results`, { range: "24h", pageSize: 100 }) : Promise.resolve(null)),
    [id],
  );
  const t = detail.data;
  const points: TrendPoint[] = (results.data?.items ?? [])
    .slice()
    .reverse()
    .map((r) => ({ ts: r.checkedAt, avgResponseMs: r.responseTimeMs, uptimePct: r.success ? 100 : 0 }));

  return (
    <Modal
      open={!!id}
      onClose={onClose}
      size="lg"
      title={t?.name ?? "Check details"}
      description={t ? `${humanize(t.monitorType)} · ${t.monitorType === "http" ? t.url : `${t.host}:${t.port}`}` : undefined}
      footer={
        t ? (
          <Button variant="outline" onClick={() => onEdit(t)}>
            <Pencil className="size-4" aria-hidden="true" /> Edit check
          </Button>
        ) : null
      }
    >
      {detail.error ? <ErrorState message={detail.error} onRetry={detail.reload} /> : null}
      {!t && detail.loading ? <TableSkeleton rows={4} /> : null}
      {t ? (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge value={t.status} />
            {t.lastError ? <span className="text-sm text-rose-500">{t.lastError}</span> : null}
            {!t.enabled ? <Badge>Paused</Badge> : null}
          </div>
          <dl className="grid grid-cols-2 divide-line overflow-hidden rounded-lg border border-line sm:grid-cols-4 sm:divide-x">
            {[
              { label: "Uptime 24h", value: fmtPct(t.stats.uptime24hPct) },
              { label: "Uptime 7d", value: fmtPct(t.stats.uptime7dPct) },
              { label: "Avg response", value: fmtMs(t.stats.avgResponse24hMs) },
              { label: "Checks 24h", value: String(t.stats.checks24h) },
            ].map((stat) => (
              <div key={stat.label} className="border-b border-line px-3 py-2.5 last:border-b-0 sm:border-b-0">
                <dt className="text-2xs font-medium uppercase tracking-[0.06em] text-muted">{stat.label}</dt>
                <dd className="tabular-nums mt-0.5 text-base font-semibold text-fg">{stat.value}</dd>
              </div>
            ))}
          </dl>
          <Card className="overflow-hidden">
            <CardHeader title="Response time" description="Last 24 hours, one point per check" icon={Activity} />
            <div className="p-3">
              <ResponseTrendChart data={points} height={220} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Recent results" description={`${t.recentResults.length} most recent checks`} icon={Activity} />
            <DataTable minWidth={520}>
              <thead>
                <tr>
                  <Th>Time</Th>
                  <Th>Result</Th>
                  <Th>Response</Th>
                  <Th>Detail</Th>
                </tr>
              </thead>
              <tbody>
                {t.recentResults.map((r) => (
                  <tr key={r.id} className="row-hover">
                    <Td className="whitespace-nowrap text-muted">{fmtRelative(r.checkedAt)}</Td>
                    <Td>
                      <StatusBadge value={r.state} />
                    </Td>
                    <Td>{fmtMs(r.responseTimeMs)}</Td>
                    <Td className="text-muted">{r.errorMessage ?? (r.statusCode ? `HTTP ${r.statusCode}` : "OK")}</Td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
            {t.recentResults.length === 0 ? <EmptyState title="No results yet" description="The worker runs the first check shortly after the target is created." /> : null}
          </Card>
        </div>
      ) : null}
    </Modal>
  );
}

export default function MonitoringPage() {
  const { can, user } = useAuth();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [state, setState] = useState("");
  const [monitorType, setMonitorType] = useState("");
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<MonitorTarget | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MonitorTarget | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    const target = new URLSearchParams(window.location.search).get("target");
    if (target) setDetailId(target);
  }, []);

  useEffect(() => {
    setPage(1);
  }, [debounced, state, monitorType]);

  const overview = useAsync(() => fetchData<MonitorOverview>("/monitoring/overview"), []);
  const list = useAsync(
    () => fetchList<MonitorTarget>("/monitoring/targets", { page, pageSize: 15, search: debounced, state, monitorType, sort: "name", order: "asc" }),
    [page, debounced, state, monitorType],
  );
  const analytics = useAsync(() => fetchData<MonitoringAnalytics>("/monitoring/analytics", { range: "24h" }), []);
  const assets = useAsync(() => fetchList<Asset>("/assets", { pageSize: 100 }), []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      overview.reload();
      list.reload();
      analytics.reload();
    }, 30_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reloadAll = () => {
    overview.reload();
    list.reload();
  };

  const runCheck = async (t: MonitorTarget) => {
    try {
      await sendData("post", `/monitoring/targets/${t.id}/check`);
      toast.info(`Check queued for ${t.name}. The worker will run it shortly.`);
      window.setTimeout(reloadAll, 3000);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await sendData("delete", `/monitoring/targets/${deleteTarget.id}`);
      toast.success("Monitoring check deleted");
      setDeleteTarget(null);
      reloadAll();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const s = overview.data?.summary;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Infrastructure"
        title="Monitoring"
        description="Active HTTP and TCP checks executed by the background worker. Results refresh every 30 seconds."
        actions={
          <>
            <Button variant="outline" onClick={reloadAll} loading={overview.loading && !!overview.data}>
              <Activity className="size-4" aria-hidden="true" /> Refresh
            </Button>
            {can("write") ? (
              <Button
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                <Plus className="size-4" aria-hidden="true" /> Add check
              </Button>
            ) : null}
          </>
        }
      />

      {overview.error && !overview.data ? <ErrorState message={overview.error} onRetry={overview.reload} /> : null}
      {s ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatCard label="Services" value={s.total} hint={`${s.paused} paused`} icon={Activity} />
          <StatCard label="Healthy" value={s.healthy} tone="success" />
          <StatCard label="Degraded" value={s.degraded} tone={s.degraded > 0 ? "warning" : "neutral"} />
          <StatCard label="Unavailable" value={s.unavailable} tone={s.unavailable > 0 ? "danger" : "neutral"} />
          <StatCard
            label="Uptime (24h)"
            value={fmtPct(analytics.data?.uptime.h24 ?? overview.data?.uptime24hPct)}
            hint={`${analytics.data?.totals.total ?? overview.data?.checks24h ?? 0} checks · 7d ${fmtPct(analytics.data?.uptime.d7)} · 30d ${fmtPct(analytics.data?.uptime.d30)}`}
          />
          <StatCard
            label="Latency p95 (24h)"
            value={fmtMs(analytics.data?.totals.p95Ms)}
            hint={`p99 ${fmtMs(analytics.data?.totals.p99Ms)} · avg ${fmtMs(analytics.data?.totals.avgMs)}`}
          />
        </div>
      ) : null}
      {analytics.error ? <ErrorState message={analytics.error} onRetry={analytics.reload} /> : null}

      <Toolbar>
        <div className="grid w-full gap-3 md:grid-cols-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted" aria-hidden="true" />
            <Input aria-label="Search checks" className="pl-9" placeholder="Search by name, host or URL" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select aria-label="Filter by service state" value={state} onChange={(e) => setState(e.target.value)}>
            <option value="">All states</option>
            <option value="healthy">Healthy</option>
            <option value="degraded">Degraded</option>
            <option value="unavailable">Unavailable</option>
            <option value="unknown">Unknown</option>
          </Select>
          <Select aria-label="Filter by check type" value={monitorType} onChange={(e) => setMonitorType(e.target.value)}>
            <option value="">All check types</option>
            <option value="http">HTTP / HTTPS</option>
            <option value="tcp">TCP</option>
          </Select>
        </div>
      </Toolbar>

      <Card className="overflow-hidden">
        {list.error && !list.data ? <ErrorState message={list.error} onRetry={list.reload} /> : null}
        {!list.data && list.loading ? <TableSkeleton rows={6} /> : null}
        {list.data && list.data.items.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="No monitoring checks yet"
            description="Add an HTTP or TCP check. Assets are not monitored until a check is configured."
            action={
              can("write") ? (
                <Button onClick={() => setFormOpen(true)}>
                  <Plus className="size-4" aria-hidden="true" /> Add check
                </Button>
              ) : null
            }
          />
        ) : null}
        {list.data && list.data.items.length > 0 ? (
          <>
            <DataTable minWidth={960}>
              <thead>
                <tr>
                  <Th>Service</Th>
                  <Th>Target</Th>
                  <Th>State</Th>
                  <Th>Last response</Th>
                  <Th>Uptime 24h</Th>
                  <Th>Last checked</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((t) => (
                  <tr key={t.id} className="row-hover">
                    <Td>
                      <button type="button" onClick={() => setDetailId(t.id)} className="flex items-center gap-2 text-left font-medium text-accent hover:underline">
                        <StatusDot value={t.enabled ? t.status : "unknown"} />
                        {t.name}
                      </button>
                      {t.assetName ? <p className="text-xs text-muted">Asset: {t.assetName}</p> : null}
                    </Td>
                    <Td className="max-w-[260px] truncate text-muted">
                      <Badge tone={t.monitorType === "http" ? "info" : "neutral"}>{t.monitorType.toUpperCase()}</Badge>{" "}
                      <span className="align-middle">{t.monitorType === "http" ? t.url : `${t.host}:${t.port}`}</span>
                    </Td>
                    <Td>
                      {t.enabled ? <StatusBadge value={t.status} /> : <Badge>Paused</Badge>}
                      {t.status === "unavailable" && t.lastError ? <p className="mt-1 max-w-[220px] truncate text-xs text-rose-500">{t.lastError}</p> : null}
                    </Td>
                    <Td className="tabular-nums">{fmtMs(t.lastResponseMs)}</Td>
                    <Td className="tabular-nums">{fmtPct(t.uptime24hPct)}</Td>
                    <Td className="whitespace-nowrap text-muted">{fmtRelative(t.lastCheckedAt)}</Td>
                    <Td className="text-right">
                      <div className="flex justify-end gap-1">
                        {can("write") ? (
                          <Button variant="ghost" size="icon" aria-label={`Run check now for ${t.name}`} title="Run check now" onClick={() => void runCheck(t)} disabled={!t.enabled}>
                            <Play className="size-4" />
                          </Button>
                        ) : null}
                        {can("write") ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Edit ${t.name}`}
                            onClick={() => {
                              setEditing(t);
                              setFormOpen(true);
                            }}
                          >
                            <Pencil className="size-4" />
                          </Button>
                        ) : null}
                        {user?.role === "admin" ? (
                          <Button variant="ghost" size="icon" aria-label={`Delete ${t.name}`} onClick={() => setDeleteTarget(t)}>
                            <Trash2 className="size-4 text-rose-500" />
                          </Button>
                        ) : null}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
            <Pagination meta={list.data.meta} onPageChange={setPage} />
          </>
        ) : null}
      </Card>

      <MonitorFormModal
        open={formOpen}
        target={editing}
        assets={assets.data?.items ?? []}
        isAdmin={user?.role === "admin"}
        onClose={() => setFormOpen(false)}
        onSaved={reloadAll}
      />
      <TargetDetailModal
        id={detailId}
        onClose={() => setDetailId(null)}
        onEdit={(t) => {
          setDetailId(null);
          setEditing(t);
          setFormOpen(true);
        }}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete monitoring check?"
        description={`"${deleteTarget?.name ?? ""}" and its result history will be permanently removed.`}
        confirmLabel="Delete check"
        busy={busy}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
