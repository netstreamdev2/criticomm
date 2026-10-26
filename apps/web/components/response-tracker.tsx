'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Clock3, Map as MapIcon, MapPinOff, ShieldAlert, ShieldCheck, Radio } from 'lucide-react';
import {
  STALE_FIX_MS, arrivalWords, distanceWords, etaMinutes, metresApart, progressAlong, vehicleFor,
  type IncidentResponder, type OnDutyOfficer,
} from '@criticom/api';
import { useOnDutyOfficers } from '@/lib/on-duty';
import { CrewRouteMap, type MapCrew } from '@/components/crew-route-map';
import { useT } from '@/components/i18n';
import { cn } from '@/lib/utils';
import { ResponseVehicle } from '@/components/response-vehicle';

/**
 * Following each department's crew to the scene, the way a ride app follows
 * a car (0099): a strip from Dispatched to Closed with the department's
 * vehicle on it (Police a car with a blue light bar, EMS red, Fire orange,
 * Disaster yellow), gliding along as the crew closes in, with the ETA. On
 * scene comes from the crew's own phone reaching the scene, and says how it
 * was recorded: GPS ✓, marked by the officer (verified or not), or by
 * dispatch. Click a strip and the crew slides out: each officer, how far,
 * how long, and when their phone last placed them.
 */

export type TrackPart = {
  silo: string;
  status: string;
  dispatched_at: string | null;
  accepted_at: string | null;
  arrived_at: string | null;
  report_filed_at: string | null;
  closed_at: string | null;
  finished_at: string | null;
  lead_id: string | null;
  lead_name: string | null;
  arrived_by: string | null;
  arrived_verified: boolean | null;
  arrived_distance_m: number | null;
};

const NAMES: Record<string, string> = {
  MetroPolice: 'Metro Police', MetroFire: 'Fire & Rescue', Medical: 'EMS', EthekwiniDisaster: 'Disaster Management', Ethekwini: 'Control room',
};
/** Two lights flashing in turn, each department its own pair. */
const LIGHTS: Record<string, [string, string]> = {
  MetroPolice: ['#3b82f6', '#60a5fa'], Ethekwini: ['#3b82f6', '#60a5fa'],
  Medical: ['#ef4444', '#ffffff'], MetroFire: ['#ef4444', '#fbbf24'], EthekwiniDisaster: ['#facc15', '#f59e0b'],
};
const clock = new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', hour12: false });
const hhmm = (iso: string | null) => (iso ? clock.format(new Date(iso)) : null);
const ago = (iso: string, now: number) => {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
};
const initials = (name: string | null) => (name ?? '?').split(/\s+/).filter((w) => !/^(const|sgt|insp|capt|cpt|lt|ff|medic)\.?$/i.test(w)).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';

type Road = { minutes: number; km: number; from: { lat: number; lng: number }; at: number; path: Array<[number, number]> | null };

