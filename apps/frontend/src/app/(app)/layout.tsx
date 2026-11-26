"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { Skeleton } from "@/components/ui";
import { useAuth } from "@/context/auth-context";

/** Mirrors the real shell so the session check never flashes a blank screen. */
function ShellSkeleton() {
  return (
    <div className="flex min-h-screen" aria-busy="true" aria-label="Loading session">
      <div className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col gap-6 border-r border-sidebar-line bg-sidebar p-3 lg:flex">
        <div className="flex h-11 items-center gap-2.5">
          <Skeleton className="size-8 rounded-lg bg-sidebar-2" />
          <div className="space-y-1.5">
            <Skeleton className="h-3 w-20 bg-sidebar-2" />
            <Skeleton className="h-2 w-24 bg-sidebar-2" />
          </div>
        </div>
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-7 w-full bg-sidebar-2" />
          ))}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 items-center justify-between border-b border-line bg-surface px-4">
          <Skeleton className="h-3 w-40" />
          <div className="flex items-center gap-2">
            <Skeleton className="size-7 rounded-full" />
            <Skeleton className="h-6 w-24" />
          </div>
        </div>
        <div className="mx-auto w-full max-w-[1400px] space-y-5 p-4 md:p-6">
          <div className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-3 w-80" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-[104px]" />
            ))}
          </div>
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    </div>
  );
}

export default function ProtectedLayout({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "anonymous") router.replace("/login");
  }, [status, router]);

  if (status !== "authenticated") return <ShellSkeleton />;
  return <AppShell>{children}</AppShell>;
}
