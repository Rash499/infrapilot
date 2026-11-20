"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Archive, ArchiveRestore, Pencil } from "lucide-react";
import { AssetFormModal } from "@/components/forms/asset-form";
import { Button, Card, ConfirmDialog, EmptyState, ErrorState, PageHeader, Skeleton, StatusBadge } from "@/components/ui";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/context/toast-context";
import { fetchData, getErrorMessage, sendData } from "@/lib/client/api";
import { useAsync } from "@/lib/client/use-async";
import { fmtDateTime, fmtRelative, humanize } from "@/lib/format";
import type { Asset, AssetDetail, AuditEntry, UserOption } from "@/types/api";

export default function AssetDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { can } = useAuth();
  const toast = useToast();
  const [formOpen, setFormOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const asset = useAsync(() => fetchData<AssetDetail>(`/assets/${id}`), [id]);
  const history = useAsync(() => fetchData<AuditEntry[]>(`/assets/${id}/history`), [id]);
  const owners = useAsync(() => fetchData<UserOption[]>("/users/options"), []);
  const a = asset.data;

  const toggleArchive = async () => {
    if (!a) return;
    setBusy(true);
    try {
      if (a.archivedAt) {
        await sendData("patch", `/assets/${a.id}`, { archived: false });
        toast.success("Asset restored");
      } else {
        await sendData("delete", `/assets/${a.id}`);
        toast.success("Asset archived");
      }
      setArchiveOpen(false);
      asset.reload();
      history.reload();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (asset.error && !a) {
    return <ErrorState message={asset.error} onRetry={asset.reload} />;
  }

  return (
    <div className="space-y-6">
      <Link href="/assets" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden="true" /> Back to assets
      </Link>

      {!a ? (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <>
          <PageHeader
            title={a.name}
            description={`${humanize(a.assetType)} · ${humanize(a.environment)}${a.archivedAt ? " · Archived" : ""}`}
            actions={
              can("write") ? (
                <>
                  {!a.archivedAt ? (
                    <Button variant="outline" onClick={() => setFormOpen(true)}>
                      <Pencil className="size-4" aria-hidden="true" /> Edit
                    </Button>
                  ) : null}
                  <Button variant="outline" onClick={() => setArchiveOpen(true)}>
                    {a.archivedAt ? <ArchiveRestore className="size-4" aria-hidden="true" /> : <Archive className="size-4" aria-hidden="true" />}
                    {a.archivedAt ? "Restore" : "Archive"}
                  </Button>
                </>
              ) : null
            }
          />

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="p-5 lg:col-span-2">
              <h2 className="mb-4 text-sm font-semibold text-fg">Details</h2>
              <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                {[
                  ["Status", <StatusBadge key="s" value={a.status} />],
                  ["Environment", <StatusBadge key="e" value={a.environment} />],
                  ["Hostname", a.hostname ?? "—"],
                  ["IP address", a.ipAddress ?? "—"],
                  ["Operating system", a.operatingSystem ?? "—"],
                  ["Location", a.location ?? "—"],
                  ["Owner", a.ownerName ?? "Unassigned"],
                  ["Created", fmtDateTime(a.createdAt)],
                  ["Last updated", `${fmtDateTime(a.updatedAt)} (${fmtRelative(a.updatedAt)})`],
                ].map(([label, value]) => (
                  <div key={String(label)}>
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted">{label}</dt>
                    <dd className="mt-1 text-sm text-fg">{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-5">
                <dt className="text-xs font-medium uppercase tracking-wide text-muted">Description</dt>
                <dd className="mt-1 whitespace-pre-line text-sm text-fg">{a.description || "No description provided."}</dd>
              </div>
            </Card>

            <Card className="p-5">
              <h2 className="mb-4 text-sm font-semibold text-fg">Monitoring</h2>
              {a.monitors.length === 0 ? (
                <p className="text-sm text-muted">
                  No monitoring target is linked. Registering an asset does not mean it is monitored: add a check on the{" "}
                  <Link href="/monitoring" className="text-sky-500 hover:underline">
                    Monitoring
                  </Link>{" "}
                  page.
                </p>
              ) : (
                <ul className="space-y-2">
                  {a.monitors.map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-2">
                      <Link href={`/monitoring?target=${m.id}`} className="truncate text-sm text-sky-500 hover:underline">
                        {m.name}
                      </Link>
                      <StatusBadge value={m.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <div className="border-b border-line px-4 py-3">
                <h2 className="text-sm font-semibold text-fg">Security findings</h2>
              </div>
              {a.findings.length === 0 ? (
                <EmptyState title="No findings for this asset" />
              ) : (
                <ul className="divide-y divide-line">
                  {a.findings.map((f) => (
                    <li key={f.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <Link href={`/security?finding=${f.id}`} className="truncate text-sm text-fg hover:underline">
                        {f.title}
                      </Link>
                      <div className="flex gap-2">
                        <StatusBadge value={f.severity} />
                        <StatusBadge value={f.status} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <div className="border-b border-line px-4 py-3">
                <h2 className="text-sm font-semibold text-fg">Linked incidents</h2>
              </div>
              {a.incidents.length === 0 ? (
                <EmptyState title="No incidents linked" />
              ) : (
                <ul className="divide-y divide-line">
                  {a.incidents.map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <Link href={`/incidents/${i.id}`} className="min-w-0 truncate text-sm text-fg hover:underline">
                        <span className="text-muted">{i.reference}</span> {i.title}
                      </Link>
                      <StatusBadge value={i.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card>
            <div className="border-b border-line px-4 py-3">
              <h2 className="text-sm font-semibold text-fg">Asset history</h2>
            </div>
            {history.error ? <ErrorState message={history.error} /> : null}
            {history.data && history.data.length === 0 ? <EmptyState title="No history recorded yet" /> : null}
            <ol className="relative space-y-4 px-6 py-5">
              {(history.data ?? []).map((h) => (
                <li key={h.id} className="relative pl-5">
                  <span className="absolute left-0 top-1.5 size-2 rounded-full bg-sky-500" aria-hidden="true" />
                  <p className="text-sm text-fg">{h.summary}</p>
                  <p className="text-xs text-muted">
                    {h.actorName} · {fmtDateTime(h.createdAt)}
                  </p>
                </li>
              ))}
            </ol>
          </Card>
        </>
      )}

      <AssetFormModal
        open={formOpen}
        asset={a as Asset | null}
        owners={owners.data ?? []}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          asset.reload();
          history.reload();
        }}
      />
      <ConfirmDialog
        open={archiveOpen}
        title={a?.archivedAt ? "Restore asset?" : "Archive asset?"}
        description={a?.archivedAt ? "The asset will return to the active inventory." : "The asset will be hidden from the active inventory. History is preserved."}
        confirmLabel={a?.archivedAt ? "Restore" : "Archive"}
        tone={a?.archivedAt ? "primary" : "danger"}
        busy={busy}
        onConfirm={() => void toggleArchive()}
        onCancel={() => setArchiveOpen(false)}
      />
      <span className="sr-only" aria-live="polite">
        {router ? "" : ""}
      </span>
    </div>
  );
}
