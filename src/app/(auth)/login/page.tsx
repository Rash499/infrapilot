"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@/context/auth-context";
import { getErrorMessage } from "@/lib/client/api";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { loginSchema } from "@/validators/schemas";

type FormValues = { email: string; password: string };

export default function LoginPage() {
  const router = useRouter();
  const { signIn, status } = useAuth();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(loginSchema) as unknown as Resolver<FormValues>,
    defaultValues: { email: "", password: "" },
  });

  useEffect(() => {
    if (status === "authenticated") router.replace("/");
  }, [status, router]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await signIn(values.email, values.password);
      router.replace("/");
    } catch (err) {
      setServerError(getErrorMessage(err));
    }
  });

  return (
    <Card className="p-6">
      <h1 className="text-lg font-semibold text-fg">Sign in</h1>
      <p className="mt-1 text-sm text-muted">Use your InfraPilot account to access the operations console.</p>
      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        {serverError ? <Alert tone="danger">{serverError}</Alert> : null}
        <Field label="Email" htmlFor="login-email" error={errors.email?.message}>
          <Input id="login-email" type="email" autoComplete="email" {...register("email")} />
        </Field>
        <Field label="Password" htmlFor="login-password" error={errors.password?.message}>
          <Input id="login-password" type="password" autoComplete="current-password" {...register("password")} />
        </Field>
        <Button type="submit" className="w-full" loading={isSubmitting}>
          Sign in
        </Button>
      </form>
      <div className="mt-5 flex flex-col gap-2 text-center text-sm text-muted sm:flex-row sm:justify-between">
        <Link href="/forgot-password" className="text-sky-500 hover:underline">
          Forgot password?
        </Link>
        <Link href="/register" className="text-sky-500 hover:underline">
          Create an account
        </Link>
      </div>
    </Card>
  );
}
