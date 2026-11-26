"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { UserCircle, KeyRound, Palette } from "lucide-react";
import { Alert, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Input, PageHeader, Segmented, Skeleton, StatusBadge } from "@/components/ui";
import { useAuth } from "@/context/auth-context";
import { useTheme } from "@/context/theme-context";
import { useToast } from "@/context/toast-context";
import { fetchData, getErrorMessage, sendData, validatePayload } from "@/lib/client/api";
import { useAsync } from "@/lib/client/use-async";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import { changePasswordSchema, updateProfileSchema } from "@/validators/schemas";
import type { AccountSession, SessionPayload } from "@/types/api";

type PasswordValues = { currentPassword: string; newPassword: string; confirm: string };

export default function SettingsPage() {
  const { user, refreshUser, applySession } = useAuth();
  const { theme, setTheme } = useTheme();
  const toast = useToast();
  const [profileError, setProfileError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [sessionToRevoke, setSessionToRevoke] = useState<AccountSession | null>(null);
  const [revokingSession, setRevokingSession] = useState(false);
  const sessions = useAsync(() => fetchData<AccountSession[]>("/users/me/sessions"), []);

  const profile = useForm<{ name: string }>({ defaultValues: { name: user?.name ?? "" } });
  const password = useForm<PasswordValues>({ defaultValues: { currentPassword: "", newPassword: "", confirm: "" } });
  const { reset: resetProfile } = profile;
  const { reset: resetPassword } = password;

  useEffect(() => {
    if (user) resetProfile({ name: user.name });
  }, [user, resetProfile]);

  const saveProfile = profile.handleSubmit(async (v) => {
    setProfileError(null);
    const payload = { name: v.name.trim() };
    try {
      validatePayload(updateProfileSchema, payload);
      await sendData("patch", "/users/me", payload);
      await refreshUser();
      toast.success("Profile updated");
    } catch (err) {
      setProfileError(getErrorMessage(err));
    }
  });

  const changePw = password.handleSubmit(async (v) => {
    setPasswordError(null);
    if (v.newPassword !== v.confirm) {
      password.setError("confirm", { message: "Passwords do not match" });
      return;
    }
    const payload = { currentPassword: v.currentPassword, newPassword: v.newPassword };
    try {
      validatePayload(changePasswordSchema, payload);
      const session = await sendData<SessionPayload>("post", "/users/me/password", payload);
      applySession(session);
      resetPassword({ currentPassword: "", newPassword: "", confirm: "" });
      toast.success("Password changed. Other sessions were signed out.");
    } catch (err) {
      setPasswordError(getErrorMessage(err));
    }
  });

  const revokeSession = async () => {
    if (!sessionToRevoke) return;
    setRevokingSession(true);
    try {
      await sendData("delete", `/users/me/sessions/${sessionToRevoke.id}`);
      toast.success("Session revoked");
      setSessionToRevoke(null);
      sessions.reload();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setRevokingSession(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Workspace"
        title="Settings"
        description="Manage your profile, password and display preferences."
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
            <UserCircle className="size-4 text-accent" aria-hidden="true" /> Profile
          </h2>
          <form onSubmit={saveProfile} className="mt-4 space-y-4" noValidate>
            {profileError ? <Alert tone="danger">{profileError}</Alert> : null}
            <Field label="Full name" htmlFor="set-name" error={profile.formState.errors.name?.message}>
              <Input id="set-name" {...profile.register("name", { required: "Name is required" })} />
            </Field>
            <Field label="Email" htmlFor="set-email" hint="Contact an administrator to change your sign-in email.">
              <Input id="set-email" value={user?.email ?? ""} readOnly disabled />
            </Field>
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm text-muted">
                Role: <StatusBadge value={user?.role ?? "viewer"} />
              </div>
              <Button type="submit" loading={profile.formState.isSubmitting}>
                Save profile
              </Button>
            </div>
          </form>
          <dl className="mt-6 grid gap-3 border-t border-line pt-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Last sign-in</dt>
              <dd className="text-fg">{fmtDateTime(user?.lastLoginAt)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Account created</dt>
              <dd className="text-fg">{fmtDateTime(user?.createdAt)}</dd>
            </div>
          </dl>
        </Card>

        <Card className="p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
            <KeyRound className="size-4 text-accent" aria-hidden="true" /> Change password
          </h2>
          <form onSubmit={changePw} className="mt-4 space-y-4" noValidate>
            {passwordError ? <Alert tone="danger">{passwordError}</Alert> : null}
            <Field label="Current password" htmlFor="pw-current" error={password.formState.errors.currentPassword?.message}>
              <Input id="pw-current" type="password" autoComplete="current-password" {...password.register("currentPassword", { required: "Enter your current password" })} />
            </Field>
            <Field label="New password" htmlFor="pw-new" hint="At least 12 characters with upper, lower case and a number." error={password.formState.errors.newPassword?.message}>
              <Input id="pw-new" type="password" autoComplete="new-password" {...password.register("newPassword", { required: "Enter a new password" })} />
            </Field>
            <Field label="Confirm new password" htmlFor="pw-confirm" error={password.formState.errors.confirm?.message}>
              <Input id="pw-confirm" type="password" autoComplete="new-password" {...password.register("confirm", { required: "Confirm the new password" })} />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" loading={password.formState.isSubmitting}>
                Update password
              </Button>
            </div>
          </form>
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-fg">Active sessions</h2>
        <p className="mt-1 text-sm text-muted">Review devices signed in to your account. Showing up to 50 active sessions; revoking one signs that device out.</p>
        {sessions.error && !sessions.data ? <ErrorState message={sessions.error} onRetry={sessions.reload} /> : null}
        {!sessions.data && sessions.loading ? (
          <div className="mt-4 space-y-3" aria-busy="true">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : null}
        {sessions.data && sessions.data.length === 0 ? (
          <EmptyState icon={UserCircle} title="No active sessions" description="Your current browser session may have expired." />
        ) : null}
        {sessions.data && sessions.data.length > 0 ? (
          <ul className="mt-4 divide-y divide-line">
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
                  onClick={() => setSessionToRevoke(session)}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      <Card className="p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
          <Palette className="size-4 text-accent" aria-hidden="true" /> Appearance
        </h2>
        <p className="mt-1 text-sm text-muted">Dark theme is the default. Your choice is stored in this browser.</p>
        <div className="mt-4">
          <Segmented
            label="Theme"
            value={theme}
            onChange={setTheme}
            options={[
              { value: "dark", label: "Dark" },
              { value: "light", label: "Light" },
            ]}
          />
        </div>
      </Card>

      <ConfirmDialog
        open={!!sessionToRevoke}
        title="Revoke this session?"
        description="The selected device will need to sign in again. Your current session is not affected."
        confirmLabel="Revoke session"
        tone="danger"
        busy={revokingSession}
        onConfirm={() => void revokeSession()}
        onCancel={() => setSessionToRevoke(null)}
      />
    </div>
  );
}
