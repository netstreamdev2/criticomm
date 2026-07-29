/**
 * Skeleton matching the dispatch board's silhouette, so navigating to the
 * dashboard paints its real shape immediately while the data streams in.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading dashboard">
      {/* Headline stats */}
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="h-44 animate-pulse rounded-lg border border-border bg-bg-card" />
        ))}
      </div>
      {/* Feed + critical wait */}
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="h-72 animate-pulse rounded-lg border border-border bg-bg-card" />
        <div className="h-72 animate-pulse rounded-xl bg-muted/60" />
      </div>
      {/* Map */}
      <div className="h-[640px] animate-pulse rounded-lg border border-border bg-bg-card" />
      {/* Throughput */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-40 animate-pulse rounded-lg border border-border bg-bg-card" />
        ))}
      </div>
    </div>
  );
}
