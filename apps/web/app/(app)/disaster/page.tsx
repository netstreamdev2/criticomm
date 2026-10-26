import Link from 'next/link';
import { Building2, ChevronRight, FileText, Footprints, MapPin, Network, Plus, Siren, Timer, TriangleAlert, type LucideIcon } from 'lucide-react';
import {
  getOperationalSettings, listCallFacts, listCallouts, listLastDeskUpdates, listOpenDisasterIncidents, listOpenShelters, listPostMortems,
  listReliefStocks, listShelters,
} from '@criticom/api';
import { deskChecks, isWorking } from '@criticom/api/criti/disaster';
import { IncidentLive } from '@/components/incident-live';
import { OpsMap } from '@/components/ops-map/ops-map';
import { availableLayers } from '@/lib/ops-map/layers';
import { toDeskCallout, toDeskUpdate } from '@/lib/disaster-desk';
import { getSession } from '@/lib/session';
import { cn, formatSaTime, timeAgo } from '@/lib/utils';
import { readable } from '@/lib/readable';
import { requestT } from '@/lib/i18n';
import { WindWidget } from './wind-widget';
import { LiveClock } from './live-clock';
import { LevelChip } from './desk/[id]/call-facts';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Disaster Management · HikTech' };

type Tone = 'critical' | 'warn' | 'info' | 'calm' | 'plain';
/** Each tile's colour: the bar on top, the icon and the figure. */
const TONE: Record<Tone, { rail: string; icon: string; value: string }> = {
  critical: { rail: 'border-t-severity-critical', icon: 'bg-severity-critical/15 text-severity-critical-ink', value: 'text-severity-critical-ink' },
  warn: { rail: 'border-t-severity-medium', icon: 'bg-severity-medium/15 text-severity-medium-ink', value: 'text-severity-medium-ink' },
  info: { rail: 'border-t-accent', icon: 'bg-accent/15 text-accent', value: 'text-accent' },
  calm: { rail: 'border-t-severity-low', icon: 'bg-severity-low/15 text-severity-low-ink', value: '' },
  plain: { rail: 'border-t-border', icon: 'bg-muted text-muted-foreground', value: '' },
};

/** One figure: big and coloured by how it stands, with a line saying what it counts. A link when there is more behind it. */
function Tile({ label, value, hint, icon: Icon, tone, href }: { label: string; value: string | number; hint: string; icon: LucideIcon; tone: Tone; href?: string }) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">{label}</p>
        <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-lg', TONE[tone].icon)}><Icon className="h-5 w-5" aria-hidden /></span>
      </div>
      <p className={cn('mt-3 text-4xl font-bold tabular-nums leading-none', TONE[tone].value)}>{value}</p>
      <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
    </>
  );
  const box = cn('block rounded-2xl border border-t-4 border-border bg-bg-card p-4 shadow-sm', TONE[tone].rail);
  return href ? <Link href={href} className={cn(box, 'transition-colors hover:bg-muted')}>{body}</Link> : <div className={box}>{body}</div>;
}

const RAIL: Record<string, string> = {
  Critical: 'border-l-severity-critical', High: 'border-l-severity-high', Medium: 'border-l-severity-medium', Low: 'border-l-severity-low',
};

/**
 * Disaster Management at a glance (V4's Disaster Command Center): where the
 * desk and its command land. The time, six big figures, the live map (every
 * open call, the reception centres, rain radar and traffic) beside the open
 * calls, then the weather and the latest post-mortems. Disaster has no field
 * crews on the app (0111): every call opens on the Disaster desk.
 */