export function ResponseTracker({ scene, parts, responders, officers, eta, live }: {
  scene: { lat: number; lng: number } | null;
  parts: TrackPart[];
  responders: IncidentResponder[];
  officers: OnDutyOfficer[];
  eta: { speedKmh: number; roadFactor: number };
  /** The call is still being worked: follow positions live. */
  live: boolean;
}) {
  const { t } = useT();
  const people = useOnDutyOfficers(officers, undefined, live);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, [live]);

  const where = (userId: string | null | undefined) => {
    const o = userId ? people.find((p) => p.userId === userId) : undefined;
    if (!o || o.lat === null || o.lng === null) return null;
    return { lat: o.lat, lng: o.lng, seenAt: o.seenAt, stale: now - Date.parse(o.seenAt) > STALE_FIX_MS };
  };

  // Road ETA for each crew on the way: asked again when they have moved or a minute has passed.
  const [road, setRoad] = useState<Record<string, Road>>({});
  const asking = useRef(new Set<string>());

  const tracks = useMemo(() => parts.map((p) => {
    const crew = responders.filter((r) => r.silo === p.silo);
    const lead = crew.find((r) => r.user_id === p.lead_id) ?? crew.find((r) => r.role === 'lead') ?? null;
    const pos = where(lead?.user_id);
    const left = scene && pos ? metresApart(pos, scene) : null;
    const enRoute = Boolean(p.accepted_at) && !p.arrived_at && !['Not needed', 'Cancelled'].includes(p.status);
    return { p, crew, lead, pos, left, enRoute };
  }), [parts, responders, people, scene, now]);

  useEffect(() => {
    if (!scene) return;
    for (const tr of tracks) {
      // From their last known position, fresh or not: the road, never the straight line.
      if (!tr.enRoute || !tr.pos || asking.current.has(tr.p.silo)) continue;
      const known = road[tr.p.silo];
      if (known && now - known.at < 60_000 && metresApart(known.from, tr.pos) < 150) continue;
      const from = { lat: tr.pos.lat, lng: tr.pos.lng };
      asking.current.add(tr.p.silo);
      // With the road line itself, for the big map.
      const q = new URLSearchParams({ fromLat: String(from.lat), fromLng: String(from.lng), toLat: String(scene.lat), toLng: String(scene.lng), geometry: '1' });
      void fetch(`/api/route?${q}`)
        .then((r) => r.json() as Promise<{ routed: boolean; minutes?: number; km?: number; path?: Array<[number, number]> }>)
        .then((r) => {
          if (r.routed && r.minutes !== undefined) {
            setRoad((cur) => ({ ...cur, [tr.p.silo]: { minutes: r.minutes!, km: r.km ?? 0, from, at: Date.now(), path: r.path ?? null } }));
          }
        })
        .catch(() => {})
        .finally(() => asking.current.delete(tr.p.silo));
    }
  }, [tracks, scene, road, now]);

  if (parts.length === 0) return null;

  return (
    <div className="space-y-3">
      {tracks.map((tr) => (
        <PartStrip
          key={tr.p.silo}
          track={tr}
          road={road[tr.p.silo] ?? null}
          eta={eta}
          scene={scene}
          where={where}
          now={now}
          t={t}
        />
      ))}
    </div>
  );
}

type Track = {
  p: TrackPart;
  crew: IncidentResponder[];
  lead: IncidentResponder | null;
  pos: { lat: number; lng: number; seenAt: string; stale: boolean } | null;
  left: number | null;
  enRoute: boolean;
};

