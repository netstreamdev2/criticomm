'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import {
  AudioLines, BatteryLow, BatteryMedium, BatteryFull, HardHat, Headset, MapPin, MessageSquare, Radio, RefreshCw, Search, Send, X,
} from 'lucide-react';
import {
  FRESHNESS_TONE, RADIO_PROVIDERS, batteryTone, kindLabel, providerLabel, type RadioProvider, type RadioView,
} from '@criticom/api/radio';
import type { TalkChannel } from '@criticom/api';
import { TalkPanel } from '@/components/talk/talk-panel';
import type { RadioDesk as Desk } from '@/lib/radio';
import { formatSaTime } from '@/lib/utils';
import { useT } from '@/components/i18n';
import { T } from '@/components/i18n';

const REFRESH_MS = 15_000;
const TONE = Object.fromEntries(RADIO_PROVIDERS.map((p) => [p.id, p.tone])) as Record<RadioProvider, string>;

type Audio = { id: number; time: string; play_url: string };

function KindIcon({ kind, className }: { kind: RadioView['kind']; className?: string }) {
  if (kind === 'hard_hat') return <HardHat className={className} aria-hidden />;
  if (kind === 'dispatcher') return <Headset className={className} aria-hidden />;
  return <Radio className={className} aria-hidden />;
}

function Battery({ level }: { level: number | null }) {
  const tone = batteryTone(level);
  const Icon = level === null ? BatteryMedium : level < 20 ? BatteryLow : level < 60 ? BatteryMedium : BatteryFull;
  return (
    <div className="flex items-center gap-2 text-xs">
      <Icon className="h-4 w-4 shrink-0" style={{ color: tone }} aria-hidden />
      <div className="h-1.5 flex-1 rounded-full bg-bg-soft/80">
        <div className="h-1.5 rounded-full" style={{ width: `${level ?? 0}%`, backgroundColor: tone }} />
      </div>
      <span className="w-9 text-right font-semibold tabular-nums" style={{ color: tone }}>{level === null ? '—' : `${level}%`}</span>
    </div>
  );
}

function Tile({ label, value, tone, hint }: { label: string; value: number; tone: string; hint?: string }) {
  return (
    <div
      className="frost relative overflow-hidden rounded-xl border p-4"
      style={{ borderColor: `${tone}55`, backgroundImage: `linear-gradient(135deg, ${tone}24, transparent 70%)` }}
    >
      <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: tone }} aria-hidden />
      <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-3xl font-bold tabular-nums" style={{ color: tone }}>{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function where(v: RadioView): string {
  const l = v.live;
  if (!l?.fixAt || l.lat === null || l.lng === null) return 'No position from the platform';
  const label = v.freshness === 'live' ? 'Live' : v.freshness === 'recent' ? 'Recent' : 'Last fix';
  return `${label} · ${formatSaTime(l.fixAt)}${l.speedKmh ? ` · ${Math.round(l.speedKmh)} km/h` : ''}`;
}

