"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { GitPullRequest, Pencil, Plus, Search } from "lucide-react";
import { AssetPicker } from "@/components/forms/asset-picker";
import { Alert, Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Pagination, Select, StatusBadge, TableSkeleton, Td, Textarea, Th, Toolbar, type Tone } from "@/components/ui";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/context/toast-context";
import { fetchData, fetchList, getErrorMessage, sendData, validatePayload } from "@/lib/client/api";
import { focusFirstInvalid, serverFieldErrors, validateFields } from "@/lib/client/form";
import { useAsync } from "@/lib/client/use-async";
import { CHANGE_STATUS_OPTIONS, RISK_OPTIONS, fmtDateTime, fmtRelative, fromDatetimeLocal, humanize, toDatetimeLocal } from "@/lib/format";
import { changeCreateSchema, changeTransitionSchema } from "@/validators/schemas";
import type { Change, UserOption } from "@/types/api";

interface ChangeFormValues {
  title: string;
  description: string;
  reason: string;
  riskLevel: string;
  riskAssessment: string;
  rollbackPlan: string;
  plannedStartAt: string;
  plannedEndAt: string;
  implementerId: string;
}

const riskTone: Record<string, Tone> = { low: "success", medium: "warning", high: "danger" };

function blank(c: Change | null): ChangeFormValues {
  return {
    title: c?.title ?? "",
    description: c?.description ?? "",
    reason: c?.reason ?? "",
    riskLevel: c?.riskLevel ?? "low",
    riskAssessment: c?.riskAssessment ?? "",
    rollbackPlan: c?.rollbackPlan ?? "",
    plannedStartAt: toDatetimeLocal(c?.plannedStartAt),
    plannedEndAt: toDatetimeLocal(c?.plannedEndAt),
    implementerId: c?.implementerId ?? "",
  };
}