function PartStrip({ track, road, eta, scene, where, now, t }: {
  track: Track;
  road: Road | null;
  eta: { speedKmh: number; roadFactor: number };
  scene: { lat: number; lng: number } | null;
  where: (userId: string | null | undefined) => Track['pos'];
  now: number;
  t: ReturnType<typeof useT>['t'];
}) {
  const [open, setOpen] = useState(false);
  const { p, crew, lead, pos, left, enRoute } = track;
  const v = vehicleFor(p.silo);
  const [lightA, lightB] = LIGHTS[p.silo] ?? LIGHTS.MetroPolice!;
  const stoodDown = p.status === 'Not needed' || p.status === 'Cancelled';

  const stops = [
    { key: 'dispatched', label: 'Dispatched', done: Boolean(p.dispatched_at), at: p.dispatched_at },
    { key: 'enroute', label: 'En route', done: Boolean(p.accepted_at), at: p.accepted_at },
    { key: 'scene', label: 'On scene', done: Boolean(p.arrived_at), at: p.arrived_at },
    ...(p.silo === 'Medical' ? [{ key: 'transport', label: 'Transporting', done: p.status === 'Transporting' || (Boolean(p.report_filed_at) && false), at: null }] : []),
    { key: 'report', label: 'Report filed', done: Boolean(p.report_filed_at), at: p.report_filed_at },
    { key: 'closed', label: 'Closed', done: Boolean(p.closed_at), at: p.closed_at },
  ];
  const posOf = (i: number) => (i / (stops.length - 1)) * 100;
  const reached = stops.reduce((last, s, i) => (s.done ? i : last), -1);
  const progress = enRoute ? progressAlong(lead?.start_distance_m ?? null, pos && !pos.stale ? left : null) : null;
  const at = !p.dispatched_at ? null
    : enRoute ? posOf(1) + (progress ?? 0.06) * (posOf(2) - posOf(1))
      : posOf(Math.max(0, reached));
  const working = !stoodDown && !p.report_filed_at && Boolean(p.accepted_at);

  const minutes = road?.minutes ?? etaMinutes(left, eta.speedKmh, eta.roadFactor);
  const arrival = arrivalWords(p);
  const crewNames = crew.map((r) => r.name).filter(Boolean).join(', ');

  // The journey's headline, as a goal tracker reads: the number that matters now, then the rest.
  const afterDispatch = (iso: string | null) => (iso && p.dispatched_at
    ? Math.max(0, Math.round((Date.parse(iso) - Date.parse(p.dispatched_at)) / 60_000)) : null);
  const stepChip = `${Math.max(0, reached) + 1} / ${stops.length}`;
  const roadLeft = enRoute ? (road ? road.km * 1000 : left) : null;
  let head: JourneyHead;
  let sub: string | null = null;
  let chip: string | null = stepChip;
  if (enRoute && pos && minutes !== null) {
    head = { big: String(minutes), unit: t('min'), rest: t('arrives {time}', { time: clock.format(new Date(now + minutes * 60_000)) }) };
    chip = progress !== null ? t('{n}% there', { n: Math.round(progress * 100) }) : stepChip;
    sub = [roadLeft !== null ? t('{d} to the scene', { d: distanceWords(roadLeft) ?? '' }) : null,
      pos.stale ? t('position {ago}', { ago: ago(pos.seenAt, now) }) : t('live position')].filter(Boolean).join(' · ');
  } else if (enRoute) {
    head = { big: t('On the way'), word: true };
    sub = pos ? null : t('No live position from their phone yet.');
  } else if (p.closed_at) {
    head = { big: hhmm(p.closed_at) ?? '—', rest: t('closed') };
  } else if (p.report_filed_at) {
    head = { big: hhmm(p.report_filed_at) ?? '—', rest: t('report filed') };
  } else if (p.arrived_at) {
    const took = afterDispatch(p.arrived_at);
    head = { big: hhmm(p.arrived_at) ?? '—', rest: t('on scene') };
    sub = took !== null ? t('{n} min after dispatch', { n: took }) : null;
  } else if (p.accepted_at) {
    head = { big: t('Finished'), word: true };
  } else if (p.dispatched_at) {
    head = { big: t('Waiting for a crew'), word: true };
    sub = t('Dispatched {time}', { time: hhmm(p.dispatched_at) ?? '' });
  } else {
    head = { big: t('Waiting to dispatch'), word: true };
    chip = null;
  }

  // The big view: the crew on the map, the numbers on top.
  const placed: MapCrew[] = crew.flatMap((r) => {
    const here = where(r.user_id);
    return here ? [{ userId: r.user_id, name: r.name ?? t('Officer'), lead: r.user_id === lead?.user_id, lat: here.lat, lng: here.lng, stale: here.stale }] : [];
  });
  // A new list only when someone moved: the map re-frames on movement, not on the clock.
  const placedKey = placed.map((c) => `${c.userId}:${c.lat.toFixed(5)},${c.lng.toFixed(5)}:${c.stale}:${c.lead}`).join('|');
  const mapCrew = useMemo(() => placed, [placedKey]);
  const leftM = enRoute ? (road ? road.km * 1000 : left) : null;
  const overlay = (
    <div className="relative w-[17rem] max-w-full overflow-hidden rounded-2xl bg-slate-950/95 px-5 py-4 text-white shadow-2xl ring-1 ring-white/15 backdrop-blur-md">
      <div className="absolute inset-x-0 top-0 h-1" style={{ background: v.tone }} />
      <ResponseVehicle silo={p.silo} className="absolute right-3 top-5 h-12 w-20 opacity-90" />
      <p className="relative pr-20 text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: v.light }}>
        {enRoute ? t('On the way') : p.arrived_at ? t('On scene') : p.accepted_at ? t('Finished') : t('Waiting for a crew')}
      </p>
      {enRoute ? (
        pos ? (
          <>
            <p className="mt-0.5 font-black leading-none tabular-nums">
              <span className="text-5xl">{minutes ?? '—'}</span>
              <span className="ml-1 text-xl font-bold">{t('min')}</span>
            </p>
            <p className="mt-1 text-sm text-white/80">
              {[leftM !== null ? t('{d} to the scene', { d: distanceWords(leftM) ?? '' }) : null,
                minutes !== null ? t('arrives {time}', { time: clock.format(new Date(now + minutes * 60_000)) }) : null].filter(Boolean).join(' · ')}
            </p>
            {progress !== null ? (
              <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/15">
                <div className="h-full rounded-full transition-[width] duration-1000 motion-reduce:transition-none" style={{ width: `${Math.round(progress * 100)}%`, background: v.light }} />
              </div>
            ) : null}
          </>
        ) : (
          <p className="mt-1 text-sm text-white/80">{t('No live position from their phone yet.')}</p>
        )
      ) : p.arrived_at ? (
        <>
          <p className="mt-0.5 text-3xl font-black leading-tight">{hhmm(p.arrived_at)}</p>
          {arrival ? <p className={cn('mt-1 text-sm font-semibold', arrival.tone === 'warn' ? 'text-amber-300' : arrival.tone === 'ok' ? 'text-emerald-300' : 'text-white/80')}>{t(arrival.text)}</p> : null}
        </>
      ) : null}
      {lead ? (
        // The clock moves between the server's drawing and the browser's: "seen 43 s ago" may read 44.
        <p suppressHydrationWarning className="mt-2 border-t border-white/10 pt-2 text-xs text-white/70">
          <span className="font-bold text-white">{lead.name ?? t('Officer')}</span>
          {pos ? ` · ${pos.stale ? t('last seen {ago}', { ago: ago(pos.seenAt, now) }) : t('live')}` : ''}
          {crew.length > 1 ? ` · ${t('+{n} backup', { n: crew.length - 1 })}` : ''}
        </p>
      ) : null}
    </div>
  );

  const status = (() => {
    if (stoodDown) return <span className="text-sm font-semibold text-muted-foreground">{t(p.status === 'Cancelled' ? 'Cancelled' : 'Stood down')}</span>;
    // Folded, the journey's headline already says these.
    if (!p.dispatched_at) return open ? <span className="text-sm text-muted-foreground">{t('Waiting to dispatch')}</span> : null;
    if (!p.accepted_at) return open ? <span className="text-sm font-semibold text-severity-medium-ink">{t('Waiting for a crew to accept')}</span> : null;
    if (enRoute) {
      if (!pos) return <span className="flex items-center gap-1.5 text-sm text-muted-foreground"><MapPinOff className="h-4 w-4" />{t('No live position')}</span>;
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-soft px-2.5 py-1 text-xs font-bold text-fg">
          <span className={cn('h-2 w-2 rounded-full', !pos.stale && 'animate-pulse')} style={{ background: pos.stale ? 'rgb(var(--c-border))' : v.light }} />
          {pos.stale ? t('Position {ago}', { ago: ago(pos.seenAt, now) }) : t('Live')}
        </span>
      );
    }
    if (arrival) {
      const Badge = arrival.tone === 'warn' ? ShieldAlert : arrival.tone === 'ok' ? ShieldCheck : Radio;
      return (
        <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold',
          arrival.tone === 'warn' ? 'border-severity-high/60 bg-severity-high/15 text-severity-high-ink'
            : arrival.tone === 'ok' ? 'border-severity-low/50 bg-severity-low/10 text-severity-low-ink'
              : 'border-border bg-bg-soft text-muted-foreground')}
        >
          <Badge className="h-3.5 w-3.5" /> {t(arrival.text)}
        </span>
      );
    }
    return null;
  })();

  return (
    <section className="response-card overflow-hidden rounded-2xl border border-border bg-bg-card shadow-sm" style={{ ['--response-tone' as string]: v.tone }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="block w-full px-4 py-4 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:px-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-[1_1_12rem] items-center gap-3">
            <span className="flex h-14 w-20 shrink-0 items-center justify-center rounded-xl border border-border bg-bg-soft">
              <ResponseVehicle silo={p.silo} className="h-12 w-[76px]" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold tracking-tight sm:text-base">{t(NAMES[p.silo] ?? p.silo)}</p>
              {crewNames ? <p className="mt-1 truncate text-xs text-muted-foreground">{crewNames}</p> : null}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {status}
            {crew.length || scene ? <ChevronDown className={cn('h-7 w-7 shrink-0 rounded-full border border-border p-1.5 text-muted-foreground transition-transform motion-reduce:transition-none', open && 'rotate-180')} /> : null}
          </div>
        </div>

      </button>

      {/* Folded: the journey. Open: the big map below takes its place. */}
      {stoodDown || open ? null : (
        <JourneyStrip
          silo={p.silo}
          stops={stops}
          at={at}
          tone={v.tone}
          light={v.light}
          lights={[lightA, lightB]}
          working={working}
          moving={Boolean(enRoute && pos && !pos.stale)}
          head={head}
          sub={sub}
          chip={chip}
          onOpen={() => setOpen(true)}
          t={t}
        />
      )}

      {/* The crew, sliding out: each officer, how far, how long, how they arrived. */}
      <div className={cn('grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
        <div className="overflow-hidden">
          {open && scene && !stoodDown ? (
            <div className="px-3 pb-3">
              <CrewRouteMap
                scene={scene}
                crew={mapCrew}
                path={enRoute ? road?.path ?? null : null}
                onTheWay={enRoute}
                silo={p.silo}
                tone={v.tone}
                lights={[lightA, lightB]}
                overlay={overlay}
              />
            </div>
          ) : null}
          <ul className="divide-y divide-border border-t border-border">
            {crew.map((r) => {
              const me = where(r.user_id);
              const away = scene && me ? metresApart(me, scene) : null;
              const mins = etaMinutes(away, eta.speedKmh, eta.roadFactor);
              const arrived = arrivalWords({ arrived_by: r.arrived_by ?? null, arrived_verified: r.arrived_verified ?? null, arrived_distance_m: r.arrived_distance_m ?? null });
              const onWay = r.status === 'En Route' && !r.arrived_at;
              return (
                <li key={r.user_id} className="flex items-center gap-3 px-5 py-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-bg-soft text-sm font-bold text-fg">
                    {initials(r.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">
                      {r.name ?? t('Officer')}
                      <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        {t(r.role === 'lead' ? 'Lead' : 'Backup')}
                      </span>
                    </p>
                    <p suppressHydrationWarning className="text-xs text-muted-foreground">
                      {onWay
                        ? me ? [distanceWords(away), mins !== null ? t('about {n} min', { n: mins }) : null, t('position {ago}', { ago: ago(me.seenAt, now) })].filter(Boolean).join(' · ')
                          : t('No live position from their phone')
                        : r.arrived_at ? `${t('On scene')} ${hhmm(r.arrived_at)}${arrived ? ` · ${t(arrived.text)}` : ''}` : t(r.status)}
                    </p>
                    {r.arrive_note ? <p className="mt-0.5 text-xs italic text-muted-foreground">“{r.arrive_note}”</p> : null}
                  </div>
                  {arrived?.tone === 'warn' ? <ShieldAlert className="h-5 w-5 shrink-0 text-severity-high-ink" aria-label={t('Not verified')} /> : null}
                  {arrived?.tone === 'ok' ? <ShieldCheck className="h-5 w-5 shrink-0 text-severity-low-ink" aria-label={t('Verified by GPS')} /> : null}
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex w-full items-center justify-center gap-1.5 border-t border-border py-2 text-xs font-semibold text-muted-foreground hover:bg-muted"
          >
            <ChevronUp className="h-4 w-4" /> {t('Show the strip')}
          </button>
        </div>
      </div>
    </section>
  );
}

/* ── The journey ─────────────────────────────────────────────────────── */

type JourneyHead = { big: string; unit?: string; rest?: string; word?: boolean };
type Stop = { key: string; label: string; done: boolean; at: string | null };

/**
 * The crew's journey as a goal tracker draws it: the number that matters
 * now, a ticked rail filled in the department's colours with the vehicle at
 * its head, and the checkpoints. Hover, tap or tab to a checkpoint and the
 * vehicle pops up with when the crew reached it.
 */
function JourneyStrip({ silo, stops, at, tone, light, lights, working, moving, head, sub, chip, onOpen, t }: {
  silo: string;
  stops: Stop[];
  /** Where the vehicle is along the rail, 0–100; null before dispatch. */
  at: number | null;
  tone: string;
  light: string;
  lights: [string, string];
  /** The crew is working the call: the light bar flashes. */
  working: boolean;
  /** Closing in on a live position: the fill shimmers and the vehicle rolls. */
  moving: boolean;
  head: JourneyHead;
  sub: string | null;
  chip: string | null;
  onOpen: () => void;
  t: ReturnType<typeof useT>['t'];
}) {
  const [peek, setPeek] = useState<number | null>(null);
  const last = stops.length - 1;
  const posOf = (i: number) => (i / last) * 100;
  const reached = stops.reduce((r, s, i) => (s.done ? i : r), -1);
  const dispatchedAt = stops[0]?.at ? Date.parse(stops[0].at) : null;
  const edge = (i: number) => (i === 0 ? '0%' : i === last ? '-100%' : '-50%');
  const peeked = peek !== null ? stops[peek] ?? null : null;
  const took = peeked?.at && dispatchedAt !== null && peek ? Math.max(0, Math.round((Date.parse(peeked.at) - dispatchedAt) / 60_000)) : null;
  // The crew does not close the case: once it is closed the vehicle leaves the rail and the end is a tick.
  const closed = stops[last]?.key === 'closed' && Boolean(stops[last]?.done);
  const isClosedStop = (i: number) => i === last && closed;

  return (
    <div className="px-4 pb-4 sm:px-5">
      <div className="flex items-end justify-between gap-3">
        <p className="min-w-0 leading-none" suppressHydrationWarning>
          <span className={cn('font-black tracking-tight tabular-nums text-fg', head.word ? 'text-xl sm:text-2xl' : 'text-3xl sm:text-4xl')}>{head.big}</span>
          {head.unit ? <span className="ml-1 text-lg font-bold text-fg">{head.unit}</span> : null}
          {head.rest ? <span className="ml-2 text-sm font-semibold text-muted-foreground">/ {head.rest}</span> : null}
        </p>
        {chip ? (
          <span className="shrink-0 rounded-full border border-border bg-bg-soft px-2.5 py-1 text-xs font-bold tabular-nums text-muted-foreground">{chip}</span>
        ) : null}
      </div>

      {/* One line, 13px up: faint ticks behind, the slim fill on them, the checkpoints on it, the vehicle just above. */}
      <div className={cn('relative mx-6', at !== null && !closed ? 'mt-1 h-[70px]' : 'mt-3 h-8')}>
        <div className="journey-ticks absolute inset-x-0 bottom-[8px] h-2.5 opacity-60" />
        {at !== null ? (
          <div
            className="journey-fill absolute bottom-[10px] left-0 h-1.5 rounded-full"
            data-moving={moving}
            style={{ width: `${at}%`, background: `linear-gradient(90deg, ${tone}, ${light})`, boxShadow: `0 0 10px ${tone}66` }}
          />
        ) : null}

        {/* The vehicle at the head of the fill, until the case is closed. */}
        {at !== null && !closed ? (
          <div className="vehicle-glide pointer-events-none absolute z-10 -translate-x-1/2" style={{ left: `${at}%`, bottom: 18 }} aria-hidden>
            <div className="journey-car relative h-10 w-16" data-moving={moving}>
              <span className="absolute inset-x-2 bottom-0 h-1 rounded-full blur-[3px]" style={{ background: `${tone}99` }} />
              {working ? (
                <span className="absolute left-1/2 top-1 z-10 flex -translate-x-1/2 gap-0.5">
                  <span className="lightbar-a h-[3px] w-1.5 rounded-full" style={{ background: lights[0], boxShadow: `0 0 5px ${lights[0]}` }} />
                  <span className="lightbar-b h-[3px] w-1.5 rounded-full" style={{ background: lights[1], boxShadow: `0 0 5px ${lights[1]}` }} />
                </span>
              ) : null}
              <ResponseVehicle silo={silo} className="relative h-10 w-16 drop-shadow-lg" />
            </div>
          </div>
        ) : null}

        {/* The checkpoints, on the line. */}
        <div className="absolute inset-x-0 bottom-[10px] h-1.5">
          {stops.map((s, i) => {
            const next = i === reached + 1 && reached >= 0;
            return (
              <button
                key={s.key}
                type="button"
                data-peek={peek === i}
                onMouseEnter={() => setPeek(i)}
                onMouseLeave={() => setPeek(null)}
                onFocus={() => setPeek(i)}
                onBlur={() => setPeek(null)}
                onClick={(e) => { e.stopPropagation(); setPeek(peek === i ? null : i); }}
                aria-label={`${t(s.label)}: ${s.at ? hhmm(s.at) : s.done ? t('Done') : t('Not yet')}`}
                className="journey-stop absolute top-1/2 z-20 flex h-6 w-6 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                style={{ left: `${posOf(i)}%` }}
              >
                {isClosedStop(i) ? (
                  <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full ring-[3px] ring-bg-card" style={{ background: tone }}>
                    <Check className="h-3 w-3 text-white" strokeWidth={3.5} />
                  </span>
                ) : (
                  <span
                    className={cn('block h-3 w-3 rounded-full ring-[3px] ring-bg-card', !s.done && 'border-2 border-border bg-bg-card', next && 'journey-next')}
                    style={{ ...(s.done ? { background: tone } : {}), ['--ping' as string]: `${tone}99` }}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* The card a checkpoint pops: the vehicle, the step, when. */}
        {peek !== null && peeked ? (
          <div
            key={peek}
            className="journey-pop pointer-events-none absolute z-30 w-52 overflow-hidden rounded-xl border border-border bg-bg-card/95 p-2.5 shadow-xl backdrop-blur"
            style={{ left: `${posOf(peek)}%`, bottom: 26, ['--pop-x' as string]: edge(peek), transform: `translateX(${edge(peek)})` }}
            aria-live="polite"
          >
            <div className="absolute inset-x-0 top-0 h-0.5" style={{ background: `linear-gradient(90deg, ${tone}, ${light})` }} />
            <div className="flex items-center gap-2.5">
              {isClosedStop(peek) ? (
                <span className="journey-pop-car flex h-9 w-14 shrink-0 items-center justify-center rounded-lg" style={{ background: `${tone}22`, color: tone }}>
                  <Check className="h-5 w-5" strokeWidth={3} />
                </span>
              ) : peeked.done ? (
                <ResponseVehicle silo={silo} className="journey-pop-car h-9 w-14 shrink-0" />
              ) : (
                <span className="flex h-9 w-14 shrink-0 items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground">
                  <Clock3 className="h-4 w-4" />
                </span>
              )}
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{t(peeked.label)}</p>
                <p className="text-lg font-black leading-tight tabular-nums text-fg">
                  {peeked.at ? hhmm(peeked.at) : peeked.done ? t('Done') : peek === reached + 1 ? t('Next') : t('Not yet')}
                </p>
                {took !== null ? (
                  <p className="text-[11px] font-semibold" style={{ color: tone }}>{t('{n} min after dispatch', { n: took })}</p>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* The step names under the rail; a narrow card keeps only where the crew is and what is next. */}
      <div className="relative mx-6 h-8">
        {stops.map((s, i) => (
          <span
            key={s.key}
            data-current={i === Math.max(0, reached) || i === reached + 1}
            className={cn('journey-label absolute top-0 w-20 text-[10px] font-semibold leading-tight',
              s.done ? 'text-fg' : 'text-muted-foreground',
              i === 0 ? 'left-0 text-left' : i === last ? 'right-0 text-right' : '-translate-x-1/2 text-center')}
            style={i === 0 || i === last ? undefined : { left: `${posOf(i)}%` }}
          >
            {t(s.label)}
            {s.at ? <span className="block font-normal text-muted-foreground">{hhmm(s.at)}</span> : null}
          </span>
        ))}
      </div>

      <div className="mt-1 flex items-center justify-between gap-3">
        <p suppressHydrationWarning className="min-w-0 text-xs font-medium text-muted-foreground">{sub}</p>
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs font-bold text-fg hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <MapIcon className="h-3.5 w-3.5" aria-hidden /> {t('Map')}
        </button>
      </div>
    </div>
  );
}
