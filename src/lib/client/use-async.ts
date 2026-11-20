"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getErrorMessage } from "@/lib/client/api";

/** Runs an async loader whenever `deps` change and exposes data, error, loading, and reload. */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const loaderRef = useRef(loader);

  useEffect(() => {
    loaderRef.current = loader;
  });

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    loaderRef.current()
      .then((result) => {
        if (active) setData(result);
      })
      .catch((err: unknown) => {
        if (active) setError(getErrorMessage(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, ...deps]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data, error, loading, reload, setData };
}
