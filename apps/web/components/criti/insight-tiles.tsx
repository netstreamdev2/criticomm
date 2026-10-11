'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, Bell, CheckCircle2, Clock, Copy, Hourglass, Layers, MapPin, MessageSquare, Navigation,
  PhoneMissed, Send, Siren, Sparkles, Timer, UserX, X,
} from 'lucide-react';
import { onDutyFlip, subscribeIncidentUpdates, subscribeNewIncidents, subscribePersonnel } from '@criticom/api';
import type { Insight, InsightKind, InsightTone, ProposalView } from '@criticom/api';
import { Modal } from '@/components/ui/modal';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { cn } from '@/lib/utils';
import { ProposalCard } from './proposal-card';
import { COUNT_EVENT, askCriti, openCriti, standing } from './shared';

/**
 * Criti's suggestion tiles: what needs attention now, for this person.
 *
 * Worked out on the server by fixed rules from the board they may see, so
 * they need no AI and cost nothing to run. They refresh on every change to a
 * call or a crew and every 30 seconds. A tile's task opens a card to
 * confirm; × hides a tile for 15 minutes on this screen.
 */

const ICON: Record<InsightKind, typeof Siren> = {
  sos: Siren,
  incoming_critical: AlertTriangle,
  late_dispatch: Timer,
  not_accepted: PhoneMissed,
  no_arrival: Navigation,
  gone_quiet: Hourglass,
  possible_duplicate: Copy,
  missing_desk: Send,
  no_crews: UserX,
  queue_building: Layers,
  long_shift: Clock,
  on_scene_long: MapPin,
  my_call: Bell,
};

const TONE: Record<InsightTone, { rail: string; wash: string; ink: string }> = {
  critical: { rail: 'border-l-severity-critical', wash: 'bg-severity-critical/[0.07]', ink: 'text-severity-critical-ink' },
  high: { rail: 'border-l-severity-high', wash: 'bg-severity-high/[0.06]', ink: 'text-severity-high-ink' },
  warning: { rail: 'border-l-severity-medium', wash: 'bg-severity-medium/[0.06]', ink: 'text-severity-medium-ink' },
  info: { rail: 'border-l-accent', wash: 'bg-bg-card', ink: 'text-accent' },
};

const SNOOZE_KEY = 'criti:snoozed';
const SNOOZE_MS = 15 * 60_000;
const SHOWN = 6;

function readSnoozed(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(SNOOZE_KEY) ?? '{}') as Record<string, number>;
    const now = Date.now();
    return Object.fromEntries(Object.entries(raw).filter(([, until]) => typeof until === 'number' && until > now));
  } catch {
    return {};
  }
}

