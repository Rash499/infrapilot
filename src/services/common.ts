import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";

/** Escapes LIKE wildcards so user search text is treated literally. Parameters are still bound by the ORM. */
export function likeTerm(term: string): string {
  return `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

export async function userNameMap(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((v): v is string => typeof v === "string" && v.length > 0))];
  const map = new Map<string, string>();
  if (unique.length === 0) return map;
  const rows = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, unique));
  for (const row of rows) map.set(row.id, row.name);
  return map;
}

/** Returns the names of fields whose values differ, used for concise audit summaries. */
export function diffFields(before: object, after: object, keys: readonly string[]): string[] {
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  return keys.filter((k) => k in a && JSON.stringify(b[k] ?? null) !== JSON.stringify(a[k] ?? null));
}

export function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export function humanize(value: string): string {
  const words = value.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function pageOffset(page: number, pageSize: number): number {
  return (page - 1) * pageSize;
}
