'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  BatteryCharging, BatteryFull, BatteryLow, BatteryMedium, HardHat, List, Map as MapIcon, MapPin, Mic, Radio, Route, Search, Video, X,
} from 'lucide-react';
import { batteryTone, channelLabel, isRadioModel, type RadioView } from '@criticom/api/radio';
import { listDutyTracks, type DutyTrackPoint, type TalkChannel } from '@criticom/api';
import { TalkPanel } from '@/components/talk/talk-panel';
import { RadioCameraViewer } from '@/components/talk/radio-camera-viewer';
import type { RadioDesk as Desk } from '@/lib/radio';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { formatSaTime } from '@/lib/utils';
import { T, useT } from '@/components/i18n';
import { RadioMap, positionOf } from './radio-map';

/**
 * The radio desk, kept plain: talk, see who is on, see where they are.
 * Colours and icons carry it; words are few.
 */

const REFRESH_MS = 10_000;
/** The route drawn for a radio: its person's last twelve hours on duty. */
const ROUTE_HOURS = 12;
const VIEW_KEY = 'criticom:radio-desk:view';
const ON = '#22c55e';
const OFF = '#64748b';

type Mode = 'list' | 'map';

const isOn = (v: RadioView) => Boolean(v.live?.online);
const isTalking = (v: RadioView) => Boolean(v.live?.online && v.live.talking);
const time = (iso: string | null | undefined) => (iso ? formatSaTime(iso).split(' ').at(-1)?.slice(0, 5) ?? '' : '');

function BatteryBadge({ level, charging }: { level: number | null; charging?: boolean | null }) {
  if (level === null) return <span className="w-16 text-right text-sm text-muted-foreground">—</span>;
  const tone = batteryTone(level);
  const Icon = charging ? BatteryCharging : level < 20 ? BatteryLow : level < 60 ? BatteryMedium : BatteryFull;
  return (
    <span className="inline-flex w-16 items-center justify-end gap-1 text-sm font-bold tabular-nums" style={{ color: tone }}>
      <Icon className="h-5 w-5" aria-hidden /> {level}%
    </span>
  );
}

function Dot({ v, size = 14 }: { v: RadioView; size?: number }) {
  const tone = isTalking(v) ? ON : isOn(v) ? ON : OFF;
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {isTalking(v) ? <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ backgroundColor: ON }} /> : null}
      <span className="relative inline-flex rounded-full" style={{ width: size, height: size, backgroundColor: tone }} />
    </span>
  );
}

/** "On", "Talking", or "Off · 10:42". */
function StatusWord({ v }: { v: RadioView }) {
  const { t } = useT();
  if (isTalking(v)) {
    return <span className="inline-flex items-center gap-1 font-semibold text-emerald-500"><Mic className="h-4 w-4" aria-hidden />{t('Talking')}</span>;
  }
  if (isOn(v)) return <span className="font-semibold text-emerald-500">{t('On')}</span>;
  const seen = v.live?.lastOnlineAt;
  return <span className="text-muted-foreground">{t('Off')}{seen ? ` · ${time(seen)}` : ''}</span>;
}

function RadioRow({ v, selected, onSelect, onMap }: { v: RadioView; selected: boolean; onSelect: () => void; onMap: () => void }) {
  const { t } = useT();
  const Icon = v.kind === 'hard_hat' ? HardHat : Radio;
  return (
    <li>
      <div
        className={`frost flex items-center gap-3 rounded-xl border px-4 py-3 ${selected ? 'border-primary ring-2 ring-primary/40' : 'border-border'}`}
      >
        <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <Dot v={v} />
          <Icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base font-bold">{v.title}</span>
            <span className="block text-sm"><StatusWord v={v} /></span>
          </span>
        </button>
        <BatteryBadge level={v.live?.battery ?? null} charging={v.live?.charging} />
        <button
          type="button" onClick={onMap} disabled={!positionOf(v)} aria-label={t('On the map')} title={t('On the map')}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border hover:bg-bg-soft/70 disabled:opacity-30"
        >
          <MapPin className="h-5 w-5" />
        </button>
      </div>
    </li>
  );
}

