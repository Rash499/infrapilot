"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Pagination, TableSkeleton, cn } from "@/components/ui";
import { useToast } from "@/context/toast-context";
import { fetchList, getErrorMessage, sendData } from "@/lib/client/api";
import { useAsync } from "@/lib/client/use-async";
import { NOTIFICATION_TYPE_LABELS, fmtDateTime, fmtRelative } from "@/lib/format";
import type { NotificationItem } from "@/types/api";

export default function NotificationsPage() {
  const router = useRouter();
  const toast = useToast();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);

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
        title="Notifications"
        description="Monitoring failures, critical findings, incident and change activity, and maintenance reminders."
        actions={
          <>
            <div className="flex overflow-hidden rounded-md border border-line">
              <button type="button" onClick={() => setUnreadOnly(false)} className={cn("px-3 py-1.5 text-sm", !unreadOnly ? "bg-sky-600 text-white" : "text-muted hover:bg-surface-2")}>
                All
              </button>
              <button type="button" onClick={() => setUnreadOnly(true)} className={cn("px-3 py-1.5 text-sm", unreadOnly ? "bg-sky-600 text-white" : "text-muted hover:bg-surface-2")}>
                Unread {unreadCount > 0 ? `(${unreadCount})` : ""}
              </button>
            </div>
            <Button variant="outline" onClick={() => void markAll()} loading={busy} disabled={unreadCount === 0}>
              <CheckCheck className="size-4" aria-hidden="true" /> Mark all read
            </Button>
          </>
        }
      />

      <Card className="overflow-hidden">
        {list.error && !list.data ? <ErrorState message={list.error} onRetry={list.reload} /> : null}
        {!list.data && list.loading ? <TableSkeleton rows={6} /> : null}
        {list.data && list.data.items.length === 0 ? (
          <EmptyState
            icon={Bell}
            title={unreadOnly ? "You are all caught up" : "No notifications yet"}
            description="Alerts about monitoring, incidents, findings, maintenance and changes will appear here."
          />
        ) : null}
        {list.data && list.data.items.length > 0 ? (
          <>
            <ul className="divide-y divide-line">
              {list.data.items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => void markRead(n)}
                    className={cn("flex w-full items-start gap-3 px-4 py-4 text-left transition-colors hover:bg-surface-2/60", !n.readAt && "bg-sky-500/5")}
                  >
                    <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-sky-500")} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className={cn("text-sm", n.readAt ? "text-fg" : "font-semibold text-fg")}>{n.title}</span>
                        <Badge>{NOTIFICATION_TYPE_LABELS[n.type] ?? "General"}</Badge>
                      </span>
                      <span className="mt-1 block text-sm text-muted">{n.message}</span>
                      <span className="mt-1 block text-xs text-muted" title={fmtDateTime(n.createdAt)}>
                        {fmtRelative(n.createdAt)}
                      </span>
                    </span>
                    {n.link ? <span className="self-center text-xs text-sky-500">Open →</span> : null}
                  </button>
                </li>
              ))}
            </ul>
            <Pagination meta={list.data.meta} onPageChange={setPage} />
          </>
        ) : null}
      </Card>
    </div>
  );
}