function RadioCard({ v, selected, onSelect, canManage }: { v: RadioView; selected: boolean; onSelect: () => void; canManage: boolean }) {
  const { t } = useT();
  const tone = TONE[v.provider];
  const online = Boolean(v.live?.online);
  return (
    <li>
      <div
        className={`frost flex h-full flex-col gap-3 rounded-xl border p-4 transition-colors ${selected ? 'ring-2' : ''}`}
        style={{ borderColor: selected ? tone : `${tone}44`, ...(selected ? { boxShadow: `0 0 0 2px ${tone}66` } : {}) }}
      >
        <div className="flex items-start gap-3">
          <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white" style={{ backgroundColor: tone }}>
            <KindIcon kind={v.kind} className="h-5 w-5" />
            <span
              className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-[rgb(var(--c-bg-card))]"
              style={{ backgroundColor: online ? '#22c55e' : '#64748b' }}
              title={online ? 'Online' : 'Offline'}
            />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{v.title}</p>
            <p className="truncate text-xs text-muted-foreground">
              {kindLabel(v.kind)} · {providerLabel(v.provider)} · <span className="font-mono">{v.account}</span>
            </p>
          </div>
          <span
            className="frost-pill shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold"
            style={{ borderColor: online ? '#22c55e77' : '#64748b55', color: online ? '#22c55e' : undefined }}
          >
            {online ? 'Online' : 'Offline'}
          </span>
        </div>

        <Battery level={v.live?.battery ?? null} />

        <div className="space-y-1 text-xs text-muted-foreground">
          <p className="flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 shrink-0" style={{ color: FRESHNESS_TONE[v.freshness] }} aria-hidden />
            {where(v)}
          </p>
          {!online && v.live?.lastOnlineAt ? <p>{t('Last online {saTime}', { saTime: formatSaTime(v.live.lastOnlineAt) })}</p> : null}
          {!v.live ? <p>{t('The platform has not reported this radio.')}</p> : null}
        </div>

        {!v.register ? (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-500">
            {t('Not in the register.')}{' '}
            {canManage ? (
              <Link
                href={`/admin/radios?provider=${v.provider}&account=${encodeURIComponent(v.account)}&kind=${v.kind}${v.live?.name ? `&label=${encodeURIComponent(v.live.name)}` : ''}`}
                className="font-semibold underline"
              >
                {t('Add it')}</Link>
            ) : 'Ask an administrator to add it.'}
          </p>
        ) : null}

        <div className="mt-auto flex gap-2">
          <button
            type="button"
            onClick={onSelect}
            disabled={v.provider !== 'realptt'}
            title={v.provider !== 'realptt' ? 'Needs PocStar’s API' : undefined}
            className="frost-pill inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border border-border text-xs font-semibold hover:bg-bg-soft/70 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <MessageSquare className="h-3.5 w-3.5" /> {' '}{t('Message & recordings')}</button>
        </div>
      </div>
    </li>
  );
}