export function CritiTiles({ variant = 'page' }: { variant?: 'page' | 'dock' }) {
  const [insights, setInsights] = useState<Insight[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [failed, setFailed] = useState(false);
  const [showAll, setShowAll] = useState(variant === 'dock');
  const [snoozed, setSnoozed] = useState<Record<string, number>>({});
  const [confirming, setConfirming] = useState<ProposalView | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busy = useRef(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const res = await fetch('/api/criti/insights', { cache: 'no-store' });
      if (res.status === 404) { setEnabled(false); return; }
      if (!res.ok) { setFailed(true); return; }
      const data = (await res.json()) as { insights?: Insight[]; applies?: boolean; error?: string };
      if (data.applies === false) { setEnabled(false); return; }
      setInsights(data.insights ?? []);
      setFailed(Boolean(data.error));
    } catch {
      setFailed(true);
    } finally {
      busy.current = false;
      setNow(Date.now());
    }
  }, []);

  // A burst of changes (a crew stepping En Route → On Scene) is one refresh.
  const soon = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void load(), 1200);
  }, [load]);

  useEffect(() => {
    setSnoozed(readSnoozed());
    void load();
    let offNew = () => {};
    let offUpd = () => {};
    let offDuty = () => {};
    try {
      const sb = getBrowserSupabase();
      offNew = subscribeNewIncidents(sb, 'all', soon);
      offUpd = subscribeIncidentUpdates(sb, 'all', soon);
      offDuty = subscribePersonnel(sb, onDutyFlip(soon));
    } catch { /* no live connection: the 30-second refresh still runs */ }
    const poll = setInterval(() => void load(), 30_000);
    const tick = setInterval(() => setNow(Date.now()), 20_000);
    return () => {
      offNew(); offUpd(); offDuty();
      clearInterval(poll); clearInterval(tick);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load, soon]);

  // In the dock, bring the card into view once when it opens.
  useEffect(() => {
    if (confirming && variant === 'dock') cardRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [confirming, variant]);

  const visible = useMemo(() => (insights ?? []).filter((x) => !snoozed[x.id] || snoozed[x.id]! < now), [insights, snoozed, now]);
  const urgent = visible.filter((x) => x.tone === 'critical' || x.tone === 'high').length;

  // The dock's launcher shows how many urgent tiles there are.
  useEffect(() => {
    if (insights === null) return;
    window.dispatchEvent(new CustomEvent(COUNT_EVENT, { detail: { urgent } }));
  }, [urgent, insights]);

  const snooze = (id: string) => {
    const next = { ...readSnoozed(), [id]: Date.now() + SNOOZE_MS };
    setSnoozed(next);
    try { localStorage.setItem(SNOOZE_KEY, JSON.stringify(next)); } catch { /* private mode: hidden until reload */ }
  };

  if (!enabled) return null;
  if (insights === null) {
    return variant === 'dock'
      ? <p className="px-1 py-6 text-center text-xs text-muted-foreground">Reading the board…</p>
      : null;
  }

  const shown = showAll ? visible : visible.slice(0, SHOWN);

  return (
    <section aria-label="Criti suggestions" className="space-y-2">
      {/* In the dock a pop-up would open behind it, so the card sits on top of the list. */}
      {confirming && variant === 'dock' ? (
        <div className="space-y-1.5" ref={cardRef}>
          <ProposalCard
            key={JSON.stringify(confirming.proposal)}
            view={confirming}
            onDone={() => void load()}
            onChange={(s) => { if (s === 'cancelled') setConfirming(null); }}
          />
          <button type="button" onClick={() => setConfirming(null)} className="text-[11px] font-semibold text-accent hover:underline">
            Back to the suggestions
          </button>
        </div>
      ) : null}
      {variant === 'page' ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
            <Sparkles className="h-4 w-4 text-accent" /> Criti suggests
            {visible.length ? <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-fg">{visible.length}</span> : null}
          </h2>
          <button
            type="button"
            onClick={() => openCriti('chat')}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-semibold hover:bg-muted"
          >
            <MessageSquare className="h-3.5 w-3.5" /> Ask Criti
          </button>
        </div>
      ) : null}

      {visible.length === 0 ? (
        <p className="flex items-center gap-2 rounded-xl border border-severity-low/30 bg-severity-low/5 px-3 py-2.5 text-xs text-severity-low-ink">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {failed ? 'Criti could not read the board just now. It tries again in a moment.' : 'Nothing needs your attention right now.'}
        </p>
      ) : (
        <div className={cn('grid gap-2', variant === 'page' && 'sm:grid-cols-2 xl:grid-cols-3')}>
          {shown.map((x) => {
            const Icon = ICON[x.kind] ?? Sparkles;
            const tone = TONE[x.tone];
            return (
              <article
                key={x.id}
                className={cn('flex flex-col rounded-xl border border-border border-l-4 p-3', tone.rail, tone.wash)}
              >
                <header className="flex items-start gap-2">
                  <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', tone.ink, x.kind === 'sos' && 'animate-pulse')} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold leading-snug">{x.title}</p>
                    {x.incident ? (
                      <p className="truncate text-[11px] text-muted-foreground">
                        <Link href={`/incidents/${x.incident.id}`} className="font-mono hover:underline">{x.incident.number}</Link>
                        {' · '}{x.incident.type}
                      </p>
                    ) : null}
                  </div>
                  {x.since ? (
                    <span className={cn('shrink-0 font-mono text-[11px] font-bold tabular-nums', tone.ink)} title="How long this has stood">
                      {standing(x.since, now)}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => snooze(x.id)}
                    aria-label="Hide for 15 minutes"
                    title="Hide for 15 minutes"
                    className="-mr-1 -mt-1 shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-fg"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </header>
                <p className="mt-1.5 text-xs leading-relaxed text-fg/90">{x.body}</p>
                {x.actions.length ? (
                  <div className="mt-auto flex flex-wrap gap-1.5 pt-2.5">
                    {x.actions.map((a, i) => {
                      const primary = i === 0;
                      const cls = cn(
                        'inline-flex h-7 max-w-full items-center rounded-md px-2.5 text-[11px] font-semibold',
                        primary ? 'bg-primary text-primary-foreground' : 'border border-border hover:bg-muted',
                      );
                      if (a.type === 'link') return <Link key={i} href={a.href} className={cls}><span className="truncate">{a.label}</span></Link>;
                      if (a.type === 'ask') {
                        return <button key={i} type="button" className={cls} onClick={() => askCriti(a.prompt)}><span className="truncate">{a.label}</span></button>;
                      }
                      return <button key={i} type="button" className={cls} onClick={() => setConfirming(a.view)}><span className="truncate">{a.label}</span></button>;
                    })}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      {visible.length > SHOWN && variant === 'page' ? (
        <button type="button" onClick={() => setShowAll((s) => !s)} className="text-xs font-semibold text-accent hover:underline">
          {showAll ? 'Show fewer' : `Show all ${visible.length}`}
        </button>
      ) : null}

      {confirming && variant === 'page' ? (
        <Modal title="Confirm with Criti" onClose={() => setConfirming(null)}>
          <ProposalCard
            view={confirming}
            onDone={() => void load()}
            onChange={(s) => { if (s === 'cancelled') setConfirming(null); }}
          />
        </Modal>
      ) : null}
    </section>
  );
}
