import Link from 'next/link';
import {
  AlertCircle, AlertTriangle, Ambulance, CheckCircle2, MapPin, Navigation,
  Radio, Satellite, Smartphone, Timer, Truck, Zap,
} from 'lucide-react';
import {
  featureEnabled, getDispatcherKpis, getOperationalSettings, listActiveIncidents, listOnDutyOfficers, listPendingIncidents,
} from '@criticom/api';
import { DEPARTMENT_NAMES, canAccess, canSeeRoutes, type Database, type Silo, type UserRole } from '@criticom/db';
import { Card, CardContent } from '@/components/ui/card';
import { OpsMap } from '@/components/ops-map/ops-map';
import { getFeatures } from '@/lib/features';
import { availableLayers, defaultLayers } from '@/lib/ops-map/layers';
import type { getSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { DispatchMapButton } from '@/components/dispatch-map-button';
import { chatTime, saStamp, waitParts, waitShown } from '@/lib/when';
import { readable } from '@/lib/readable';
import { BoardLive } from './board-live';
import { requestT } from '@/lib/i18n';

type Supabase = Awaited<ReturnType<typeof getSession>>['supabase'];
type Incident = Database['public']['Tables']['incidents']['Row'];

/* ── Formatting helpers ─────────────────────────────────────────────── */


/** Prefer the 10-code when the type carries one — "10-57" beats a long label. */
function shortCode(type: string) {
  return /\b(\d{2}-\d{2})\b/.exec(type)?.[1] ?? type;
}

const FEED_META: Record<string, { label: string; icon: typeof MapPin; tone: string; chip: string }> = {
  'On Scene': { label: 'Unit On Scene', icon: MapPin, tone: 'text-severity-low-ink', chip: 'bg-severity-low/15' },
  Arrived: { label: 'Unit On Scene', icon: MapPin, tone: 'text-severity-low-ink', chip: 'bg-severity-low/15' },
  Dispatched: { label: 'Unit Dispatched', icon: Radio, tone: 'text-accent', chip: 'bg-accent/15' },
  'En Route': { label: 'Unit En Route', icon: Navigation, tone: 'text-accent', chip: 'bg-accent/15' },
  Transporting: { label: 'Transporting', icon: Ambulance, tone: 'text-severity-high-ink', chip: 'bg-severity-high/15' },
  Resolved: { label: 'Incident Closed', icon: CheckCircle2, tone: 'text-muted-foreground', chip: 'bg-muted' },
  Closed: { label: 'Incident Closed', icon: CheckCircle2, tone: 'text-muted-foreground', chip: 'bg-muted' },
};
const FEED_DEFAULT = { label: 'Incoming Incident', icon: AlertCircle, tone: 'text-severity-medium-ink', chip: 'bg-severity-medium/15' };

/* ── South African days ─────────────────────────────────────────────── */

// The control room works in SAST. The server may run in UTC (Vercel), so
// "today" and the per-day volume buckets are computed for Africa/Johannesburg
// explicitly — otherwise the board rolls over at 02:00 local time.
const SA_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
});
/** YYYY-MM-DD in SAST. */
const saDay = (d: Date | string) => SA_DAY.format(typeof d === 'string' ? new Date(d) : d);
/** Midnight SAST of the given SA day, as an instant. */
const saMidnight = (day: string) => new Date(`${day}T00:00:00+02:00`);

const avgMinutes = (spans: number[]) =>
  spans.length ? Math.round(spans.reduce((s, m) => s + m, 0) / spans.length) : null;

/* ── Tiny inline visuals (server-safe SVG/divs) ─────────────────────── */

