import Link from 'next/link';
import {
  AlertCircle, AlertTriangle, Ambulance, CheckCircle2, MapPin, Navigation,
  Radio, Satellite, Smartphone, Timer, Truck, Zap,
} from 'lucide-react';
import { getDispatcherKpis, listActiveIncidents, listPendingIncidents } from '@criticom/api';
import type { Database, Silo } from '@criticom/db';
import { Card, CardContent } from '@/components/ui/card';
import { LeafletMap, type MapMarker } from '@/components/leaflet-map';
import type { getSession } from '@/lib/session';
import { timeAgo, cn } from '@/lib/utils';

type Supabase = Awaited<ReturnType<typeof getSession>>['supabase'];
type Incident = Database['public']['Tables']['incidents']['Row'];

/* ── Formatting helpers ─────────────────────────────────────────────── */

/** "36d 10h 23m" — how long a critical call has sat unanswered. */
function elapsedParts(iso: string) {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  return { d: Math.floor(mins / 1440), h: Math.floor((mins % 1440) / 60), m: mins % 60 };
}

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

const PIN_KIND: Record<string, string> = { Critical: 'critical', High: 'critical', Medium: 'medium', Low: 'low' };

/* ── Tiny inline visuals (server-safe SVG/divs) ─────────────────────── */

