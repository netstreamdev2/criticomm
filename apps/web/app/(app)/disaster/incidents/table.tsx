'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { DM_STATUSES } from '@criticom/db/disaster-joc';
import { MUNICIPALITIES, levelRank, type CoordinationLevel } from '@criticom/db/disaster-plan';
import { useT } from '@/components/i18n';
import { cn, timeAgo } from '@/lib/utils';
import { DmStatusChip } from '../desk/[id]/after-tile';

export type IncidentRow = {
  id: string; number: string; title: string; hazard: string | null; level: CoordinationLevel; municipality: string; ward: string | null;
  place: string; severity: string; affected: number; status: (typeof DM_STATUSES)[number]; updated: string;
};

const BAR: Record<CoordinationLevel, string> = { Bronze: 'bg-[#b0753a]', Silver: 'bg-[#9aa6b2]', Gold: 'bg-[#d4a72c]' };

/** The level as three stacked bars, lit up to the level: one Bronze, two Silver, three Gold. */
function LevelBars({ level }: { level: CoordinationLevel }) {
  const n = levelRank(level);
  return (
    <span className="inline-flex flex-col-reverse gap-0.5" title={level} role="img" aria-label={level}>
      {[1, 2, 3].map((i) => <span key={i} className={cn('h-1.5 w-5 rounded-sm', i <= n ? BAR[level] : 'bg-muted')} />)}
    </span>
  );
}

export function IncidentTable({ rows }: { rows: IncidentRow[] }) {
  const { t } = useT();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<string>('Active');
  const [level, setLevel] = useState<string>('');
  const [muni, setMuni] = useState<string>('');
  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => rows
    .filter((r) => !status || r.status === status)
    .filter((r) => !level || r.level === level)
    .filter((r) => !muni || r.municipality === muni)
    .filter((r) => !needle || `${r.number} ${r.title} ${r.hazard ?? ''} ${r.place} ${r.ward ?? ''}`.toLowerCase().includes(needle)),
  [rows, status, level, muni, needle]);
  const select = 'h-11 rounded-md border border-border bg-bg-card px-3 text-sm';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <label className="relative block w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search reference, title or place')}
            className="h-11 w-full rounded-md border border-border bg-bg-card pl-9 pr-3 text-sm" />
        </label>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t('Status')} className={select}>
          <option value="">{t('All statuses')}</option>
          {DM_STATUSES.map((s) => <option key={s} value={s}>{t(s)}</option>)}
        </select>
        <select value={level} onChange={(e) => setLevel(e.target.value)} aria-label={t('Level')} className={select}>
          <option value="">{t('All levels')}</option>
          {(['Bronze', 'Silver', 'Gold'] as const).map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <select value={muni} onChange={(e) => setMuni(e.target.value)} aria-label={t('Municipality')} className={select}>
          <option value="">{t('All municipalities')}</option>
          {MUNICIPALITIES.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-bg-card shadow-sm">
        <table className="w-full min-w-[56rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3">{t('Level')}</th><th className="px-4 py-3">{t('Reference')}</th><th className="px-4 py-3">{t('Incident')}</th>
              <th className="px-4 py-3">{t('Where')}</th><th className="px-4 py-3">{t('Severity')}</th><th className="px-4 py-3">{t('Affected')}</th>
              <th className="px-4 py-3">{t('Status')}</th><th className="px-4 py-3">{t('Updated')}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted">
                <td className="px-4 py-3"><LevelBars level={r.level} /></td>
                <td className="px-4 py-3 font-mono font-semibold"><Link href={`/disaster/desk/${r.id}`} className="hover:underline">{r.number}</Link></td>
                <td className="px-4 py-3">
                  <Link href={`/disaster/desk/${r.id}`} className="block font-semibold hover:underline">{r.title}</Link>
                  {r.hazard && r.hazard !== r.title ? <span className="text-muted-foreground">{t(r.hazard)}</span> : null}
                </td>
                <td className="px-4 py-3">{r.municipality}{r.ward ? <span className="block text-muted-foreground">{t('Ward {w}', { w: r.ward })}</span> : null}</td>
                <td className="px-4 py-3"><span className="rounded bg-muted px-2 py-0.5 text-xs font-semibold">{t(r.severity)}</span></td>
                <td className="px-4 py-3 font-semibold tabular-nums">{r.affected}</td>
                <td className="px-4 py-3"><DmStatusChip status={r.status} /></td>
                <td className="px-4 py-3 text-muted-foreground">{timeAgo(r.updated)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 ? <p className="p-8 text-center text-muted-foreground">{t('No incident matches.')}</p> : null}
      </div>
    </div>
  );
}
