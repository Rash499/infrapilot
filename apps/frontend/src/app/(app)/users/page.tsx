"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, Users as UsersIcon } from "lucide-react";
import { Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, ErrorState, Input, Modal, PageHeader, Pagination, Select, Skeleton, StatusBadge, TableSkeleton, Td, Th, cn } from "@/components/ui";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/context/toast-context";
import { fetchData, fetchList, getErrorMessage, sendData } from "@/lib/client/api";
import { useAsync } from "@/lib/client/use-async";
import { PERMISSIONS, PERMISSION_LEVELS } from "@/lib/permissions";
import { ROLE_OPTIONS, fmtDateTime, fmtRelative, humanize } from "@/lib/format";
import type { AccountSession, AuditEntry, LoginHistoryEntry, SessionUser } from "@/types/api";

type Tab = "users" | "audit";

function UsersTab() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [role, setRole] = useState("");
  const [page, setPage] = useState(1);
  const [pending, setPending] = useState<{ user: SessionUser; action: "deactivate" | "activate" } | null>(null);
  const [sessionsFor, setSessionsFor] = useState<SessionUser | null>(null);
  const [historyFor, setHistoryFor] = useState<SessionUser | null>(null);
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
            <DataTable minWidth={920}>
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
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" size="sm" onClick={() => setSessionsFor(u)} aria-label={`View sessions for ${u.name}`}>
                            Sessions
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => setHistoryFor(u)} aria-label={`View sign-in history for ${u.name}`}>
                            Sign-in history
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isSelf}
                            onClick={() => setPending({ user: u, action: u.isActive ? "deactivate" : "activate" })}
                          >
                            {u.isActive ? "Deactivate" : "Reactivate"}
                          </Button>
                        </div>
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
      <SessionInventoryDialog user={sessionsFor} onClose={() => setSessionsFor(null)} />
      <LoginHistoryDialog key={historyFor?.id ?? "none"} user={historyFor} onClose={() => setHistoryFor(null)} />
    </div>
  );
}

