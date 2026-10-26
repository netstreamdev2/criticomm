'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Clock, MapPin, Radio, Search, TriangleAlert, Truck, X } from 'lucide-react';
import type { CoordinationLevel } from '@criticom/db/disaster-plan';
import { useT } from '@/components/i18n';
import { cn, timeAgo } from '@/lib/utils';
import { LevelChip } from './[id]/call-facts';

export type DeskCard = {
  id: string; number: string; title: string; hazard: string | null; group: string | null; severity: string; level: CoordinationLevel;
  place: string; calledAt: string; heardAt: string; description: string | null;
  checks: Array<{ text: string; urgent: boolean }>;
  partners: Array<{ id: string; name: string; status: string }>;
  calledOut: number;
};

const TOP: Record<string, string> = {
  Critical: 'border-t-severity-critical', High: 'border-t-severity-high', Medium: 'border-t-severity-medium', Low: 'border-t-severity-low',
};
const SEVERITY_TONE: Record<string, string> = {
  Critical: 'bg-severity-critical/15 text-severity-critical-ink', High: 'bg-severity-high/15 text-severity-high-ink',
  Medium: 'bg-severity-medium/15 text-severity-medium-ink', Low: 'bg-severity-low/15 text-severity-low-ink',
};
const PARTNER_TONE: Record<string, string> = {
  Called: 'bg-sky-500/15 text-sky-300', 'On the way': 'bg-severity-medium/15 text-severity-medium-ink', 'On scene': 'bg-severity-low/15 text-severity-low-ink',
};
const SEVERITY_RANK: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };
/** Called in within the last half hour. */
const NEW_FOR_MS = 30 * 60_000;

type Show = 'all' | 'action' | 'nobody' | 'serious' | 'raised';
const SHOWS: Array<{ key: Show; label: string; test: (c: DeskCard) => boolean }> = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'action', label: 'Need action', test: (c) => c.checks.length > 0 },
  { key: 'nobody', label: 'Nobody called out', test: (c) => c.calledOut === 0 },
  { key: 'serious', label: 'Critical and high', test: (c) => c.severity === 'Critical' || c.severity === 'High' },
  { key: 'raised', label: 'Silver or Gold', test: (c) => c.level !== 'Bronze' },
];

/**
 * The open incidents on the Disaster desk as cards of one size, newest first
 * (or most urgent first, when chosen). Filters by what needs the desk, by
 * hazard and by a search; each choice shows how many it leaves. The choice
 * is kept on this computer.
 */
