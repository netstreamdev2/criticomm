'use client';

import Link from 'next/link';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import type { UnfinishedCall } from '@criticom/api';
import { useT } from '@/components/i18n';
import { timeAgo } from '@/lib/utils';
import { severityWord } from './intake-ui';

/**
 * Calls sent to dispatch before their details were in, still unfinished
 * (0076). After a refresh, or on another computer, the call taker carries on
 * with the same call instead of logging it twice.
 */
export function UnfinishedCalls({ calls, userId }: { calls: UnfinishedCall[]; userId: string }) {
  const { t } = useT();
  return (
    <section className="rounded-2xl border border-severity-medium/50 bg-severity-medium/10 p-4" aria-labelledby="unfinished-title">
      <p id="unfinished-title" className="flex items-center gap-2 text-sm font-semibold">
        <AlertTriangle className="h-4 w-4 text-severity-medium-ink" aria-hidden />
        {calls.length === 1 ? t('1 call sent early still needs its details') : t('{n} calls sent early still need their details', { n: calls.length })}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{t('Dispatch already has them. Carry on to add what is missing; each change goes to the call.')}</p>
      <ul className="mt-3 space-y-1.5">
        {calls.map((c) => (
          <li key={c.id}>
            <Link
              href={`/dispatch/log-call?resume=${c.id}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-bg-card px-3 py-2 text-sm hover:border-accent/50"
            >
              <span className="font-mono text-xs font-semibold">{c.incident_number}</span>
              <span className="severity-pill" data-sev={c.incident_severity}>{severityWord(c.incident_severity, t)}</span>
              <span className="min-w-0 flex-1 truncate">{t(c.incident_type)} · {c.location_address}</span>
              <span className="text-xs text-muted-foreground">
                {c.created_by === userId ? t('You, {ago}', { ago: timeAgo(c.incident_created_at) }) : `${c.call_taken_by ?? t('Another call taker')}, ${timeAgo(c.incident_created_at)}`}
              </span>
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-accent">{t('Carry on')} <ArrowRight className="h-3.5 w-3.5" aria-hidden /></span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
