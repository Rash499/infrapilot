"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Archive, ArchiveRestore, Pencil, Plus, Search } from "lucide-react";
import { AssetFormModal } from "@/components/forms/asset-form";
import { Button, Card, ConfirmDialog, DataTable, EmptyState, ErrorState, Input, PageHeader, Pagination, Select, Td, TableSkeleton, Th, StatusBadge } from "@/components/ui";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/context/toast-context";
import { fetchData, fetchList, getErrorMessage, sendData } from "@/lib/client/api";
import { useAsync } from "@/lib/client/use-async";
import { ASSET_STATUS_OPTIONS, ASSET_TYPE_OPTIONS, ENVIRONMENT_OPTIONS, fmtRelative, humanize } from "@/lib/format";
import type { Asset, UserOption } from "@/types/api";

export default function AssetsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [assetType, setAssetType] = useState("");
  const [environment, setEnvironment] = useState("");
  const [status, setStatus] = useState("");
  const [archived, setArchived] = useState<"false" | "true">("false");
  const [sort, setSort] = useState("name");
  const [order, setOrder] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Asset | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debounced, assetType, environment, status, archived, sort, order]);

  const list = useAsync(
    () => fetchList<Asset>("/assets", { page, pageSize: 15, search: debounced, assetType, environment, status, archived, sort, order }),
    [page, debounced, assetType, environment, status, archived, sort, order],
  );
  const owners = useAsync(() => fetchData<UserOption[]>("/users/options"), []);

  const reload = () => list.reload();

  const handleArchive = async () => {
    if (!archiveTarget) return;
    setBusy(true);
    try {
      if (archiveTarget.archivedAt) {
        await sendData("patch", `/assets/${archiveTarget.id}`, { archived: false });
        toast.success("Asset restored");
      } else {
        await sendData("delete", `/assets/${archiveTarget.id}`);
        toast.success("Asset archived");
      }
      setArchiveTarget(null);
      reload();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleSort = (column: string) => {
    if (sort === column) setOrder(order === "asc" ? "desc" : "asc");
    else {
      setSort(column);
      setOrder("asc");
    }
  };

  const sortLabel = (column: string) => (sort === column ? (order === "asc" ? " ▲" : " ▼") : "");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Infrastructure assets"
        description="Servers, virtual machines, network devices, cloud resources, containers, databases and applications."
        actions={
          can("write") ? (
            <Button
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              Register asset
            </Button>
          ) : null
        }
      />

      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div className="relative xl:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted" aria-hidden="true" />
            <Input aria-label="Search assets" placeholder="Search by name, hostname, IP or location" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select aria-label="Filter by type" value={assetType} onChange={(e) => setAssetType(e.target.value)}>
            <option value="">All types</option>
            {ASSET_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Select aria-label="Filter by environment" value={environment} onChange={(e) => setEnvironment(e.target.value)}>
            <option value="">All environments</option>
            {ENVIRONMENT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {ASSET_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="mt-3 flex gap-2">
          <Button variant={archived === "false" ? "primary" : "outline"} size="sm" onClick={() => setArchived("false")}>
            Active
          </Button>
          <Button variant={archived === "true" ? "primary" : "outline"} size="sm" onClick={() => setArchived("true")}>
            Archived
          </Button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {list.error && !list.data ? <ErrorState message={list.error} onRetry={reload} /> : null}
        {!list.data && list.loading ? <TableSkeleton rows={6} /> : null}
        {list.data && list.data.items.length === 0 ? (
          <EmptyState
            icon={Search}
            title="No assets match these filters"
            description={can("write") ? "Register your first asset to start tracking infrastructure." : "Ask an operator to register infrastructure assets."}
            action={
              can("write") && !debounced && !assetType && !environment && !status && archived === "false" ? (
                <Button onClick={() => setFormOpen(true)}>
                  <Plus className="size-4" aria-hidden="true" />
                  Register asset
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
                  <Th>
                    <button type="button" onClick={() => toggleSort("name")} className="uppercase">
                      Name{sortLabel("name")}
                    </button>
                  </Th>
                  <Th>Type</Th>
                  <Th>Host / IP</Th>
                  <Th>
                    <button type="button" onClick={() => toggleSort("environment")} className="uppercase">
                      Environment{sortLabel("environment")}
                    </button>
                  </Th>
                  <Th>Owner</Th>
                  <Th>
                    <button type="button" onClick={() => toggleSort("status")} className="uppercase">
                      Status{sortLabel("status")}
                    </button>
                  </Th>
                  <Th>
                    <button type="button" onClick={() => toggleSort("updatedAt")} className="uppercase">
                      Updated{sortLabel("updatedAt")}
                    </button>
                  </Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((asset) => (
                  <tr key={asset.id} className="hover:bg-surface-2/50">
                    <Td>
                      <Link href={`/assets/${asset.id}`} className="font-medium text-sky-500 hover:underline">
                        {asset.name}
                      </Link>
                    </Td>
                    <Td className="text-muted">{humanize(asset.assetType)}</Td>
                    <Td className="text-muted">
                      <span className="block">{asset.hostname ?? "—"}</span>
                      <span className="text-xs">{asset.ipAddress ?? ""}</span>
                    </Td>
                    <Td>
                      <StatusBadge value={asset.environment} />
                    </Td>
                    <Td className="text-muted">{asset.ownerName ?? "Unassigned"}</Td>
                    <Td>
                      <StatusBadge value={asset.status} />
                    </Td>
                    <Td className="text-muted">{fmtRelative(asset.updatedAt)}</Td>
                    <Td className="text-right">
                      <div className="flex justify-end gap-1">
                        {can("write") && !asset.archivedAt ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Edit ${asset.name}`}
                            onClick={() => {
                              setEditing(asset);
                              setFormOpen(true);
                            }}
                          >
                            <Pencil className="size-4" />
                          </Button>
                        ) : null}
                        {can("write") ? (
                          <Button variant="ghost" size="icon" aria-label={asset.archivedAt ? `Restore ${asset.name}` : `Archive ${asset.name}`} onClick={() => setArchiveTarget(asset)}>
                            {asset.archivedAt ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
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

      <AssetFormModal
        open={formOpen}
        asset={editing}
        owners={owners.data ?? []}
        onClose={() => setFormOpen(false)}
        onSaved={() => reload()}
      />

      <ConfirmDialog
        open={!!archiveTarget}
        title={archiveTarget?.archivedAt ? "Restore asset?" : "Archive asset?"}
        description={
          archiveTarget?.archivedAt
            ? `"${archiveTarget.name}" will return to the active inventory.`
            : `"${archiveTarget?.name ?? ""}" will be hidden from the active inventory. Its history is kept.`
        }
        confirmLabel={archiveTarget?.archivedAt ? "Restore" : "Archive"}
        tone={archiveTarget?.archivedAt ? "primary" : "danger"}
        busy={busy}
        onConfirm={() => void handleArchive()}
        onCancel={() => setArchiveTarget(null)}
      />
    </div>
  );
}
