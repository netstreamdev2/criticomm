'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/** Triggers the i-traffic feed import (POST /api/cameras/import). */
export function ImportCamerasButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const run = () => {
    setMessage(null);
    start(async () => {
      try {
        const res = await fetch('/api/cameras/import', { method: 'POST' });
        const data = (await res.json()) as { imported?: number; message?: string; error?: string };
        if (!res.ok) {
          setMessage(data.error ?? `Import failed (${res.status})`);
          return;
        }
        setMessage(
          data.imported != null
            ? `Imported ${data.imported} cameras from i-traffic.`
            : data.message ?? 'Done.',
        );
        router.refresh();
      } catch (e) {
        setMessage((e as Error).message);
      }
    });
  };

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold disabled:opacity-50"
      >
        {pending ? 'Importing…' : '⟳ Import i-traffic feed'}
      </button>
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
    </div>
  );
}
