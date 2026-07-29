'use client';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <p className="text-sm font-semibold uppercase tracking-widest text-severity-critical-ink">
        Something went wrong
      </p>
      <h1 className="mt-3 text-2xl font-bold">This page hit an error</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {error.message || 'Unexpected failure.'}
        {error.digest && <span className="mt-1 block font-mono text-xs">Ref: {error.digest}</span>}
      </p>
      <div className="mt-6 flex justify-center gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold"
        >
          Try again
        </button>
        <a href="/dashboard" className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted">
          Back to dashboard
        </a>
      </div>
    </div>
  );
}
