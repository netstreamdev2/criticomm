'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCheck } from 'lucide-react';
import { markAllAlertsRead } from '@criticom/api';
import { getBrowserSupabase } from '@/lib/supabase-browser';

export function MarkAllRead({ count }: { count: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);

  const run = () => {
    setBusy(true);
    void markAllAlertsRead(getBrowserSupabase())
      .catch(() => {})
      .finally(() => {
        setBusy(false);
        start(() => router.refresh());
      });
  };

  return (
    <button
      type="button"
      onClick={run}
      disabled={busy || pending}
      className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-60"
    >
      <CheckCheck className="h-4 w-4" />
      {busy || pending ? 'Marking…' : `Mark ${count} read`}
    </button>
  );
}
