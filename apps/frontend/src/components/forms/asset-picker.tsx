"use client";

import { useAsync } from "@/lib/client/use-async";
import { fetchList } from "@/lib/client/api";
import { cn } from "@/components/ui";
import type { Asset } from "@/types/api";

/** Multi-select list of active assets used by incidents, maintenance, and change requests. */
export function AssetPicker({ value, onChange, idPrefix = "asset" }: { value: string[]; onChange: (ids: string[]) => void; idPrefix?: string }) {
  const assets = useAsync(() => fetchList<Asset>("/assets", { pageSize: 100, sort: "name", order: "asc" }), []);
  const items = assets.data?.items ?? [];

  if (assets.loading) return <p className="text-sm text-muted">Loading assets…</p>;
  if (items.length === 0) return <p className="text-sm text-muted">No active assets yet. Register an asset first.</p>;

  return (
    <div className="grid max-h-48 gap-1 overflow-y-auto rounded-md border border-line bg-canvas p-2 sm:grid-cols-2" role="group" aria-label="Affected assets">
      {items.map((asset) => {
        const checked = value.includes(asset.id);
        const id = `${idPrefix}-${asset.id}`;
        return (
          <label
            key={asset.id}
            htmlFor={id}
            className={cn("flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-surface-2", checked && "bg-sky-600/10")}
          >
            <input
              id={id}
              type="checkbox"
              className="size-4 accent-sky-600"
              checked={checked}
              onChange={(e) => onChange(e.target.checked ? [...value, asset.id] : value.filter((v) => v !== asset.id))}
            />
            <span className="truncate text-fg">{asset.name}</span>
          </label>
        );
      })}
    </div>
  );
}
