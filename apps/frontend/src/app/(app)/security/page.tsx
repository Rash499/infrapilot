"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Loader2, Pencil, Plus, Search, ShieldAlert, Trash2, Upload } from "lucide-react";
import { DistributionChart } from "@/components/charts";
import { Alert, Badge, Button, Card, CardHeader, ConfirmDialog, cn, DataTable, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Pagination, Select, StatCard, StatusBadge, TableSkeleton, Td, Textarea, Th, Toolbar } from "@/components/ui";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/context/toast-context";
import { fetchData, fetchList, getErrorMessage, sendData, validatePayload } from "@/lib/client/api";
import { focusFirstInvalid, serverFieldErrors, validateFields } from "@/lib/client/form";
import { useAsync } from "@/lib/client/use-async";
import { FINDING_STATUS_OPTIONS, SEVERITY_OPTIONS, fmtDateTime, fmtRelative, humanize } from "@/lib/format";
import { findingCreateSchema, findingUpdateSchema } from "@/validators/schemas";
import type { Asset, Finding, SecurityDashboard, TrivyImportResult, UserOption } from "@/types/api";

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
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const { register, handleSubmit, reset, setError, clearErrors, formState: { errors, isSubmitting, isDirty } } = useForm<FindingFormValues>({
    defaultValues: blank(finding),
  });
  useEffect(() => {
    if (open) reset(blank(finding));
  }, [open, finding, reset]);

  const requestClose = () => {
    if (isSubmitting) return;
    if (isDirty) setConfirmDiscard(true);
    else onClose();
  };

  const onSubmit = handleSubmit(async (v) => {
    clearErrors("root");
    const common = {
      title: v.title.trim(),
      description: v.description.trim(),
      severity: v.severity,
      assetId: v.assetId || null,
      assigneeId: v.assigneeId || null,
      remediation: v.remediation.trim() || null,
      cveId: v.cveId.trim() || null,
    };
    const fields = ["title", "description", "severity", "assetId", "assigneeId", "remediation", "cveId"] as const;
    const validation = finding
      ? validateFields(findingUpdateSchema, { ...common, status: v.status, note: v.note.trim() || undefined }, setError, fields)
      : validateFields(findingCreateSchema, common, setError, fields);
    if (!validation.valid) {
      if (validation.formError) setError("root", { message: validation.formError });
      requestAnimationFrame(() => focusFirstInvalid(document.getElementById("finding-form")));
      return;
    }
    try {
      let saved: Finding;
      if (finding) {
        const payload = { ...common, status: v.status, note: v.note.trim() || undefined };
        saved = await sendData<Finding>("patch", `/findings/${finding.id}`, payload);
      } else {
        saved = await sendData<Finding>("post", "/findings", common);
      }
      toast.success(finding ? "Finding updated" : "Finding recorded");
      onSaved(saved);
      onClose();
    } catch (err) {
      const mapped = serverFieldErrors(err, setError, fields);
      if (!mapped.firstField) setError("root", { message: getErrorMessage(err) });
      requestAnimationFrame(() => focusFirstInvalid(document.getElementById("finding-form")));
    }
  });

  return (
    <>
    <Modal
      open={open}
      onClose={requestClose}
      size="lg"
      title={finding ? "Edit security finding" : "Record security finding"}
      description="Findings capture vulnerabilities, misconfigurations and risks against infrastructure assets."
      footer={
        <>
          <Button variant="outline" onClick={requestClose} disabled={isSubmitting}>
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
          <Alert tone="danger" className="sm:col-span-2" title="Could not save this finding">{errors.root.message}</Alert>
        ) : null}
        <Field label="Title *" htmlFor="f-title" error={errors.title?.message} className="sm:col-span-2">
          <Input id="f-title" {...register("title")} maxLength={200} placeholder="Outdated TLS configuration on load balancer" />
        </Field>
        <Field label="Severity *" htmlFor="f-sev" error={errors.severity?.message} hint="Drives the remediation deadline.">
          <Select id="f-sev" {...register("severity")}>
            {SEVERITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="CVE identifier" htmlFor="f-cve" error={errors.cveId?.message} hint="Optional, e.g. CVE-2024-12345">
          <Input id="f-cve" {...register("cveId")} placeholder="CVE-2024-12345" />
        </Field>
        <Field label="Affected asset" htmlFor="f-asset" error={errors.assetId?.message}>
          <Select id="f-asset" {...register("assetId")}>
            <option value="">Not linked</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Responsible user" htmlFor="f-assignee" error={errors.assigneeId?.message}>
          <Select id="f-assignee" {...register("assigneeId")}>
            <option value="">Unassigned</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Description *" htmlFor="f-desc" error={errors.description?.message} className="sm:col-span-2">
          <Textarea id="f-desc" rows={3} {...register("description")} />
        </Field>
        <Field label="Remediation recommendation" htmlFor="f-rem" error={errors.remediation?.message} hint="What the owner should do, and by when." className="sm:col-span-2">
          <Textarea id="f-rem" rows={3} {...register("remediation")} />
        </Field>
        {finding ? (
          <>
            <Field label="Remediation status" htmlFor="f-status" error={errors.status?.message}>
              <Select id="f-status" {...register("status")}>
                {FINDING_STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Update note" htmlFor="f-note" error={errors.note?.message} hint="Required when accepting risk (justification).">
              <Input id="f-note" {...register("note")} />
            </Field>
          </>
        ) : null}
      </form>
    </Modal>

    <ConfirmDialog
      open={confirmDiscard}
      title="Discard this finding?"
      description="The finding has unsaved details. Closing the dialog will discard them."
      confirmLabel="Discard changes"
      onCancel={() => setConfirmDiscard(false)}
      onConfirm={() => {
        setConfirmDiscard(false);
        onClose();
      }}
    />
    </>
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

function TrivyImportModal({
  open,
  onClose,
  onImported,
  assets,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
  assets: Asset[];
}) {
  const toast = useToast();
  const [assetId, setAssetId] = useState("");
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<TrivyImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!open) {
      setAssetId("");
      setFileName("");
      setResult(null);
      setError(null);
      setDragging(false);
    }
  }, [open]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setResult(null);
    if (!assetId) {
      setError("Select the asset this report describes before choosing a file.");
      return;
    }
    if (!/\.json$/i.test(file.name) && file.type !== "application/json") {
      setError(`${file.name} is not a .json report. Export the report with: trivy image --format json -o report.json <image>`);
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError(`${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB. Trivy reports must be 2 MB or smaller.`);
      return;
    }
    if (file.size === 0) {
      setError(`${file.name} is empty.`);
      return;
    }
    setBusy(true);
    setFileName(file.name);
    try {
      const text = await file.text();
      let report: unknown;
      try {
        report = JSON.parse(text);
      } catch {
        throw new Error("The selected file is not valid JSON. Re-export the report and try again.");
      }
      const imported = await sendData<TrivyImportResult>("post", "/security/imports", { assetId, report });
      setResult(imported);
      toast.success(`${imported.findingsCreated} new findings imported`);
      onImported();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import Trivy report"
      description="Upload a Trivy JSON report produced elsewhere (trivy image --format json). InfraPilot parses it; it never executes the file or runs a live scan."
    >
      <div className="space-y-4" aria-busy={busy}>
        <Field label="Asset *" htmlFor="trivy-asset" hint="Findings are attached to this asset and deduplicated by CVE + package">
          <Select id="trivy-asset" value={assetId} onChange={(e) => setAssetId(e.target.value)} disabled={!!result}>
            <option value="">Select an asset</option>
            {assets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Report file (.json)"
          htmlFor="trivy-file"
          error={error ?? undefined}
          hint="JSON produced by `trivy image --format json`. Maximum 2 MB and 1,000 vulnerabilities per import."
        >
          <div
            onDragOver={(event) => {
              if (busy || !assetId || result) return;
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              if (busy || result) return;
              void onFile(event.dataTransfer.files?.[0]);
            }}
            className={cn(
              "rounded-lg border border-dashed p-4 transition-colors",
              dragging ? "border-accent bg-accent-soft" : "border-line-strong bg-surface-2/40",
            )}
          >
            <input
              id="trivy-file"
              type="file"
              accept="application/json,.json"
              disabled={busy || !assetId || !!result}
              onChange={(e) => void onFile(e.target.files?.[0])}
              className="block w-full cursor-pointer text-sm text-fg file:mr-3 file:cursor-pointer file:rounded file:border-0 file:bg-accent-soft file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-accent disabled:cursor-not-allowed disabled:opacity-60"
            />
            <p className="mt-2 text-xs text-muted">Drag a report here, or choose a file. Nothing is executed — the JSON is parsed as data only.</p>
          </div>
        </Field>
        {busy ? (
          <p className="flex items-center gap-2 text-xs text-muted">
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            Parsing {fileName || "report"} and importing findings…
          </p>
        ) : null}
        {result ? (
          <div className="space-y-2 rounded-lg border border-line bg-surface-2/50 p-3 text-xs">
            <p className="text-sm font-medium text-fg">{fileName}</p>
            <p className="text-muted">
              {result.artifactName} · {result.vulnerabilitiesSeen} vulnerabilities seen · scanned {result.scannedAt ? fmtDateTime(result.scannedAt) : "date not reported"}
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div><span className="block text-muted">Created</span><span className="font-semibold text-fg">{result.findingsCreated}</span></div>
              <div><span className="block text-muted">Refreshed</span><span className="font-semibold text-fg">{result.findingsUpdated}</span></div>
              <div><span className="block text-muted">Reopened</span><span className="font-semibold text-fg">{result.findingsReopened}</span></div>
              <div><span className="block text-muted">Skipped</span><span className="font-semibold text-fg">{result.findingsSkipped}</span></div>
            </div>
            <p className="text-muted">
              {result.criticalCount} critical and {result.highCount} high severity. Remediation deadlines follow policy: critical 7 days, high 30 days.
            </p>
            {result.skipped.length > 0 ? (
              <p className="text-muted">Skipped entries: {result.skipped.map((row) => `${row.id} (${row.reason})`).join(", ")}</p>
            ) : null}
            <p className="text-muted">Imported findings reflect the report&apos;s scan, not a live scan performed by InfraPilot.</p>
          </div>
        ) : null}
        {result ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
            <p className="text-xs text-muted">Imported from {fileName}. Re-import to refresh existing findings.</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setResult(null);
                setFileName("");
                setError(null);
              }}
            >
              Import another report
            </Button>
          </div>
        ) : null}
      </div>
    </Modal>
  );
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
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Component</dt>
              <dd className="text-sm text-fg">
                {f.component ? `${f.component}${f.installedVersion ? ` ${f.installedVersion}` : ""}${f.fixedVersion ? ` → ${f.fixedVersion}` : ""}` : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">CVSS / source</dt>
              <dd className="text-sm text-fg">
                {f.cvssScore !== null ? f.cvssScore.toFixed(1) : "—"} · {f.source === "trivy" ? "Trivy import" : "Manual"}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Remediation deadline</dt>
              <dd className="text-sm text-fg">{f.remediationDeadline ? fmtDateTime(f.remediationDeadline) : "—"}</dd>
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
                  <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-accent" aria-hidden="true" />
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
  const [importOpen, setImportOpen] = useState(false);
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
  const dashboard = useAsync(() => fetchData<SecurityDashboard>("/security/dashboard"), []);

  const reloadAll = () => {
    list.reload();
    stats.reload();
    dashboard.reload();
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
        eyebrow="Security"
        title="Security findings"
        description="Vulnerability and risk register. Import Trivy JSON reports or record findings manually; remediation deadlines follow the documented severity policy."
        actions={
          can("write") ? (
            <>
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                <Upload className="size-4" aria-hidden="true" /> Import Trivy report
              </Button>
              <Button
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                <Plus className="size-4" aria-hidden="true" /> Record finding
              </Button>
            </>
          ) : null
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Critical"
          value={countBy("severity", "critical")}
          hint="Loaded findings"
          icon={ShieldAlert}
          tone={countBy("severity", "critical") > 0 ? "danger" : "neutral"}
        />
        <StatCard
          label="High"
          value={countBy("severity", "high")}
          hint="Loaded findings"
          icon={ShieldAlert}
          tone={countBy("severity", "high") > 0 ? "warning" : "neutral"}
        />
        <StatCard label="Open" value={countBy("status", "open")} hint="Awaiting triage" icon={ShieldAlert} />
        <StatCard
          label="Past deadline"
          value={dashboard.data?.overdue ?? 0}
          hint={`${dashboard.data?.dueSoon ?? 0} due within 7 days`}
          tone={(dashboard.data?.overdue ?? 0) > 0 ? "danger" : "neutral"}
        />
      </div>

      <Toolbar>
        <div className="grid w-full gap-3 md:grid-cols-2 xl:grid-cols-5">
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
      </Toolbar>

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
                    <tr key={f.id} className="row-hover">
                      <Td>
                        <button type="button" onClick={() => setDetailId(f.id)} className="text-left font-medium text-accent hover:underline">
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
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Findings by status"
              description="Newest 100 findings in the current filter"
              icon={ShieldAlert}
            />
            <div className="p-3 pt-4">
              <DistributionChart
                data={FINDING_STATUS_OPTIONS.map((o) => ({ label: o.label, count: countBy("status", o.value) }))}
                color="#f59e0b"
                height={190}
                labelWidth={104}
              />
            </div>
          </Card>
          <Card>
            <CardHeader title="Findings by severity" description="Newest 100 findings in the current filter" icon={ShieldAlert} />
            <div className="p-3 pt-4">
              <DistributionChart
                data={SEVERITY_OPTIONS.map((o) => ({ label: o.label, count: countBy("severity", o.value) }))}
                color="#fb7185"
                height={214}
                labelWidth={104}
              />
            </div>
          </Card>
          <Alert tone="info">
            Counts on this page describe the newest 100 findings matching the current filters. Use the filters to narrow
            the register.
          </Alert>
        </div>
      </div>

      <FindingFormModal
        open={formOpen}
        finding={editing}
        assets={assets.data?.items ?? []}
        users={users.data ?? []}
        onClose={() => setFormOpen(false)}
        onSaved={() => reloadAll()}
      />
      <TrivyImportModal open={importOpen} onClose={() => setImportOpen(false)} onImported={reloadAll} assets={assets.data?.items ?? []} />

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