function SessionInventoryDialog({ user, onClose }: { user: SessionUser | null; onClose: () => void }) {
  const toast = useToast();
  const [pending, setPending] = useState<AccountSession | null>(null);
  const [busy, setBusy] = useState(false);
  const sessions = useAsync(
    () => (user ? fetchData<AccountSession[]>(`/users/${user.id}/sessions`) : Promise.resolve([])),
    [user?.id],
  );

  const revoke = async () => {
    if (!user || !pending) return;
    setBusy(true);
    try {
      await sendData("delete", `/users/${user.id}/sessions/${pending.id}`);
      toast.success("Session revoked");
      setPending(null);
      sessions.reload();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal
        open={!!user}
        onClose={onClose}
        title={user ? `Sessions for ${user.name}` : "Account sessions"}
        description={user?.email}
        footer={<Button variant="outline" onClick={onClose}>Close</Button>}
      >
        {sessions.error && !sessions.data ? <ErrorState message={sessions.error} onRetry={sessions.reload} /> : null}
        {!sessions.data && sessions.loading ? (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : null}
        {sessions.data && sessions.data.length === 0 ? (
          <EmptyState title="No active sessions" description="This account has no unexpired sessions." />
        ) : null}
        {sessions.data && sessions.data.length > 0 ? (
          <ul className="divide-y divide-line">
            {sessions.data.map((session) => (
              <li key={session.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-fg">{session.userAgent ?? "Unknown device"}</p>
                  <p className="text-xs text-muted">
                    {session.ipAddress ?? "Unknown IP"} · Last refreshed {fmtRelative(session.createdAt)} · Expires {fmtDateTime(session.expiresAt)}
                  </p>
                </div>
                {session.current ? <StatusBadge value="healthy" label="Current session" /> : null}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={session.current}
                  aria-label={`Revoke session ${session.userAgent ?? session.id}`}
                  onClick={() => setPending(session)}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </Modal>
      <ConfirmDialog
        open={!!pending}
        title="Revoke this session?"
        description={`${user?.name ?? "This user"} will need to sign in again on the selected device.`}
        confirmLabel="Revoke session"
        tone="danger"
        busy={busy}
        onConfirm={() => void revoke()}
        onCancel={() => setPending(null)}
      />
    </>
  );
}

function LoginHistoryDialog({ user, onClose }: { user: SessionUser | null; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const history = useAsync(
    () =>
      user
        ? fetchList<LoginHistoryEntry>(`/users/${user.id}/login-history`, { page, pageSize: 10 })
        : Promise.resolve({ items: [], meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 } }),
    [user?.id, page],
  );

  return (
    <Modal
      open={!!user}
      onClose={onClose}
      title={user ? `Sign-in history for ${user.name}` : "Sign-in history"}
      description={user?.email}
      footer={<Button variant="outline" onClick={onClose}>Close</Button>}
    >
      {history.error && !history.data ? <ErrorState message={history.error} onRetry={history.reload} /> : null}
      {!history.data && history.loading ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : null}
      {history.data && history.data.items.length === 0 ? (
        <EmptyState title="No sign-in history" description="Successful and failed attempts for this account will appear here." />
      ) : null}
      {history.data && history.data.items.length > 0 ? (
        <>
          <ul className="divide-y divide-line">
            {history.data.items.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg">
                    {entry.action === "auth.login" ? "Successful sign-in" : "Failed sign-in"}
                  </p>
                  <p className="text-xs text-muted">
                    {entry.ipAddress ?? "Unknown IP"} · {entry.userAgent ?? "Unknown device"} · {fmtRelative(entry.createdAt)}
                  </p>
                </div>
                <span className="whitespace-nowrap text-xs text-muted" title={fmtDateTime(entry.createdAt)}>
                  {fmtDateTime(entry.createdAt)}
                </span>
              </li>
            ))}
          </ul>
          <Pagination meta={history.data.meta} onPageChange={setPage} />
        </>
      ) : null}
    </Modal>
  );
}

function AuditTab() {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [entityType, setEntityType] = useState("");
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    setPage(1);
  }, [debounced, entityType, action]);
  const list = useAsync(
    () => fetchList<AuditEntry>("/audit", { page, pageSize: 25, entityType, action, search: debounced }),
    [page, debounced, entityType, action],
  );

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <Input aria-label="Search audit log" placeholder="Search summary, action, or entity ID" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select aria-label="Filter audit by entity" value={entityType} onChange={(e) => setEntityType(e.target.value)}>
            <option value="">All entities</option>
            {["user", "asset", "monitoring_target", "security_finding", "incident", "maintenance", "change_request"].map((e) => (
              <option key={e} value={e}>
                {humanize(e)}
              </option>
            ))}
          </Select>
          <Select aria-label="Filter audit by action" value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">All actions</option>
            {["auth.login", "auth.login_failed", "user.session_revoked", "asset.created", "monitoring_target.created", "incident.created", "security_finding.created"].map((value) => (
              <option key={value} value={value}>{humanize(value)}</option>
            ))}
          </Select>
        </div>
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
      <Card className="overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-fg">Role permission matrix</h2>
          <p className="mt-1 text-xs text-muted">Minimum API access enforced by the server. Individual operations may apply additional checks.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm" aria-label="Role permission matrix">
            <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted">
              <tr>
                <th scope="col" className="px-4 py-3">Access level</th>
                {ROLE_OPTIONS.map((role) => (
                  <th key={role.value} scope="col" className="px-4 py-3 text-center">{role.label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {PERMISSION_LEVELS.map((level) => (
                <tr key={level}>
                  <th scope="row" className="px-4 py-3 font-medium text-fg">{humanize(level)}</th>
                  {ROLE_OPTIONS.map((role) => {
                    const granted = PERMISSIONS[level].some((allowedRole) => allowedRole === role.value);
                    return (
                      <td
                        key={role.value}
                        className={`px-4 py-3 text-center ${granted ? "font-medium text-emerald-500" : "text-muted"}`}
                        aria-label={`${role.label} ${level}: ${granted ? "granted" : "not granted"}`}
                      >
                        {granted ? "Granted" : "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-line px-4 py-2">
          <Button variant="ghost" size="sm" onClick={() => setTab("audit")}>
            Review audit log
          </Button>
        </div>
      </Card>
    </div>
  );
}
