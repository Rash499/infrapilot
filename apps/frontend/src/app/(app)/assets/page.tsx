"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Archive, ArchiveRestore, Download, FilterX, Pencil, Plus, Search, Upload } from "lucide-react";
import { AssetFormModal } from "@/components/forms/asset-form";
import { Alert, Button, Card, ConfirmDialog, DataTable, EmptyState, ErrorState, Input, Modal, PageHeader, Pagination, Segmented, Select, SortHeader, StatusBadge, TableSkeleton, Td, Th, Toolbar } from "@/components/ui";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/context/toast-context";
import { fetchData, fetchList, getErrorMessage, sendData } from "@/lib/client/api";
import { useAsync } from "@/lib/client/use-async";
import { assetsToCsv, MAX_ASSET_IMPORT_ROWS, parseAssetsCsv, type AssetCsvError, type AssetCsvImport } from "@/lib/assets-csv";
import { useUrlFilters } from "@/lib/client/use-url-filters";
import { ASSET_STATUS_OPTIONS, ASSET_TYPE_OPTIONS, ENVIRONMENT_OPTIONS, fmtRelative, humanize } from "@/lib/format";
import type { Asset, UserOption } from "@/types/api";

interface AssetImportPreview extends AssetCsvImport {
  fileName: string;
}

interface AssetImportReport {
  total: number;
  imported: number;
  errors: AssetCsvError[];
}

