"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  CalendarClock,
  CheckCheck,
  ChevronRight,
  GitPullRequest,
  ShieldAlert,
} from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Pagination, Segmented, TableSkeleton, cn } from "@/components/ui";
import { useToast } from "@/context/toast-context";
import { fetchList, getErrorMessage, sendData } from "@/lib/client/api";
import { useAsync } from "@/lib/client/use-async";
import { NOTIFICATION_TYPE_LABELS, fmtDateTime, fmtRelative } from "@/lib/format";
import type { NotificationItem } from "@/types/api";

const TYPE_ICON: Record<string, typeof Bell> = {
  monitoring_unavailable: Activity,
  monitoring_recovered: Activity,
  critical_finding: ShieldAlert,
  incident_assigned: AlertTriangle,
  incident_updated: AlertTriangle,
  maintenance_scheduled: CalendarClock,
  maintenance_reminder: CalendarClock,
  change_pending_approval: GitPullRequest,
  change_decision: GitPullRequest,
  general: Bell,
};

const URGENT_TYPES = new Set(["monitoring_unavailable", "critical_finding", "incident_assigned"]);

export default function NotificationsPage() {
  const router = useRouter();
  const toast = useToast();
  const [scope, setScope] = useState<"all" | "unread">("all");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const unreadOnly = scope === "unread";

  useEffect(() => {
    setPage(1);
  }, [unreadOnly]);

  const list = useAsync(
    () => fetchList<NotificationItem>("/notifications", { page, pageSize: 20, unread: unreadOnly ? "true" : "false" }),
    [page, unreadOnly],
  );
  const unreadCount = Number(list.data?.meta.unreadCount ?? 0);

  const markRead = async (n: NotificationItem) => {
    try {
      if (!n.readAt) await sendData("post", `/notifications/${n.id}/read`);
      if (n.link) router.push(n.link);
      else list.reload();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const markAll = async () => {
    setBusy(true);
    try {
      const res = await sendData<{ updated: number }>("post", "/notifications/read-all");
      toast.success(`${res.updated} notification(s) marked as read`);
      list.reload();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Workspace"
        title="Notifications"
        description="Monitoring failures, critical findings, incident and change activity, and maintenance reminders for this account."
        actions={
          <Button variant="outline" onClick={() => void markAll()} loading={busy} disabled={unreadCount === 0}>
            <CheckCheck className="size-4" aria-hidden="true" /> Mark all read
          </Button>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Notification scope"
          value={scope}
          onChange={setScope}
          options={[
            { value: "all", label: "All" },
            { value: "unread", label: `Unread${unreadCount > 0 ? ` (${unreadCount})` : ""}` },
          ]}
        />
        {unreadCount > 0 ? (
          <p className="text-xs text-muted">
            {unreadCount} unread {unreadCount === 1 ? "notification" : "notifications"}
          </p>
        ) : (
          <p className="text-xs text-muted">All notifications read</p>
        )}
      </div>

      <Card className="overflow-hidden">
        {list.error && !list.data ? <ErrorState message={list.error} onRetry={list.reload} /> : null}
        {!list.data && list.loading ? <TableSkeleton rows={6} /> : null}
        {list.data && list.data.items.length === 0 ? (
          <EmptyState
            icon={Bell}
            title={unreadOnly ? "You are all caught up" : "No notifications yet"}
            description="Alerts about monitoring, incidents, findings, maintenance and changes appear here."
          />
        ) : null}
        {list.data && list.data.items.length > 0 ? (
          <>
            <ul className="divide-y divide-line">
              {list.data.items.map((n) => {
                const Icon = TYPE_ICON[n.type] ?? Bell;
                const unread = !n.readAt;
                const urgent = unread && URGENT_TYPES.has(n.type);
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => void markRead(n)}
                      className={cn(
                        "row-hover flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent",
                        unread && "bg-accent/[0.04]",
                      )}
                    >
                      <span
                        className={cn(
                          "mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border",
                          urgent
                            ? "border-[color-mix(in_srgb,var(--st-danger-fg)_35%,transparent)] bg-[var(--st-danger-bg)] text-[var(--st-danger-fg)]"
                            : "border-line bg-surface-2 text-muted",
                        )}
                        aria-hidden="true"
                      >
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className={cn("text-sm", unread ? "font-semibold text-fg" : "text-fg")}>{n.title}</span>
                          <Badge>{NOTIFICATION_TYPE_LABELS[n.type] ?? "General"}</Badge>
                          {unread ? (
                            <span className="inline-flex items-center gap-1 text-2xs font-medium uppercase tracking-wide text-accent">
                              <span className="size-1.5 rounded-full bg-accent" aria-hidden="true" />
                              Unread
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-1 block text-sm leading-relaxed text-muted">{n.message}</span>
                        <span className="mt-1 block text-xs text-muted" title={fmtDateTime(n.createdAt)}>
                          {fmtRelative(n.createdAt)}
                        </span>
                      </span>
                      {n.link ? (
                        <span className="mt-0.5 hidden shrink-0 items-center gap-1 text-xs font-medium text-accent sm:flex">
                          Open
                          <ChevronRight className="size-3.5" aria-hidden="true" />
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
            <Pagination meta={list.data.meta} onPageChange={setPage} />
          </>
        ) : null}
      </Card>
    </div>
  );
}