function Count({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <span className="frost-pill inline-flex items-center gap-2 rounded-full border px-4 py-2" style={{ borderColor: `${tone}66` }}>
      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: tone }} />
      <span className="text-xl font-bold tabular-nums" style={{ color: tone }}>{value}</span>
      <span className="text-sm font-semibold">{label}</span>
    </span>
  );
}

function RadioPanel({ v, route, routeState, onShowRoute, onClose }: {
  v: RadioView;
  route: DutyTrackPoint[] | null;
  routeState: 'idle' | 'loading' | 'error';
  onShowRoute: () => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const l = v.live;
  const channel = l?.online ? channelLabel(l.talkChannel) : null;
  const [camera, setCamera] = useState(false);
  // The camera of a radio running our app, while it is on (0091).
  const cameraDevice = l?.provider === 'hiktech' && l.online && isRadioModel(l.model) ? l.account : null;
  return (
    <aside className="frost space-y-4 rounded-xl border border-border p-5 lg:sticky lg:top-4 lg:self-start">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <Dot v={v} size={18} />
          <h2 className="truncate text-xl font-bold">{v.title}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label={t('Close')} className="rounded-md p-1.5 hover:bg-bg-soft/70"><X className="h-5 w-5" /></button>
      </div>

      <div className="space-y-3 text-base">
        <p><StatusWord v={v} />{channel ? <span className="text-muted-foreground"> · {channel}</span> : null}</p>
        <p className="flex items-center gap-2"><BatteryBadge level={l?.battery ?? null} charging={l?.charging} />{l?.charging ? <span className="text-sm text-muted-foreground">{t('Charging')}</span> : null}</p>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <MapPin className="h-4 w-4 shrink-0" aria-hidden />
          {l?.fixAt ? time(l.fixAt) : t('No position')}
        </p>
      </div>

      {camera && cameraDevice ? (
        <RadioCameraViewer deviceId={cameraDevice} onClose={() => setCamera(false)} />
      ) : cameraDevice ? (
        <button
          type="button" onClick={() => setCamera(true)}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-red-600 text-base font-bold text-white hover:bg-red-700"
        >
          <Video className="h-5 w-5" /> {t('Live camera')}
        </button>
      ) : null}

      {l?.userId ? (
        <button
          type="button" onClick={onShowRoute} disabled={routeState === 'loading'}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary text-base font-bold text-white disabled:opacity-60"
        >
          <Route className="h-5 w-5" /> {routeState === 'loading' ? t('Loading…') : t('Show route')}
        </button>
      ) : null}
      {routeState === 'error' ? <p className="text-sm text-red-500">{t('Try again.')}</p> : null}
      {route && route.length === 0 ? <p className="text-sm text-muted-foreground">{t('No route today.')}</p> : null}
    </aside>
  );
}

export function RadioDesk({ initial, talk, canManage }: {
  initial: Desk;
  talk: { channels: TalkChannel[]; setUp: boolean; installed: boolean };
  canManage: boolean;
}) {
  const { t } = useT();
  const [desk, setDesk] = useState(initial);
  const [q, setQ] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('list');
  const [route, setRoute] = useState<{ key: string; points: DutyTrackPoint[] } | null>(null);
  const [routeState, setRouteState] = useState<'idle' | 'loading' | 'error'>('idle');

  // The last view this person used, on this browser only.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_KEY);
      if (saved === 'map' || saved === 'list') setMode(saved);
    } catch { /* no storage: the list */ }
  }, []);
  const changeMode = (m: Mode) => {
    setMode(m);
    try { localStorage.setItem(VIEW_KEY, m); } catch { /* fine */ }
  };

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/radio/live', { cache: 'no-store' });
      if (res.ok) setDesk((await res.json()) as Desk);
    } catch { /* keep the last picture; the next refresh tries again */ }
  }, []);
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const radios = useMemo(() => desk.views.filter((v) => v.kind !== 'dispatcher'), [desk.views]);
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return term ? radios.filter((v) => v.title.toLowerCase().includes(term)) : radios;
  }, [radios, q]);
  const selected = radios.find((v) => v.key === selectedKey) ?? null;
  const on = radios.filter(isOn).length;

  const loadRoute = useCallback(async (v: RadioView) => {
    const userId = v.live?.userId;
    if (!userId) return;
    setRouteState('loading');
    try {
      const points = await listDutyTracks(getBrowserSupabase(), {
        since: new Date(Date.now() - ROUTE_HOURS * 3_600_000).toISOString(),
        userIds: [userId],
      });
      setRoute({ key: v.key, points });
      setRouteState('idle');
    } catch {
      setRouteState('error');
    }
  }, []);

  const select = (key: string | null) => {
    setSelectedKey(key);
    if (route && route.key !== key) setRoute(null);
  };
  const showOnMap = (v: RadioView) => {
    select(v.key);
    changeMode('map');
  };

  return (
    <div className="space-y-5">
      <h1 className="flex items-center gap-3 text-2xl font-bold">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-white"><Radio className="h-6 w-6" aria-hidden /></span>
        <T s="Radio Desk" />
      </h1>

      {talk.channels.length ? (
        <TalkPanel channels={talk.channels} title={t('Talk')} />
      ) : (
        <p className="frost rounded-xl border border-border px-4 py-3 text-base">
          {t('Talk is not ready.')}{' '}
          {canManage && talk.installed && !talk.setUp
            ? <Link href="/admin/radios#voice" className="font-semibold text-primary underline">{t('Set it up')}</Link>
            : t('Ask the system administrator.')}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Count value={on} label={t('On')} tone={ON} />
        <Count value={radios.length - on} label={t('Off')} tone={OFF} />
        {desk.counts.lowBattery ? <Count value={desk.counts.lowBattery} label={t('Low battery')} tone="#ef4444" /> : null}

        <div className="ml-auto flex rounded-full border border-border p-1" role="tablist" aria-label={t('View')}>
          {([['list', List, t('List')], ['map', MapIcon, t('Map')]] as const).map(([m, Icon, label]) => (
            <button
              key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => changeMode(m)}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold ${mode === m ? 'bg-primary text-white' : 'text-muted-foreground'}`}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
      </div>

      {radios.length > 6 ? (
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Find a name')}
            className="h-11 w-full rounded-lg border border-border bg-bg-soft/80 pl-10 pr-3 text-base"
          />
        </label>
      ) : null}

      <div className={`grid gap-4 ${selected ? 'lg:grid-cols-[1fr_20rem]' : ''}`}>
        {mode === 'map' ? (
          <RadioMap
            views={shown}
            selectedKey={selectedKey}
            onSelect={(key) => select(key)}
            route={route && route.key === selectedKey ? route.points : null}
          />
        ) : shown.length === 0 ? (
          <p className="frost rounded-xl border border-dashed border-border p-10 text-center text-base text-muted-foreground">
            {radios.length === 0 ? t('No radios yet.') : t('No one by that name.')}
          </p>
        ) : (
          <ul className="space-y-2">
            {shown.map((v) => (
              <RadioRow key={v.key} v={v} selected={v.key === selectedKey} onSelect={() => select(v.key)} onMap={() => showOnMap(v)} />
            ))}
          </ul>
        )}
        {selected ? (
          <RadioPanel
            key={selected.key} v={selected}
            route={route && route.key === selected.key ? route.points : null}
            routeState={routeState}
            onShowRoute={() => { changeMode('map'); void loadRoute(selected); }}
            onClose={() => select(null)}
          />
        ) : null}
      </div>
    </div>
  );
}
