"use client";

import {
  forwardRef,
  useEffect,
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TdHTMLAttributes,
  type TextareaHTMLAttributes,
  type ThHTMLAttributes,
} from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Inbox, Loader2, X, type LucideIcon } from "lucide-react";
import { humanize } from "@/lib/format";
import type { Pagination } from "@/types/api";

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

/* ---------- buttons ---------- */

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
const variantClass: Record<Variant, string> = {
  primary: "bg-sky-600 text-white hover:bg-sky-500",
  secondary: "bg-surface-2 text-fg hover:bg-line",
  ghost: "text-muted hover:bg-surface-2 hover:text-fg",
  danger: "bg-rose-600 text-white hover:bg-rose-500",
  outline: "border border-line bg-transparent text-fg hover:bg-surface-2",
};
const sizeClass = {
  sm: "h-8 px-3 text-xs",
  md: "h-9 px-4 text-sm",
  icon: "size-9",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: keyof typeof sizeClass;
  loading?: boolean;
};

export function Button({ variant = "primary", size = "md", loading = false, className, disabled, children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-50",
        sizeClass[size],
        variantClass[variant],
        className,
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

/* ---------- surfaces & badges ---------- */

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("rounded-xl border border-line bg-surface shadow-sm", className)}>{children}</div>;
}

export type Tone = "neutral" | "success" | "warning" | "danger" | "info";
const toneClass: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted border-line",
  success: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30",
  warning: "bg-amber-500/10 text-amber-500 border-amber-500/30",
  danger: "bg-rose-500/10 text-rose-500 border-rose-500/30",
  info: "bg-sky-500/10 text-sky-500 border-sky-500/30",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium", toneClass[tone], className)}>
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  healthy: "success",
  degraded: "warning",
  unavailable: "danger",
  unknown: "neutral",
  maintenance: "info",
  open: "warning",
  investigating: "info",
  in_progress: "info",
  pending_approval: "warning",
  resolved: "success",
  closed: "neutral",
  accepted_risk: "neutral",
  critical: "danger",
  high: "warning",
  medium: "info",
  low: "neutral",
  informational: "neutral",
  p1: "danger",
  p2: "warning",
  p3: "info",
  p4: "neutral",
  scheduled: "info",
  completed: "success",
  cancelled: "neutral",
  draft: "neutral",
  approved: "success",
  rejected: "danger",
  implemented: "success",
  rolled_back: "warning",
  admin: "info",
  operator: "warning",
  viewer: "neutral",
  http: "info",
  tcp: "neutral",
};

export function StatusBadge({ value, label }: { value: string; label?: string }) {
  return <Badge tone={STATUS_TONE[value] ?? "neutral"}>{label ?? humanize(value)}</Badge>;
}

export function StatusDot({ value }: { value: string }) {
  const color: Record<string, string> = {
    healthy: "bg-emerald-500",
    degraded: "bg-amber-500",
    unavailable: "bg-rose-500",
    unknown: "bg-slate-500",
  };
  return <span className={cn("inline-block size-2 rounded-full", color[value] ?? "bg-slate-500")} aria-hidden="true" />;
}

/* ---------- form controls ---------- */

const inputBase =
  "h-9 w-full rounded-md border border-line bg-canvas px-3 text-sm text-fg placeholder:text-muted focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30 disabled:opacity-60";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(inputBase, className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...props }, ref) {
  return (
    <select ref={ref} className={cn(inputBase, "pr-8", className)} {...props}>
      {children}
    </select>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(inputBase, "h-auto min-h-20 py-2", className)} {...props} />;
});

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-xs font-medium text-muted">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-rose-500">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export const Checkbox = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: string; id: string }>(function Checkbox(
  { id, label, ...props },
  ref,
) {
  return (
    <label htmlFor={id} className="inline-flex cursor-pointer items-center gap-2 text-sm text-fg">
      <input ref={ref} id={id} type="checkbox" className="size-4 rounded border-line accent-sky-600" {...props} />
      {label}
    </label>
  );
});

/* ---------- overlays ---------- */

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-2xl sm:rounded-2xl",
          size === "lg" ? "sm:max-w-3xl" : size === "sm" ? "sm:max-w-md" : "sm:max-w-xl",
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 id={titleId} className="text-base font-semibold text-fg">
              {title}
            </h2>
            {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
          </div>
          <button type="button" onClick={onClose} aria-label="Close dialog" className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-fg">
            <X className="size-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  tone = "danger",
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  tone?: "danger" | "primary";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {null}
    </Modal>
  );
}

/* ---------- feedback & layout ---------- */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-surface-2", className)} aria-hidden="true" />;
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <Icon className="size-8 text-muted" aria-hidden="true" />
      <p className="text-sm font-medium text-fg">{title}</p>
      {description ? <p className="max-w-sm text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <AlertTriangle className="size-8 text-rose-500" aria-hidden="true" />
      <p className="text-sm font-medium text-fg">Something went wrong</p>
      <p className="max-w-md text-sm text-muted">{message}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function Alert({ tone = "info", children }: { tone?: Tone; children: ReactNode }) {
  return <div className={cn("rounded-md border px-3 py-2 text-sm", toneClass[tone])}>{children}</div>;
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-fg md:text-2xl">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: LucideIcon;
  tone?: Tone;
}) {
  const iconTone: Record<Tone, string> = {
    neutral: "text-sky-500 bg-sky-500/10",
    success: "text-emerald-500 bg-emerald-500/10",
    warning: "text-amber-500 bg-amber-500/10",
    danger: "text-rose-500 bg-rose-500/10",
    info: "text-sky-500 bg-sky-500/10",
  };
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-fg">{value}</p>
          {hint ? <p className="mt-1 truncate text-xs text-muted">{hint}</p> : null}
        </div>
        {Icon ? (
          <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", iconTone[tone])}>
            <Icon className="size-4" aria-hidden="true" />
          </span>
        ) : null}
      </div>
    </Card>
  );
}

export function Pagination({ meta, onPageChange }: { meta?: Pagination; onPageChange: (page: number) => void }) {
  if (!meta) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm text-muted">
      <span>
        {meta.total} total · page {meta.page} of {meta.totalPages}
      </span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={meta.page <= 1} onClick={() => onPageChange(meta.page - 1)} aria-label="Previous page">
          <ChevronLeft className="size-4" aria-hidden="true" />
        </Button>
        <Button variant="outline" size="sm" disabled={meta.page >= meta.totalPages} onClick={() => onPageChange(meta.page + 1)} aria-label="Next page">
          <ChevronRight className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

/* ---------- tables ---------- */

export function DataTable({ children, minWidth = 720 }: { children: ReactNode; minWidth?: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export function Th({ children, className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th scope="col" className={cn("border-b border-line bg-surface-2/60 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted", className)} {...props}>
      {children}
    </th>
  );
}

export function Td({ children, className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn("border-b border-line px-4 py-3 align-middle text-fg", className)} {...props}>
      {children}
    </td>
  );
}
