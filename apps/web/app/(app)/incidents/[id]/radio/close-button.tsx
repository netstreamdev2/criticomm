'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2 } from 'lucide-react';
import { closeFromDeskAction } from './actions';

/** Close a department's part on scene for its crew (0075), from the departments card. */
export function CloseOnSceneButton({ incidentId, silo, label }: { incidentId: string; silo: string; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!window.confirm(`Close ${label} on scene for the crew? Dispatch and command are told.`)) return;
          start(async () => {
            setError(null);
            const res = await closeFromDeskAction({ incidentId, silo });
            if (!res.ok) setError(res.error);
            router.refresh();
          });
        }}
        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-severity-low px-3 text-xs font-semibold text-white disabled:opacity-60"
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Close on scene
      </button>
      {error ? <span role="alert" className="text-xs text-severity-critical-ink">{error}</span> : null}
    </span>
  );
}