/** Cyan progress ring, dispatch-board style: value over an operational target. */
function Ring({ value, max }: { value: number; max: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const frac = Math.min(1, Math.max(0.04, max > 0 ? value / max : 0));
  return (
    <svg viewBox="0 0 64 64" className="mx-auto mt-2 h-16 w-16 -rotate-90" aria-hidden>
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

export async function DispatchBoard({ supabase, sf }: { supabase: Supabase; sf: Silo | undefined }) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const tenDaysAgo = new Date(todayStart.getTime() - 9 * 86_400_000);

  const feedQ = supabase
    .from('incidents')
    .select('id, incident_number, incident_type, incident_severity, status, location_address, updated_at')
    .order('updated_at', { ascending: false })
    .limit(6);
  const totalQ = supabase.from('incidents').select('id', { count: 'exact', head: true });
  const recentQ = supabase
    .from('incidents')
    .select('incident_created_at')
    .gte('incident_created_at', tenDaysAgo.toISOString());
  const closedQ = supabase
    .from('incidents')
    .select('closed_at, call_timestamp')
    .gte('closed_at', todayStart.toISOString());

  const [kpi, active, pending, feedRes, totalRes, recentRes, closedRes] = await Promise.all([
    getDispatcherKpis(supabase, sf),
    listActiveIncidents(supabase, sf),
    listPendingIncidents(supabase, sf),
    sf ? feedQ.eq('silo', sf) : feedQ,
    sf ? totalQ.eq('silo', sf) : totalQ,
    sf ? recentQ.eq('silo', sf) : recentQ,
    sf ? closedQ.eq('silo', sf) : closedQ,
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
  const wait = critical ? elapsedParts(critical.incident_created_at) : null;

  // Ten-day sparkline, zero-filled so quiet days still occupy a bar.
  const perDay = new Map<string, number>();
  for (let i = 0; i < 10; i++) {
    perDay.set(new Date(tenDaysAgo.getTime() + i * 86_400_000).toISOString().slice(0, 10), 0);
  }
  for (const row of recentRes.data ?? []) {
    const day = String(row.incident_created_at).slice(0, 10);
    if (perDay.has(day)) perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }

  // Mean minutes from call to closure, today only — V4's "avg call duration".
  const durations = (closedRes.data ?? [])
    .filter((r) => r.closed_at && r.call_timestamp)
    .map((r) => (new Date(r.closed_at!).getTime() - new Date(r.call_timestamp).getTime()) / 60_000)
    .filter((m) => m >= 0);
  const avgDuration = durations.length
    ? Math.round(durations.reduce((s, m) => s + m, 0) / durations.length)
    : 0;

  const markers: MapMarker[] = live
    .filter((i) => i.location_lat && i.location_lng)
    .map((i) => ({
      id: i.id,
      lat: i.location_lat,
      lng: i.location_lng,
      kind: PIN_KIND[i.incident_severity] ?? 'medium',
      popupHtml: `<strong>${i.incident_number}</strong><br/>${i.incident_type}<br/>${i.location_address}`,
    }));

  const avgResponse = Math.round(Number(kpi.avgResponseTime ?? 0));

  return (
    <>
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
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">Live incidents</p>
            <p className="stat-glow text-6xl font-bold text-severity-critical-ink">{live.length}</p>
          </CardContent>
        </Card>

        <Card className="h-full">
          <CardContent className="flex h-full flex-col justify-center p-6">
            <p className="text-center text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">
              Severity analysis
            </p>
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
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">Closed today</p>
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
                <Satellite className="h-4 w-4 text-accent" /> Live Operations Feed
              </h2>
              <span className="rounded-md bg-accent px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                Real-time
              </span>
            </div>

            <ul className="mt-4 space-y-1">
              {feedRes.data?.length ? feedRes.data.map((i) => {
                const meta = FEED_META[i.status] ?? FEED_DEFAULT;
                const Icon = meta.icon;
                return (
                  <li key={`${i.id}-${i.updated_at}`}>
                    <Link
                      href={`/incidents/${i.id}`}
                      className="flex items-start gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted/50"
                    >
                      <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', meta.chip, meta.tone)}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-3">
                          <span className="truncate text-sm font-bold">{meta.label}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(i.updated_at)}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {shortCode(i.incident_type)} at {i.location_address}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              }) : (
                <li className="px-2 py-8 text-center text-sm text-muted-foreground">
                  No activity yet — the feed fills as calls move.
                </li>
              )}
            </ul>
          </CardContent>
        </Card>

        {/* Critical wait — the call the room must clear first. Fixed amber so it
            reads as the same warning light in every theme. */}
        {critical && wait ? (
          <div className="flex flex-col items-center justify-center rounded-xl bg-[#8a6710] p-8 text-center text-white shadow-2xl">
            <Timer className="h-10 w-10" />
            <p className="mt-4 text-lg font-bold uppercase tracking-wider">Critical wait time</p>
            <p className="mt-1 text-sm text-white/80">
              Ticket #{critical.incident_number} ({shortCode(critical.incident_type)})
            </p>
            <p className="mt-4 font-mono text-4xl font-bold tabular-nums">
              {wait.d > 0 && <>{wait.d}<span className="text-lg text-white/70">d </span></>}
              {wait.h}<span className="text-lg text-white/70">h </span>
              {wait.m}<span className="text-lg text-white/70">m</span>
            </p>
            <Link
              href={`/dispatch/assign/${critical.id}`}
              className="mt-6 inline-flex h-11 items-center gap-2 rounded-full bg-white px-8 text-sm font-bold text-[#5c4408] transition-transform hover:scale-[1.03]"
            >
              <Zap className="h-4 w-4" /> Dispatch now
            </Link>
            <Link
              href={`/incidents/${critical.id}`}
              className="mt-4 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-white/85 hover:text-white"
            >
              <Smartphone className="h-3.5 w-3.5" /> Request GPS via SMS
            </Link>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-xl border border-severity-low/40 bg-severity-low/10 p-8 text-center">
            <CheckCircle2 className="h-10 w-10 text-severity-low-ink" />
            <p className="mt-4 text-lg font-bold uppercase tracking-wider text-severity-low-ink">Queue clear</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Nothing is waiting for dispatch right now.
            </p>
          </div>
        )}
      </section>

      {/* ── Row 3: live map ── */}
      <Card>
        <CardContent className="p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-base font-bold">
              <MapPin className="h-4 w-4 text-accent" /> Real-Time Incident Map
            </h2>
            <div className="flex items-center gap-2">
              <Link href="/incidents/map" className="text-xs font-bold uppercase tracking-wider text-accent hover:underline">
                Scan area
              </Link>
              <span className="rounded-md bg-accent px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                {sf ?? 'Ethekwini'}
              </span>
              <span className="flex items-center gap-1.5 rounded-md bg-severity-low px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                <span className="live-dot" /> Live
              </span>
            </div>
          </div>
          <div className="overflow-hidden rounded-lg border border-border">
            <LeafletMap markers={markers} height={640} satellite pin />
          </div>
        </CardContent>
      </Card>

      {/* ── Row 4: throughput ── */}
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">Total calls logged</p>
            <p className="mt-1 text-4xl font-bold">{totalRes.count ?? 0}</p>
            <MiniBars counts={[...perDay.values()]} />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">Avg response time</p>
            <p className="mt-1 text-4xl font-bold">{avgResponse}</p>
            <Ring value={avgResponse} max={30} />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">Avg call duration</p>
            <p className="mt-1 text-4xl font-bold">{avgDuration}</p>
            <Ring value={avgDuration} max={120} />
          </CardContent>
        </Card>

        <Card className="border-accent/60">
          <CardContent className="flex flex-col items-center justify-center p-6 text-center">
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-accent">
              <Truck className="h-4 w-4" /> Active units
            </p>
            <p className="stat-glow mt-1 text-5xl font-bold text-accent">{kpi.personnelOnDuty}</p>
            <p className="mt-2 text-xs text-muted-foreground">Live Responders on Duty</p>
          </CardContent>
        </Card>
      </section>
    </>
  );
}
