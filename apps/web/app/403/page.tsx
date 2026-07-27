import Link from 'next/link';

export default function ForbiddenPage() {
  return (
    <main className="grid min-h-screen place-items-center px-6">
      <div className="max-w-md text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-primary">403 · forbidden</p>
        <h1 className="mt-3 text-3xl font-bold">Silo access denied</h1>
        <p className="mt-3 text-muted-foreground">
          Your account isn't cleared for this department. Speak to your supervisor if you believe
          this is an error.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold"
        >
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