export default async function DisasterPage() {
  const { t } = await requestT();
  const { supabase, userId, role, silo } = await getSession();
  const [open, postMortems, stocks, register, settings] = await Promise.all([
    listOpenDisasterIncidents(supabase).catch(() => []),
    listPostMortems(supabase).catch(() => []),
    listReliefStocks(supabase).catch(() => []),
    listShelters(supabase).catch(() => []),
    getOperationalSettings(supabase).catch(() => null),
  ]);
  const ids = open.map((i) => i.id);
  const [callouts, updates, factsList, shelters] = await Promise.all([
    listCallouts(supabase, ids), listLastDeskUpdates(supabase, ids), listCallFacts(supabase, ids), listOpenShelters(supabase),
  ]);
  const facts = new Map(factsList.map((f) => [f.incident_id, f]));
  const sheltered = shelters.reduce((n, o) => n + o.people_now, 0);
  const inHall = new Map<string, number>();
  for (const o of shelters) inHall.set(o.shelter_id, (inHall.get(o.shelter_id) ?? 0) + o.people_now);
  const halls = register.filter((h) => inHall.has(h.id));
  const now = new Date();

  const calls = open.map((i) => {
    const mine = callouts.filter((c) => c.incident_id === i.id).map(toDeskCallout);
    const ups = updates.filter((u) => u.incident_id === i.id).map(toDeskUpdate);
    return { i, mine, checks: deskChecks({ calledInAt: i.call_timestamp, callouts: mine, updates: ups }, now).filter((c) => c.level !== 'info') };
  });
  const working = callouts.filter((c) => isWorking({ status: c.status })).length;
  const needing = calls.filter((c) => c.checks.length > 0).length;
  // V4's average response: from the call to the first partner called out.
  const waits = calls.filter((c) => c.mine.length)
    .map((c) => (new Date(c.mine[0]!.calledAt).getTime() - new Date(c.i.call_timestamp).getTime()) / 60_000)
    .filter((m) => m >= 0);
  const avgResponse = waits.length ? readable(waits.reduce((a, b) => a + b, 0) / waits.length) : '—';
  const displaced = postMortems.reduce((n, p) => n + (p.displaced_people ?? 0), 0);
  const lowStock = stocks.filter((s) => s.quantity < 10);

  const tiles: Array<{ label: string; value: string | number; hint: string; icon: LucideIcon; tone: Tone; href?: string }> = [
    { label: t('Open calls'), value: open.length, hint: open.length ? t('Not closed yet') : t('All clear'), icon: Siren, tone: open.length ? 'critical' : 'calm', href: '#calls' },
    { label: t('Need the desk'), value: needing, hint: needing ? t('Need a call-out or news') : t('Nothing waiting'), icon: TriangleAlert, tone: needing ? 'warn' : 'calm', href: '#calls' },
    { label: t('Partners working'), value: working, hint: t('Called out and not left'), icon: Network, tone: 'info', href: '/disaster/partners' },
    { label: t('First call-out'), value: avgResponse, hint: t('Average, from the call'), icon: Timer, tone: 'plain' },
    { label: t('In shelters now'), value: sheltered, hint: t('{n} halls open', { n: halls.length }), icon: Building2, tone: sheltered ? 'warn' : 'plain', href: '/disaster/shelters' },
    { label: t('Displaced'), value: displaced, hint: t('From filed post-mortems'), icon: Footprints, tone: 'plain', href: '/disaster/post-mortem' },
  ];

  return (
    <div className="space-y-6">
      <IncidentLive />
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-bg-card px-6 py-5 shadow-sm">
        <div className="space-y-3">
          <div>
            <h1 className="text-2xl font-bold">{t('Disaster management')}</h1>
            <p className="text-muted-foreground">{t('Every call is run from the Disaster desk.')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/disaster/desk" className="inline-flex h-11 items-center gap-2 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground">
              <Siren className="h-4 w-4" aria-hidden />{t('Open the Disaster desk')}</Link>
            <Link href="/disaster/desk/new" className="inline-flex h-11 items-center gap-2 rounded-md border border-border bg-bg-soft px-4 text-sm font-medium hover:bg-muted">
              <Plus className="h-4 w-4" aria-hidden />{t('Open incident')}</Link>
            <Link href="/disaster/post-mortem" className="inline-flex h-11 items-center gap-2 rounded-md border border-border bg-bg-soft px-4 text-sm hover:bg-muted">
              <FileText className="h-4 w-4" aria-hidden />{t('Post-mortems')}</Link>
            <Link href="/disaster/partners" className="inline-flex h-11 items-center gap-2 rounded-md border border-border bg-bg-soft px-4 text-sm hover:bg-muted">
              <Network className="h-4 w-4" aria-hidden />{t('Partner list')}</Link>
          </div>
        </div>
        <LiveClock />
      </header>

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        {tiles.map((x) => <Tile key={x.label} {...x} />)}
      </section>
      {lowStock.length ? (
        <p className="rounded-lg border border-severity-medium/40 bg-bg-card px-4 py-2 text-sm font-medium text-severity-medium-ink">
          {t('{length} relief stock item{value} running low.', { length: lowStock.length, value: lowStock.length === 1 ? '' : 's' })}
        </p>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-5">
        <div className="overflow-hidden rounded-2xl border border-border bg-bg-card shadow-sm xl:col-span-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-5 py-3">
            <h2 className="text-lg font-semibold">{t('Live map')}</h2>
            <p className="text-sm text-muted-foreground">{t('Open calls, shelters, rain radar and traffic')}</p>
          </div>
          <OpsMap incidents={open} officers={[]} silo="EthekwiniDisaster"
            layers={availableLayers({ cameras: false, shelters: true })}
            defaults={['incidents', 'zones', 'shelters', 'radar', 'traffic']}
            basemap={settings?.['map.default_basemap'] ?? 'dark'} scopeLabel={t('Disaster Management')} height={600}
            me={{ id: userId, role, silo }}
            shelters={halls.filter((h) => h.lat != null && h.lng != null).map((h) => ({
              id: h.id, name: h.name, lat: h.lat!, lng: h.lng!, capacity: h.capacity, people: inHall.get(h.id) ?? 0 }))} />
        </div>

        <div id="calls" className="flex scroll-mt-24 flex-col overflow-hidden rounded-2xl border border-border bg-bg-card shadow-sm xl:col-span-2 xl:h-[655px]">
          <div className="flex items-baseline justify-between gap-2 border-b border-border px-5 py-3">
            <h2 className="text-lg font-semibold">{t('Open calls')} <span className="text-sm font-normal text-muted-foreground">({calls.length})</span></h2>
            <Link href="/disaster/desk" className="text-sm text-accent hover:underline">{t('Disaster desk')}</Link>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {calls.length === 0 ? (
              <div className="grid h-full place-items-center p-8 text-center">
                <div>
                  <p className="text-lg font-semibold">{t('All clear')}</p>
                  <p className="text-sm text-muted-foreground">{t('No open disaster calls.')}</p>
                </div>
              </div>
            ) : null}
            <ul className="space-y-3">
              {calls.map(({ i, mine, checks }) => (
                <li key={i.id}>
                  <Link href={`/disaster/desk/${i.id}`}
                    className={cn('group flex items-center gap-3 rounded-xl border border-l-4 border-border bg-bg-soft p-4 hover:bg-muted',
                      RAIL[i.incident_severity] ?? 'border-l-accent')}>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <LevelChip level={facts.get(i.id)?.level ?? 'Bronze'} />
                        <span className="font-semibold">{facts.get(i.id)?.short_title || i.disaster_type || i.incident_type}</span>
                      </p>
                      <p className="mt-1 font-mono text-xs text-muted-foreground">{i.incident_number}</p>
                      <p className="mt-1 flex items-center gap-1 truncate text-sm text-muted-foreground">
                        <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />{[i.location_address, i.suburb].filter(Boolean).join(', ')}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {t('Called in {ago}', { ago: timeAgo(i.call_timestamp) })} · {mine.filter(isWorking).length
                          ? t('{n} partners working', { n: mine.filter(isWorking).length })
                          : mine.length ? t('All partners left') : t('Nobody called out')}
                      </p>
                      {checks[0] ? (
                        <p className={cn('mt-1 flex items-start gap-1.5 text-sm font-medium',
                          checks[0].level === 'urgent' ? 'text-severity-critical-ink' : 'text-severity-medium-ink')}>
                          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{checks[0].text}
                        </p>
                      ) : null}
                    </div>
                    <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground group-hover:text-fg" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-5">
        <div className="xl:col-span-2"><WindWidget /></div>
        <div className="space-y-3 xl:col-span-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{t('Recent post-mortems')}</h2>
            <Link href="/disaster/post-mortem" className="text-sm text-accent hover:underline">{t('All post-mortems')}</Link>
          </div>
          {postMortems.length === 0 ? (
            <p className="rounded-2xl border border-border bg-bg-card p-6 text-center text-sm text-muted-foreground">{t('No post-mortems filed.')}</p>
          ) : (
            <ul className="grid gap-4 md:grid-cols-2">
              {postMortems.slice(0, 4).map((p) => (
                <li key={p.id} className="rounded-2xl border border-border bg-bg-card p-4 shadow-sm">
                  <p className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-semibold">{p.short_title || p.incident_type || '—'}</span>
                    <span className="text-xs text-muted-foreground">{formatSaTime(p.report_filed_at)}</span>
                  </p>
                  <p className="truncate text-sm text-muted-foreground">{p.location ?? '—'}</p>
                  <p className="mt-1 text-sm">
                    {t('{a} injured · {b} dead · {c} displaced', { a: p.injuries, b: p.fatalities, c: p.displaced_people })}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-3 text-sm">
                    {p.incident_id ? <Link href={`/incidents/${p.incident_id}`} className="text-accent hover:underline">{t('Open')}</Link> : null}
                    {p.incident_id ? <a href={`/api/pdf/disaster/${p.incident_id}`} download className="text-accent hover:underline">{t('Report (PDF)')}</a> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
