'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LayoutGrid, Search, Square, Video } from 'lucide-react';
import { subscribeBodycams } from '@criticom/api';
import { MAX_LIVE_FEEDS } from '@criticom/db/bodycams';
import { BodycamViewer, type BodycamTarget, type ViewReason } from '@/components/bodycam/bodycam-viewer';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { cn, formatSaTime } from '@/lib/utils';
import { useT } from '@/components/i18n';

export type WallBodycam = {
  bodycamId: string;
  serial: string;
  model: string | null;
  station: string | null;
  bookedAt: string | null;
  /** Without a Hikvision camera code, only the test video can play. */
  hasCode: boolean;
  officer: { name: string; badge: string | null; station: string | null; onDuty: boolean } | null;
};

const LAYOUT_KEY = 'criticom:bodycam-layout';

/**
 * The list of bodycams out with officers, and one or four live feeds. A feed
 * placed in a full layout of one replaces what was there; in four it takes
 * the next free place.
 */
export function BodycamWall({ cams, testVideo }: { cams: WallBodycam[]; testVideo: boolean }) {
  const { t } = useT();
  const router = useRouter();
  const [layout, setLayout] = useState<1 | 4>(1);
  const [slots, setSlots] = useState<Array<BodycamTarget | null>>(() => Array(MAX_LIVE_FEEDS).fill(null));
  const [lastReason, setLastReason] = useState<ViewReason | null>(null);
  const [q, setQ] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    try {
      if (localStorage.getItem(LAYOUT_KEY) === '4') setLayout(4);
    } catch { /* private window: one feed it is */ }
  }, []);
  const chooseLayout = (n: 1 | 4) => {
    setLayout(n);
    // Going down to one keeps the first open feed and closes the rest.
    if (n === 1) setSlots((cur) => [cur.find(Boolean) ?? null, null, null, null]);
    try { localStorage.setItem(LAYOUT_KEY, String(n)); } catch { /* not fatal */ }
  };

  // Booked out and handed back show here without a refresh.
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    let off = () => {};
    try {
      off = subscribeBodycams(getBrowserSupabase(), () => {
        if (pending.current) clearTimeout(pending.current);
        pending.current = setTimeout(() => router.refresh(), 800);
      });
    } catch { /* no realtime config: the minute tick still refreshes */ }
    const tick = setInterval(() => router.refresh(), 60_000);
    return () => {
      off();
      clearInterval(tick);
      if (pending.current) clearTimeout(pending.current);
    };
  }, [router]);

  const open = new Set(slots.filter(Boolean).map((s) => s!.bodycamId));
  const place = (cam: WallBodycam) => {
    const target: BodycamTarget = { bodycamId: cam.bodycamId, serial: cam.serial, officer: cam.officer?.name ?? null };
    if (layout === 1) {
      setNotice(null);
      setSlots([target, null, null, null]);
      return;
    }
    const free = slots.findIndex((s) => !s);
    if (free === -1) {
      setNotice(`All ${MAX_LIVE_FEEDS} places are in use. Close one first.`);
      return;
    }
    setNotice(null);
    setSlots((cur) => cur.map((s, j) => (j === free ? target : s)));
  };
  const clear = (i: number) => setSlots((cur) => cur.map((s, j) => (j === i ? null : s)));

  const needle = q.trim().toLowerCase();
  const shown = cams.filter((c) => !needle
    || [c.serial, c.officer?.name, c.officer?.badge, c.officer?.station, c.station].some((v) => v?.toLowerCase().includes(needle)));

  return (
    <div className="grid gap-4 xl:grid-cols-[20rem_1fr]">
      <section aria-label={t('Bodycams out with officers')} className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold">{t('{length} bodycam{value} out', { length: cams.length, value: cams.length === 1 ? '' : 's' })}</h2>
          <fieldset className="flex rounded-lg border border-border p-0.5">
            <legend className="sr-only">{t('How many feeds')}</legend>
            {([1, 4] as const).map((n) => (
              <button key={n} type="button" onClick={() => chooseLayout(n)} aria-pressed={layout === n}
                className={cn('inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold',
                  layout === n ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}>
                {n === 1 ? <Square className="h-3.5 w-3.5" /> : <LayoutGrid className="h-3.5 w-3.5" />} {n}
              </button>
            ))}
          </fieldset>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Officer, badge, serial, station')}
            aria-label={t('Search bodycams')} className="h-9 w-full rounded-md border border-border bg-bg-soft pl-8 pr-2 text-sm" />
        </div>
        {notice ? <output className="block text-xs text-severity-medium-ink">{notice}</output> : null}
        {shown.length === 0 ? (
          <p className="rounded-xl border border-border bg-bg-card px-4 py-8 text-center text-sm text-muted-foreground">
            {cams.length ? 'Nothing matches.' : 'No bodycam is out with an officer right now. Officers book one out in the app at the start of their shift.'}
          </p>
        ) : (
          <ul className="max-h-[70vh] divide-y divide-border overflow-y-auto rounded-xl border border-border bg-bg-card">
            {shown.map((c) => (
              <li key={c.bodycamId} className="flex items-start gap-3 px-3 py-2.5">
                <span className={cn('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', c.officer?.onDuty ? 'bg-success' : 'bg-muted-foreground/50')}
                  aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{c.officer?.name ?? 'An officer'}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[c.officer?.badge, c.officer?.station ?? c.station].filter(Boolean).join(' · ') || '—'}
                  </p>
                  <p className="truncate font-mono text-[11px] text-muted-foreground">
                    {t('{serial} · since {saTime}{value}', { serial: c.serial, saTime: formatSaTime(c.bookedAt), value: c.officer && !c.officer.onDuty ? ' · off duty' : '' })}
                  </p>
                  {!c.hasCode && !testVideo ? (
                    <p className="text-[11px] text-severity-medium-ink">{t('No Hikvision camera code on the register yet.')}</p>
                  ) : null}
                </div>
                <button type="button" onClick={() => place(c)} disabled={open.has(c.bodycamId)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-bold text-primary-foreground disabled:opacity-40">
                  <Video className="h-3.5 w-3.5" /> {open.has(c.bodycamId) ? 'Open' : 'Watch'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label={t('Live feeds')} className={cn('grid content-start gap-3', layout === 4 && 'md:grid-cols-2')}>
        {slots.slice(0, layout).map((s, i) => (s ? (
          <BodycamViewer
            key={`${i}-${s.bodycamId}`}
            target={s}
            kind="live"
            defaultReason={lastReason}
            onReason={setLastReason}
            onClose={() => clear(i)}
          />
        ) : (
          <div key={`empty-${i}`} className="flex aspect-video items-center justify-center rounded-xl border border-dashed border-border bg-bg-card p-4 text-center text-sm text-muted-foreground">
            {t('Choose a bodycam from the list to watch it here.')}</div>
        )))}
      </section>
    </div>
  );
}
