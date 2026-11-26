import { Skeleton } from "@/components/ui";

/** Route-level fallback shown while a segment streams in. */
export default function AppLoading() {
  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-5" aria-busy="true" aria-label="Loading view">
      <div className="space-y-2 border-b border-line pb-4">
        <Skeleton className="h-2.5 w-20" />
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-3 w-72" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-[104px]" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Skeleton className="h-72 xl:col-span-2" />
        <Skeleton className="h-72" />
      </div>
    </div>
  );
}
