'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCheck } from 'lucide-react';
import { markAllAlertsRead } from '@criticom/api';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { useT } from '@/components/i18n';

export function MarkAllRead({ count }: { count: number }) {
  const { t } = useT();
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
      className="frost-pill inline-flex h-9 items-center gap-2 rounded-full border border-border/60 px-4 text-sm font-semibold transition-colors hover:text-fg disabled:opacity-60"
    >
      <CheckCheck className="h-4 w-4" />
      {busy || pending ? t('Marking…') : t('Mark {count} read', { count })}
    </button>
  );
}
