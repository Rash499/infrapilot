import Link from "next/link";
import { Activity, Compass, LayoutDashboard } from "lucide-react";

export default function NotFound() {
  return (
    <main id="main" className="grid min-h-screen place-items-center px-4 py-12">
      <div className="w-full max-w-lg text-center">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-lg bg-accent text-white" aria-hidden="true">
            <Activity className="size-5" strokeWidth={2.4} />
          </span>
          <span className="text-sm font-semibold tracking-tight text-fg">InfraPilot</span>
        </div>

        <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-accent">Error 404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.01em] text-fg">This page does not exist</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
          The address may be mistyped, or the record was archived. You can return to the dashboard and continue from
          there.
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <Link
            href="/"
            className="inline-flex h-9 items-center gap-2 rounded-md bg-accent px-3.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <LayoutDashboard className="size-4" aria-hidden="true" />
            Go to dashboard
          </Link>
          <Link
            href="/assets"
            className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-surface px-3.5 text-sm font-medium text-fg transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <Compass className="size-4" aria-hidden="true" />
            Browse assets
          </Link>
        </div>
      </div>
    </main>
  );
}
