export interface Option {
  value: string;
  label: string;
}

export function humanize(value: string | null | undefined): string {
  if (!value) return "—";
  const words = value.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function fmtDateTime(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function fmtRelative(iso?: string | null): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const abs = Math.abs(diff);
  const future = diff < 0;
  const units: Array<[number, string]> = [
    [60_000, "min"],
    [3_600_000, "h"],
    [86_400_000, "d"],
  ];
  if (abs < 45_000) return future ? "in a moment" : "just now";
  for (let i = units.length - 1; i >= 0; i -= 1) {
    const [ms, label] = units[i]!;
    if (abs >= ms) {
      const n = Math.round(abs / ms);
      return future ? `in ${n}${label}` : `${n}${label} ago`;
    }
  }
  return future ? "in a moment" : "just now";
}

export function fmtPct(value?: number | null): string {
  return value === null || value === undefined ? "—" : `${value.toFixed(2)}%`;
}

export function fmtMs(value?: number | null): string {
  return value === null || value === undefined ? "—" : `${Math.round(value)} ms`;
}

/** Converts an ISO timestamp to the local value expected by <input type="datetime-local">. */
export function toDatetimeLocal(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromDatetimeLocal(value: string): string | null {
  if (!value) return null;
  return new Date(value).toISOString();
}

export function opts(values: readonly string[]): Option[] {
  return values.map((v) => ({ value: v, label: humanize(v) }));
}

export const ASSET_TYPE_VALUES = [
  "physical_server",
  "virtual_machine",
  "network_device",
  "cloud_resource",
  "container",
  "database",
  "application",
  "other",
] as const;
export const ASSET_TYPE_OPTIONS = opts(ASSET_TYPE_VALUES);
export const ENVIRONMENT_OPTIONS = opts(["development", "testing", "production"]);
export const ASSET_STATUS_OPTIONS = opts(["healthy", "degraded", "unavailable", "maintenance", "unknown"]);
export const SERVICE_STATE_OPTIONS = opts(["healthy", "degraded", "unavailable", "unknown"]);
export const SEVERITY_OPTIONS = opts(["critical", "high", "medium", "low", "informational"]);
export const INCIDENT_SEVERITY_OPTIONS = opts(["critical", "high", "medium", "low"]);
export const FINDING_STATUS_OPTIONS = opts(["open", "in_progress", "resolved", "accepted_risk"]);
export const INCIDENT_STATUS_OPTIONS = opts(["open", "investigating", "in_progress", "resolved", "closed"]);
export const PRIORITY_OPTIONS: Option[] = [
  { value: "p1", label: "P1 — Critical" },
  { value: "p2", label: "P2 — High" },
  { value: "p3", label: "P3 — Medium" },
  { value: "p4", label: "P4 — Low" },
];
export const MAINTENANCE_STATUS_OPTIONS = opts(["scheduled", "in_progress", "completed", "cancelled"]);
export const CHANGE_STATUS_OPTIONS = opts([
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "implemented",
  "rolled_back",
  "cancelled",
]);
export const RISK_OPTIONS = opts(["low", "medium", "high"]);
export const ROLE_OPTIONS = opts(["admin", "operator", "viewer"]);
export const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
  monitoring_unavailable: "Monitoring",
  monitoring_recovered: "Monitoring",
  critical_finding: "Security",
  incident_assigned: "Incident",
  incident_updated: "Incident",
  maintenance_scheduled: "Maintenance",
  maintenance_reminder: "Maintenance",
  change_pending_approval: "Change",
  change_decision: "Change",
  general: "General",
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates an identifier taken from the URL before it is interpolated into an API path.
 * Deep links are user-controlled input; rejecting malformed values prevents path traversal.
 */
export function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
