"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ArrowRight, CornerDownLeft, Search, X } from "lucide-react";
import { api, getErrorMessage } from "@/lib/client/api";
import { cn, Kbd, Skeleton } from "@/components/ui";
import type { SearchResults } from "@/types/api";

const MIN_QUERY = 2;
const RESULT_LIMIT = 4;

type Status = "idle" | "loading" | "ready" | "error";

interface FlatHit {
  id: string;
  title: string;
  subtitle: string;
  href: string;
  meta?: string | null;
  groupLabel: string;
}

/**
 * Header search with an inline result panel.
 *
 * Everything shown comes from `GET /search`, which reuses each module's list query, so results obey
 * the same visibility rules as the pages (users are admin-only). No client-side index or invented
 * suggestion is used.
 */
export function GlobalSearch({ className }: { className?: string }) {
  const router = useRouter();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mobileInputRef = useRef<HTMLInputElement>(null);
  const mobileTriggerRef = useRef<HTMLButtonElement>(null);

  const trimmed = query.trim();
  const enough = trimmed.length >= MIN_QUERY;

  useEffect(() => {
    if (!enough) {
      setResults(null);
      setStatus("idle");
      setError(null);
      return;
    }
    const controller = new AbortController();
    setStatus("loading");
    const timer = window.setTimeout(() => {
      api
        .get<{ data: SearchResults }>("/search", {
          params: { q: trimmed, limit: RESULT_LIMIT },
          signal: controller.signal,
        })
        .then((res) => {
          setResults(res.data.data);
          setError(null);
          setStatus("ready");
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setError(getErrorMessage(err));
          setStatus("error");
        });
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [trimmed, enough]);

  useEffect(() => {
    setActiveIndex(-1);
  }, [trimmed]);

  const hits = useMemo<FlatHit[]>(() => {
    if (!results || status !== "ready") return [];
    return results.groups.flatMap((group) =>
      group.items.map((item) => ({ ...item, groupLabel: group.label })),
    );
  }, [results, status]);

  const close = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
  }, []);

  const closeMobile = useCallback(() => {
    setMobileOpen(false);
    mobileTriggerRef.current?.focus();
  }, []);

  // Click outside / Escape close the desktop panel.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, close]);

  // ⌘K / Ctrl+K opens search from anywhere; Escape leaves it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
        setMobileOpen(false);
        if (window.matchMedia("(min-width: 768px)").matches) {
          inputRef.current?.focus();
          inputRef.current?.select();
        } else {
          setMobileOpen(true);
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Body scroll lock and initial focus for the mobile overlay.
  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    mobileInputRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMobile();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [mobileOpen, closeMobile]);

  const go = useCallback(
    (href: string) => {
      close();
      setMobileOpen(false);
      setQuery("");
      router.push(href);
    },
    [close, router],
  );

  const submit = () => {
    if (!enough) return;
    if (activeIndex >= 0 && hits[activeIndex]) {
      go(hits[activeIndex]!.href);
      return;
    }
    go(`/search?q=${encodeURIComponent(trimmed)}`);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setQuery("");
      close();
      if (mobileOpen) closeMobile();
      return;
    }
    if (!open) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (hits.length === 0) return;
      event.preventDefault();
      setActiveIndex((current) => {
        const next = event.key === "ArrowDown" ? current + 1 : current - 1;
        if (next < -1) return hits.length - 1;
        if (next >= hits.length) return -1;
        return next;
      });
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    }
  };

  const optionId = (index: number) => `${listId}-option-${index}`;

  const renderPanel = (panelId: string) => (
    <div
      id={panelId}
      role="listbox"
      aria-label="Search results"
      className="overflow-hidden rounded-lg border border-line bg-surface shadow-overlay"
    >
      <div aria-live="polite" className="sr-only">
        {status === "loading"
          ? "Searching"
          : status === "ready"
            ? `${results?.totalHits ?? 0} result${(results?.totalHits ?? 0) === 1 ? "" : "s"} for ${trimmed}`
            : ""}
      </div>

      {!enough ? (
        <p className="px-3 py-4 text-xs text-muted">
          Type at least {MIN_QUERY} characters to search assets, checks, alerts, incidents and findings.
        </p>
      ) : null}

      {status === "loading" ? (
        <div className="space-y-2 p-3" aria-hidden="true">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex items-center gap-2">
              <Skeleton className="size-6 rounded" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-2.5 w-2/3" />
                <Skeleton className="h-2 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {status === "error" ? (
        <p role="alert" className="px-3 py-4 text-xs text-rose-600 dark:text-rose-400">
          {error}
        </p>
      ) : null}

      {status === "ready" && results && results.totalHits === 0 ? (
        <p className="px-3 py-4 text-xs text-muted">
          No matches for “{trimmed}”. Try a hostname, CVE identifier or incident reference.
        </p>
      ) : null}

      {status === "ready" && hits.length > 0 ? (
        <div className="max-h-[min(60vh,26rem)] overflow-y-auto py-1">
          {results?.groups
            .filter((group) => group.items.length > 0)
            .map((group) => (
              <div key={group.key} className="py-1">
                <p className="px-3 py-1 text-2xs font-semibold uppercase tracking-[0.08em] text-muted">
                  {group.label}
                </p>
                <ul>
                  {group.items.map((item) => {
                    const index = hits.findIndex((hit) => hit.id === item.id && hit.href === item.href);
                    const active = index === activeIndex;
                    return (
                      <li key={`${group.key}-${item.id}`}>
                        <Link
                          id={optionId(index)}
                          role="option"
                          aria-selected={active}
                          href={item.href}
                          onClick={() => {
                            close();
                            setMobileOpen(false);
                            setQuery("");
                          }}
                          onMouseEnter={() => setActiveIndex(index)}
                          className={cn(
                            "flex items-center gap-2.5 px-3 py-2 text-sm transition-colors",
                            active ? "bg-surface-2 text-fg" : "text-fg hover:bg-surface-2",
                          )}
                        >
                          <Search className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{item.title}</span>
                            <span className="block truncate text-xs text-muted">{item.subtitle}</span>
                          </span>
                          {item.meta ? (
                            <span className="hidden max-w-[8rem] truncate text-xs text-muted sm:block">{item.meta}</span>
                          ) : null}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          <div className="mt-1 border-t border-line px-3 py-2">
            <Link
              href={`/search?q=${encodeURIComponent(trimmed)}`}
              onClick={() => {
                close();
                setMobileOpen(false);
                setQuery("");
              }}
              className="flex items-center justify-between text-xs text-accent hover:underline"
            >
              View all results for “{trimmed}”
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          </div>
        </div>
      ) : null}

      {status !== "idle" && status !== "loading" ? (
        <div className="hidden items-center gap-3 border-t border-line bg-surface-2/60 px-3 py-1.5 text-[10px] text-muted md:flex">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> navigate
          </span>
          <span className="flex items-center gap-1">
            <Kbd>
              <CornerDownLeft className="size-2.5" aria-hidden="true" />
            </Kbd>
            open
          </span>
          <span className="flex items-center gap-1">
            <Kbd>Esc</Kbd> close
          </span>
        </div>
      ) : null}
    </div>
  );

  const searchField = (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
        aria-label="Global search"
        placeholder="Search workspace…"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className="h-8 w-44 rounded-md border border-line bg-surface-2/60 pl-8 pr-14 text-xs text-fg placeholder:text-muted focus-visible:border-accent focus-visible:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring lg:w-64"
      />
      {query ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setQuery("");
            setActiveIndex(-1);
            inputRef.current?.focus();
          }}
          className="absolute right-6 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-muted hover:bg-surface-3 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
        >
          <X className="size-3" aria-hidden="true" />
        </button>
      ) : null}
      <span className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 lg:block">
        <Kbd>⌘K</Kbd>
      </span>
    </div>
  );

  return (
    <>
      <div ref={containerRef} className={cn("relative hidden shrink-0 md:block", className)}>
        <form
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {searchField}
        </form>
        {open && (
          <div className="animate-dialog-in absolute right-0 top-[calc(100%+8px)] z-50 w-[24rem] max-w-[calc(100vw-2rem)]">
            {renderPanel(listId)}
          </div>
        )}
      </div>

      <button
        ref={mobileTriggerRef}
        type="button"
        aria-label="Open search"
        onClick={() => setMobileOpen(true)}
        className="grid size-8 place-items-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring md:hidden"
      >
        <Search className="size-[18px]" aria-hidden="true" />
      </button>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-canvas md:hidden">
          <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2.5">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
              <input
                ref={mobileInputRef}
                type="search"
                role="combobox"
                aria-expanded
                aria-controls={`${listId}-mobile`}
                aria-autocomplete="list"
                aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
                aria-label="Global search"
                placeholder="Search workspace…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onKeyDown}
                className="h-10 w-full rounded-md border border-line bg-surface pl-9 pr-3 text-sm text-fg placeholder:text-muted focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
              />
            </div>
            <button
              type="button"
              onClick={closeMobile}
              className="rounded px-2 py-1.5 text-sm text-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
            >
              Cancel
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">{renderPanel(`${listId}-mobile`)}</div>
        </div>
      ) : null}
    </>
  );
}
