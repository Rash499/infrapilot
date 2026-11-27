import { isAxiosError } from "axios";
import type { FieldValues, Path, UseFormSetError } from "react-hook-form";

/**
 * Helpers shared by every form in the application.
 *
 * Validation deliberately stays authoritative on the API: the schemas imported here are the exact
 * Zod contracts the backend runs, so the browser can only *preview* a failure. These helpers exist
 * to turn a validation result into accessible field-level feedback rather than one opaque banner.
 */

export interface ValidationIssue {
  path: PropertyKey[];
  message: string;
}

export interface SchemaLike {
  safeParse(data: unknown): { success: boolean; error?: { issues: ValidationIssue[] } };
}

function pathKey(path: PropertyKey[]): string {
  return path.map(String).filter(Boolean).join(".");
}

/**
 * Runs a shared schema and returns `{ fieldErrors, formError }`, keeping the first message per field
 * so a field never shows two competing errors. Issues without a path become a form-level error.
 */
export function collectFieldErrors(
  schema: SchemaLike,
  payload: unknown,
): { fieldErrors: Record<string, string>; formError?: string; ok: boolean } {
  const result = schema.safeParse(payload);
  if (result.success) return { fieldErrors: {}, ok: true };

  const fieldErrors: Record<string, string> = {};
  let formError: string | undefined;
  for (const issue of result.error?.issues ?? []) {
    const key = pathKey(issue.path);
    if (!key) {
      formError ??= issue.message;
      continue;
    }
    fieldErrors[key] ??= issue.message;
  }
  return { fieldErrors, formError, ok: false };
}

/**
 * Applies validation issues to react-hook-form, assigning each one to a real field when possible.
 * Returns the issues that matched no field so callers can surface them in a banner instead of
 * dropping them silently.
 */
export function applyIssues<T extends FieldValues>(
  issues: ValidationIssue[],
  setError: UseFormSetError<T>,
  fields: ReadonlyArray<Path<T>>,
): { firstField?: Path<T>; unmatched: string[] } {
  const known = new Set(fields.map(String));
  const unmatched: string[] = [];
  let firstField: Path<T> | undefined;

  for (const issue of issues) {
    const key = pathKey(issue.path);
    if (key && known.has(key)) {
      const field = key as Path<T>;
      setError(field, { type: "validation", message: issue.message });
      firstField ??= field;
    } else if (issue.message) {
      unmatched.push(key ? `${key}: ${issue.message}` : issue.message);
    }
  }
  return firstField ? { firstField, unmatched } : { unmatched };
}

/** Validates with a shared schema and routes each issue to its field. Returns a form-level message. */
export function validateFields<T extends FieldValues>(
  schema: SchemaLike,
  payload: unknown,
  setError: UseFormSetError<T>,
  fields: ReadonlyArray<Path<T>>,
): { valid: boolean; formError?: string } {
  const result = schema.safeParse(payload);
  if (result.success) return { valid: true };

  const issues = result.error?.issues ?? [];
  const { unmatched } = applyIssues(issues, setError, fields);
  if (unmatched.length > 0) return { valid: false, formError: unmatched[0] };
  const onlyFormLevel = issues.every((issue) => pathKey(issue.path) === "");
  return { valid: false, formError: onlyFormLevel ? issues[0]?.message : undefined };
}

/**
 * Extracts per-field messages from an API validation response (`error.details[]`), so a server-side
 * rejection highlights the same inputs the browser would have highlighted. Unknown fields fall back
 * to the caller's banner message.
 */
export function serverFieldErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: ReadonlyArray<Path<T>>,
): { firstField?: Path<T>; unmatched: string[] } {
  if (!isAxiosError(error)) return { unmatched: [] };
  const body = error.response?.data as
    | { error?: { details?: Array<{ path?: unknown; message?: string }> } }
    | undefined;
  const details = body?.error?.details;
  if (!Array.isArray(details) || details.length === 0) return { unmatched: [] };

  const issues: ValidationIssue[] = [];
  for (const detail of details) {
    if (!detail || typeof detail !== "object") continue;
    const rawPath = detail.path;
    const segments = Array.isArray(rawPath)
      ? rawPath
      : typeof rawPath === "string"
        ? rawPath.split(".")
        : [];
    if (detail.message) issues.push({ path: segments, message: detail.message });
  }
  return applyIssues(issues, setError, fields);
}

/**
 * Moves focus to the first control the form marked invalid. Called after a failed submission so
 * keyboard and screen-reader users land on the field that needs attention.
 */
export function focusFirstInvalid(form: ParentNode | null): void {
  if (!form) return;
  const target = form.querySelector<HTMLElement>(
    '[aria-invalid="true"]:not([disabled]), [data-invalid="true"]:not([disabled])',
  );
  target?.focus();
  target?.scrollIntoView({ block: "nearest" });
}

/** Requirement checklist for password fields; mirrors the shared `passwordSchema` rules. */
export function passwordChecks(value: string): Array<{ id: string; label: string; met: boolean }> {
  return [
    { id: "length", label: "At least 12 characters", met: value.length >= 12 },
    { id: "lower", label: "A lowercase letter", met: /[a-z]/.test(value) },
    { id: "upper", label: "An uppercase letter", met: /[A-Z]/.test(value) },
    { id: "number", label: "A number", met: /[0-9]/.test(value) },
    { id: "max", label: "At most 128 characters", met: value.length <= 128 },
  ];
}
