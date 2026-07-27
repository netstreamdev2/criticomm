export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-64 animate-pulse rounded-md bg-muted" />
      <div className="h-4 w-96 max-w-full animate-pulse rounded-md bg-muted/60" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg border border-border bg-bg-card" />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-lg border border-border bg-bg-card" />
    </div>
  );
}