/** Cyan progress ring, dispatch-board style: value over an operational target. */
function Ring({ value, max }: { value: number; max: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const frac = Math.min(1, Math.max(0.04, max > 0 ? value / max : 0));
  return (
    <svg viewBox="0 0 64 64" className="mx-auto mt-2 h-16 w-16 -rotate-90" aria-hidden="true">
      <circle cx="32" cy="32" r={r} fill="none" strokeWidth="6" className="stroke-muted" />
      <circle
        cx="32" cy="32" r={r} fill="none" strokeWidth="6" strokeLinecap="round"
        className="stroke-accent" strokeDasharray={`${c * frac} ${c}`}
      />
    </svg>
  );
}

/** Ten-day call-volume sparkbars under the total counter. */
function MiniBars({ counts }: { counts: number[] }) {
  const max = Math.max(1, ...counts);
  return (
    <div className="mx-auto mt-3 flex h-12 items-end justify-center gap-1" aria-hidden>
      {counts.map((n, i) => (
        <span
          key={i}
          className="w-2 rounded-sm bg-accent"
          style={{ height: `${Math.max(8, (n / max) * 100)}%`, opacity: 0.45 + 0.55 * (n / max) }}
        />
      ))}
    </div>
  );
}

/* ── The board ──────────────────────────────────────────────────────── */

export async function DispatchBoard({
  supabase, sf, role, silo, userId,
}: {
  supabase: Supabase; sf: Silo | undefined; role: string; silo: string; userId: string;
}) {
  const { t } = await requestT();
  // Loggers see the board but cannot assign — their button opens the incident.
  const canDispatch = canAccess('/dispatch/pending', role as UserRole, silo as Silo);
  const canAssign = canAccess('/dispatch/assign/x', role as UserRole, silo as Silo);
  // Admin-tuned knobs (Admin → Operations Settings) shape the whole board.
  const settings = await getOperationalSettings(supabase);
  const volumeDays = settings['board.volume_days'];

  const now = new Date();
  const today = saDay(now);
  const todayStart = saMidnight(today);
  const tenDaysAgo = new Date(todayStart.getTime() - (volumeDays - 1) * 86_400_000);

  const feedQ = supabase
    .from('incidents')
    .select('id, incident_number, incident_type, incident_severity, status, location_address, location_lat, location_lng, updated_at')
    .order('updated_at', { ascending: false })
    .limit(settings['board.feed_items']);
  const totalQ = supabase.from('incidents').select('id', { count: 'exact', head: true });
  const recentQ = supabase
    .from('incidents')
    .select('incident_created_at')
    .gte('incident_created_at', tenDaysAgo.toISOString());
  const closedQ = supabase
    .from('incidents')
    .select('closed_at, call_timestamp')
    .gte('closed_at', todayStart.toISOString());
  // Response time = call to arrival on scene (Operations Manual 36: the
  // response target the gauge measures against), for calls reached today.
  const arrivedQ = supabase
    .from('incidents')
    .select('call_timestamp, arrived_timestamp')
    .gte('arrived_timestamp', todayStart.toISOString());

  const [kpi, active, pending, officers, feedRes, totalRes, recentRes, closedRes, arrivedRes] = await Promise.all([
    getDispatcherKpis(supabase, sf),
    listActiveIncidents(supabase, sf),
    listPendingIncidents(supabase, sf),
    listOnDutyOfficers(supabase, sf ? [sf] : undefined).catch(() => []),
    sf ? feedQ.eq('silo', sf) : feedQ,
    sf ? totalQ.eq('silo', sf) : totalQ,
    sf ? recentQ.eq('silo', sf) : recentQ,
    sf ? closedQ.eq('silo', sf) : closedQ,
    sf ? arrivedQ.eq('silo', sf) : arrivedQ,
  ]);

  // Live = everything not yet resolved: the active board plus the queue.
  const live: Incident[] = [...active, ...pending.filter((p) => !active.some((a) => a.id === p.id))];
  const buckets = {
    high: live.filter((i) => i.incident_severity === 'Critical' || i.incident_severity === 'High').length,
    med: live.filter((i) => i.incident_severity === 'Medium').length,
    low: live.filter((i) => i.incident_severity === 'Low').length,
  };

  const closedToday = (closedRes.data ?? []).length;

  // Oldest critical call still waiting is the one the room must clear first.
  const rank: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  const waiting = [...pending].sort((a, b) =>
    (rank[a.incident_severity] ?? 9) - (rank[b.incident_severity] ?? 9)
    || new Date(a.incident_created_at).getTime() - new Date(b.incident_created_at).getTime());
  const critical = waiting[0];
  // How long it has waited, as the calendar counts: "6mo 14d 12h 34m", years when it comes to that.
  const wait = critical ? waitShown(waitParts(critical.incident_created_at)) : null;

  // Volume sparkline over the configured window, zero-filled so quiet days
  // still occupy a bar.
  const perDay = new Map<string, number>();
  for (let i = 0; i < volumeDays; i++) {
    perDay.set(saDay(new Date(tenDaysAgo.getTime() + i * 86_400_000)), 0);
  }
  for (const row of recentRes.data ?? []) {
    const day = saDay(String(row.incident_created_at));
    if (perDay.has(day)) perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }

  // Mean minutes from call to closure, today only — V4's "avg call duration".
  const durations = (closedRes.data ?? [])
    .filter((r) => r.closed_at && r.call_timestamp)
    .map((r) => (new Date(r.closed_at!).getTime() - new Date(r.call_timestamp).getTime()) / 60_000)
    .filter((m) => m >= 0);
  const avgDuration = avgMinutes(durations);

  const responses = (arrivedRes.data ?? [])
    .filter((r) => r.arrived_timestamp && r.call_timestamp)
    .map((r) => (new Date(r.arrived_timestamp!).getTime() - new Date(r.call_timestamp).getTime()) / 60_000)
    .filter((m) => m >= 0);
  const avgResponse = avgMinutes(responses);
  // Call → dispatch, from the KPI function (all calls in scope).
  const avgDispatch = Math.round(Number(kpi.avgResponseTime ?? 0));

  return (
    <>
      <BoardLive />
      {/* ── Row 1: headline stats ── */}
      <section className="grid gap-4 md:grid-cols-3">
        <Card className="relative h-full overflow-hidden">
          {/* Faint red wash behind the counter, like a warning lamp bleeding into the card. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ background: 'radial-gradient(ellipse at 50% 30%, rgb(var(--c-critical) / 0.14), transparent 65%)' }}
          />
          <CardContent className="relative flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <span className="ops-chip" data-tone="critical"><AlertTriangle className="h-5 w-5" /></span>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">{t('Live incidents')}</p>
            <p className="stat-glow text-6xl font-bold text-severity-critical-ink">{live.length}</p>
          </CardContent>
        </Card>

        <Card className="h-full">
          <CardContent className="flex h-full flex-col justify-center p-6">
            <p className="text-center text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">
              {t('Severity analysis')}</p>
            <div className="mt-5 flex items-center justify-center">
              {([
                ['HIGH', buckets.high, 'bg-severity-critical'],
                ['MED', buckets.med, 'bg-severity-medium'],
                ['LOW', buckets.low, 'bg-severity-low'],
              ] as const).map(([label, value, dot], i) => (
                <div key={label} className={cn('flex-1 text-center', i > 0 && 'border-l border-border')}>
                  <p className="text-4xl font-bold">{value}</p>
                  <p className="mt-2 flex items-center justify-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    <span className={cn('h-1.5 w-1.5 rounded-full', dot)} /> {label}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="relative h-full overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ background: 'radial-gradient(ellipse at 50% 30%, rgb(var(--c-low) / 0.12), transparent 65%)' }}
          />
          <CardContent className="relative flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <span className="ops-chip" data-tone="low"><CheckCircle2 className="h-5 w-5" /></span>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">{t('Closed today')}</p>
            <p className="stat-glow text-6xl font-bold text-severity-low-ink">{closedToday}</p>
          </CardContent>
        </Card>
      </section>

      {/* ── Row 2: feed + critical wait ── */}
      <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-base font-bold">
                <Satellite className="h-4 w-4 text-accent" /> {' '}{t('Live Operations Feed')}</h2>
              <span className="rounded-md bg-accent px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                {t('Real-time')}</span>
            </div>

            <ul className="mt-4 space-y-1">
              {feedRes.data?.length ? feedRes.data.map((i) => {
                const meta = FEED_META[i.status] ?? FEED_DEFAULT;
                const Icon = meta.icon;
                return (
                  <li key={`${i.id}-${i.updated_at}`} className="flex items-center gap-1 rounded-lg transition-colors hover:bg-muted/50">
                    <Link
                      href={`/incidents/${i.id}`}
                      className="flex min-w-0 flex-1 items-start gap-3 px-2 py-2.5"
                    >
                      <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', meta.chip, meta.tone)}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-3">
                          <span className="truncate text-sm font-bold">{meta.label}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{chatTime(i.updated_at, now)}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {t('{shortCode} at {value}', { shortCode: shortCode(i.incident_type), value: i.location_address })}
                        </span>
                      </span>
                    </Link>
                    {i.location_lat && i.location_lng && i.status !== 'Resolved' && i.status !== 'Closed' ? (
                      <DispatchMapButton
                        incident={{
                          id: i.id, number: i.incident_number, type: i.incident_type, severity: i.incident_severity,
                          address: i.location_address, lat: i.location_lat, lng: i.location_lng,
                        }}
                        officers={officers}
                        canAssign={canAssign}
                        title={t('Officers, routes and minutes away')}
                        className="mr-1 shrink-0 rounded-md p-2 text-accent hover:bg-accent/15"
                      >
                        <MapPin className="h-4 w-4" aria-label={t('Live map')} />
                      </DispatchMapButton>
                    ) : null}
                  </li>
                );
              }) : (
                <li className="px-2 py-8 text-center text-sm text-muted-foreground">
                  {t('No activity yet — the feed fills as calls move.')}</li>
              )}
            </ul>
          </CardContent>
        </Card>

        {/* Critical wait — the call the room must clear first. Fixed amber so it
            reads as the same warning light in every theme. */}
        {critical && wait ? (
          <div className="flex flex-col items-center justify-center rounded-xl bg-[#8a6710] p-8 text-center text-white shadow-2xl">
            <Timer className="h-10 w-10" />
            <p className="mt-4 text-lg font-bold uppercase tracking-wider">{t('Critical wait time')}</p>
            <p className="mt-1 text-sm text-white/80">
              {t('Ticket #{value} ({shortCode})', { value: critical.incident_number, shortCode: shortCode(critical.incident_type) })}</p>
            <p className="mt-4 font-mono text-4xl font-bold tabular-nums">
              {wait.map(([n, unit], i) => (
                <span key={unit}>{n}<span className="text-lg text-white/70">{unit}{i < wait.length - 1 ? ' ' : ''}</span></span>
              ))}
            </p>
            <p className="mt-1 text-xs text-white/75">{t('Waiting since {value}', { value: saStamp(critical.incident_created_at) })}</p>
            <Link
              href={canDispatch ? `/dispatch/assign/${critical.id}` : `/incidents/${critical.id}`}
              className="mt-6 inline-flex h-11 items-center gap-2 rounded-full bg-white px-8 text-sm font-bold text-[#5c4408] transition-transform hover:scale-[1.03]"
            >
              <Zap className="h-4 w-4" /> {canDispatch ? 'Dispatch now' : 'Open incident'}
            </Link>
            {critical.location_lat && critical.location_lng ? (
              <DispatchMapButton
                incident={{
                  id: critical.id, number: critical.incident_number, type: critical.incident_type,
                  severity: critical.incident_severity, address: critical.location_address,
                  lat: critical.location_lat, lng: critical.location_lng,
                }}
                officers={officers}
                canAssign={canAssign}
                className="mt-3 inline-flex h-9 items-center gap-2 rounded-full border border-white/60 px-5 text-xs font-bold uppercase tracking-wider text-white hover:bg-white/10"
              >
                <MapPin className="h-3.5 w-3.5" /> {' '}{t('Nearest units & routes')}</DispatchMapButton>
            ) : null}
            <Link
              href={`/incidents/${critical.id}`}
              className="mt-4 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-white/85 hover:text-white"
            >
              <Smartphone className="h-3.5 w-3.5" /> {' '}{t('Request GPS via SMS')}</Link>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-xl border border-severity-low/40 bg-severity-low/10 p-8 text-center">
            <CheckCircle2 className="h-10 w-10 text-severity-low-ink" />
            <p className="mt-4 text-lg font-bold uppercase tracking-wider text-severity-low-ink">{t('Queue clear')}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('Nothing is waiting for dispatch right now.')}</p>
          </div>
        )}
      </section>

      {/* ── Row 3: live map ── */}
      <Card>
        <CardContent className="p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-base font-bold">
              <MapPin className="h-4 w-4 text-accent" /> {' '}{t('Real-Time Incident Map')}</h2>
            <div className="flex items-center gap-2">
              <Link href="/incidents/map" className="text-xs font-bold uppercase tracking-wider text-accent hover:underline">
                {t('Open full map')}</Link>
              <span className="rounded-md bg-accent px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                {sf ?? 'Ethekwini'}
              </span>
              <span className="flex items-center gap-1.5 rounded-md bg-severity-low px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                <span className="live-dot" /> {' '}{t('Live')}</span>
            </div>
          </div>
          {/* Layers (crime zones, hydrants, weather…) and Full screen for the wall TV sit on the map. */}
          <OpsMap
            incidents={live}
            officers={officers}
            silo={sf}
            layers={availableLayers({
              cameras: canAccess('/sanral', role as UserRole, silo as Silo),
              routes: canSeeRoutes(role as UserRole),
            })}
            defaults={defaultLayers(role as UserRole)}
            basemap={settings['map.default_basemap']}
            scopeLabel={sf ? DEPARTMENT_NAMES[sf] : 'All departments'}
            height={640}
            me={{ id: userId, role: role as UserRole, silo: silo as Silo }}
            bodycams={canAccess('/cameras', role as UserRole, silo as Silo) && featureEnabled(await getFeatures(), 'web.cameras')}
            liveRoutes={{ canAssign }}
          />
        </CardContent>
      </Card>

      {/* ── Row 4: throughput ── */}
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">{t('Total calls logged')}</p>
            <p className="mt-1 text-4xl font-bold">{totalRes.count ?? 0}</p>
            <MiniBars counts={[...perDay.values()]} />
            <p className="mt-2 text-[11px] text-muted-foreground">
              {t('{value} today · last {volumeDays} days shown', { value: perDay.get(today) ?? 0, volumeDays })}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">{t('Avg response time')}</p>
            <p className="mt-1 text-4xl font-bold">
              {readable(avgResponse)}
            </p>
            <Ring value={avgResponse ?? 0} max={settings['sla.response_target_minutes']} />
            <p className="mt-2 text-[11px] text-muted-foreground">
              {t('Call → on scene today · target {value} · dispatch {avgDispatch}', { value: readable(settings['sla.response_target_minutes']), avgDispatch: readable(avgDispatch) })}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">{t('Avg call duration')}</p>
            <p className="mt-1 text-4xl font-bold">
              {readable(avgDuration)}
            </p>
            <Ring value={avgDuration ?? 0} max={settings['sla.call_duration_target_minutes']} />
            <p className="mt-2 text-[11px] text-muted-foreground">
              {t('Call → closed today · target {value}', { value: readable(settings['sla.call_duration_target_minutes']) })}</p>
          </CardContent>
        </Card>

        <Card className="border-accent/60">
          <CardContent className="flex flex-col items-center justify-center p-6 text-center">
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-accent">
              <Truck className="h-4 w-4" /> {' '}{t('Active units')}</p>
            <p className="stat-glow mt-1 text-5xl font-bold text-accent">{kpi.personnelOnDuty}</p>
            <p className="mt-2 text-xs text-muted-foreground">{t('Live Responders on Duty')}</p>
          </CardContent>
        </Card>
      </section>
    </>
  );
}
