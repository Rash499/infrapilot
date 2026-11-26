"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { Activity, Archive, ArchiveRestore, ArrowLeft, Pencil, ShieldAlert, Siren } from "lucide-react";
import { AssetFormModal } from "@/components/forms/asset-form";
import { ActivityTimeline, Button, Card, CardHeader, ConfirmDialog, DetailItem, DetailList, EmptyState, ErrorState, PageHeader, Skeleton, StatusBadge } from "@/components/ui";
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
      <Link
        href="/assets"
        className="inline-flex items-center gap-1 rounded text-sm text-muted transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
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
            eyebrow="Asset"
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
            <Card className="lg:col-span-2">
              <CardHeader title="Asset details" description={`Registered ${fmtRelative(a.createdAt)}`} icon={Activity} />
              <div className="p-4 pt-4">
                <DetailList>
                  <DetailItem label="Status">
                    <StatusBadge value={a.status} />
                  </DetailItem>
                  <DetailItem label="Environment">
                    <StatusBadge value={a.environment} />
                  </DetailItem>
                  <DetailItem label="Hostname">{a.hostname ?? "—"}</DetailItem>
                  <DetailItem label="IP address">{a.ipAddress ?? "—"}</DetailItem>
                  <DetailItem label="Operating system">{a.operatingSystem ?? "—"}</DetailItem>
                  <DetailItem label="Location">{a.location ?? "—"}</DetailItem>
                  <DetailItem label="Owner">{a.ownerName ?? "Unassigned"}</DetailItem>
                  <DetailItem label="Asset type">{humanize(a.assetType)}</DetailItem>
                  <DetailItem label="Created">{fmtDateTime(a.createdAt)}</DetailItem>
                  <DetailItem label="Last updated">
                    {fmtDateTime(a.updatedAt)} <span className="text-muted">({fmtRelative(a.updatedAt)})</span>
                  </DetailItem>
                  <DetailItem label="Description" className="sm:col-span-2">
                    <span className="whitespace-pre-line">{a.description || "No description provided."}</span>
                  </DetailItem>
                </DetailList>
              </div>
            </Card>

            <Card className="p-4">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg">
                <Activity className="size-4 text-accent" aria-hidden="true" /> Monitoring
              </h2>
              {a.monitors.length === 0 ? (
                <p className="text-sm text-muted">
                  No monitoring target is linked. Registering an asset does not mean it is monitored: add a check on the{" "}
                  <Link href="/monitoring" className="text-accent hover:underline">
                    Monitoring
                  </Link>{" "}
                  page.
                </p>
              ) : (
                <ul className="space-y-2">
                  {a.monitors.map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-2">
                      <Link href={`/monitoring?target=${m.id}`} className="truncate text-sm text-accent hover:underline">
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
              <CardHeader title="Security findings" description="Open and resolved vulnerabilities on this asset" icon={ShieldAlert} />
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
              <CardHeader title="Linked incidents" description="Incidents that reference this asset" icon={Siren} />
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
            <CardHeader title="Asset history" description="Audit trail of changes to this record" icon={Activity} />
            {history.error ? <ErrorState message={history.error} /> : null}
            {history.data && history.data.length === 0 ? <EmptyState title="No history recorded yet" /> : null}
            <div className="px-4 py-4">
              <ActivityTimeline
                items={(history.data ?? []).map((h) => ({
                  id: h.id,
                  title: h.summary,
                  meta: fmtRelative(h.createdAt),
                  body: `${h.actorName} · ${fmtDateTime(h.createdAt)}`,
                  tone: "info" as const,
                }))}
              />
            </div>
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