function ChangeFormModal({
  open,
  onClose,
  onSaved,
  change,
  users,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  change: Change | null;
  users: UserOption[];
}) {
  const toast = useToast();
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const { register, handleSubmit, reset, watch, setError, clearErrors, formState: { errors, isSubmitting, isDirty } } = useForm<ChangeFormValues>({ defaultValues: blank(null) });
  const plannedStart = watch("plannedStartAt");

  const requestClose = () => {
    if (isSubmitting) return;
    if (isDirty || assetIds.length > 0) setConfirmDiscard(true);
    else onClose();
  };

  useEffect(() => {
    if (open) {
      reset(blank(change));
      setAssetIds(change?.assets?.map((a) => a.id) ?? []);
      setFormError(null);
    }
  }, [open, change, reset]);

  const onSubmit = handleSubmit(async (v) => {
    clearErrors("root");
    const payload = {
      title: v.title.trim(),
      description: v.description.trim(),
      reason: v.reason.trim(),
      riskLevel: v.riskLevel,
      riskAssessment: v.riskAssessment.trim() || null,
      rollbackPlan: v.rollbackPlan.trim() || null,
      plannedStartAt: fromDatetimeLocal(v.plannedStartAt),
      plannedEndAt: fromDatetimeLocal(v.plannedEndAt),
      implementerId: v.implementerId || null,
      assetIds,
    };
    const validation = validateFields(changeCreateSchema, payload, setError, [
      "title",
      "description",
      "reason",
      "riskLevel",
      "riskAssessment",
      "rollbackPlan",
      "plannedStartAt",
      "plannedEndAt",
      "implementerId",
    ]);
    if (!validation.valid) {
      if (validation.formError) setFormError(validation.formError);
      requestAnimationFrame(() => focusFirstInvalid(document.getElementById("change-form")));
      return;
    }
    try {
      if (change) await sendData("patch", `/changes/${change.id}`, payload);
      else await sendData("post", "/changes", payload);
      toast.success(change ? "Change request updated" : "Change request drafted");
      onSaved();
      onClose();
    } catch (err) {
      const mapped = serverFieldErrors(err, setError, [
        "title",
        "description",
        "reason",
        "riskLevel",
        "riskAssessment",
        "rollbackPlan",
        "plannedStartAt",
        "plannedEndAt",
        "implementerId",
      ]);
      if (!mapped.firstField) setFormError(getErrorMessage(err));
      requestAnimationFrame(() => focusFirstInvalid(document.getElementById("change-form")));
    }
  });

  return (
    <>
    <Modal
      open={open}
      onClose={requestClose}
      size="lg"
      title={change ? `Edit ${change.reference}` : "New change request"}
      description="Record what changes, why, the risk, and how to roll back. Submit it for approval when ready."
      footer={
        <>
          <Button variant="outline" onClick={requestClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" form="change-form" loading={isSubmitting}>
            {change ? "Save draft" : "Create draft"}
          </Button>
        </>
      }
    >
      <form id="change-form" onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
        {formError ? (
          <Alert tone="danger" className="sm:col-span-2" title="Could not save this change">{formError}</Alert>
        ) : null}
        <Field label="Title *" htmlFor="c-title" error={errors.title?.message} className="sm:col-span-2">
          <Input id="c-title" {...register("title")} maxLength={200} placeholder="Upgrade load balancer TLS policy" />
        </Field>
        <Field label="Change description *" htmlFor="c-desc" error={errors.description?.message} hint="What the change does, step by step." className="sm:col-span-2">
          <Textarea id="c-desc" rows={3} {...register("description")} />
        </Field>
        <Field label="Reason for change *" htmlFor="c-reason" error={errors.reason?.message} hint="The problem this change solves or the risk it removes." className="sm:col-span-2">
          <Textarea id="c-reason" rows={2} {...register("reason")} />
        </Field>
        <Field label="Risk level" htmlFor="c-risk" error={errors.riskLevel?.message} hint="Drives the approval requirement.">
          <Select id="c-risk" {...register("riskLevel")}>
            {RISK_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Implementer" htmlFor="c-impl" error={errors.implementerId?.message}>
          <Select id="c-impl" {...register("implementerId")}>
            <option value="">Not yet assigned</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Planned start" htmlFor="c-start" error={errors.plannedStartAt?.message}>
          <Input id="c-start" type="datetime-local" {...register("plannedStartAt")} />
        </Field>
        <Field label="Planned end" htmlFor="c-end" error={errors.plannedEndAt?.message} hint="Must be after the planned start.">
          <Input id="c-end" type="datetime-local" min={plannedStart} {...register("plannedEndAt")} />
        </Field>
        <Field label="Risk assessment" htmlFor="c-risk-text" error={errors.riskAssessment?.message} hint="Required before submission." className="sm:col-span-2">
          <Textarea id="c-risk-text" rows={2} {...register("riskAssessment")} />
        </Field>
        <Field label="Rollback plan" htmlFor="c-rollback" error={errors.rollbackPlan?.message} hint="Required before submission." className="sm:col-span-2">
          <Textarea id="c-rollback" rows={2} {...register("rollbackPlan")} />
        </Field>
        <Field label="Affected assets" className="sm:col-span-2">
          <AssetPicker value={assetIds} onChange={setAssetIds} idPrefix="chg-asset" />
        </Field>
      </form>
    </Modal>

    <ConfirmDialog
      open={confirmDiscard}
      title="Discard this draft?"
      description="The change request has unsaved details. Closing the dialog will discard them."
      confirmLabel="Discard draft"
      onCancel={() => setConfirmDiscard(false)}
      onConfirm={() => {
        setConfirmDiscard(false);
        onClose();
      }}
    />
    </>
  );
}

function ChangeDetailModal({
  id,
  onClose,
  onEdit,
  onChanged,
}: {
  id: string | null;
  onClose: () => void;
  onEdit: (c: Change) => void;
  onChanged: () => void;
}) {
  const { user, can } = useAuth();
  const toast = useToast();
  const detail = useAsync(() => (id ? fetchData<Change>(`/changes/${id}`) : Promise.resolve(null)), [id]);
  const [comment, setComment] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const c = detail.data;

  const run = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(success);
      setComment("");
      setNotes("");
      detail.reload();
      onChanged();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const isRequester = !!c && c.requesterId === user?.id;
  const canDecide = !!c && c.status === "pending_approval" && !isRequester && can("write");
  const canEdit = !!c && (c.status === "draft" || c.status === "rejected") && (isRequester || user?.role === "admin");
  const canSubmit = canEdit;

  return (
    <Modal
      open={!!id}
      onClose={onClose}
      size="lg"
      title={c ? `${c.reference} · ${c.title}` : "Change request"}
      description={c ? `Requested by ${c.requesterName ?? "unknown"} · ${fmtRelative(c.createdAt)}` : undefined}
      footer={
        c && canEdit ? (
          <Button variant="outline" onClick={() => onEdit(c)}>
            <Pencil className="size-4" aria-hidden="true" /> Edit draft
          </Button>
        ) : null
      }
    >
      {detail.error ? <ErrorState message={detail.error} onRetry={detail.reload} /> : null}
      {!c && detail.loading ? <TableSkeleton rows={4} /> : null}
      {c ? (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge value={c.status} />
            <Badge tone={riskTone[c.riskLevel]}>Risk: {humanize(c.riskLevel)}</Badge>
            <Badge>
              Approvals {c.approvalsCount}/{c.approvalsRequired ?? 1}
            </Badge>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Section title="Description" text={c.description} />
            <Section title="Reason" text={c.reason} />
            <Section title="Risk assessment" text={c.riskAssessment} />
            <Section title="Rollback plan" text={c.rollbackPlan} />
            <Section title="Planned window" text={`${fmtDateTime(c.plannedStartAt)} → ${fmtDateTime(c.plannedEndAt)}`} />
            <Section title="Implementer" text={c.implementerName ?? "Not assigned"} />
            <Section title="Affected assets" text={(c.assets ?? []).map((a) => a.name).join(", ") || "None linked"} />
            {c.implementedAt ? <Section title="Implemented" text={fmtDateTime(c.implementedAt)} /> : null}
            {c.implementationNotes ? <Section title="Implementation notes" text={c.implementationNotes} /> : null}
            {c.rollbackNotes ? <Section title="Rollback notes" text={c.rollbackNotes} /> : null}
          </div>

          {canSubmit && c.status !== "pending_approval" ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-canvas p-4">
              <p className="text-sm text-muted">Submission requires a risk assessment and rollback plan. Approvers are notified.</p>
              <Button loading={busy} onClick={() => void run(() => sendData("post", `/changes/${c.id}/submit`), "Submitted for approval")}>
                Submit for approval
              </Button>
            </div>
          ) : null}

          {canDecide ? (
            <div className="space-y-3 rounded-lg border border-line bg-canvas p-4">
              <h3 className="text-sm font-semibold text-fg">Approval decision</h3>
              <Textarea aria-label="Decision comment" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Comment (required when rejecting)" />
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="danger"
                  disabled={!comment.trim()}
                  loading={busy}
                  onClick={() => void run(() => sendData("post", `/changes/${c.id}/approvals`, { decision: "rejected", comment: comment.trim() }), "Change rejected")}
                >
                  Reject
                </Button>
                <Button loading={busy} onClick={() => void run(() => sendData("post", `/changes/${c.id}/approvals`, { decision: "approved", comment: comment.trim() || null }), "Change approved")}>
                  Approve
                </Button>
              </div>
            </div>
          ) : null}

          {can("write") && c.status === "approved" ? (
            <div className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-canvas p-4">
              <Field label="Implementation notes" htmlFor="impl-notes" className="flex-1">
                <Input id="impl-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What was done, timing, verification" />
              </Field>
              <Button loading={busy} onClick={() => void run(() => sendData("post", `/changes/${c.id}/transitions`, transitionPayload("implement", notes)), "Marked as implemented")}>
                Mark implemented
              </Button>
            </div>
          ) : null}

          {can("write") && c.status === "implemented" ? (
            <div className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-canvas p-4">
              <Field label="Rollback notes (required)" htmlFor="rb-notes" className="flex-1">
                <Input id="rb-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What was reverted and why" />
              </Field>
              <Button variant="outline" disabled={!notes.trim()} loading={busy} onClick={() => void run(() => sendData("post", `/changes/${c.id}/transitions`, transitionPayload("rollback", notes)), "Rollback recorded")}>
                Record rollback
              </Button>
            </div>
          ) : null}

          {can("write") && ["draft", "pending_approval", "approved", "rejected"].includes(c.status) ? (
            <div className="flex justify-end">
              <Button variant="ghost" className="text-rose-500" loading={busy} onClick={() => void run(() => sendData("post", `/changes/${c.id}/transitions`, transitionPayload("cancel", null)), "Change cancelled")}>
                Cancel change
              </Button>
            </div>
          ) : null}

          <div>
            <h3 className="mb-2 text-sm font-semibold text-fg">Approval history</h3>
            {(c.approvals ?? []).length === 0 ? (
              <p className="text-sm text-muted">No decisions recorded yet.</p>
            ) : (
              <ul className="space-y-2">
                {(c.approvals ?? []).map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line px-3 py-2 text-sm">
                    <span className="text-fg">
                      <StatusBadge value={a.decision} /> {a.approverName}
                      {a.comment ? <span className="text-muted"> — {a.comment}</span> : null}
                    </span>
                    <span className="text-xs text-muted">{fmtDateTime(a.decidedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {comment && !canDecide ? <Alert tone="info">Decisions can only be recorded by an approver other than the requester.</Alert> : null}
        </div>
      ) : null}
    </Modal>
  );
}

function transitionPayload(action: "implement" | "rollback" | "cancel", notes: string | null) {
  const payload = { action, notes: notes && notes.trim() ? notes.trim() : null };
  validatePayload(changeTransitionSchema, payload);
  return payload;
}

function Section({ title, text }: { title: string; text: string | null }) {
  return (
    <div>
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted">{title}</h3>
      <p className="mt-1 whitespace-pre-line text-sm text-fg">{text || "—"}</p>
    </div>
  );
}

export default function ChangesPage() {
  const { can } = useAuth();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState("");
  const [riskLevel, setRiskLevel] = useState("");
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Change | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("change");
    if (id) setDetailId(id);
  }, []);

  useEffect(() => {
    setPage(1);
  }, [debounced, status, riskLevel]);

  const list = useAsync(
    () => fetchList<Change>("/changes", { page, pageSize: 15, search: debounced, status, riskLevel, sort: "createdAt", order: "desc" }),
    [page, debounced, status, riskLevel],
  );
  const users = useAsync(() => fetchData<UserOption[]>("/users/options"), []);

  const reload = () => list.reload();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations"
        title="Change management"
        description="Request, assess, approve, implement and roll back infrastructure changes with a full audit trail."
        actions={
          can("write") ? (
            <Button
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus className="size-4" aria-hidden="true" /> New change request
            </Button>
          ) : null
        }
      />

      <Toolbar>
        <div className="grid w-full gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="relative xl:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted" aria-hidden="true" />
            <Input aria-label="Search changes" className="pl-9" placeholder="Search by title" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {CHANGE_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Select aria-label="Filter by risk" value={riskLevel} onChange={(e) => setRiskLevel(e.target.value)}>
            <option value="">All risk levels</option>
            {RISK_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      </Toolbar>

      <Card className="overflow-hidden">
        {list.error && !list.data ? <ErrorState message={list.error} onRetry={reload} /> : null}
        {!list.data && list.loading ? <TableSkeleton rows={5} /> : null}
        {list.data && list.data.items.length === 0 ? (
          <EmptyState
            icon={GitPullRequest}
            title="No change requests match these filters"
            description="Draft a change to start the approval workflow."
          />
        ) : null}
        {list.data && list.data.items.length > 0 ? (
          <>
            <DataTable minWidth={900}>
              <thead>
                <tr>
                  <Th>Reference</Th>
                  <Th>Change</Th>
                  <Th>Risk</Th>
                  <Th>Status</Th>
                  <Th>Approvals</Th>
                  <Th>Requester</Th>
                  <Th>Updated</Th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((c) => (
                  <tr key={c.id} className="cursor-pointer row-hover" onClick={() => setDetailId(c.id)}>
                    <Td className="whitespace-nowrap font-mono text-xs text-muted">{c.reference}</Td>
                    <Td>
                      <button type="button" onClick={(e) => { e.stopPropagation(); setDetailId(c.id); }} className="text-left font-medium text-accent hover:underline">
                        {c.title}
                      </button>
                    </Td>
                    <Td>
                      <Badge tone={riskTone[c.riskLevel]}>{humanize(c.riskLevel)}</Badge>
                    </Td>
                    <Td>
                      <StatusBadge value={c.status} />
                    </Td>
                    <Td className="tabular-nums text-muted">
                      {c.approvalsCount}/{Number(list.data?.meta.approvalsRequired ?? 1)}
                    </Td>
                    <Td className="text-muted">{c.requesterName ?? "—"}</Td>
                    <Td className="whitespace-nowrap text-muted">{fmtRelative(c.updatedAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
            <Pagination meta={list.data.meta} onPageChange={setPage} />
          </>
        ) : null}
      </Card>

      <ChangeFormModal open={formOpen} change={editing} users={users.data ?? []} onClose={() => setFormOpen(false)} onSaved={reload} />
      <ChangeDetailModal
        id={detailId}
        onClose={() => setDetailId(null)}
        onChanged={reload}
        onEdit={(c) => {
          setDetailId(null);
          setEditing(c);
          setFormOpen(true);
        }}
      />
    </div>
  );
}