const MAX_ASSET_CSV_BYTES = 5 * 1024 * 1024;

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
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState<AssetImportPreview | null>(null);
  const [importReport, setImportReport] = useState<AssetImportReport | null>(null);
  const csvInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debounced, assetType, environment, status, archived, sort, order]);

  // Structured filters are shareable: reloading or navigating back restores the same view. The
  // free-text search is intentionally transient — writing it from a debounce would race with a row
  // click that navigates to an asset while the timer fires.
  useUrlFilters(
    { type: assetType, env: environment, state: status, scope: archived, sort, order },
    { type: "", env: "", state: "", scope: "false", sort: "name", order: "asc" },
    (patch) => {
      if (patch.type !== undefined) setAssetType(patch.type);
      if (patch.env !== undefined) setEnvironment(patch.env);
      if (patch.state !== undefined) setStatus(patch.state);
      if (patch.scope !== undefined) setArchived(patch.scope === "true" ? "true" : "false");
      if (patch.sort !== undefined) setSort(patch.sort);
      if (patch.order !== undefined) setOrder(patch.order === "desc" ? "desc" : "asc");
    },
  );

  const filtersActive = Boolean(debounced || assetType || environment || status) || archived !== "false";

  const clearFilters = () => {
    setSearch("");
    setAssetType("");
    setEnvironment("");
    setStatus("");
    setArchived("false");
  };

  const list = useAsync(
    () => fetchList<Asset>("/assets", { page, pageSize: 15, search: debounced, assetType, environment, status, archived, sort, order }),
    [page, debounced, assetType, environment, status, archived, sort, order],
  );
  const owners = useAsync(() => fetchData<UserOption[]>("/users/options"), []);

  const reload = () => list.reload();

  const exportCsv = async () => {
    setExporting(true);
    try {
      const filters = { pageSize: 100, search: debounced, assetType, environment, status, archived, sort, order };
      const first = await fetchList<Asset>("/assets", { ...filters, page: 1 });
      const assets = [...first.items];
      for (let currentPage = 2; currentPage <= first.meta.totalPages; currentPage += 1) {
        const pageResult = await fetchList<Asset>("/assets", { ...filters, page: currentPage });
        assets.push(...pageResult.items);
      }

      const blob = new Blob(["\uFEFF", assetsToCsv(assets)], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `infrapilot-assets-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      toast.success(`Exported ${assets.length} asset${assets.length === 1 ? "" : "s"}`);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  const selectCsv = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (file.size > MAX_ASSET_CSV_BYTES) {
      toast.error("CSV files must be 5 MB or smaller.");
      return;
    }
    try {
      const parsed = parseAssetsCsv(await file.text());
      setImportReport(null);
      setImportPreview({ fileName: file.name, ...parsed });
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const importCsv = async () => {
    if (!importPreview || importPreview.errors.length > 0 || importPreview.rows.length === 0) return;
    setImporting(true);
    let imported = 0;
    const errors: AssetCsvError[] = [];
    try {
      for (const row of importPreview.rows) {
        try {
          await sendData("post", "/assets", row.payload);
          imported += 1;
        } catch (err) {
          errors.push({ rowNumber: row.rowNumber, message: getErrorMessage(err) });
        }
      }
      setImportReport({ total: importPreview.rows.length, imported, errors });
      setImportPreview(null);
      reload();
      if (errors.length === 0) {
        toast.success(`Imported ${imported} asset${imported === 1 ? "" : "s"}`);
      } else {
        toast.error(`Imported ${imported} of ${importPreview.rows.length} assets. Review the row errors below.`);
      }
    } finally {
      setImporting(false);
    }
  };

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

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Infrastructure"
        title="Infrastructure assets"
        description="Servers, virtual machines, network devices, cloud resources, containers, databases and applications."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void exportCsv()} loading={exporting}>
              <Download className="size-4" aria-hidden="true" />
              Export CSV
            </Button>
            {can("write") ? (
              <>
                <input ref={csvInput} type="file" accept=".csv,text/csv" className="hidden" onChange={(event) => void selectCsv(event)} />
                <Button variant="outline" onClick={() => csvInput.current?.click()}>
                  <Upload className="size-4" aria-hidden="true" />
                  Import CSV
                </Button>
                <Button
                  onClick={() => {
                    setEditing(null);
                    setFormOpen(true);
                  }}
                >
                  <Plus className="size-4" aria-hidden="true" />
                  Register asset
                </Button>
              </>
            ) : null}
          </div>
        }
      />

      {importReport ? (
        <Card className="p-4">
          <div role={importReport.errors.length > 0 ? "alert" : "status"} aria-live="polite">
            <p className="text-sm font-medium text-fg">
              Imported {importReport.imported} of {importReport.total} assets.
              {importReport.errors.length > 0 ? ` ${importReport.errors.length} rows failed.` : ""}
            </p>
            {importReport.errors.length > 0 ? (
              <details className="mt-2 text-sm text-muted">
                <summary className="cursor-pointer">Review failed rows</summary>
                <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                  {importReport.errors.map((error) => (
                    <li key={`${error.rowNumber}-${error.message}`}>Row {error.rowNumber}: {error.message}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        </Card>
      ) : null}

      <Toolbar>
        <div className="grid w-full gap-3 md:grid-cols-2 xl:grid-cols-5">
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
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Inventory scope"
            value={archived}
            onChange={setArchived}
            options={[
              { value: "false", label: "Active" },
              { value: "true", label: "Archived" },
            ]}
          />
          {filtersActive ? (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <FilterX className="size-3.5" aria-hidden="true" />
              Clear filters
            </Button>
          ) : null}
        </div>
      </Toolbar>

      <Card className="overflow-hidden">
        {list.error && !list.data ? <ErrorState message={list.error} onRetry={reload} /> : null}
        {!list.data && list.loading ? <TableSkeleton rows={6} /> : null}
        {list.data && list.data.items.length === 0 ? (
          <EmptyState
            icon={Search}
            title="No assets match these filters"
            description={can("write") ? "Register your first asset to start tracking infrastructure." : "Ask an operator to register infrastructure assets."}
            action={
              can("write") && !filtersActive ? (
                <Button onClick={() => setFormOpen(true)}>
                  <Plus className="size-4" aria-hidden="true" />
                  Register asset
                </Button>
              ) : filtersActive ? (
                <Button variant="outline" onClick={clearFilters}>
                  <FilterX className="size-4" aria-hidden="true" />
                  Clear filters
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
                  <SortHeader column="name" activeColumn={sort} direction={order} onSort={toggleSort}>
                    Name
                  </SortHeader>
                  <Th>Type</Th>
                  <Th>Host / IP</Th>
                  <SortHeader column="environment" activeColumn={sort} direction={order} onSort={toggleSort}>
                    Environment
                  </SortHeader>
                  <Th>Owner</Th>
                  <SortHeader column="status" activeColumn={sort} direction={order} onSort={toggleSort}>
                    Status
                  </SortHeader>
                  <SortHeader column="updatedAt" activeColumn={sort} direction={order} onSort={toggleSort}>
                    Updated
                  </SortHeader>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((asset) => (
                  <tr key={asset.id} className="row-hover">
                    <Td>
                      <Link href={`/assets/${asset.id}`} className="font-medium text-accent hover:underline">
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

      <Modal
        open={!!importPreview}
        onClose={() => {
          if (!importing) setImportPreview(null);
        }}
        title="Import assets from CSV"
        description={importPreview?.fileName}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setImportPreview(null)} disabled={importing}>
              Cancel
            </Button>
            <Button
              onClick={() => void importCsv()}
              loading={importing}
              disabled={!importPreview || importPreview.errors.length > 0 || importPreview.rows.length === 0}
            >
              Import {importPreview?.rows.length ?? 0} assets
            </Button>
          </>
        }
      >
        {importPreview ? (
          <div className="space-y-4 text-sm">
            <p className="text-muted">
              {importPreview.rows.length} valid row{importPreview.rows.length === 1 ? "" : "s"} ready to import. Up to {MAX_ASSET_IMPORT_ROWS} assets are accepted per file.
            </p>
            <p className="text-muted">Import creates new assets; it does not update existing records. Export follows the current list filters.</p>
            <p className="text-muted">
              Required columns: <code>name</code>, <code>assetType</code>, <code>environment</code>. Optional columns: hostname, ipAddress, operatingSystem, location, ownerId, description, status.
            </p>
            {importPreview.errors.length > 0 ? (
              <Alert tone="danger" title={`${importPreview.errors.length} row${importPreview.errors.length === 1 ? "" : "s"} need correction`}>
                <p>No assets will be imported until every listed row is fixed.</p>
                <ul className="mt-2 max-h-48 list-disc space-y-1 overflow-y-auto pl-4">
                  {importPreview.errors.map((error) => (
                    <li key={`${error.rowNumber}-${error.message}`}>
                      Row {error.rowNumber}: {error.message}
                    </li>
                  ))}
                </ul>
              </Alert>
            ) : null}
          </div>
        ) : null}
      </Modal>

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