function RadioPanel({ v, onClose }: { v: RadioView; onClose: () => void }) {
  const { t } = useT();
  const [text, setText] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [audios, setAudios] = useState<Audio[] | null>(null);
  const [pending, start] = useTransition();

  const send = () => {
    if (!text.trim()) return;
    setStatus(null);
    start(async () => {
      try {
        const res = await fetch('/api/ptt/send', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ account: v.account, text: text.trim() }),
        });
        const data = (await res.json()) as { success?: boolean; error?: string };
        if (data.success) { setStatus(`Sent to ${v.title}.`); setText(''); }
        else setStatus(data.error ?? 'The message did not go through.');
      } catch (e) { setStatus((e as Error).message); }
    });
  };
  const loadAudio = () => {
    setAudios(null);
    start(async () => {
      try {
        const res = await fetch(`/api/ptt/audio?account=${encodeURIComponent(v.account)}`);
        const data = (await res.json()) as { success?: boolean; audios?: Audio[]; error?: string };
        if (data.success) setAudios(data.audios ?? []);
        else setStatus(data.error ?? 'Could not load the recordings.');
      } catch (e) { setStatus((e as Error).message); }
    });
  };

  return (
    <aside className="frost space-y-4 rounded-xl border p-4 lg:sticky lg:top-4" style={{ borderColor: `${TONE[v.provider]}66` }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{providerLabel(v.provider)} · {v.account}</p>
          <h2 className="truncate text-lg font-bold">{v.title}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label={t('Close')} className="rounded-md p-1.5 hover:bg-bg-soft/70"><X className="h-4 w-4" /></button>
      </div>

      <div className="space-y-2">
        <label htmlFor="radio-text" className="text-xs font-semibold uppercase text-muted-foreground">{t('Text to the radio')}</label>
        <div className="flex gap-2">
          <input
            id="radio-text" value={text} maxLength={500}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
            placeholder={t('Message…')}
            className="h-10 min-w-0 flex-1 rounded-md border border-border bg-bg-soft/80 px-3 text-sm"
          />
          <button
            type="button" onClick={send} disabled={pending || !text.trim()}
            className="inline-flex h-10 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-semibold disabled:opacity-50"
          >
            <Send className="h-4 w-4" /> {' '}{t('Send')}</button>
        </div>
        <p className="text-xs text-muted-foreground">{t('It shows on the radio with your name. Every message is kept in the audit trail.')}</p>
      </div>

      <div className="space-y-2">
        <button
          type="button" onClick={loadAudio} disabled={pending}
          className="frost-pill inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-border text-sm font-semibold hover:bg-bg-soft/70 disabled:opacity-50"
        >
          <AudioLines className="h-4 w-4" /> {' '}{t('Recordings, last 2 hours')}</button>
        {audios !== null ? (
          audios.length === 0 ? <p className="text-sm text-muted-foreground">{t('Nothing said on this radio in the last 2 hours.')}</p> : (
            <ul className="max-h-80 space-y-2 overflow-y-auto">
              {audios.map((a) => (
                <li key={a.id} className="rounded-md border border-border/60 bg-bg-soft/70 p-2">
                  <p className="mb-1 font-mono text-[11px] text-muted-foreground">{a.time}</p>
                  {/* biome-ignore lint/a11y/useMediaCaption: radio traffic has no captions */}
                  <audio controls preload="none" src={a.play_url} className="h-9 w-full" />
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>
      {status ? <p className="text-sm text-muted-foreground">{status}</p> : null}
    </aside>
  );
}

export function RadioDesk({ initial, talk, canManage }: {
  initial: Desk;
  talk: { channels: TalkChannel[]; setUp: boolean; installed: boolean };
  canManage: boolean;
}) {
  const [desk, setDesk] = useState(initial);
  const [q, setQ] = useState('');
  const [provider, setProvider] = useState<RadioProvider | 'all'>('all');
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/radio/live', { cache: 'no-store' });
      if (res.ok) setDesk((await res.json()) as Desk);
    } catch { /* keep the last picture; the next refresh tries again */ } finally { setRefreshing(false); }
  }, []);
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return desk.views.filter((v) => (provider === 'all' || v.provider === provider)
      && (!onlineOnly || v.live?.online)
      && (!term || [v.title, v.account, v.live?.name, v.register?.label].some((x) => x?.toLowerCase().includes(term))));
  }, [desk.views, q, provider, onlineOnly]);
  const selected = desk.views.find((v) => v.key === selectedKey) ?? null;
  const c = desk.counts;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-sky-500 text-white shadow-lg">
            <Radio className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-bold leading-tight"><T s="Radio Desk" /></h1>
            <p className="text-sm text-muted-foreground"><T s="Every radio and hard hat, as the person it belongs to." /></p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {desk.providers.map((p) => {
            const tone = p.ok ? '#22c55e' : p.configured ? '#ef4444' : '#f59e0b';
            return (
              <span
                key={p.provider} title={p.message}
                className="frost-pill inline-flex max-w-xs items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold"
                style={{ borderColor: `${TONE[p.provider]}66` }}
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: tone, boxShadow: p.ok ? `0 0 8px ${tone}` : undefined }} />
                <span style={{ color: TONE[p.provider] }}>{providerLabel(p.provider)}</span>
                <span className="truncate font-normal text-muted-foreground">{p.ok ? p.message : p.configured ? 'Not answering' : 'Waiting'}</span>
              </span>
            );
          })}
          <button
            type="button" onClick={() => void refresh()} disabled={refreshing}
            className="frost-pill inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
            title={`Updated ${formatSaTime(desk.at)}`}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} /> {formatSaTime(desk.at).split(' ').at(-1)}
          </button>
        </div>
      </header>

      {talk.channels.length ? (
        <TalkPanel channels={talk.channels} title="HikTech Talk" />
      ) : (
        <p className="frost rounded-xl border border-orange-500/40 px-4 py-3 text-sm">
          <span className="font-semibold text-orange-500"><T s="HikTech Talk:" />{' '}</span>
          {!talk.installed ? 'not installed yet (run migration 0083).'
            : !talk.setUp ? <><T s="no voice server yet." />{' '}{canManage ? <Link href="/admin/radios#voice" className="font-semibold underline"><T s="Set it up in Admin → Radios" /></Link> : 'An administrator sets it up.'}</>
              : 'you are not in a talk group.'}
        </p>
      )}

      {desk.providers.filter((p) => !p.ok).map((p) => (
        <p key={p.provider} className="frost rounded-xl border px-4 py-3 text-sm" style={{ borderColor: `${TONE[p.provider]}55` }}>
          <span className="font-semibold" style={{ color: TONE[p.provider] }}>{providerLabel(p.provider)}: </span>{p.message}
        </p>
      ))}

      <section className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Tile label="Radios" value={c.total} tone="#6366f1" />
        <Tile label="Online" value={c.online} tone="#22c55e" />
        <Tile label="Low battery" value={c.lowBattery} tone="#ef4444" hint="Under 20%, online" />
        <Tile label="Hard hats" value={c.hardHats} tone="#f97316" />
        <Tile label="Not in the register" value={c.unregistered} tone="#f59e0b" hint={canManage ? 'Add them in Admin → Radios' : undefined} />
      </section>

      <div className="frost flex flex-wrap items-center gap-2 rounded-xl border border-border p-3">
        <label className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a person, vehicle or account"
            className="h-9 w-full rounded-md border border-border bg-bg-soft/80 pl-9 pr-3 text-sm"
          />
        </label>
        {(['all', ...RADIO_PROVIDERS.map((p) => p.id)] as const).map((p) => {
          const on = provider === p;
          const tone = p === 'all' ? '#94a3b8' : TONE[p];
          return (
            <button
              key={p} type="button" onClick={() => setProvider(p)}
              className="frost-pill rounded-full border px-3 py-1.5 text-xs font-semibold"
              style={on ? { borderColor: tone, backgroundColor: `${tone}22`, color: tone } : { borderColor: `${tone}44` }}
            >
              {p === 'all' ? 'All platforms' : providerLabel(p)}
            </button>
          );
        })}
        <button
          type="button" onClick={() => setOnlineOnly((x) => !x)}
          className="frost-pill rounded-full border px-3 py-1.5 text-xs font-semibold"
          style={onlineOnly ? { borderColor: '#22c55e', backgroundColor: '#22c55e22', color: '#22c55e' } : { borderColor: '#22c55e44' }}
        >
          <T s="Online only" /></button>
      </div>

      <div className={`grid gap-4 ${selected ? 'lg:grid-cols-[1fr_22rem]' : ''}`}>
        {shown.length === 0 ? (
          <div className="frost rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            {desk.views.length === 0
              ? <><T s="No radios yet." />{' '}{canManage ? <Link href="/admin/radios" className="font-semibold text-accent underline"><T s="Add them to the register" /></Link> : 'An administrator adds them to the register.'}</>
              : 'No radios match.'}
          </div>
        ) : (
          <ul className={`grid gap-3 sm:grid-cols-2 ${selected ? 'xl:grid-cols-2' : 'xl:grid-cols-3'}`}>
            {shown.map((v) => (
              <RadioCard key={v.key} v={v} canManage={canManage} selected={v.key === selectedKey} onSelect={() => setSelectedKey(v.key)} />
            ))}
          </ul>
        )}
        {selected ? <RadioPanel key={selected.key} v={selected} onClose={() => setSelectedKey(null)} /> : null}
      </div>
    </div>
  );
}
