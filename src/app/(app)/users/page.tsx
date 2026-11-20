"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, Users as UsersIcon } from "lucide-react";
import { Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, ErrorState, Input, PageHeader, Pagination, Select, StatusBadge, TableSkeleton, Td, Th, cn } from "@/components/ui";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/context/toast-context";
import { fetchList, getErrorMessage, sendData } from "@/lib/client/api";
import { useAsync } from "@/lib/client/use-async";
import { ROLE_OPTIONS, fmtDateTime, fmtRelative, humanize } from "@/lib/format";
import type { AuditEntry, SessionUser } from "@/types/api";

type Tab = "users" | "audit";

function UsersTab() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [role, setRole] = useState("");
  const [page, setPage] = useState(1);
  const [pending, setPending] = useState<{ user: SessionUser; action: "deactivate" | "activate" } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debounced, role]);

  const list = useAsync(() => fetchList<SessionUser>("/users", { page, pageSize: 15, search: debounced, role }), [page, debounced, role]);

  const changeRole = async (target: SessionUser, nextRole: string) => {
    try {
      await sendData("patch", `/users/${target.id}`, { role: nextRole });
      toast.success(`${target.name} is now ${humanize(nextRole)}`);
      list.reload();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await sendData("patch", `/users/${pending.user.id}`, { isActive: pending.action === "activate" });
      toast.success(pending.action === "activate" ? "Account reactivated" : "Account deactivated and sessions revoked");
      setPending(null);
      list.reload();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <Input aria-label="Search users" placeholder="Search by name or email" value={search} onChange={(e) => setSearch(e.target.value)} className="md:col-span-2" />
          <Select aria-label="Filter by role" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">All roles</option>
            {ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      </Card>
      <Card className="overflow-hidden">
        {list.error && !list.data ? <ErrorState message={list.error} onRetry={list.reload} /> : null}
        {!list.data && list.loading ? <TableSkeleton rows={5} /> : null}
        {list.data && list.data.items.length === 0 ? <EmptyState icon={UsersIcon} title="No users match these filters" /> : null}
        {list.data && list.data.items.length > 0 ? (
          <>
            <DataTable minWidth={800}>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Email</Th>
                  <Th>Role</Th>
                  <Th>Account</Th>
                  <Th>Last sign-in</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((u) => {
                  const isSelf = u.id === me?.id;
                  return (
                    <tr key={u.id} className="hover:bg-surface-2/50">
                      <Td className="font-medium">
                        {u.name} {isSelf ? <Badge tone="info">You</Badge> : null}
                      </Td>
                      <Td className="text-muted">{u.email}</Td>
                      <Td>
                        <Select aria-label={`Role for ${u.name}`} className="h-8 w-36 text-xs" value={u.role} disabled={isSelf} onChange={(e) => void changeRole(u, e.target.value)}>
                          {ROLE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </Select>
                      </Td>
                      <Td>{u.isActive ? <StatusBadge value="healthy" label="Active" /> : <StatusBadge value="unavailable" label="Deactivated" />}</Td>
                      <Td className="whitespace-nowrap text-muted">{u.lastLoginAt ? fmtRelative(u.lastLoginAt) : "Never"}</Td>
                      <Td className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isSelf}
                          onClick={() => setPending({ user: u, action: u.isActive ? "deactivate" : "activate" })}
                        >
                          {u.isActive ? "Deactivate" : "Reactivate"}
                        </Button>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </DataTable>
            <Pagination meta={list.data.meta} onPageChange={setPage} />
          </>
        ) : null}
      </Card>
      <ConfirmDialog
        open={!!pending}
        title={pending?.action === "activate" ? "Reactivate account?" : "Deactivate account?"}
        description={
          pending?.action === "activate"
            ? `${pending.user.name} will be able to sign in again.`
            : `${pending?.user.name ?? ""} will be signed out everywhere and cannot sign in until reactivated.`
        }
        confirmLabel={pending?.action === "activate" ? "Reactivate" : "Deactivate"}
        tone={pending?.action === "activate" ? "primary" : "danger"}
        busy={busy}
        onConfirm={() => void confirm()}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}

function AuditTab() {
  const [entityType, setEntityType] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => {
    setPage(1);
  }, [entityType]);
  const list = useAsync(() => fetchList<AuditEntry>("/audit", { page, pageSize: 25, entityType }), [page, entityType]);

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <Select aria-label="Filter audit by entity" className="md:w-60" value={entityType} onChange={(e) => setEntityType(e.target.value)}>
          <option value="">All entities</option>
          {["user", "asset", "monitoring_target", "security_finding", "incident", "maintenance", "change_request"].map((e) => (
            <option key={e} value={e}>
              {humanize(e)}
            </option>
          ))}
        </Select>
      </Card>
      <Card className="overflow-hidden">
        {list.error && !list.data ? <ErrorState message={list.error} onRetry={list.reload} /> : null}
        {!list.data && list.loading ? <TableSkeleton rows={6} /> : null}
        {list.data && list.data.items.length === 0 ? <EmptyState icon={ShieldCheck} title="No audit records yet" /> : null}
        {list.data && list.data.items.length > 0 ? (
          <>
            <DataTable minWidth={760}>
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Actor</Th>
                  <Th>Action</Th>
                  <Th>Entity</Th>
                  <Th>Summary</Th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((a) => (
                  <tr key={a.id}>
                    <Td className="whitespace-nowrap text-xs text-muted" title={fmtDateTime(a.createdAt)}>
                      {fmtRelative(a.createdAt)}
                    </Td>
                    <Td>{a.actorName}</Td>
                    <Td>
                      <code className={cn("rounded bg-surface-2 px-1.5 py-0.5 text-xs text-fg")}>{a.action}</code>
                    </Td>
                    <Td className="text-muted">{humanize(a.entityType)}</Td>
                    <Td className="max-w-md text-sm text-fg">{a.summary}</Td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
            <Pagination meta={list.data.meta} onPageChange={setPage} />
          </>
        ) : null}
      </Card>
    </div>
  );
}

export default function UsersPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("users");

  if (user && user.role !== "admin") {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="Administrator access required"
        description="User management and the audit trail are restricted to administrators."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="User management" description="Manage roles and account access, and review the audit trail." />
      <div className="flex gap-2 border-b border-line">
        {(["users", "audit"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className={cn("-mb-px border-b-2 px-3 pb-2 text-sm font-medium", tab === t ? "border-sky-500 text-sky-500" : "border-transparent text-muted hover:text-fg")}
          >
            {t === "users" ? "Users & roles" : "Audit log"}
          </button>
        ))}
      </div>
      {tab === "users" ? <UsersTab /> : <AuditTab />}
      <Card className="p-4 text-sm text-muted">
        <p className="font-medium text-fg">Role permissions</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            <strong className="text-fg">Administrator</strong>: everything, including user management, deleting records and authorising private-network monitoring.
          </li>
          <li>
            <strong className="text-fg">Operator</strong>: create and update assets, checks, findings, incidents, maintenance and changes; approve changes they did not request.
          </li>
          <li>
            <strong className="text-fg">Viewer</strong>: read-only access to all modules.
          </li>
        </ul>
        <Button variant="ghost" size="sm" className="mt-3" onClick={() => setTab("audit")}>
          Review audit log
        </Button>
      </Card>
    </div>
  );
}
