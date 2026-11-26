"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@/context/auth-context";
import { getErrorMessage } from "@/lib/client/api";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { registerSchema } from "@/validators/schemas";

type FormValues = { name: string; email: string; password: string };

export default function RegisterPage() {
  const router = useRouter();
  const { register: createAccount } = useAuth();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(registerSchema) as unknown as Resolver<FormValues>,
    defaultValues: { name: "", email: "", password: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await createAccount(values.name, values.email, values.password);
      router.replace("/");
    } catch (err) {
      setServerError(getErrorMessage(err));
    }
  });

  return (
    <Card className="p-6">
      <h1 className="text-lg font-semibold text-fg">Create account</h1>
      <p className="mt-1 text-sm text-muted">The first account becomes the administrator. Later accounts start with Viewer access.</p>
      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        {serverError ? <Alert tone="danger">{serverError}</Alert> : null}
        <Field label="Full name" htmlFor="reg-name" error={errors.name?.message}>
          <Input id="reg-name" autoComplete="name" {...register("name")} />
        </Field>
        <Field label="Work email" htmlFor="reg-email" error={errors.email?.message}>
          <Input id="reg-email" type="email" autoComplete="email" {...register("email")} />
        </Field>
        <Field label="Password" htmlFor="reg-password" error={errors.password?.message} hint="At least 12 characters with upper, lower case and a number.">
          <Input id="reg-password" type="password" autoComplete="new-password" {...register("password")} />
        </Field>
        <Button type="submit" className="w-full" loading={isSubmitting}>
          Create account
        </Button>
      </form>
      <p className="mt-5 text-center text-sm text-muted">
        Already registered?{" "}
        <Link href="/login" className="text-sky-500 hover:underline">
          Sign in
        </Link>
      </p>
    </Card>
  );
}
