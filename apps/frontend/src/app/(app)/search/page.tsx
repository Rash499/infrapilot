"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { Badge, Card, EmptyState, ErrorState, PageHeader, TableSkeleton } from "@/components/ui";
import { fetchData, getErrorMessage } from "@/lib/client/api";
import { useAsync } from "@/lib/client/use-async";
import type { SearchResults } from "@/types/api";

/**
 * Global search results. The query lives in the URL so results can be linked, and the page reads it
 * from `window.location` instead of `useSearchParams` to keep the route statically renderable.
 */
export default function SearchPage() {
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");

  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get("q") ?? "";
    setQ(initial);
    setTerm(initial.trim());
  }, []);

  const results = useAsync(
    () =>
      term.length >= 2
        ? fetchData<SearchResults>("/search", { q: term }).catch((error: unknown) => {
            throw new Error(getErrorMessage(error));
          })
        : Promise.resolve({ q: term, groups: [], totalHits: 0 }),
    [term],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Workspace"
        title="Search"
        description="Find assets, checks, alerts, incidents, findings, maintenance windows, change requests and (for administrators) users."
      />

      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          const next = q.trim();
          setTerm(next);
          if (next.length >= 2) window.history.replaceState(null, "", `/search?q=${encodeURIComponent(next)}`);
        }}
        className="flex gap-2"
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted" aria-hidden="true" />
          <input
            type="search"
            aria-label="Search"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Search by name, hostname, CVE, incident title…"
            className="h-9 w-full rounded-md border border-line bg-surface pl-9 pr-3 text-sm text-fg placeholder:text-muted focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
          />
        </div>
        <button
          type="submit"
          className="inline-flex h-9 items-center rounded-md bg-accent px-4 text-sm font-medium text-white hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
        >
          Search
        </button>
      </form>

      {results.error ? <ErrorState message={results.error} onRetry={results.reload} /> : null}
      {results.loading ? <TableSkeleton rows={5} columns={2} /> : null}

      {!results.loading && term.length < 2 ? (
        <EmptyState icon={Search} title="Enter at least two characters" description="Search runs against stored records only; nothing is fetched externally." />
      ) : null}

      {!results.loading && term.length >= 2 && results.data && results.data.totalHits === 0 ? (
        <EmptyState icon={Search} title={`No matches for “${term}”`} description="Try a hostname, CVE identifier, incident reference or asset name." />
      ) : null}

      {results.data && results.data.totalHits > 0 ? (
        <div className="space-y-4">
          <p className="text-xs text-muted">
            {results.data.totalHits} result{results.data.totalHits === 1 ? "" : "s"} for “{results.data.q}”
          </p>
          {results.data.groups.map((group) => (
            <Card key={group.key} className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
                <h2 className="text-[13px] font-semibold text-fg">{group.label}</h2>
                <Badge tone="neutral">{group.total}</Badge>
              </div>
              <ul className="divide-y divide-line">
                {group.items.map((item) => (
                  <li key={`${group.key}-${item.id}`}>
                    <Link href={item.href} className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-fg">{item.title}</span>
                        <span className="block truncate text-xs text-muted">{item.subtitle}</span>
                      </span>
                      {item.meta ? <span className="hidden max-w-[40%] truncate text-xs text-muted sm:block">{item.meta}</span> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}
