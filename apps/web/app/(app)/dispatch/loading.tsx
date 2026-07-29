/**
 * Skeleton for the dispatch consoles (intake, assign, queue): the two-panel
 * silhouette appears instantly while the incident data loads.
 */
export default function DispatchLoading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading dispatch console">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-8 w-56 animate-pulse rounded-md bg-muted" />
          <div className="h-4 w-80 max-w-full animate-pulse rounded-md bg-muted/60" />
        </div>
        <div className="h-10 w-40 animate-pulse rounded-lg bg-muted/60" />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <div className="h-[560px] animate-pulse rounded-2xl border border-border bg-bg-card" />
        <div className="h-[560px] animate-pulse rounded-2xl border border-border bg-bg-card" />
      </div>
    </div>
  );
}
