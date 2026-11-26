"use client";

import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

type Tone = "success" | "error" | "info";
interface ToastItem {
  id: number;
  tone: Tone;
  message: string;
}
interface ToastValue {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastValue | null>(null);

const toneStyles: Record<Tone, { icon: string; frame: string; badge: string }> = {
  success: {
    icon: "text-emerald-600 dark:text-emerald-400",
    frame: "tone-success",
    badge: "bg-emerald-500/12 border-emerald-500/25",
  },
  error: {
    icon: "text-rose-600 dark:text-rose-400",
    frame: "tone-danger",
    badge: "bg-rose-500/12 border-rose-500/25",
  },
  info: {
    icon: "text-accent",
    frame: "tone-info",
    badge: "bg-accent/12 border-accent/25",
  },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: number) => setItems((prev) => prev.filter((t) => t.id !== id)), []);

  const push = useCallback(
    (tone: Tone, message: string) => {
      counter.current += 1;
      const id = counter.current;
      setItems((prev) => [...prev.slice(-4), { id, tone, message }]);
      window.setTimeout(() => dismiss(id), 4500);
    },
    [dismiss],
  );

  const value = useMemo<ToastValue>(
    () => ({
      success: (m) => push("success", m),
      error: (m) => push("error", m),
      info: (m) => push("info", m),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,380px)] flex-col gap-2" aria-live="polite">
        {items.map((t) => {
          const Icon = t.tone === "success" ? CheckCircle2 : t.tone === "error" ? XCircle : Info;
          return (
            <div
              key={t.id}
              role={t.tone === "error" ? "alert" : "status"}
              className="animate-toast-in pointer-events-auto flex items-start gap-3 rounded-card border border-line bg-surface p-3 shadow-overlay"
            >
              <span
                className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-md border ${toneStyles[t.tone].badge}`}
                aria-hidden="true"
              >
                <Icon className={`size-4 ${toneStyles[t.tone].icon}`} />
              </span>
              <p className="flex-1 pt-0.5 text-sm leading-relaxed text-fg">{t.message}</p>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss notification"
                className="rounded p-1 text-muted transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <X className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
