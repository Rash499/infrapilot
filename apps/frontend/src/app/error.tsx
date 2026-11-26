"use client";

import { useEffect } from "react";
import { Activity, RefreshCw } from "lucide-react";

/**
 * Route-level error boundary. It deliberately avoids app context so it still
 * renders when the failure happens before or inside a provider.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Surface the failure in the browser console only; the server already logs it.
    console.error(error);
  }, [error]);

  return (
    <main id="main" className="grid min-h-screen place-items-center px-4 py-12">
      <div className="w-full max-w-lg text-center">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-lg bg-accent text-white" aria-hidden="true">
            <Activity className="size-5" strokeWidth={2.4} />
          </span>
          <span className="text-sm font-semibold tracking-tight text-fg">InfraPilot</span>
        </div>

        <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-[var(--st-danger-fg)]">Unexpected error</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.01em] text-fg">This view could not be rendered</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
          The request failed before the page finished loading. Retrying re-renders the view; if it keeps failing, reload
          the browser.
        </p>
        {error.digest ? (
          <p className="mt-3 font-mono text-xs text-faint">Reference: {error.digest}</p>
        ) : null}

        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-accent px-3.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            Try again
          </button>
        </div>
      </div>
    </main>
  );
}
