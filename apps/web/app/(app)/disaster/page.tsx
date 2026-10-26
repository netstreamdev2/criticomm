import Link from 'next/link';
import { ChevronRight, FileText, MapPin, Network, Siren, TriangleAlert } from 'lucide-react';
import { listCallFacts, listCallouts, listLastDeskUpdates, listOpenDisasterIncidents, listOpenShelters, listPostMortems, listReliefStocks } from '@criticom/api';
import { deskChecks, isWorking } from '@criticom/api/criti/disaster';
import { IncidentLive } from '@/components/incident-live';
import { LeafletMap } from '@/components/leaflet-map';
import { toDeskCallout, toDeskUpdate } from '@/lib/disaster-desk';
import { getSession } from '@/lib/session';
import { cn, escapeHtml, formatSaTime, timeAgo } from '@/lib/utils';
import { readable } from '@/lib/readable';
import { requestT } from '@/lib/i18n';
import { WindWidget } from './wind-widget';
import { LevelChip } from './desk/[id]/call-facts';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Disaster Management · HikTech' };

const RAIL: Record<string, string> = {
  Critical: 'border-l-severity-critical', High: 'border-l-severity-high', Medium: 'border-l-severity-medium', Low: 'border-l-severity-low',
};

/**
 * Disaster Management at a glance (V4's Disaster Command Center), for the
 * desk and its command. Disaster has no field crews on the app (0111): the
 * figures are the desk's — open calls, partners working them, time to the
 * first call-out — and every call opens on the Disaster desk.
 */
export default async function DisasterPage() {
  const { t } = await requestT();
  const { supabase } = await getSession();
  const [open, postMortems, stocks] = await Promise.all([
    listOpenDisasterIncidents(supabase).catch(() => []),
    listPostMortems(supabase).catch(() => []),
    listReliefStocks(supabase).catch(() => []),
  ]);
  const ids = open.map((i) => i.id);
  const [callouts, updates, factsList, shelters] = await Promise.all([
    listCallouts(supabase, ids), listLastDeskUpdates(supabase, ids), listCallFacts(supabase, ids), listOpenShelters(supabase),
  ]);
  const facts = new Map(factsList.map((f) => [f.incident_id, f]));
  const sheltered = shelters.reduce((n, o) => n + o.people_now, 0);
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

  const tiles = [
    { label: t('Open calls'), value: open.length, tone: open.length ? 'text-severity-critical-ink' : '' },
    { label: t('Need the desk'), value: needing, tone: needing ? 'text-severity-medium-ink' : '' },
    { label: t('Partners working'), value: working, tone: 'text-accent' },
    { label: t('Time to first call-out'), value: avgResponse, tone: '' },
    { label: t('Sheltered now'), value: sheltered, tone: sheltered ? 'text-severity-medium-ink' : '' },
    { label: t('Displaced (filed)'), value: displaced, tone: '' },
  ];

  return (
    <div className="space-y-6">
      <IncidentLive />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('Disaster management')}</h1>
          <p className="text-muted-foreground">{t('Every call is run from the Disaster desk.')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/disaster/desk" className="inline-flex h-11 items-center gap-2 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground">
            <Siren className="h-4 w-4" aria-hidden />{t('Open the Disaster desk')}</Link>
          <Link href="/disaster/post-mortem" className="inline-flex h-11 items-center gap-2 rounded-md border border-border bg-bg-card px-4 text-sm hover:bg-muted">
            <FileText className="h-4 w-4" aria-hidden />{t('Post-mortems')}</Link>
          <Link href="/disaster/partners" className="inline-flex h-11 items-center gap-2 rounded-md border border-border bg-bg-card px-4 text-sm hover:bg-muted">
            <Network className="h-4 w-4" aria-hidden />{t('Partner list')}</Link>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((x) => (
          <div key={x.label} className="rounded-xl border border-border bg-bg-card p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{x.label}</p>
            <p className={cn('mt-2 text-3xl font-bold tabular-nums', x.tone)}>{x.value}</p>
          </div>
        ))}
      </section>
      {lowStock.length ? (
        <p className="rounded-lg border border-severity-medium/40 bg-bg-card px-4 py-2 text-sm font-medium text-severity-medium-ink">
          {t('{length} relief stock item{value} running low.', { length: lowStock.length, value: lowStock.length === 1 ? '' : 's' })}
        </p>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-5">
        <div className="space-y-3 xl:col-span-3">
          <h2 className="text-lg font-semibold">{t('Open calls')}</h2>
          {calls.length === 0 ? (
            <div className="rounded-xl border border-border bg-bg-card p-8 text-center">
              <p className="font-semibold">{t('All clear')}</p>
              <p className="text-sm text-muted-foreground">{t('No open disaster calls.')}</p>
            </div>
          ) : null}
          <ul className="space-y-3">
            {calls.map(({ i, mine, checks }) => (
              <li key={i.id}>
                <Link href={`/disaster/desk/${i.id}`}
                  className={cn('group flex items-center gap-3 rounded-xl border border-l-4 border-border bg-bg-card p-4 shadow-sm hover:bg-muted',
                    RAIL[i.incident_severity] ?? 'border-l-accent')}>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-baseline gap-x-2">
                      <LevelChip level={facts.get(i.id)?.level ?? 'Bronze'} />
                      <span className="font-semibold">{facts.get(i.id)?.short_title || i.disaster_type || i.incident_type}</span>
                      <span className="font-mono text-xs text-muted-foreground">{i.incident_number}</span>
                    </p>
                    <p className="mt-0.5 flex items-center gap-1 truncate text-sm text-muted-foreground">
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
        <div className="space-y-6 xl:col-span-2">
          <div className="overflow-hidden rounded-xl border border-border bg-bg-card shadow-sm">
            <p className="border-b border-border px-4 py-3 font-semibold">{t('Disaster map')}</p>
            <LeafletMap height={300} pin markers={open.filter((i) => i.location_lat != null && i.location_lng != null).map((i) => ({
              id: i.id, lat: i.location_lat, lng: i.location_lng, kind: i.incident_severity.toLowerCase(), href: `/disaster/desk/${i.id}`,
              popupHtml: `<strong>${escapeHtml(i.incident_number)}</strong><br/>${escapeHtml(i.disaster_type || i.incident_type)}`,
            }))} />
          </div>
          <WindWidget />
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t('Recent post-mortems')}</h2>
          <Link href="/disaster/post-mortem" className="text-sm text-accent hover:underline">{t('All post-mortems')}</Link>
        </div>
        {postMortems.length === 0 ? (
          <p className="rounded-xl border border-border bg-bg-card p-6 text-center text-sm text-muted-foreground">{t('No post-mortems filed.')}</p>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {postMortems.slice(0, 6).map((p) => (
              <li key={p.id} className="rounded-xl border border-border bg-bg-card p-4 shadow-sm">
                <p className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">{p.incident_type ?? '—'}</span>
                  <span className="text-xs text-muted-foreground">{formatSaTime(p.report_filed_at)}</span>
                </p>
                <p className="truncate text-sm text-muted-foreground">{p.location ?? '—'}</p>
                <p className="mt-1 text-sm">
                  {t('{a} injured · {b} dead · {c} displaced', { a: p.injuries, b: p.fatalities, c: p.displaced_people })}
                </p>
                {p.incident_id ? (
                  <Link href={`/incidents/${p.incident_id}`} className="mt-1 inline-block text-sm text-accent hover:underline">{t('Open')}</Link>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
