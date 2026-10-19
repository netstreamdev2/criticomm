'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { DEPARTMENT_NAMES, type Silo } from '@criticom/db';
import { resendManyAction } from '@/app/(app)/admin/invitations/actions';
import { BulkRunDialog, type BulkItem } from '@/components/register/bulk-run';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useT } from '@/components/i18n';

export type ChasePerson = {
  id: string; name: string; badge: string; silo: Silo; station: string;
  invitationId: string; status: 'ready' | 'sent' | 'opened' | 'expired' | 'locked';
  channel: 'email' | 'sms' | 'code'; failed: boolean;
};

const LABEL: Record<ChasePerson['status'], string> = {
  ready: 'Not delivered', sent: 'Not opened yet', opened: 'Opened, not finished', expired: 'Expired', locked: 'Locked',
};
const CHANNEL = { email: 'Email', sms: 'SMS', code: 'Printed code' } as const;

/** Sending again replaces their link or code. Someone part-way through activating is left alone. */
const resendable = (p: ChasePerson) => p.status !== 'opened';

/**
 * Everyone invited who has not activated yet, by station, so nobody reaches
 * go-live without a working account.
 */
export function ChaseList({ people, canSend }: { people: ChasePerson[]; canSend: boolean }) {
  const { t } = useT();
  const [station, setStation] = useState('all');
  const [running, setRunning] = useState<BulkItem[] | null>(null);
  const stations = useMemo(() => [...new Set(people.map((p) => `${p.silo}|${p.station}`))].sort(), [people]);
  const shown = people.filter((p) => station === 'all' || `${p.silo}|${p.station}` === station);
  const toSend = shown.filter(resendable);

  if (!people.length) return <p className="px-4 py-6 text-sm text-muted-foreground">{t('Nobody is waiting: everyone invited has activated.')}</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 px-4 pt-4">
        <select value={station} onChange={(e) => setStation(e.target.value)} aria-label={t('Station')}
          className="h-9 rounded-md border border-border bg-bg-soft px-2 text-sm">
          <option value="all">{t('All stations ({length})', { length: people.length })}</option>
          {stations.map((s) => {
            const [silo, st] = s.split('|') as [Silo, string];
            return <option key={s} value={s}>{DEPARTMENT_NAMES[silo]} · {st} ({people.filter((p) => `${p.silo}|${p.station}` === s).length})</option>;
          })}
        </select>
        {canSend && toSend.length ? (
          <Button size="sm" onClick={() => setRunning(toSend.map((p) => ({ key: p.invitationId, name: p.name, detail: `${LABEL[p.status]} · ${CHANNEL[p.channel]}` })))}>
            {t('Send again to {length} who {value} not opened theirs', { length: toSend.length, value: toSend.length === 1 ? 'has' : 'have' })}</Button>
        ) : null}
      </div>
      <ul className="divide-y divide-border border-t border-border">
        {shown.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
            <span>
              <span className="font-medium">{p.name}</span> <span className="font-mono text-xs text-muted-foreground">{p.badge}</span>
              <span className="text-xs text-muted-foreground"> · {DEPARTMENT_NAMES[p.silo]} · {p.station}</span>
            </span>
            <span className="flex items-center gap-3 text-xs">
              <span className={cn(p.status === 'locked' || p.failed ? 'text-severity-critical-ink' : p.status === 'expired' ? 'text-severity-medium-ink' : 'text-muted-foreground')}>
                {LABEL[p.status]} · {CHANNEL[p.channel]}
              </span>
              <Link href="/admin/invitations" className="font-semibold text-primary hover:underline">{t('Open')}</Link>
            </span>
          </li>
        ))}
      </ul>
      {running ? (
        <BulkRunDialog
          title={`Send again to ${running.length}`}
          intro="Each gets a fresh link or code; the old one stops working. Printed codes come out as new slips to hand over."
          items={running}
          confirmLabel={`Send ${running.length}`}
          run={(chunk) => resendManyAction(chunk.map((c) => ({ id: c.key, name: c.name })))}
          onClose={() => setRunning(null)}
        />
      ) : null}
    </div>
  );
}
