'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Send } from 'lucide-react';
import { DEPARTMENT_NAMES, type Silo } from '@criticom/db';
import { useToast } from '@/components/toast';
import { sendToDeskAction } from '../../actions';

/**
 * Bring another department in: the call goes to that department's dispatch
 * desk, which is told at once (0068). Only ever adds; a desk the call was
 * sent to stays on its record.
 */
export function SendToDesk({ incidentId, sentTo }: { incidentId: string; sentTo: Silo[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const others = (['MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster'] as Silo[]).filter((s) => !sentTo.includes(s));
  if (others.length === 0) return null;

  const send = (silo: Silo) => {
    setError(null);
    start(async () => {
      const res = await sendToDeskAction(incidentId, [silo], '');
      if (!res.ok) { setError(res.error); return; }
      toast.push({ title: `Sent to the ${DEPARTMENT_NAMES[silo]} dispatch desk`, body: 'Its dispatchers have been told.', tone: 'success' });
      router.refresh();
    });
  };

  return (
    <div>
      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Also send to</p>
      <div className="flex flex-wrap gap-2">
        {others.map((s) => (
          <button
            key={s}
            type="button"
            disabled={pending}
            onClick={() => send(s)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-bg-soft px-3 text-xs font-semibold hover:border-accent/50 disabled:opacity-60"
          >
            <Send className="h-3.5 w-3.5" aria-hidden /> {DEPARTMENT_NAMES[s]} desk
          </button>
        ))}
      </div>
      {error ? <p role="alert" className="mt-1.5 text-xs text-severity-critical-ink">{error}</p> : null}
    </div>
  );
}
