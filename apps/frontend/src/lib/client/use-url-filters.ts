"use client";

import { useEffect, useRef } from "react";

/**
 * Keeps a page's filter state in the URL so a filtered view survives a reload, can be shared, and
 * works with the back/forward buttons.
 *
 * Filters render from component state (not `useSearchParams`) so the route stays statically
 * renderable; the URL is read once on mount, written with `replaceState`, and re-applied on
 * `popstate`.
 */
export function useUrlFilters<T extends Record<string, string>>(
  values: T,
  defaults: T,
  apply: (patch: Partial<T>) => void,
): void {
  const applyRef = useRef(apply);
  const defaultsRef = useRef(defaults);
  const serialized = JSON.stringify(values);

  // Mirror the newest callbacks into refs *after* render so the mount-only effects below always
  // call current values without re-running on every parent render.
  useEffect(() => {
    applyRef.current = apply;
    defaultsRef.current = defaults;
  });

  useEffect(() => {
    const read = () => {
      const params = new URLSearchParams(window.location.search);
      const patch: Partial<T> = {};
      for (const key of Object.keys(defaultsRef.current) as Array<keyof T & string>) {
        const fromUrl = params.get(key);
        if (fromUrl !== null) patch[key] = fromUrl as T[keyof T & string];
      }
      if (Object.keys(patch).length > 0) applyRef.current(patch);
    };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);

  useEffect(() => {
    const current = JSON.parse(serialized) as T;
    const params = new URLSearchParams(window.location.search);
    for (const key of Object.keys(defaultsRef.current) as Array<keyof T & string>) {
      const value = current[key];
      const fallback = defaultsRef.current[key];
      if (!value || value === fallback) params.delete(key);
      else params.set(key, value);
    }
    const query = params.toString();
    const next = `${window.location.pathname}${query ? `?${query}` : ""}`;
    const now = `${window.location.pathname}${window.location.search}`;
    if (next !== now) window.history.replaceState(null, "", next);
  }, [serialized]);
}
