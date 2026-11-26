"use client";

import {
  Children,
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TdHTMLAttributes,
  type TextareaHTMLAttributes,
  type ThHTMLAttributes,
} from "react";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Loader2,
  Search,
  X,
  type LucideIcon,
} from "lucide-react";
import { humanize } from "@/lib/format";
import type { Pagination as PaginationMeta } from "@/types/api";

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
const variantClass: Record<Variant, string> = {
  primary:
    "bg-accent text-white shadow-sm hover:bg-accent-hover active:translate-y-px border border-transparent",
  secondary: "bg-surface-2 text-fg border border-line hover:border-line-strong hover:bg-surface-3",
  outline: "border border-line bg-surface text-fg hover:border-line-strong hover:bg-surface-2",
  ghost: "text-muted hover:bg-surface-2 hover:text-fg border border-transparent",
  danger: "bg-rose-600 text-white shadow-sm hover:bg-rose-500 border border-transparent",
};
const sizeClass = {
  sm: "h-8 gap-1.5 px-2.5 text-xs",
  md: "h-9 gap-2 px-3.5 text-sm",
  icon: "size-8",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: keyof typeof sizeClass;
  loading?: boolean;
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className,
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-md font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
        "disabled:cursor-not-allowed disabled:opacity-50",
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

export function IconButton({
  label,
  icon: Icon,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: LucideIcon }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-md text-muted transition-colors",
        "hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring",
        className,
      )}
    >
      <Icon className="size-4" aria-hidden="true" />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Surfaces                                                            */
/* ------------------------------------------------------------------ */

export function Card({
  className,
  children,
  interactive = false,
}: {
  className?: string;
  children: ReactNode;
  interactive?: boolean;
}) {
  return <div className={cn("panel", interactive && "interactive-card", className)}>{children}</div>;
}

