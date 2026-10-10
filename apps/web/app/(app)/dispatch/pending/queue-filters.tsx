'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Loader2, Search, X } from 'lucide-react';

type Option = [string, string];

/** The queue's filters: each change applies at once; the search as you type. */
export function QueueFilters({ sorts, severities, regions, departments }: {
  sorts: Option[];
  severities: string[];
  regions: string[];
  departments: Option[];
}) {
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
  const active = ['q', 'severity', 'region', 'department', 'sort'].some((k) => params.get(k));

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-bg-card px-3 py-2.5">
      <div className="relative min-w-[220px] flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <label htmlFor="q" className="sr-only">Search the queue</label>
        <input
          id="q" value={q} placeholder="Search incident #, caller, phone, address, type"
          onChange={(e) => { typed.current = true; setQ(e.target.value); }}
          className={`${field} w-full pl-8`}
        />
      </div>
      <label htmlFor="sort" className="sr-only">Order</label>
      <select id="sort" value={params.get('sort') ?? 'newest'} onChange={(e) => apply('sort', e.target.value === 'newest' ? '' : e.target.value)} className={field}>
        {sorts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <label htmlFor="severity" className="sr-only">Severity</label>
      <select id="severity" value={params.get('severity') ?? ''} onChange={(e) => apply('severity', e.target.value)} className={field}>
        <option value="">All severities</option>
        {severities.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <label htmlFor="region" className="sr-only">Region</label>
      <select id="region" value={params.get('region') ?? ''} onChange={(e) => apply('region', e.target.value)} className={field}>
        <option value="">All regions</option>
        {regions.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
      {departments.length ? (
        <>
          <label htmlFor="department" className="sr-only">Sent to</label>
          <select id="department" value={params.get('department') ?? ''} onChange={(e) => apply('department', e.target.value)} className={field}>
            <option value="">Sent to any desk</option>
            {departments.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </>
      ) : null}
      {pending ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Updating" /> : null}
      {active ? (
        <button
          type="button"
          onClick={() => { typed.current = false; setQ(''); start(() => router.replace(pathname, { scroll: false })); }}
          className="inline-flex items-center gap-1 text-sm text-accent hover:underline"
        >
          <X className="h-3.5 w-3.5" /> Clear
        </button>
      ) : null}
    </div>
  );
}
