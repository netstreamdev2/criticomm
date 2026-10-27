'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Download, Search } from 'lucide-react';
import { PRIORITY_RISKS } from '@criticom/db/disaster-plan';
import { useT } from '@/components/i18n';
import { loadRecordsAction } from './actions';

export type RecordRow = {
  id: string; year: number; date: string | null; event: string; category: string | null; risk: string | null; place: string | null;
  ward: number | null; deaths: number | null; homes: number | null; affected: number | null; cost: string | null; notes: string | null; source: string;
};

const day = new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });

/** Load (or refresh) the records from the NDMC and the briefing. */
export function LoadRecords({ hasRows }: { hasRows: boolean }) {
  const { t } = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" disabled={pending}
        onClick={() => start(async () => {
          const res = await loadRecordsAction();
          setNote('error' in res ? res.error : t('{n} events loaded.', { n: res.loaded }) + (res.skipped ? ` ${t('{n} skipped.', { n: res.skipped })}` : ''));
          router.refresh();
        })}
        className="inline-flex h-11 items-center gap-2 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50">
        <Download className="h-4 w-4" aria-hidden />{pending ? t('Loading…') : hasRows ? t('Load the records again') : t('Load the records')}
      </button>
      {note ? <output className="text-sm text-muted-foreground">{note}</output> : null}
    </div>
  );
}

export function RecordsTable({ rows }: { rows: RecordRow[] }) {
  const { t } = useT();
  const [q, setQ] = useState('');
  const [risk, setRisk] = useState('');
  const [decade, setDecade] = useState('');
  const [ward, setWard] = useState('');
  const decades = useMemo(() => [...new Set(rows.map((r) => Math.floor(r.year / 10) * 10))].sort((a, b) => b - a), [rows]);
  const needle = q.trim().toLowerCase();
  const shown = rows
    .filter((r) => !risk || (risk === 'none' ? !r.risk : r.risk === risk))
    .filter((r) => !decade || Math.floor(r.year / 10) * 10 === Number(decade))
    .filter((r) => !ward || String(r.ward ?? '') === ward.trim())
    .filter((r) => !needle || `${r.event} ${r.category ?? ''} ${r.place ?? ''} ${r.notes ?? ''}`.toLowerCase().includes(needle));
  const select = 'h-11 rounded-md border border-border bg-bg-card px-3 text-sm';
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <label className="relative block w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search: place, event, note')}
            className="h-11 w-full rounded-md border border-border bg-bg-card pl-9 pr-3 text-sm" />
        </label>
        <select value={risk} onChange={(e) => setRisk(e.target.value)} aria-label={t('Risk')} className={select}>
          <option value="">{t('All risks')}</option>
          {PRIORITY_RISKS.map((r) => <option key={r} value={r}>{t(r)}</option>)}
          <option value="none">{t('Other events')}</option>
        </select>
        <select value={decade} onChange={(e) => setDecade(e.target.value)} aria-label={t('Decade')} className={select}>
          <option value="">{t('All years')}</option>
          {decades.map((d) => <option key={d} value={d}>{t('{d}s', { d })}</option>)}
        </select>
        <input value={ward} onChange={(e) => setWard(e.target.value.replace(/\D/g, '').slice(0, 3))} inputMode="numeric" placeholder={t('Ward')}
          aria-label={t('Ward')} className="h-11 w-24 rounded-md border border-border bg-bg-card px-3 text-sm" />
        <span className="self-center text-sm text-muted-foreground">{t('{n} of {all}', { n: shown.length, all: rows.length })}</span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-bg-card shadow-sm">
        <table className="w-full min-w-[56rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3">{t('When')}</th><th className="px-4 py-3">{t('What')}</th><th className="px-4 py-3">{t('Where')}</th>
              <th className="px-4 py-3 text-right">{t('Deaths')}</th><th className="px-4 py-3 text-right">{t('Homes')}</th>
              <th className="px-4 py-3">{t('Notes')}</th><th className="px-4 py-3">{t('From')}</th>
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, 500).map((r) => (
              <tr key={r.id} className="border-b border-border align-top last:border-0">
                <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">{r.date ? day.format(new Date(r.date)) : r.year}</td>
                <td className="px-4 py-2.5">
                  <span className="block font-semibold">{r.event}</span>
                  <span className="text-xs text-muted-foreground">{r.risk ? t(r.risk) : r.category}</span>
                </td>
                <td className="px-4 py-2.5">
                  {r.place ?? '—'}
                  {r.ward ? <Link href={`/disaster/wards/${r.ward}`} className="block text-xs font-semibold text-accent hover:underline">{t('Ward {w}', { w: r.ward })}</Link> : null}
                </td>
                <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{r.deaths ?? '—'}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{r.homes ?? '—'}</td>
                <td className="max-w-md px-4 py-2.5 text-muted-foreground">{[r.cost, r.notes].filter(Boolean).join(' · ') || '—'}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">{t(r.source)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 ? <p className="p-8 text-center text-muted-foreground">{t('No event matches.')}</p> : null}
      </div>
    </div>
  );
}
