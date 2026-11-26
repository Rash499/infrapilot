"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { getErrorMessage, sendData } from "@/lib/client/api";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
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
      setError(parsed.error.issues[0]?.message ?? "Invalid password");
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
      <Card className="p-6">
        <h1 className="text-lg font-semibold text-fg">Choose a new password</h1>
        <form onSubmit={onReset} className="mt-6 space-y-4" noValidate>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Field label="New password" htmlFor="new-password" hint="At least 12 characters with upper, lower case and a number.">
            <Input id="new-password" type="password" autoComplete="new-password" {...resetForm.register("password")} />
          </Field>
          <Field label="Confirm password" htmlFor="confirm-password" error={resetForm.formState.errors.confirm?.message}>
            <Input id="confirm-password" type="password" autoComplete="new-password" {...resetForm.register("confirm")} />
          </Field>
          <Button type="submit" className="w-full" loading={resetForm.formState.isSubmitting}>
            Update password
          </Button>
        </form>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <h1 className="text-lg font-semibold text-fg">Reset password</h1>
      <p className="mt-1 text-sm text-muted">Enter your account email. If it exists, a reset link will be sent.</p>
      <form onSubmit={onRequest} className="mt-6 space-y-4" noValidate>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {message ? <Alert tone="success">{message}</Alert> : null}
        {devToken ? (
          <Alert tone="info">
            Local development mode: <Link className="underline" href={`/forgot-password?token=${devToken}`}>open the reset link</Link>.
          </Alert>
        ) : null}
        <Field label="Email" htmlFor="forgot-email" error={requestForm.formState.errors.email?.message}>
          <Input id="forgot-email" type="email" autoComplete="email" {...requestForm.register("email")} />
        </Field>
        <Button type="submit" className="w-full" loading={requestForm.formState.isSubmitting}>
          Send reset link
        </Button>
      </form>
      <p className="mt-5 text-center text-sm text-muted">
        <Link href="/login" className="text-sky-500 hover:underline">
          Back to sign in
        </Link>
      </p>
    </Card>
  );
}
