/** Table silhouette for the incident log while rows stream in. */
export default function IncidentsLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading incidents">
      <div className="h-8 w-56 animate-pulse rounded-md bg-muted" />
      <div className="h-4 w-80 max-w-full animate-pulse rounded-md bg-muted/60" />
      <div className="overflow-hidden rounded-lg border border-border bg-bg-card">
        <div className="h-11 animate-pulse border-b border-border bg-bg-soft" />
        {Array.from({ length: 10 }, (_, i) => (
          <div
            key={i}
            className="h-12 animate-pulse border-b border-border bg-bg-card"
            style={{ animationDelay: `${i * 60}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
