'use client';

import { useState, useTransition } from 'react';
import { useT } from '@/components/i18n';
import { cn } from '@/lib/utils';
import { populationAction, reliefStockAction } from './actions';

type StockRow = { key: string; label: string; inStorage: number; minimum: number; issued: number };

/** In storage and the minimum for each relief item; a row below its minimum shows red. Saved row by row. */
export function StockTable({ rows }: { rows: StockRow[] }) {
  const { t } = useT();
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <th className="py-2 pr-3">{t('Item')}</th><th className="py-2 pr-3">{t('In storage')}</th><th className="py-2 pr-3">{t('Minimum')}</th>
            <th className="py-2 pr-3 text-right">{t('Issued this year')}</th><th />
          </tr>
        </thead>
        <tbody>{rows.map((r) => <StockLine key={r.key} row={r} />)}</tbody>
      </table>
    </div>
  );
}

function StockLine({ row }: { row: StockRow }) {
  const { t } = useT();
  const [pending, start] = useTransition();
  const [v, setV] = useState({ inStorage: String(row.inStorage), minimum: String(row.minimum) });
  const [note, setNote] = useState<string | null>(null);
  const dirty = v.inStorage !== String(row.inStorage) || v.minimum !== String(row.minimum);
  const low = Number(v.minimum) > 0 && Number(v.inStorage) < Number(v.minimum);
  const field = 'h-11 w-28 rounded-md border bg-bg-soft px-3 text-[15px] tabular-nums';
  return (
    <tr className="border-b border-border last:border-0">
      <td className="py-2 pr-3 font-medium">{t(row.label)}</td>
      <td className="py-2 pr-3">
        <input value={v.inStorage} inputMode="numeric" aria-label={t('{item} in storage', { item: t(row.label) })}
          onChange={(e) => setV({ ...v, inStorage: e.target.value.replace(/\D/g, '').slice(0, 7) })}
          className={cn(field, low ? 'border-severity-critical text-severity-critical-ink' : 'border-border')} />
      </td>
      <td className="py-2 pr-3">
        <input value={v.minimum} inputMode="numeric" aria-label={t('Minimum {item}', { item: t(row.label) })}
          onChange={(e) => setV({ ...v, minimum: e.target.value.replace(/\D/g, '').slice(0, 7) })} className={cn(field, 'border-border')} />
      </td>
      <td className="py-2 pr-3 text-right font-semibold tabular-nums">{row.issued.toLocaleString('en-ZA')}</td>
      <td className="py-2">
        {dirty ? (
          <button type="button" disabled={pending}
            onClick={() => start(async () => {
              const res = await reliefStockAction(row.key, v.inStorage || '0', v.minimum || '0');
              setNote('error' in res ? res.error : null);
            })}
            className="h-11 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">{pending ? t('Saving…') : t('Save')}</button>
        ) : null}
        {note ? <output className="block text-xs text-severity-critical-ink">{note}</output> : null}
      </td>
    </tr>
  );
}

/** The city's population, once, for deaths per 100 000 (FD1.2). */
export function PopulationForm({ population, note }: { population: number | null; note: string }) {
  const { t } = useT();
  const [pending, start] = useTransition();
  const [v, setV] = useState({ population: population ? String(population) : '', note });
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="space-y-2 rounded-xl border border-border p-3">
      <p className="text-sm font-semibold">{t('Population of eThekwini')}</p>
      <div className="flex flex-wrap gap-2">
        <input value={v.population} inputMode="numeric" placeholder={t('For example 4300000')} aria-label={t('Population')}
          onChange={(e) => setV({ ...v, population: e.target.value.replace(/[^\d]/g, '').slice(0, 8) })}
          className="h-11 w-40 rounded-md border border-border bg-bg-soft px-3 text-[15px] tabular-nums" />
        <input value={v.note} maxLength={200} placeholder={t('Source, e.g. Stats SA mid-year estimate')} aria-label={t('Where the figure is from')}
          onChange={(e) => setV({ ...v, note: e.target.value })} className="h-11 min-w-0 flex-1 rounded-md border border-border bg-bg-soft px-3 text-sm" />
        <button type="button" disabled={pending || !v.population}
          onClick={() => start(async () => {
            const res = await populationAction(v.population, v.note);
            setMsg('error' in res ? res.error : t('Saved.'));
          })}
          className="h-11 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">{t('Save')}</button>
      </div>
      {msg ? <output className="text-xs text-muted-foreground">{msg}</output> : null}
    </div>
  );
}
