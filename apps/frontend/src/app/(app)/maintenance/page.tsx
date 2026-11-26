"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { CalendarClock, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { AssetPicker } from "@/components/forms/asset-picker";
import { Alert, Button, Card, ConfirmDialog, DataTable, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Pagination, Select, StatusBadge, TableSkeleton, Td, Textarea, Th, Toolbar } from "@/components/ui";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/context/toast-context";
import { fetchData, fetchList, getErrorMessage, sendData, validatePayload } from "@/lib/client/api";
import { useAsync } from "@/lib/client/use-async";
import { MAINTENANCE_STATUS_OPTIONS, fmtDateTime, fromDatetimeLocal, toDatetimeLocal } from "@/lib/format";
import { maintenanceCreateSchema } from "@/validators/schemas";
import type { Maintenance, UserOption } from "@/types/api";

interface MaintenanceFormValues {
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  ownerId: string;
  notes: string;
}

function blank(m: Maintenance | null): MaintenanceFormValues {
  const start = m ? toDatetimeLocal(m.startsAt) : toDatetimeLocal(new Date(Date.now() + 86_400_000).toISOString());
  const end = m ? toDatetimeLocal(m.endsAt) : toDatetimeLocal(new Date(Date.now() + 90_000_000).toISOString());
  return {
    title: m?.title ?? "",
    description: m?.description ?? "",
    startsAt: start,
    endsAt: end,
    ownerId: m?.ownerId ?? "",
    notes: m?.notes ?? "",
  };
}

const NEXT_ACTIONS: Record<string, Array<{ status: string; label: string }>> = {
  scheduled: [
    { status: "in_progress", label: "Start" },
    { status: "cancelled", label: "Cancel" },
  ],
  in_progress: [
    { status: "completed", label: "Complete" },
    { status: "cancelled", label: "Cancel" },
  ],
};

