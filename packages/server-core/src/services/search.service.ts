import { listAlerts } from "@/db/repositories/alerts.repository";
import { listAssetsPaginated } from "@/db/repositories/assets.repository";
import { listChangeRequests } from "@/db/repositories/changes.repository";
import { listSecurityFindings } from "@/db/repositories/findings.repository";
import { listIncidents } from "@/db/repositories/incidents.repository";
import { listMaintenances } from "@/db/repositories/maintenance.repository";
import { listMonitoringTargets } from "@/db/repositories/monitoring.repository";
import { listUsersPaginated } from "@/db/repositories/users.repository";
import type { AuthUser } from "@/lib/auth";
import { humanize } from "@/services/common";

/**
 * Global search across the modules an operator can already browse.
 *
 * Each group uses the same repository function as its module list endpoint, so results respect the
 * same visibility rules. Users are only searchable by administrators, matching the navigation guard.
 */

export type SearchGroupKey = "assets" | "monitoring" | "alerts" | "incidents" | "findings" | "maintenance" | "changes" | "users";

export interface SearchHit {
  id: string;
  title: string;
  subtitle: string;
  href: string;
  meta?: string | null;
}

export interface SearchGroup {
  key: SearchGroupKey;
  label: string;
  total: number;
  items: SearchHit[];
}

export async function globalSearch(actor: AuthUser, query: { q: string; limit: number }): Promise<{ q: string; groups: SearchGroup[]; totalHits: number }> {
  const { q } = query;
  const page = { page: 1, pageSize: query.limit, search: q };

  const [assets, monitors, alerts, incidents, findings, maintenance, changes, users] = await Promise.all([
    listAssetsPaginated({ ...page, archived: false, sort: "name", order: "asc" }),
    listMonitoringTargets({ page: page.page, pageSize: page.pageSize, search: q, sort: "name", order: "asc" }),
    listAlerts({ page: page.page, pageSize: page.pageSize, search: q }),
    listIncidents({ ...page, sort: "openedAt", order: "desc" }),
    listSecurityFindings({ ...page, sort: "createdAt", order: "desc" }),
    listMaintenances({ ...page, sort: "startsAt", order: "desc" }),
    listChangeRequests({ ...page, sort: "createdAt", order: "desc" }),
    actor.role === "admin" ? listUsersPaginated({ page: 1, pageSize: query.limit, search: q }) : Promise.resolve({ items: [], total: 0 }),
  ]);

  const groups: SearchGroup[] = [
    {
      key: "assets",
      label: "Assets",
      total: assets.total,
      items: assets.items.map((row) => ({
        id: row.id,
        title: row.name,
        subtitle: `${humanize(row.assetType)} · ${humanize(row.environment)}`,
        meta: row.hostname,
        href: `/assets/${row.id}`,
      })),
    },
    {
      key: "monitoring",
      label: "Monitoring checks",
      total: monitors.total,
      items: monitors.items.map((row) => ({
        id: row.id,
        title: row.name,
        subtitle: `${row.monitorType.toUpperCase()} · ${humanize(row.status)}`,
        meta: row.url ?? (row.host && row.port ? `${row.host}:${row.port}` : null),
        href: "/monitoring",
      })),
    },
    {
      key: "alerts",
      label: "Alerts",
      total: alerts.total,
      items: alerts.items.map((row) => ({
        id: row.id,
        title: row.title,
        subtitle: `${humanize(row.severity)} · ${humanize(row.status)}`,
        meta: row.triggerCondition,
        href: `/alerts?alert=${row.id}`,
      })),
    },
    {
      key: "incidents",
      label: "Incidents",
      total: incidents.total,
      items: incidents.items.map((row) => ({
        id: row.id,
        title: `${row.title}`,
        subtitle: `INC-${String(row.number).padStart(5, "0")} · ${humanize(row.status)}`,
        meta: `${humanize(row.severity)} · ${row.priority.toUpperCase()}`,
        href: `/incidents/${row.id}`,
      })),
    },
    {
      key: "findings",
      label: "Security findings",
      total: findings.total,
      items: findings.items.map((row) => ({
        id: row.id,
        title: row.title,
        subtitle: `${humanize(row.severity)} · ${humanize(row.status)}`,
        meta: row.cveId ?? row.component ?? null,
        href: `/security?finding=${row.id}`,
      })),
    },
    {
      key: "maintenance",
      label: "Maintenance",
      total: maintenance.total,
      items: maintenance.items.map((row) => ({
        id: row.id,
        title: row.title,
        subtitle: `${humanize(row.status)} · ${row.startsAt.toISOString().slice(0, 10)}`,
        meta: row.ownerId ? "Owned" : null,
        href: "/maintenance",
      })),
    },
    {
      key: "changes",
      label: "Change requests",
      total: changes.total,
      items: changes.items.map((row) => ({
        id: row.id,
        title: row.title,
        subtitle: `CHG-${String(row.number).padStart(5, "0")} · ${humanize(row.status)}`,
        meta: `Risk ${humanize(row.riskLevel)}`,
        href: "/changes",
      })),
    },
  ];

  if (actor.role === "admin") {
    groups.push({
      key: "users",
      label: "Users",
      total: users.total,
      items: users.items.map((row) => ({
        id: row.id,
        title: row.name,
        subtitle: humanize(row.role),
        meta: row.email,
        href: "/users",
      })),
    });
  }

  return {
    q,
    groups: groups.filter((group) => group.items.length > 0),
    totalHits: groups.reduce((sum, group) => sum + group.items.length, 0),
  };
}
