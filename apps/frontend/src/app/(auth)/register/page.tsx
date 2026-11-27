"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, type Resolver } from "react-hook-form";

import { zodResolver } from "@hookform/resolvers/zod";
import { ShieldCheck } from "lucide-react";
import { useAuth } from "@/context/auth-context";
import { getErrorMessage } from "@/lib/client/api";
import { Alert, Button, Card, Field, Input, PasswordInput, PasswordRequirements } from "@/components/ui";
import { registerSchema } from "@/validators/schemas";

type FormValues = { name: string; email: string; password: string };

export default function RegisterPage() {
  const router = useRouter();
  const { register: createAccount } = useAuth();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    watch,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(registerSchema) as unknown as Resolver<FormValues>,
    defaultValues: { name: "", email: "", password: "" },
  });
  const password = watch("password");

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await createAccount(values.name, values.email, values.password);
      router.replace("/");
    } catch (err) {
      setServerError(getErrorMessage(err));
    }
  }, (invalid) => {
    const first = (["name", "email", "password"] as const).find((field) => invalid[field]);
    if (first) setFocus(first);
  });

  return (
    <Card className="p-6 sm:p-7">
      <div className="mb-6">
        <p className="text-2xs font-semibold uppercase tracking-[0.1em] text-accent">Get started</p>
        <h1 className="mt-1 text-xl font-semibold tracking-[-0.01em] text-fg">Create account</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          The first account becomes the administrator. Later accounts start with Viewer access and an administrator can
          raise them.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {serverError ? <Alert tone="danger">{serverError}</Alert> : null}
        <Field label="Full name" htmlFor="reg-name" error={errors.name?.message} required>
          <Input id="reg-name" autoComplete="name" placeholder="Ada Lovelace" aria-invalid={errors.name ? true : undefined} {...register("name")} />
        </Field>
        <Field label="Work email" htmlFor="reg-email" error={errors.email?.message} required>
          <Input
            id="reg-email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            aria-invalid={errors.email ? true : undefined}
            {...register("email")}
          />
        </Field>
        <Field
          label="Password"
          htmlFor="reg-password"
          error={errors.password?.message}
          hint="At least 12 characters with upper, lower case and a number."
          required
        >
          <PasswordInput
            id="reg-password"
            autoComplete="new-password"
            placeholder="••••••••••••"
            aria-describedby="reg-password-rules"
            {...register("password")}
          />
          <PasswordRequirements value={password ?? ""} id="reg-password-rules" />
        </Field>

        <Button type="submit" className="mt-1 w-full" loading={isSubmitting}>
          {isSubmitting ? null : <ShieldCheck className="size-4" aria-hidden="true" />}
          Create account
        </Button>
      </form>

      <p className="mt-6 border-t border-line pt-4 text-sm text-muted">
        Already registered?{" "}
        <Link href="/login" className="rounded text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </Card>
  );
}
