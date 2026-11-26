"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Pencil, Plus, Search, ShieldAlert, Trash2 } from "lucide-react";
import { DistributionChart } from "@/components/charts";
import { Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Pagination, Select, StatCard, StatusBadge, TableSkeleton, Td, Textarea, Th } from "@/components/ui";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/context/toast-context";
import { fetchData, fetchList, getErrorMessage, sendData, validatePayload } from "@/lib/client/api";
import { useAsync } from "@/lib/client/use-async";
import { FINDING_STATUS_OPTIONS, SEVERITY_OPTIONS, fmtDateTime, fmtRelative, humanize } from "@/lib/format";
import { findingCreateSchema, findingUpdateSchema } from "@/validators/schemas";
import type { Asset, Finding, UserOption } from "@/types/api";

interface FindingFormValues {
  title: string;
  description: string;
  severity: string;
  assetId: string;
  assigneeId: string;
  remediation: string;
  cveId: string;
  status: string;
  note: string;
}

function FindingFormModal({
  open,
  onClose,
  onSaved,
  finding,
  assets,
  users,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (f: Finding) => void;
  finding: Finding | null;
  assets: Asset[];
  users: UserOption[];
}) {
  const toast = useToast();
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm<FindingFormValues>({
    defaultValues: blank(finding),
  });
  useEffect(() => {
    if (open) reset(blank(finding));
  }, [open, finding, reset]);

  const onSubmit = handleSubmit(async (v) => {
    const common = {
      title: v.title.trim(),
      description: v.description.trim(),
      severity: v.severity,
      assetId: v.assetId || null,
      assigneeId: v.assigneeId || null,
      remediation: v.remediation.trim() || null,
      cveId: v.cveId.trim() || null,
    };
    try {
      let saved: Finding;
      if (finding) {
        const payload = { ...common, status: v.status, note: v.note.trim() || undefined };
        validatePayload(findingUpdateSchema, payload);
        saved = await sendData<Finding>("patch", `/findings/${finding.id}`, payload);
      } else {
        validatePayload(findingCreateSchema, common);
        saved = await sendData<Finding>("post", "/findings", common);
      }
      toast.success(finding ? "Finding updated" : "Finding recorded");
      onSaved(saved);
      onClose();
    } catch (err) {
      setError("root", { message: getErrorMessage(err) });
    }
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={finding ? "Edit security finding" : "Record security finding"}
      description="Findings capture vulnerabilities, misconfigurations and risks against infrastructure assets."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" form="finding-form" loading={isSubmitting}>
            {finding ? "Save finding" : "Record finding"}
          </Button>
        </>
      }
    >
      <form id="finding-form" onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
        {errors.root?.message ? (
          <p role="alert" className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-500 sm:col-span-2">
            {errors.root.message}
          </p>
        ) : null}
        <Field label="Title *" htmlFor="f-title" className="sm:col-span-2">
          <Input id="f-title" {...register("title", { required: "Title is required" })} placeholder="Outdated TLS configuration on load balancer" />
        </Field>
        <Field label="Severity *" htmlFor="f-sev">
          <Select id="f-sev" {...register("severity")}>
            {SEVERITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="CVE identifier" htmlFor="f-cve" hint="Optional, e.g. CVE-2024-12345">
          <Input id="f-cve" {...register("cveId")} placeholder="CVE-2024-12345" />
        </Field>
        <Field label="Affected asset" htmlFor="f-asset">
          <Select id="f-asset" {...register("assetId")}>
            <option value="">Not linked</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Responsible user" htmlFor="f-assignee">
          <Select id="f-assignee" {...register("assigneeId")}>
            <option value="">Unassigned</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Description *" htmlFor="f-desc" className="sm:col-span-2">
          <Textarea id="f-desc" rows={3} {...register("description", { required: "Description is required" })} />
        </Field>
        <Field label="Remediation recommendation" htmlFor="f-rem" className="sm:col-span-2">
          <Textarea id="f-rem" rows={3} {...register("remediation")} />
        </Field>
        {finding ? (
          <>
            <Field label="Remediation status" htmlFor="f-status">
              <Select id="f-status" {...register("status")}>
                {FINDING_STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Update note" htmlFor="f-note" hint="Required when accepting risk (justification).">
              <Input id="f-note" {...register("note")} />
            </Field>
          </>
        ) : null}
      </form>
    </Modal>
  );
}

function blank(f: Finding | null): FindingFormValues {
  return {
    title: f?.title ?? "",
    description: f?.description ?? "",
    severity: f?.severity ?? "medium",
    assetId: f?.assetId ?? "",
    assigneeId: f?.assigneeId ?? "",
    remediation: f?.remediation ?? "",
    cveId: f?.cveId ?? "",
    status: f?.status ?? "open",
    note: "",
  };
}

function FindingDetailModal({
  id,
  onClose,
  onEdit,
  onChanged,
}: {
  id: string | null;
  onClose: () => void;
  onEdit: (f: Finding) => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const detail = useAsync(() => (id ? fetchData<Finding>(`/findings/${id}`) : Promise.resolve(null)), [id]);
  const [status, setStatus] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const f = detail.data;

  useEffect(() => {
    if (f) {
      setStatus(f.status);
      setNote("");
    }
  }, [f]);

  const save = async () => {
    if (!f) return;
    setSaving(true);
    try {
      const payload = { status, note: note.trim() || undefined };
      validatePayload(findingUpdateSchema, payload);
      await sendData("patch", `/findings/${f.id}`, payload);
      toast.success("Remediation status updated");
      detail.reload();
      onChanged();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={!!id}
      onClose={onClose}
      size="lg"
      title={f?.title ?? "Finding details"}
      description={f ? `Recorded ${fmtDateTime(f.createdAt)} by ${f.createdByName ?? "unknown"}` : undefined}
      footer={
        f ? (
          <Button variant="outline" onClick={() => onEdit(f)}>
            <Pencil className="size-4" aria-hidden="true" /> Edit details
          </Button>
        ) : null
      }
    >
      {detail.error ? <ErrorState message={detail.error} onRetry={detail.reload} /> : null}
      {!f && detail.loading ? <TableSkeleton rows={4} /> : null}
      {f ? (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge value={f.severity} />
            <StatusBadge value={f.status} />
            {f.cveId ? <Badge>{f.cveId}</Badge> : null}
          </div>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Asset</dt>
              <dd className="text-sm text-fg">{f.assetName ?? "Not linked"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Responsible user</dt>
              <dd className="text-sm text-fg">{f.assigneeName ?? "Unassigned"}</dd>
            </div>
          </dl>
          <div>
            <h3 className="text-xs uppercase tracking-wide text-muted">Description</h3>
            <p className="mt-1 whitespace-pre-line text-sm text-fg">{f.description}</p>
          </div>
          <div>
            <h3 className="text-xs uppercase tracking-wide text-muted">Remediation recommendation</h3>
            <p className="mt-1 whitespace-pre-line text-sm text-fg">{f.remediation || "No remediation documented yet."}</p>
          </div>
          <div className="grid gap-3 rounded-lg border border-line bg-canvas p-4 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
            <Field label="Remediation status" htmlFor="detail-status">
              <Select id="detail-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                {FINDING_STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={status === "accepted_risk" ? "Justification (required)" : "Note"} htmlFor="detail-note">
              <Input id="detail-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changed?" />
            </Field>
            <Button onClick={() => void save()} loading={saving} disabled={status === f.status && !note.trim()}>
              Update
            </Button>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-fg">Remediation history</h3>
            <ol className="space-y-3 border-l border-line pl-4">
              {(f.history ?? []).map((h) => (
                <li key={h.id} className="relative">
                  <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-sky-500" aria-hidden="true" />
                  <p className="text-sm text-fg">
                    {h.fromStatus && h.toStatus ? (
                      <>
                        {humanize(h.fromStatus)} → <strong>{humanize(h.toStatus)}</strong>.{" "}
                      </>
                    ) : null}
                    {h.note}
                  </p>
                  <p className="text-xs text-muted">
                    {h.actorName} · {fmtDateTime(h.createdAt)}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

export default function SecurityPage() {
  const { can, user } = useAuth();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [severity, setSeverity] = useState("");
  const [status, setStatus] = useState("");
  const [assetId, setAssetId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Finding | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Finding | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("finding");
    if (id) setDetailId(id);
  }, []);

  useEffect(() => {
    setPage(1);
  }, [debounced, severity, status, assetId, assigneeId]);

  const list = useAsync(
    () => fetchList<Finding>("/findings", { page, pageSize: 15, search: debounced, severity, status, assetId, assigneeId, sort: "createdAt", order: "desc" }),
    [page, debounced, severity, status, assetId, assigneeId],
  );
  const stats = useAsync(() => fetchList<Finding>("/findings", { pageSize: 100 }), []);
  const assets = useAsync(() => fetchList<Asset>("/assets", { pageSize: 100 }), []);
  const users = useAsync(() => fetchData<UserOption[]>("/users/options"), []);

  const reloadAll = () => {
    list.reload();
    stats.reload();
  };

  const countBy = (key: "severity" | "status", value: string) =>
    (stats.data?.items ?? []).filter((f) => f[key] === value).length;

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await sendData("delete", `/findings/${deleteTarget.id}`);
      toast.success("Finding deleted");
      setDeleteTarget(null);
      reloadAll();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Security findings"
        description="Centralised vulnerability and risk register. Scanner integrations can post findings here in a later release."
        actions={
          can("write") ? (
            <Button
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus className="size-4" aria-hidden="true" /> Record finding
            </Button>
          ) : null
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Critical (page)" value={countBy("severity", "critical")} icon={ShieldAlert} tone="danger" />
        <StatCard label="High (page)" value={countBy("severity", "high")} icon={ShieldAlert} tone="warning" />
        <StatCard label="Open (page)" value={countBy("status", "open")} hint="Newest 100 findings" />
        <StatCard label="Accepted risk (page)" value={countBy("status", "accepted_risk")} />
      </div>

      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div className="relative xl:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted" aria-hidden="true" />
            <Input aria-label="Search findings" className="pl-9" placeholder="Search title or CVE" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select aria-label="Filter by severity" value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="">All severities</option>
            {SEVERITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {FINDING_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Select aria-label="Filter by asset" value={assetId} onChange={(e) => setAssetId(e.target.value)}>
            <option value="">All assets</option>
            {(assets.data?.items ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
          <Select aria-label="Filter by assigned user" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            <option value="">Any assignee</option>
            {(users.data ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="overflow-hidden xl:col-span-2">
          {list.error && !list.data ? <ErrorState message={list.error} onRetry={list.reload} /> : null}
          {!list.data && list.loading ? <TableSkeleton rows={6} /> : null}
          {list.data && list.data.items.length === 0 ? (
            <EmptyState icon={ShieldAlert} title="No findings match these filters" description="Recorded vulnerabilities and remediation work appear here." />
          ) : null}
          {list.data && list.data.items.length > 0 ? (
            <>
              <DataTable minWidth={880}>
                <thead>
                  <tr>
                    <Th>Finding</Th>
                    <Th>Severity</Th>
                    <Th>Status</Th>
                    <Th>Asset</Th>
                    <Th>Assignee</Th>
                    <Th>Updated</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((f) => (
                    <tr key={f.id} className="hover:bg-surface-2/50">
                      <Td>
                        <button type="button" onClick={() => setDetailId(f.id)} className="text-left font-medium text-sky-500 hover:underline">
                          {f.title}
                        </button>
                        {f.cveId ? <p className="text-xs text-muted">{f.cveId}</p> : null}
                      </Td>
                      <Td>
                        <StatusBadge value={f.severity} />
                      </Td>
                      <Td>
                        <StatusBadge value={f.status} />
                      </Td>
                      <Td className="text-muted">{f.assetName ?? "—"}</Td>
                      <Td className="text-muted">{f.assigneeName ?? "Unassigned"}</Td>
                      <Td className="whitespace-nowrap text-muted">{fmtRelative(f.updatedAt)}</Td>
                      <Td className="text-right">
                        <div className="flex justify-end gap-1">
                          {can("write") ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Edit ${f.title}`}
                              onClick={() => {
                                setEditing(f);
                                setFormOpen(true);
                              }}
                            >
                              <Pencil className="size-4" />
                            </Button>
                          ) : null}
                          {user?.role === "admin" ? (
                            <Button variant="ghost" size="icon" aria-label={`Delete ${f.title}`} onClick={() => setDeleteTarget(f)}>
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
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-fg">Findings by status</h2>
          <DistributionChart
            data={FINDING_STATUS_OPTIONS.map((o) => ({ label: o.label, count: countBy("status", o.value) }))}
            color="#fbbf24"
            height={220}
          />
        </Card>
      </div>

      <FindingFormModal
        open={formOpen}
        finding={editing}
        assets={assets.data?.items ?? []}
        users={users.data ?? []}
        onClose={() => setFormOpen(false)}
        onSaved={() => reloadAll()}
      />
      <FindingDetailModal
        id={detailId}
        onClose={() => setDetailId(null)}
        onChanged={reloadAll}
        onEdit={(f) => {
          setDetailId(null);
          setEditing(f);
          setFormOpen(true);
        }}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete finding?"
        description={`"${deleteTarget?.title ?? ""}" and its remediation history will be deleted.`}
        confirmLabel="Delete"
        busy={busy}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
