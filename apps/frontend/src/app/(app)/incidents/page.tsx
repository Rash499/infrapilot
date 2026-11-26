"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Plus, Search, Siren } from "lucide-react";
import { AssetPicker } from "@/components/forms/asset-picker";
import { Button, Card, DataTable, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Pagination, Select, StatCard, StatusBadge, TableSkeleton, Td, Textarea, Th } from "@/components/ui";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/context/toast-context";
import { fetchData, fetchList, getErrorMessage, sendData, validatePayload } from "@/lib/client/api";
import { useAsync } from "@/lib/client/use-async";
import { INCIDENT_SEVERITY_OPTIONS, INCIDENT_STATUS_OPTIONS, PRIORITY_OPTIONS, fmtDateTime, fmtRelative } from "@/lib/format";
import { incidentCreateSchema } from "@/validators/schemas";
import type { Incident, UserOption } from "@/types/api";

interface IncidentFormValues {
  title: string;
  description: string;
  severity: string;
  priority: string;
  assigneeId: string;
}

export default function IncidentsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState("");
  const [severity, setSeverity] = useState("");
  const [priority, setPriority] = useState("");
  const [active, setActive] = useState("");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<IncidentFormValues>({
    defaultValues: { title: "", description: "", severity: "high", priority: "p2", assigneeId: "" },
  });

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debounced, status, severity, priority, active]);

  const list = useAsync(
    () => fetchList<Incident>("/incidents", { page, pageSize: 15, search: debounced, status, severity, priority, active, sort: "openedAt", order: "desc" }),
    [page, debounced, status, severity, priority, active],
  );
  const stats = useAsync(() => fetchData<{ activeCount: number; total: number; meanTimeToResolveHours: number | null }>("/incidents/stats", { days: 90 }), []);
  const users = useAsync(() => fetchData<UserOption[]>("/users/options"), []);

  const onCreate = handleSubmit(async (v) => {
    setFormError(null);
    const payload = {
      title: v.title.trim(),
      description: v.description.trim(),
      severity: v.severity,
      priority: v.priority,
      assigneeId: v.assigneeId || null,
      assetIds,
    };
    try {
      validatePayload(incidentCreateSchema, payload);
      const created = await sendData<Incident>("post", "/incidents", payload);
      toast.success(`${created.reference} opened`);
      setCreateOpen(false);
      reset();
      setAssetIds([]);
      list.reload();
      stats.reload();
    } catch (err) {
      setFormError(getErrorMessage(err));
    }
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Incidents"
        description="Track service disruptions from detection through root-cause analysis and resolution."
        actions={
          can("write") ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" aria-hidden="true" /> Open incident
            </Button>
          ) : null
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatCard label="Active incidents" value={stats.data?.activeCount ?? "—"} icon={Siren} tone={(stats.data?.activeCount ?? 0) > 0 ? "warning" : "neutral"} />
        <StatCard label="Opened (90 days)" value={stats.data?.total ?? "—"} />
        <StatCard
          label="Mean time to resolve"
          value={stats.data?.meanTimeToResolveHours != null ? `${stats.data.meanTimeToResolveHours} h` : "—"}
          hint="Resolved incidents, last 90 days"
        />
      </div>

      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div className="relative xl:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted" aria-hidden="true" />
            <Input aria-label="Search incidents" className="pl-9" placeholder="Search by title" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {INCIDENT_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Select aria-label="Filter by severity" value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="">All severities</option>
            {INCIDENT_SEVERITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Select aria-label="Filter by priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="">All priorities</option>
            {PRIORITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {[
            ["", "All"],
            ["true", "Active"],
            ["false", "Closed"],
          ].map(([value, label]) => (
            <Button key={label} size="sm" variant={active === value ? "primary" : "outline"} onClick={() => setActive(value)}>
              {label}
            </Button>
          ))}
        </div>
      </Card>

      <Card className="overflow-hidden">
        {list.error && !list.data ? <ErrorState message={list.error} onRetry={list.reload} /> : null}
        {!list.data && list.loading ? <TableSkeleton rows={6} /> : null}
        {list.data && list.data.items.length === 0 ? (
          <EmptyState
            icon={Siren}
            title="No incidents match these filters"
            description="Open an incident to start a timeline, assign an owner and record the resolution."
          />
        ) : null}
        {list.data && list.data.items.length > 0 ? (
          <>
            <DataTable minWidth={900}>
              <thead>
                <tr>
                  <Th>Reference</Th>
                  <Th>Title</Th>
                  <Th>Severity</Th>
                  <Th>Priority</Th>
                  <Th>Status</Th>
                  <Th>Assignee</Th>
                  <Th>Opened</Th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((i) => (
                  <tr key={i.id} className="hover:bg-surface-2/50">
                    <Td className="whitespace-nowrap font-mono text-xs text-muted">{i.reference}</Td>
                    <Td>
                      <Link href={`/incidents/${i.id}`} className="font-medium text-sky-500 hover:underline">
                        {i.title}
                      </Link>
                      <p className="text-xs text-muted">Updated {fmtRelative(i.updatedAt)}</p>
                    </Td>
                    <Td>
                      <StatusBadge value={i.severity} />
                    </Td>
                    <Td>
                      <StatusBadge value={i.priority} />
                    </Td>
                    <Td>
                      <StatusBadge value={i.status} />
                    </Td>
                    <Td className="text-muted">{i.assigneeName ?? "Unassigned"}</Td>
                    <Td className="whitespace-nowrap text-muted">{fmtDateTime(i.openedAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
            <Pagination meta={list.data.meta} onPageChange={setPage} />
          </>
        ) : null}
      </Card>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        size="lg"
        title="Open incident"
        description="Describe the impact, set severity and priority, and link the affected assets."
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" form="incident-form" loading={isSubmitting}>
              Open incident
            </Button>
          </>
        }
      >
        <form id="incident-form" onSubmit={onCreate} className="grid gap-4 sm:grid-cols-2" noValidate>
          {formError ? (
            <p role="alert" className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-500 sm:col-span-2">
              {formError}
            </p>
          ) : null}
          <Field label="Title *" htmlFor="i-title" error={errors.title?.message} className="sm:col-span-2">
            <Input id="i-title" {...register("title", { required: "Title is required" })} placeholder="Checkout API returning 503s" />
          </Field>
          <Field label="Severity" htmlFor="i-sev">
            <Select id="i-sev" {...register("severity")}>
              {INCIDENT_SEVERITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Priority" htmlFor="i-pri">
            <Select id="i-pri" {...register("priority")}>
              {PRIORITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Assignee" htmlFor="i-assignee">
            <Select id="i-assignee" {...register("assigneeId")}>
              <option value="">Unassigned</option>
              {(users.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Affected assets" className="sm:col-span-2">
            <AssetPicker value={assetIds} onChange={setAssetIds} idPrefix="inc-asset" />
          </Field>
          <Field label="Description *" htmlFor="i-desc" error={errors.description?.message} className="sm:col-span-2">
            <Textarea id="i-desc" rows={4} {...register("description", { required: "Description is required" })} placeholder="Symptoms, customer impact and what has been tried so far." />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