/** Card title row used by every dashboard and detail panel. */
export function CardHeader({
  title,
  description,
  icon: Icon,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("panel-header", className)}>
      <div className="flex min-w-0 items-center gap-2.5">
        {Icon ? (
          <span className="grid size-7 shrink-0 place-items-center rounded-md bg-surface-2 text-muted">
            <Icon className="size-4" aria-hidden="true" />
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 className="truncate text-[13px] font-semibold text-fg">{title}</h2>
          {description ? <p className="truncate text-xs text-muted">{description}</p> : null}
        </div>
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

/** Canonical page wrapper: max width, vertical rhythm and horizontal padding. */
export function PageContainer({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-[1400px] space-y-5", className)}>{children}</div>;
}

/* ------------------------------------------------------------------ */
/* Badges and status                                                   */
/* ------------------------------------------------------------------ */

export type Tone = "neutral" | "success" | "warning" | "danger" | "info";

export function Badge({
  tone = "neutral",
  children,
  className,
  dot = false,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span className={cn("tone", `tone-${tone}`, className)}>
      {dot ? <span className={cn("dot", `dot-${tone}`)} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

export const STATUS_TONE: Record<string, Tone> = {
  healthy: "success",
  active: "success",
  completed: "success",
  resolved: "success",
  approved: "success",
  implemented: "success",
  success: "success",
  degraded: "warning",
  warning: "warning",
  investigating: "info",
  in_progress: "info",
  maintenance: "info",
  open: "warning",
  pending_approval: "warning",
  testing: "warning",
  staged: "warning",
  rolled_back: "warning",
  unavailable: "danger",
  rejected: "danger",
  failed: "danger",
  failure: "danger",
  critical: "danger",
  p1: "danger",
  high: "warning",
  medium: "info",
  low: "neutral",
  informational: "neutral",
  unknown: "neutral",
  inactive: "neutral",
  cancelled: "neutral",
  closed: "neutral",
  draft: "neutral",
  accepted_risk: "neutral",
  implemented_pending: "info",
  admin: "info",
  operator: "warning",
  viewer: "neutral",
  http: "info",
  tcp: "neutral",
  development: "neutral",
  production: "info",
  p2: "warning",
  p3: "info",
  p4: "neutral",
  scheduled: "info",
};

export function StatusBadge({ value, label, dot = true }: { value: string; label?: string; dot?: boolean }) {
  return (
    <Badge tone={STATUS_TONE[value] ?? "neutral"} dot={dot}>
      {label ?? humanize(value)}
    </Badge>
  );
}

export function StatusDot({ value }: { value: string }) {
  const tone = STATUS_TONE[value] ?? "neutral";
  return <span className={cn("dot", `dot-${tone}`)} aria-hidden="true" />;
}

/** Colour + text: status is never conveyed by colour alone. */
export function HealthIndicator({ value, label }: { value: string; label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-fg">
      <StatusDot value={value} />
      <span>{label ?? humanize(value)}</span>
    </span>
  );
}

export function SeverityBadge({ value }: { value: string }) {
  const tone = STATUS_TONE[value] ?? "neutral";
  const loud = value === "critical" || value === "high";
  return (
    <Badge tone={tone} className={cn(loud && "font-semibold")}>
      {humanize(value)}
    </Badge>
  );
}

/* ------------------------------------------------------------------ */
/* Form controls                                                       */
/* ------------------------------------------------------------------ */

const inputBase =
  "h-9 w-full rounded-md border border-line bg-surface px-3 text-sm text-fg shadow-sm transition-colors " +
  "placeholder:text-faint hover:border-line-strong " +
  "focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-ring/25 " +
  "disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-70 " +
  "aria-[invalid=true]:border-rose-500 aria-[invalid=true]:focus:ring-rose-500/25";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(inputBase, className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <select ref={ref} className={cn(inputBase, "cursor-pointer pr-8", className)} {...props}>
      {children}
    </select>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn(inputBase, "h-auto min-h-24 py-2 leading-relaxed", className)} {...props} />;
  },
);

export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="flex items-center gap-1 text-xs font-medium text-fg-secondary">
        {label}
        {required ? (
          <span className="text-rose-500" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {children}
      {error ? (
        <p role="alert" className="flex items-start gap-1 text-xs font-medium text-rose-500">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs leading-relaxed text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function FormSection({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <fieldset className={cn("space-y-3", className)}>
      <legend className="text-2xs font-semibold uppercase tracking-[0.08em] text-muted">{title}</legend>
      {description ? <p className="text-xs text-muted">{description}</p> : null}
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  label,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label: string;
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden="true" />
      <Input
        aria-label={label}
        placeholder={placeholder}
        className="pl-9"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export const Checkbox = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: string; id: string }>(
  function Checkbox({ id, label, ...props }, ref) {
    return (
      <label htmlFor={id} className="inline-flex cursor-pointer items-center gap-2 text-sm text-fg">
        <input
          ref={ref}
          id={id}
          type="checkbox"
          className="size-4 shrink-0 cursor-pointer rounded border-line text-accent accent-[var(--accent)]"
          {...props}
        />
        {label}
      </label>
    );
  },
);

/* ------------------------------------------------------------------ */
/* Overlays                                                            */
/* ------------------------------------------------------------------ */

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const firstField = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (firstField ?? panel)?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => element.offsetParent !== null,
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
      restoreFocusRef.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  const width = size === "lg" ? "sm:max-w-3xl" : size === "sm" ? "sm:max-w-md" : "sm:max-w-xl";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="animate-overlay-in absolute inset-0 bg-slate-950/60 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          "animate-dialog-in relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-panel border border-line bg-surface shadow-overlay outline-none sm:rounded-panel",
          width,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-[15px] font-semibold text-fg">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="mt-1 text-sm leading-relaxed text-muted">
                {description}
              </p>
            ) : null}
          </div>
          <IconButton label="Close dialog" icon={X} onClick={onClose} className="-mr-1 -mt-1" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface-2/60 px-5 py-3">
            {footer}
          </div>
        ) : null}
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

/* ------------------------------------------------------------------ */
/* Feedback                                                            */
/* ------------------------------------------------------------------ */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} aria-hidden="true" />;
}

export function TableSkeleton({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-2 p-4" aria-busy="true" aria-label="Loading table">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex items-center gap-3">
          {Array.from({ length: columns }).map((__, columnIndex) => (
            <Skeleton
              key={columnIndex}
              className={cn("h-8 flex-1", columnIndex === 0 && "max-w-[30%]")}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  compact = false,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center", compact ? "gap-1.5 px-6 py-8" : "gap-2 px-6 py-12")}>
      <span className="mb-1 grid size-10 place-items-center rounded-full border border-line bg-surface-2 text-muted">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <p className="text-sm font-semibold text-fg">{title}</p>
      {description ? <p className="max-w-sm text-sm leading-relaxed text-muted">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <span className="mb-1 grid size-10 place-items-center rounded-full border border-rose-500/30 bg-rose-500/10 text-rose-500">
        <AlertTriangle className="size-5" aria-hidden="true" />
      </span>
      <p className="text-sm font-semibold text-fg">Something went wrong</p>
      <p className="max-w-md text-sm leading-relaxed text-muted">{message}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function Alert({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: Tone;
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  const iconTone: Record<Tone, string> = {
    neutral: "text-muted",
    success: "text-emerald-600 dark:text-emerald-400",
    warning: "text-amber-600 dark:text-amber-400",
    danger: "text-rose-600 dark:text-rose-400",
    info: "text-accent",
  };
  return (
    <div
      className={cn("flex w-full items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm", `tone-${tone}`, className)}
      role={tone === "danger" ? "alert" : "status"}
    >
      <AlertTriangle className={cn("mt-0.5 size-4 shrink-0", iconTone[tone])} aria-hidden="true" />
      <span className="min-w-0">
        {title ? <span className="block font-semibold">{title}</span> : null}
        <span className="block leading-relaxed">{children}</span>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page chrome                                                         */
/* ------------------------------------------------------------------ */

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  meta,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-line pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <p className="mb-1 text-2xs font-semibold uppercase tracking-[0.1em] text-accent">{eyebrow}</p> : null}
        <h1 className="truncate text-[22px] font-semibold leading-tight tracking-[-0.01em] text-fg">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">{description}</p> : null}
        {meta ? <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">{meta}</div> : null}
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
  className,
  footer,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: LucideIcon;
  tone?: Tone;
  className?: string;
  footer?: ReactNode;
}) {
  const iconTone: Record<Tone, string> = {
    neutral: "text-muted bg-surface-2 border-line",
    success: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    warning: "text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20",
    danger: "text-rose-600 dark:text-rose-400 bg-rose-500/10 border-rose-500/20",
    info: "text-accent bg-accent-soft border-accent/20",
  };
  const valueTone: Record<Tone, string> = {
    neutral: "text-fg",
    success: "text-emerald-600 dark:text-emerald-400",
    warning: "text-amber-600 dark:text-amber-400",
    danger: "text-rose-600 dark:text-rose-400",
    info: "text-accent",
  };
  return (
    <Card className={cn("h-full p-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-2xs font-semibold uppercase tracking-[0.07em] text-muted">{label}</p>
          <p className={cn("mt-1.5 text-2xl font-semibold leading-none tabular-nums tracking-[-0.01em]", valueTone[tone])}>
            {value}
          </p>
          {hint ? <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted">{hint}</p> : null}
        </div>
        {Icon ? (
          <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg border", iconTone[tone])}>
            <Icon className="size-4" aria-hidden="true" />
          </span>
        ) : null}
      </div>
      {footer ? <div className="mt-3 border-t border-line pt-2.5 text-xs text-muted">{footer}</div> : null}
    </Card>
  );
}

export function ProgressBar({
  value,
  tone = "info",
  label,
  className,
}: {
  value: number;
  tone?: Tone;
  label?: string;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const bar: Record<Tone, string> = {
    neutral: "bg-slate-400",
    success: "bg-emerald-500",
    warning: "bg-amber-500",
    danger: "bg-rose-500",
    info: "bg-accent",
  };
  return (
    <div
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-3", className)}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div className={cn("h-full rounded-full transition-[width] duration-300", bar[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Pagination({ meta, onPageChange }: { meta?: PaginationMeta; onPageChange: (page: number) => void }) {
  if (!meta) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-xs text-muted">
      <span className="tabular-nums">
        {(meta.total ?? 0).toLocaleString()} {meta.total === 1 ? "record" : "records"} · page {meta.page} of{" "}
        {Math.max(1, meta.totalPages)}
      </span>
      <div className="flex gap-1.5">
        <Button
          variant="outline"
          size="sm"
          disabled={meta.page <= 1}
          onClick={() => onPageChange(meta.page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={meta.page >= Math.max(1, meta.totalPages)}
          onClick={() => onPageChange(meta.page + 1)}
          aria-label="Next page"
        >
          <ChevronRight className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Toolbars                                                            */
/* ------------------------------------------------------------------ */

export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("panel px-3 py-3", className)}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">{children}</div>
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  size = "md",
}: {
  options: Array<{ value: T; label: string; count?: number }>;
  value: T;
  onChange: (value: T) => void;
  label: string;
  size?: "sm" | "md";
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex w-fit items-center gap-0.5 rounded-md border border-line bg-surface-2 p-0.5"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring",
              size === "sm" ? "h-6 px-2 text-2xs" : "h-7 px-2.5 text-xs",
              active ? "bg-surface text-fg shadow-card" : "text-muted hover:text-fg",
            )}
          >
            {option.label}
            {option.count !== undefined ? (
              <span className={cn("tabular-nums", active ? "text-fg" : "text-faint")}>{option.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tables                                                              */
/* ------------------------------------------------------------------ */

export function DataTable({ children, minWidth = 720 }: { children: ReactNode; minWidth?: number }) {
  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export function Th({ children, className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        "whitespace-nowrap border-b border-line bg-surface-2/70 px-4 py-2.5 text-2xs font-semibold uppercase tracking-[0.06em] text-muted",
        className,
      )}
      {...props}
    >
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

/* ------------------------------------------------------------------ */
/* Detail + timeline                                                   */
/* ------------------------------------------------------------------ */

export function DetailList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-3 sm:grid-cols-2", className)}>
      {Children.toArray(children)}
    </dl>
  );
}

export function DetailItem({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-2xs font-medium uppercase tracking-[0.06em] text-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-fg">{children}</dd>
    </div>
  );
}

export function ActivityTimeline({
  items,
}: {
  items: Array<{ id: string; title: ReactNode; meta?: ReactNode; body?: ReactNode; tone?: Tone }>;
}) {
  return (
    <ol className="relative space-y-4 pl-5">
      <span className="absolute bottom-2 left-[5px] top-2 w-px bg-line" aria-hidden="true" />
      {items.map((item) => (
        <li key={item.id} className="relative">
          <span
            className={cn("dot absolute -left-5 top-1.5", `dot-${item.tone ?? "neutral"}`)}
            aria-hidden="true"
          />
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <p className="text-sm font-medium text-fg">{item.title}</p>
            {item.meta ? <p className="text-xs text-muted">{item.meta}</p> : null}
          </div>
          {item.body ? <div className="mt-0.5 text-sm leading-relaxed text-muted">{item.body}</div> : null}
        </li>
      ))}
    </ol>
  );
}
