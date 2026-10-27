'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, Search } from 'lucide-react';
import { useT } from '@/components/i18n';
import { cn } from '@/lib/utils';

export type WardRow = {
  ward: number; councillor: string | null; people: number | null; informal: number | null; water: number | null;
  children: number | null; older: number | null; past: number; damage2022: number; open: number; floodRisk: string | null;
};

type Key = 'ward' | 'people' | 'informal' | 'water' | 'children' | 'older' | 'past' | 'damage2022' | 'open';

/** The wards, sortable by any figure; each opens its profile. */
export function WardTable({ rows }: { rows: WardRow[] }) {
  const { t } = useT();
  const [sort, setSort] = useState<{ key: Key; down: boolean }>({ key: 'ward', down: false });
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => rows
    .filter((r) => !needle || `${r.ward} ${r.councillor ?? ''}`.toLowerCase().includes(needle))
    .sort((a, b) => {
      const x = a[sort.key] ?? -1;
      const y = b[sort.key] ?? -1;
      return (x === y ? a.ward - b.ward : x < y ? -1 : 1) * (sort.down ? -1 : 1);
    }), [rows, needle, sort]);
  const head = (key: Key, label: string, right = true) => (
    <th className={cn('px-3 py-3', right && 'text-right')}>
      <button type="button" onClick={() => setSort((s) => ({ key, down: s.key === key ? !s.down : key !== 'ward' }))}
        className="inline-flex items-center gap-1 font-semibold uppercase tracking-wide hover:text-fg">
        {label}{sort.key === key ? (sort.down ? <ArrowDown className="h-3.5 w-3.5" aria-hidden /> : <ArrowUp className="h-3.5 w-3.5" aria-hidden />) : null}
      </button>
    </th>
  );
  const pct = (v: number | null) => (v == null ? '—' : `${v < 10 ? v.toFixed(1) : Math.round(v)}%`);
  return (
    <div className="space-y-3">
      <label className="relative block w-full sm:w-72">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Ward number or councillor')}
          className="h-11 w-full rounded-md border border-border bg-bg-card pl-9 pr-3 text-sm" />
      </label>
      <div className="overflow-x-auto rounded-xl border border-border bg-bg-card shadow-sm">
        <table className="w-full min-w-[60rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              {head('ward', t('Ward'), false)}
              <th className="px-3 py-3 font-semibold uppercase tracking-wide">{t('Councillor')}</th>
              {head('people', t('People'))}{head('informal', t('Informal homes'))}{head('water', t('No piped water'))}
              {head('children', t('Children'))}{head('older', t('Over 65'))}{head('past', t('Past disasters'))}
              {head('damage2022', t('2022 damage'))}
              <th className="px-3 py-3 font-semibold uppercase tracking-wide">{t('Flood risk')}</th>
              {head('open', t('Open now'))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.ward} className="border-b border-border last:border-0 hover:bg-muted">
                <td className="px-3 py-2.5"><Link href={`/disaster/wards/${r.ward}`} className="font-bold text-accent hover:underline">{t('Ward {w}', { w: r.ward })}</Link></td>
                <td className="px-3 py-2.5">{r.councillor ?? <span className="text-muted-foreground">{t('Not on the list')}</span>}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{r.people?.toLocaleString('en-ZA') ?? '—'}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{pct(r.informal)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{pct(r.water)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{pct(r.children)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{pct(r.older)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{r.past || '—'}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{r.damage2022 || '—'}</td>
                <td className="px-3 py-2.5">{r.floodRisk ? t(r.floodRisk) : '—'}</td>
                <td className={cn('px-3 py-2.5 text-right font-semibold tabular-nums', r.open > 0 && 'text-severity-critical-ink')}>{r.open || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 ? <p className="p-8 text-center text-muted-foreground">{t('No ward matches.')}</p> : null}
      </div>
    </div>
  );
}
