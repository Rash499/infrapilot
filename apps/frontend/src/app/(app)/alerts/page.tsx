"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Activity, BellRing, Clock, RefreshCw, ShieldCheck } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  PageHeader,
  Pagination,
  Select,
  StatCard,
  StatusBadge,
  TableSkeleton,
  Td,
  Textarea,
  Th,
  Toolbar,
} from "@/components/ui";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/context/toast-context";
import { fetchData, fetchList, getErrorMessage, sendData } from "@/lib/client/api";
import { useAsync } from "@/lib/client/use-async";
import { fmtDateTime, fmtRelative, humanize, isUuid } from "@/lib/format";
import type { Alert, AlertSummary, Pagination as PaginationMeta } from "@/types/api";

const STATUS_OPTIONS = ["triggered", "acknowledged", "suppressed", "resolved"] as const;

function AlertDetailModal({
  alertId,
  open,
  onClose,
  onChanged,
  canWrite,
}: {
  alertId: string | null;
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
  canWrite: boolean;
}) {
  const toast = useToast();
  const [action, setAction] = useState<"acknowledge" | "resolve" | "suppress" | null>(null);
  const [note, setNote] = useState("");
  const [until, setUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const detail = useAsync(
    () => (alertId ? fetchData<Alert>(`/alerts/${alertId}`) : Promise.resolve(null)),
    [alertId],
  );

  useEffect(() => {
    if (!open) {
      setAction(null);
      setNote("");
      setUntil("");
    }
  }, [open]);

  const submit = async () => {
    if (!alertId || !action) return;
    setBusy(true);
    try {
      if (action === "acknowledge") {
        await sendData("post", `/alerts/${alertId}/acknowledge`, { note: note.trim() || undefined });
        toast.success("Alert acknowledged");
      } else if (action === "resolve") {
        await sendData("post", `/alerts/${alertId}/resolve`, { resolutionNotes: note.trim() });
        toast.success("Alert resolved");
      } else {
        await sendData("post", `/alerts/${alertId}/suppress`, {
          reason: note.trim(),
          until: until ? new Date(until).toISOString() : null,
        });
        toast.success("Alert suppressed");
      }
      setAction(null);
      setNote("");
      setUntil("");
      detail.reload();
      onChanged();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const alert = detail.data;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={alert ? alert.title : "Alert detail"}
      description={alert ? `${humanize(alert.severity)} · ${humanize(alert.status)} · ${alert.target.name}` : undefined}
      size="lg"
    >
      {detail.error ? <ErrorState message={detail.error} onRetry={detail.reload} /> : null}
      {!alert && detail.loading ? <TableSkeleton rows={4} columns={2} /> : null}
      {alert ? (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={alert.severity === "critical" ? "danger" : "warning"}>{humanize(alert.severity)}</Badge>
            <StatusBadge value={alert.status} />
            <Badge>{humanize(alert.kind)}</Badge>
            {alert.occurrences > 1 ? <Badge tone="neutral">{alert.occurrences} occurrences</Badge> : null}
            {alert.incidentId ? (
              <Link className="text-xs font-medium text-accent hover:underline" href={`/incidents/${alert.incidentId}`}>
                Linked incident →
              </Link>
            ) : null}
          </div>

          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-2xs uppercase tracking-wide text-muted">Condition</dt>
              <dd className="mt-0.5 text-fg">{alert.triggerCondition}</dd>
            </div>
            <div>
              <dt className="text-2xs uppercase tracking-wide text-muted">Observed</dt>
              <dd className="mt-0.5 text-fg">{alert.message}</dd>
            </div>
            <div>
              <dt className="text-2xs uppercase tracking-wide text-muted">Asset</dt>
              <dd className="mt-0.5 text-fg">{alert.asset?.name ?? "Not linked"}</dd>
            </div>
            <div>
              <dt className="text-2xs uppercase tracking-wide text-muted">First triggered</dt>
              <dd className="mt-0.5 text-fg">{fmtDateTime(alert.triggeredAt)}</dd>
            </div>
            <div>
              <dt className="text-2xs uppercase tracking-wide text-muted">Last seen</dt>
              <dd className="mt-0.5 text-fg">{fmtRelative(alert.lastSeenAt)}</dd>
            </div>
            <div>
              <dt className="text-2xs uppercase tracking-wide text-muted">Suppression</dt>
              <dd className="mt-0.5 text-fg">
                {alert.suppressionReason
                  ? `${alert.suppressionReason}${alert.suppressedUntil ? ` until ${fmtDateTime(alert.suppressedUntil)}` : ""}`
                  : "None"}
              </dd>
            </div>
          </dl>

          {canWrite && alert.status !== "resolved" ? (
            <div className="rounded-lg border border-line bg-surface-2/50 p-3">
              {action === null ? (
                <div className="flex flex-wrap gap-2">
                  {alert.status !== "acknowledged" ? (
                    <Button size="sm" variant="outline" onClick={() => setAction("acknowledge")}>
                      Acknowledge
                    </Button>
                  ) : null}
                  <Button size="sm" onClick={() => setAction("resolve")}>
                    Resolve
                  </Button>
                  {alert.status !== "suppressed" ? (
                    <Button size="sm" variant="ghost" onClick={() => setAction("suppress")}>
                      Suppress
                    </Button>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-3">
                  <Field
                    label={action === "acknowledge" ? "Note (optional)" : action === "resolve" ? "Resolution" : "Reason"}
                    htmlFor="alert-note"
                  >
                    <Textarea
                      id="alert-note"
                      rows={3}
                      maxLength={2000}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder={
                        action === "acknowledge"
                          ? "What are you investigating?"
                          : action === "resolve"
                            ? "Describe what resolved the condition (required)"
                            : "Why is this alert being suppressed?"
                      }
                    />
                  </Field>
                  {action === "suppress" ? (
                    <Field label="Suppress until" htmlFor="alert-until" hint="Defaults to one hour from now">
                      <Input
                        id="alert-until"
                        type="datetime-local"
                        value={until}
                        onChange={(e) => setUntil(e.target.value)}
                      />
                    </Field>
                  ) : null}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      loading={busy}
                      disabled={action !== "acknowledge" && note.trim().length < 3}
                      onClick={submit}
                    >
                      Confirm
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setAction(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : null}

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Lifecycle</h3>
            <ol className="space-y-2 border-l border-line pl-3">
              {[...alert.events].reverse().map((event, index) => (
                <li key={`${event.at}-${index}`} className="relative text-xs">
                  <span className="absolute -left-[17px] top-1.5 size-2 rounded-full bg-accent" aria-hidden="true" />
                  <p className="font-medium text-fg">{humanize(event.type)}</p>
                  <p className="text-muted">
                    {fmtDateTime(event.at)} · {event.actorName ?? "System"}
                  </p>
                  {event.note ? <p className="mt-0.5 text-fg">{event.note}</p> : null}
                </li>
              ))}
            </ol>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

export default function AlertsPage() {
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [severity, setSeverity] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const query = { page, pageSize: 20, status: status || undefined, severity: severity || undefined, search: search || undefined };
  const list = useAsync(() => fetchList<Alert>("/alerts", query), [page, status, severity, search]);
  const summary = useAsync(() => fetchData<AlertSummary>("/alerts/summary"), []);

  // Refresh while the tab is visible so operators see new alerts without reloading.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        list.reload();
        summary.reload();
      }
    }, 30_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deep link from search results: /alerts?alert=<id>
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("alert");
    if (isUuid(id)) setSelected(id);
  }, []);

  const meta: PaginationMeta | undefined = useMemo(
    () => (list.data ? { page: list.data.meta.page, pageSize: list.data.meta.pageSize, total: list.data.meta.total, totalPages: list.data.meta.totalPages } : undefined),
    [list.data],
  );
  const s = summary.data;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations"
        title="Alerts"
        description="Monitoring alerts with deduplication, acknowledgement, suppression and automatic incident creation. Refreshes every 30 seconds."
        actions={
          <Button
            variant="outline"
            onClick={() => {
              list.reload();
              summary.reload();
            }}
            loading={list.loading && !!list.data}
          >
            <RefreshCw className="size-4" aria-hidden="true" /> Refresh
          </Button>
        }
      />

      {summary.error ? <ErrorState message={summary.error} onRetry={summary.reload} /> : null}
      {s ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <StatCard label="Active alerts" value={s.active} icon={BellRing} tone={s.active > 0 ? "warning" : "neutral"} />
          <StatCard label="Critical active" value={s.criticalActive} tone={s.criticalActive > 0 ? "danger" : "neutral"} />
          <StatCard label="Acknowledged" value={s.acknowledged} icon={ShieldCheck} />
          <StatCard label="Suppressed" value={s.suppressed} icon={Clock} />
          <StatCard label="Resolved" value={s.resolved} icon={Activity} tone="success" />
        </div>
      ) : null}

      <Card className="overflow-hidden">
        <CardHeader title="Alert history" description="One active alert per monitored condition; every state change is recorded with an actor." />
        <div className="border-b border-line p-3">
          <Toolbar>
            <div className="grid w-full gap-3 md:grid-cols-3">
              <Input
                aria-label="Search alerts"
                placeholder="Search title, message or condition"
                value={search}
                onChange={(e) => {
                  setPage(1);
                  setSearch(e.target.value);
                }}
              />
              <Select
                aria-label="Filter by status"
                value={status}
                onChange={(e) => {
                  setPage(1);
                  setStatus(e.target.value);
                }}
              >
                <option value="">All statuses</option>
                {STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {humanize(option)}
                  </option>
                ))}
              </Select>
              <Select
                aria-label="Filter by severity"
                value={severity}
                onChange={(e) => {
                  setPage(1);
                  setSeverity(e.target.value);
                }}
              >
                <option value="">All severities</option>
                <option value="critical">Critical</option>
                <option value="warning">Warning</option>
              </Select>
            </div>
          </Toolbar>
        </div>

        {list.error && !list.data ? <ErrorState message={list.error} onRetry={list.reload} /> : null}
        {!list.data && list.loading ? <TableSkeleton rows={6} columns={6} /> : null}
        {list.data && list.data.items.length === 0 ? (
          <EmptyState
            icon={BellRing}
            title="No alerts match these filters"
            description="Alerts are raised by the monitoring worker when checks breach their configured thresholds."
          />
        ) : null}
        {list.data && list.data.items.length > 0 ? (
          <DataTable minWidth={860}>
            <thead>
              <tr>
                <Th>Alert</Th>
                <Th>Target</Th>
                <Th>Severity</Th>
                <Th>Status</Th>
                <Th>Triggered</Th>
                <Th>Last seen</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((alert) => (
                <tr key={alert.id} className="hover:bg-surface-2/60">
                  <Td>
                    <button type="button" className="text-left font-medium text-fg hover:text-accent" onClick={() => setSelected(alert.id)}>
                      {alert.title}
                    </button>
                    <p className="max-w-md truncate text-xs text-muted">{alert.message}</p>
                  </Td>
                  <Td>
                    <span className="text-sm">{alert.target.name}</span>
                    {alert.asset ? <p className="text-xs text-muted">{alert.asset.name}</p> : null}
                  </Td>
                  <Td>
                    <Badge tone={alert.severity === "critical" ? "danger" : "warning"}>{humanize(alert.severity)}</Badge>
                  </Td>
                  <Td>
                    <StatusBadge value={alert.status} />
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-muted">{fmtRelative(alert.triggeredAt)}</Td>
                  <Td className="whitespace-nowrap text-xs text-muted">{fmtRelative(alert.lastSeenAt)}</Td>
                  <Td className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => setSelected(alert.id)}>
                      Details
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        ) : null}
        {meta ? <Pagination meta={meta} onPageChange={setPage} /> : null}
      </Card>

      <AlertDetailModal
        alertId={selected}
        open={selected !== null}
        onClose={() => setSelected(null)}
        onChanged={() => {
          list.reload();
          summary.reload();
        }}
        canWrite={can("write")}
      />
    </div>
  );
}