export function DeskCards({ cards }: { cards: DeskCard[] }) {
  const { t } = useT();
  const [show, setShow] = useState<Show>('all');
  const [group, setGroup] = useState('');
  const [q, setQ] = useState('');
  const [order, setOrder] = useState<'newest' | 'urgent'>('newest');
  const [now, setNow] = useState(() => Date.now());

  // The times on the cards move on by themselves.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('disaster-desk-view') ?? '{}') as { show?: Show; order?: 'newest' | 'urgent' };
      if (saved.show && SHOWS.some((s) => s.key === saved.show)) setShow(saved.show);
      if (saved.order === 'urgent' || saved.order === 'newest') setOrder(saved.order);
    } catch { /* a private window: the defaults */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem('disaster-desk-view', JSON.stringify({ show, order })); } catch { /* nothing to keep it in */ }
  }, [show, order]);

  const needle = q.trim().toLowerCase();
  const found = (c: DeskCard) => !needle || `${c.title} ${c.number} ${c.place} ${c.hazard ?? ''}`.toLowerCase().includes(needle);
  const inGroup = (c: DeskCard) => !group || c.group === group;
  const showTest = SHOWS.find((s) => s.key === show)!.test;
  const shown = cards.filter((c) => found(c) && inGroup(c) && showTest(c)).sort((a, b) => order === 'newest'
    ? b.calledAt.localeCompare(a.calledAt)
    : Number(b.checks.some((x) => x.urgent)) - Number(a.checks.some((x) => x.urgent)) || Number(b.checks.length > 0) - Number(a.checks.length > 0)
      || (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) || b.calledAt.localeCompare(a.calledAt));
  const groups = [...new Set(cards.map((c) => c.group).filter((g): g is string => !!g))].sort();
  const filtered = show !== 'all' || !!group || !!needle;
  const chip = (on: boolean) => cn('inline-flex h-10 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors',
    on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-bg-card hover:bg-muted');

  return (
    <div className="space-y-5">
      <div className="space-y-3 rounded-2xl border border-border bg-bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative block min-w-[14rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search: title, number or place')} aria-label={t('Search the incidents')}
              className="h-11 w-full rounded-md border border-border bg-bg-soft pl-9 pr-3 text-sm" />
          </label>
          {groups.length > 1 ? (
            <select value={group} onChange={(e) => setGroup(e.target.value)} aria-label={t('Hazard')} className="h-11 rounded-md border border-border bg-bg-soft px-3 text-sm">
              <option value="">{t('Every hazard')}</option>
              {groups.map((g) => <option key={g} value={g}>{t(g)}</option>)}
            </select>
          ) : null}
          <fieldset className="inline-flex rounded-md border border-border p-0.5">
            <legend className="sr-only">{t('Order')}</legend>
            {(['newest', 'urgent'] as const).map((o) => (
              <button key={o} type="button" aria-pressed={order === o} onClick={() => setOrder(o)}
                className={cn('h-10 rounded px-4 text-sm font-medium', order === o ? 'bg-muted text-fg' : 'text-muted-foreground hover:text-fg')}>
                {o === 'newest' ? t('Newest first') : t('Most urgent first')}
              </button>
            ))}
          </fieldset>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {SHOWS.map((s) => {
            const n = cards.filter((c) => found(c) && inGroup(c) && s.test(c)).length;
            if (s.key !== 'all' && n === 0 && show !== s.key) return null;
            return (
              <button key={s.key} type="button" aria-pressed={show === s.key} onClick={() => setShow(s.key)} className={chip(show === s.key)}>
                {t(s.label)}<span className={cn('text-xs', show === s.key ? 'opacity-80' : 'text-muted-foreground')}>{n}</span>
              </button>
            );
          })}
          {filtered ? (
            <button type="button" onClick={() => { setShow('all'); setGroup(''); setQ(''); }} className="ml-auto inline-flex h-10 items-center gap-1.5 rounded-md px-3 text-sm text-muted-foreground hover:bg-muted">
              <X className="h-4 w-4" aria-hidden />{t('Clear filters')}
            </button>
          ) : null}
        </div>
      </div>

      {cards.length === 0 ? (
        <div className="rounded-2xl border border-border bg-bg-card p-10 text-center shadow-sm">
          <p className="text-lg font-semibold">{t('All clear')}</p>
          <p className="text-sm text-muted-foreground">{t('No open disaster calls.')}</p>
        </div>
      ) : shown.length === 0 ? (
        <p className="rounded-2xl border border-border bg-bg-card p-8 text-center text-sm text-muted-foreground shadow-sm">{t('No incident matches. Clear the filters to see them all.')}</p>
      ) : null}

      <ul className="grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-3">
        {shown.map((c) => {
          const fresh = now - new Date(c.calledAt).getTime() < NEW_FOR_MS;
          const urgent = c.checks.some((x) => x.urgent);
          return (
            <li key={c.id}>
              <Link href={`/disaster/desk/${c.id}`}
                className={cn('group flex h-full flex-col rounded-2xl border border-t-4 border-border bg-bg-card shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg',
                  TOP[c.severity] ?? 'border-t-accent', urgent && 'ring-1 ring-severity-critical/50')}>
                <div className="space-y-3 p-5">
                  <div className="flex items-center gap-2 text-xs">
                    <LevelChip level={c.level} />
                    <span className={cn('rounded-full px-2.5 py-0.5 font-bold uppercase tracking-wide', SEVERITY_TONE[c.severity] ?? 'bg-muted')}>{t(c.severity)}</span>
                    {fresh ? <span className="rounded-full bg-accent px-2.5 py-0.5 font-bold uppercase tracking-wide text-accent-foreground">{t('New')}</span> : null}
                    <ChevronRight className="ml-auto h-5 w-5 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-fg" aria-hidden />
                  </div>
                  <div>
                    <p className="text-xl font-bold leading-tight">{c.title}</p>
                    {c.hazard && c.hazard !== c.title ? <p className="mt-0.5 text-sm text-muted-foreground">{c.hazard}</p> : null}
                    <p className="mt-1.5 flex items-start gap-1.5 text-sm text-muted-foreground">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /><span className="line-clamp-2">{c.place}</span>
                    </p>
                  </div>
                  {c.description ? <p className="line-clamp-2 text-sm">{c.description}</p> : null}
                </div>

                {c.checks.length ? (
                  <div className={cn('mx-5 mb-4 space-y-1 rounded-lg px-3 py-2.5 text-sm font-medium',
                    urgent ? 'bg-severity-critical/10 text-severity-critical-ink' : 'bg-severity-medium/10 text-severity-medium-ink')}>
                    {c.checks.slice(0, 2).map((x) => (
                      <p key={x.text} className="flex items-start gap-1.5"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{x.text}</p>
                    ))}
                  </div>
                ) : null}

                {c.partners.length ? (
                  <ul className="mx-5 mb-4 flex flex-wrap gap-1.5">
                    {c.partners.slice(0, 4).map((p) => (
                      <li key={p.id} className={cn('rounded-full px-2.5 py-1 text-xs font-semibold', PARTNER_TONE[p.status] ?? 'bg-muted')}>{p.name} · {t(p.status)}</li>
                    ))}
                    {c.partners.length > 4 ? <li className="rounded-full bg-muted px-2.5 py-1 text-xs">+{c.partners.length - 4}</li> : null}
                  </ul>
                ) : null}

                <div className="mt-auto grid grid-cols-3 gap-2 border-t border-border px-5 py-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1" suppressHydrationWarning><Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />{timeAgo(c.calledAt)}</span>
                  <span className="flex items-center gap-1"><Truck className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    {c.partners.length ? t('{n} working', { n: c.partners.length }) : c.calledOut ? t('All left') : t('None yet')}</span>
                  <span className="flex items-center gap-1" suppressHydrationWarning><Radio className="h-3.5 w-3.5 shrink-0" aria-hidden />{t('news {ago}', { ago: timeAgo(c.heardAt) })}</span>
                </div>
                <p className="border-t border-border px-5 py-2 font-mono text-[11px] text-muted-foreground">{c.number}</p>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
