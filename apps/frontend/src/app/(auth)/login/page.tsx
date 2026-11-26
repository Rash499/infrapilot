"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { LogIn } from "lucide-react";
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
    <Card className="p-6 sm:p-7">
      <div className="mb-6">
        <p className="text-2xs font-semibold uppercase tracking-[0.1em] text-accent">Welcome back</p>
        <h1 className="mt-1 text-xl font-semibold tracking-[-0.01em] text-fg">Sign in</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          Use your InfraPilot account to open the operations console.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {serverError ? <Alert tone="danger">{serverError}</Alert> : null}
        <Field label="Email" htmlFor="login-email" error={errors.email?.message} required>
          <Input
            id="login-email"
            type="email"
            autoComplete="email"
            autoFocus
            placeholder="you@company.com"
            aria-invalid={errors.email ? true : undefined}
            {...register("email")}
          />
        </Field>
        <Field label="Password" htmlFor="login-password" error={errors.password?.message} required>
          <Input
            id="login-password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••••••"
            aria-invalid={errors.password ? true : undefined}
            {...register("password")}
          />
        </Field>

        <Button type="submit" className="mt-1 w-full" loading={isSubmitting}>
          {isSubmitting ? null : <LogIn className="size-4" aria-hidden="true" />}
          Sign in
        </Button>
      </form>

      <div className="mt-6 space-y-3 border-t border-line pt-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link href="/forgot-password" className="rounded text-accent hover:underline">
            Forgot password?
          </Link>
          <Link href="/register" className="rounded text-muted transition-colors hover:text-fg">
            Create an account
          </Link>
        </div>
      </div>
    </Card>
  );
}
