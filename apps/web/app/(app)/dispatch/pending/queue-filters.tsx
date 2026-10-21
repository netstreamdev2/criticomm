'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Loader2, RefreshCw, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/components/i18n';

type Option = [string, string];

const KEYS = ['q', 'severity', 'category', 'stage', 'region', 'department', 'from', 'to', 'sort'];

/**
 * The queue's filters, as V4 had them and a little more: search, then one row
 * of choices (severity, classification, status, region, desk, the days it was
 * logged). Each change applies at once; the search as you type. Newest first
 * unless another order is chosen.
 */
export function QueueFilters({ sorts, severities, categories, stages, regions, departments, shown }: {
  sorts: Option[];
  severities: string[];
  categories: string[];
  stages: Option[];
  regions: string[];
  departments: Option[];
  /** How many calls the filters leave. */
  shown: number;
}) {
  const { t } = useT();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(params.get('q') ?? '');
  const typed = useRef(false);

  const apply = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value); else next.delete(key);
    const qs = next.toString();
    start(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  // The search applies a moment after typing stops.
  useEffect(() => {
    if (!typed.current) return;
    const t = setTimeout(() => apply('q', q.trim()), 350);
    return () => clearTimeout(t);
    // apply reads the current params; re-running on its identity would loop.
  }, [q]);

  const field = 'h-9 rounded-md border border-border bg-bg-soft px-2.5 text-sm';
  const chosen = (k: string) => Boolean(params.get(k));
  const active = KEYS.some(chosen);
  // A chosen filter stands out, so it is clear why the list is shorter.
  const pick = (k: string) => cn(field, chosen(k) && 'border-accent text-fg');

  const select = (key: string, all: string, options: Option[]) => (
    <>
      <label htmlFor={`f-${key}`} className="sr-only">{all}</label>
      <select id={`f-${key}`} value={params.get(key) ?? ''} onChange={(e) => apply(key, e.target.value)} className={pick(key)}>
        <option value="">{all}</option>
        {options.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
      </select>
    </>
  );

  return (
    <div className="space-y-2 rounded-lg border border-border bg-bg-card px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <label htmlFor="q" className="sr-only">{t('Search the queue')}</label>
          <input
            id="q" value={q} placeholder={t('Search incident #, caller, phone, address, type or description')}
            onChange={(e) => { typed.current = true; setQ(e.target.value); }}
            className={`${field} w-full pl-8`}
          />
        </div>
        <label htmlFor="sort" className="sr-only">{t('Order')}</label>
        <select id="sort" value={params.get('sort') ?? 'newest'} onChange={(e) => apply('sort', e.target.value === 'newest' ? '' : e.target.value)} className={pick('sort')}>
          {sorts.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
        </select>
        <button
          type="button" onClick={() => start(() => router.refresh())}
          aria-label={t('Refresh')} title={t('Refresh')}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-bg-soft text-muted-foreground hover:text-fg"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {select('severity', t('All severities'), severities.map((s) => [s, s]))}
        {select('category', t('All classifications'), categories.map((c) => [c, c]))}
        {select('stage', t('All statuses'), stages)}
        {select('region', t('All regions'), regions.map((r) => [r, r]))}
        {departments.length ? select('department', t('Sent to any desk'), departments) : null}
        <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          {t('From')}
          <input type="date" value={params.get('from') ?? ''} onChange={(e) => apply('from', e.target.value)} className={pick('from')} />
        </label>
        <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          {t('To')}
          <input type="date" value={params.get('to') ?? ''} onChange={(e) => apply('to', e.target.value)} className={pick('to')} />
        </label>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {shown === 1 ? t('1 call') : t('{n} calls', { n: shown })}
        </span>
        {active ? (
          <button
            type="button"
            onClick={() => { typed.current = false; setQ(''); start(() => router.replace(pathname, { scroll: false })); }}
            className="inline-flex items-center gap-1 text-sm text-accent hover:underline"
          >
            <X className="h-3.5 w-3.5" /> {' '}{t('Clear')}</button>
        ) : null}
      </div>
    </div>
  );
}
