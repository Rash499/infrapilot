"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { Skeleton } from "@/components/ui";
import { useAuth } from "@/context/auth-context";

export default function ProtectedLayout({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "anonymous") router.replace("/login");
  }, [status, router]);

  if (status !== "authenticated") {
    return (
      <div className="grid min-h-screen place-items-center p-6" aria-busy="true" aria-label="Loading session">
        <div className="w-full max-w-md space-y-3">
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }
  return <AppShell>{children}</AppShell>;
}
