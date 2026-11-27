"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, KeyRound, MailCheck } from "lucide-react";
import { getErrorMessage, sendData } from "@/lib/client/api";
import { Alert, Button, Card, Field, Input, PasswordInput, PasswordRequirements } from "@/components/ui";
import { forgotPasswordSchema, resetPasswordSchema } from "@/validators/schemas";

type EmailValues = { email: string };
type ResetValues = { password: string; confirm: string };

export default function ForgotPasswordPage() {
  const [token, setToken] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [devToken, setDevToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token"));
  }, []);

  const requestForm = useForm<EmailValues>({
    resolver: zodResolver(forgotPasswordSchema) as unknown as Resolver<EmailValues>,
    defaultValues: { email: "" },
  });
  const resetForm = useForm<ResetValues>({ defaultValues: { password: "", confirm: "" } });

  const onRequest = requestForm.handleSubmit(async (values) => {
    setError(null);
    try {
      const res = await sendData<{ message: string; devToken?: string }>("post", "/auth/forgot-password", values);
      setMessage(res.message);
      setDevToken(res.devToken ?? null);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  });

  const onReset = resetForm.handleSubmit(async (values) => {
    setError(null);
    if (values.password !== values.confirm) {
      resetForm.setError("confirm", { message: "Passwords do not match" });
      return;
    }
    const parsed = resetPasswordSchema.safeParse({ token, password: values.password });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = issue?.path[0] === "password" ? "password" : undefined;
      if (field) resetForm.setError("password", { message: issue?.message ?? "Invalid password" });
      else setError(issue?.message ?? "Invalid password");
      return;
    }
    try {
      await sendData("post", "/auth/reset-password", { token, password: values.password });
      setMessage("Your password has been updated. You can now sign in.");
      setToken(null);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  });

  if (token) {
    return (
      <Card className="p-6 sm:p-7">
        <div className="mb-6">
          <span className="mb-3 grid size-9 place-items-center rounded-lg border border-line bg-surface-2 text-accent">
            <KeyRound className="size-4" aria-hidden="true" />
          </span>
          <h1 className="text-xl font-semibold tracking-[-0.01em] text-fg">Choose a new password</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            Your other sessions are signed out once the password changes.
          </p>
        </div>
        <form onSubmit={onReset} className="space-y-4" noValidate>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Field
            label="New password"
            htmlFor="new-password"
            hint="At least 12 characters with upper, lower case and a number."
            error={resetForm.formState.errors.password?.message}
            required
          >
            <PasswordInput id="new-password" autoComplete="new-password" {...resetForm.register("password")} />
            <PasswordRequirements value={resetForm.watch("password")} />
          </Field>
          <Field label="Confirm password" htmlFor="confirm-password" error={resetForm.formState.errors.confirm?.message} required>
            <PasswordInput id="confirm-password" autoComplete="new-password" {...resetForm.register("confirm")} />
          </Field>
          <Button type="submit" className="w-full" loading={resetForm.formState.isSubmitting}>
            Update password
          </Button>
        </form>
        <p className="mt-6 border-t border-line pt-4 text-sm">
          <Link href="/login" className="inline-flex items-center gap-1.5 rounded text-accent hover:underline">
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Back to sign in
          </Link>
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-6 sm:p-7">
      <div className="mb-6">
        <span className="mb-3 grid size-9 place-items-center rounded-lg border border-line bg-surface-2 text-accent">
          <MailCheck className="size-4" aria-hidden="true" />
        </span>
        <h1 className="text-xl font-semibold tracking-[-0.01em] text-fg">Reset password</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          Enter your account email. If it exists, reset instructions are queued for delivery.
        </p>
      </div>

      <form onSubmit={onRequest} className="space-y-4" noValidate>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {message ? <Alert tone="success">{message}</Alert> : null}
        {devToken ? (
          <Alert tone="info" title="Local development mode">
            <Link className="font-medium underline" href={`/forgot-password?token=${devToken}`}>
              Open the reset link
            </Link>
          </Alert>
        ) : null}
        <Field label="Email" htmlFor="forgot-email" error={requestForm.formState.errors.email?.message} required>
          <Input
            id="forgot-email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            {...requestForm.register("email")}
          />
        </Field>
        <Button type="submit" className="w-full" loading={requestForm.formState.isSubmitting}>
          Send reset link
        </Button>
      </form>

      <p className="mt-6 border-t border-line pt-4 text-sm">
        <Link href="/login" className="inline-flex items-center gap-1.5 rounded text-accent hover:underline">
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Back to sign in
        </Link>
      </p>
    </Card>
  );
}