export default function MaintenancePage() {
  const { can, user } = useAuth();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Maintenance | null>(null);
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Maintenance | null>(null);
  const [busy, setBusy] = useState(false);

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<MaintenanceFormValues>({ defaultValues: blank(null) });

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debounced, status]);

  const list = useAsync(
    () => fetchList<Maintenance>("/maintenance", { page, pageSize: 15, search: debounced, status, sort: "startsAt", order: "asc" }),
    [page, debounced, status],
  );
  const users = useAsync(() => fetchData<UserOption[]>("/users/options"), []);

  const openForm = (m: Maintenance | null) => {
    setEditing(m);
    setAssetIds(m ? m.assets.map((a) => a.id) : []);
    setFormError(null);
    reset(blank(m));
    setFormOpen(true);
  };

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    const payload = {
      title: v.title.trim(),
      description: v.description.trim(),
      startsAt: fromDatetimeLocal(v.startsAt),
      endsAt: fromDatetimeLocal(v.endsAt),
      ownerId: v.ownerId || null,
      notes: v.notes.trim() || null,
      assetIds,
    };
    try {
      validatePayload(maintenanceCreateSchema, payload);
      const saved = editing
        ? await sendData<Maintenance>("patch", `/maintenance/${editing.id}`, payload)
        : await sendData<Maintenance>("post", "/maintenance", payload);
      const conflicts = saved.conflicts?.length ?? 0;
      toast.success(editing ? "Maintenance updated" : "Maintenance scheduled");
      if (conflicts > 0) toast.info(`${conflicts} overlapping maintenance window(s) affect the same assets.`);
      setFormOpen(false);
      list.reload();
    } catch (err) {
      setFormError(getErrorMessage(err));
    }
  });

  const transition = async (m: Maintenance, next: string) => {
    try {
      await sendData("patch", `/maintenance/${m.id}`, { status: next });
      toast.success(`Maintenance ${next === "in_progress" ? "started" : next === "completed" ? "completed" : "cancelled"}`);
      list.reload();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await sendData("delete", `/maintenance/${deleteTarget.id}`);
      toast.success("Maintenance deleted");
      setDeleteTarget(null);
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
        eyebrow="Operations"
        title="Maintenance"
        description="Plan maintenance windows, the assets they touch, and the people responsible."
        actions={
          can("write") ? (
            <Button onClick={() => openForm(null)}>
              <Plus className="size-4" aria-hidden="true" /> Schedule maintenance
            </Button>
          ) : null
        }
      />

      <Toolbar>
        <div className="grid w-full gap-3 md:grid-cols-3">
          <div className="relative md:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted" aria-hidden="true" />
            <Input aria-label="Search maintenance" className="pl-9" placeholder="Search by title" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {MAINTENANCE_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      </Toolbar>

      <Card className="overflow-hidden">
        {list.error && !list.data ? <ErrorState message={list.error} onRetry={list.reload} /> : null}
        {!list.data && list.loading ? <TableSkeleton rows={5} /> : null}
        {list.data && list.data.items.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="No maintenance scheduled"
            description="Schedule a window to notify owners and warn about overlapping work."
            action={can("write") ? <Button onClick={() => openForm(null)}>Schedule maintenance</Button> : null}
          />
        ) : null}
        {list.data && list.data.items.length > 0 ? (
          <>
            <DataTable minWidth={900}>
              <thead>
                <tr>
                  <Th>Maintenance</Th>
                  <Th>Window</Th>
                  <Th>Status</Th>
                  <Th>Owner</Th>
                  <Th>Assets</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((m) => (
                  <tr key={m.id} className="row-hover">
                    <Td>
                      <p className="font-medium text-fg">{m.title}</p>
                      <p className="line-clamp-1 max-w-sm text-xs text-muted">{m.description}</p>
                    </Td>
                    <Td className="whitespace-nowrap text-muted">
                      {fmtDateTime(m.startsAt)}
                      <br />→ {fmtDateTime(m.endsAt)}
                    </Td>
                    <Td>
                      <StatusBadge value={m.status} />
                    </Td>
                    <Td className="text-muted">{m.ownerName ?? "Unassigned"}</Td>
                    <Td className="max-w-[200px] truncate text-muted">{m.assets.map((a) => a.name).join(", ") || "—"}</Td>
                    <Td className="text-right">
                      <div className="flex flex-wrap justify-end gap-1">
                        {can("write") ? (NEXT_ACTIONS[m.status] ?? []).map((action) => (
                          <Button key={action.status} size="sm" variant={action.status === "cancelled" ? "outline" : "secondary"} onClick={() => void transition(m, action.status)}>
                            {action.label}
                          </Button>
                        )) : null}
                        {can("write") && m.status !== "completed" && m.status !== "cancelled" ? (
                          <Button variant="ghost" size="icon" aria-label={`Edit ${m.title}`} onClick={() => openForm(m)}>
                            <Pencil className="size-4" />
                          </Button>
                        ) : null}
                        {user?.role === "admin" ? (
                          <Button variant="ghost" size="icon" aria-label={`Delete ${m.title}`} onClick={() => setDeleteTarget(m)}>
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

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        size="lg"
        title={editing ? "Edit maintenance" : "Schedule maintenance"}
        description="Maintenance windows notify the owner and remind operators 24 hours before the start."
        footer={
          <>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" form="maintenance-form" loading={isSubmitting}>
              {editing ? "Save" : "Schedule"}
            </Button>
          </>
        }
      >
        <form id="maintenance-form" onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
          {formError ? (
            <Alert tone="danger" className="sm:col-span-2">{formError}</Alert>
          ) : null}
          <Field label="Title *" htmlFor="mt-title" error={errors.title?.message} className="sm:col-span-2">
            <Input id="mt-title" {...register("title", { required: "Title is required" })} placeholder="Database minor version upgrade" />
          </Field>
          <Field label="Starts *" htmlFor="mt-start">
            <Input id="mt-start" type="datetime-local" {...register("startsAt", { required: true })} />
          </Field>
          <Field label="Ends *" htmlFor="mt-end">
            <Input id="mt-end" type="datetime-local" {...register("endsAt", { required: true })} />
          </Field>
          <Field label="Responsible user" htmlFor="mt-owner">
            <Select id="mt-owner" {...register("ownerId")}>
              <option value="">Unassigned</option>
              {(users.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Affected assets" className="sm:col-span-2">
            <AssetPicker value={assetIds} onChange={setAssetIds} idPrefix="mt-asset" />
          </Field>
          <Field label="Description *" htmlFor="mt-desc" error={errors.description?.message} className="sm:col-span-2">
            <Textarea id="mt-desc" rows={3} {...register("description", { required: "Description is required" })} />
          </Field>
          <Field label="Notes" htmlFor="mt-notes" className="sm:col-span-2">
            <Textarea id="mt-notes" rows={2} {...register("notes")} />
          </Field>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete maintenance?"
        description={`"${deleteTarget?.title ?? ""}" will be removed from the schedule.`}
        confirmLabel="Delete"
        busy={busy}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
