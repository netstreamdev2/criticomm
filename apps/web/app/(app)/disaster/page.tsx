import { Suspense } from 'react';
import Link from 'next/link';
import { listDisasterLogs, listOpenDisasterIncidents, listReliefStocks, listPostMortems } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { LeafletMap } from '@/components/leaflet-map';
import { WindWidget } from './wind-widget';
import { getSession } from '@/lib/session';
import { escapeHtml, formatSaTime, timeAgo } from '@/lib/utils';
import { periodicUpdateAction } from './actions';
import { CritiTiles } from '@/components/criti/insight-tiles';
import { AttendanceNow } from '@/components/schedule/attendance-now';
import { requestT } from '@/lib/i18n';
import { readable } from '@/lib/readable';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Disaster Management · HikTech' };

type TimelineEntry = { timestamp: string; text: string };

export default async function DisasterPage() {
  const { t } = await requestT();
  const { supabase, role, silo } = await getSession();
  const [logs, stocks, postMortems, activeIncidents] = await Promise.all([
    listDisasterLogs(supabase),
    listReliefStocks(supabase).catch(() => []),
    listPostMortems(supabase),
    listOpenDisasterIncidents(supabase).catch(() => []),
  ]);
  const lowStock = stocks.filter((s) => s.quantity < 10);
  // V4's dashboard figures.
  const displaced = postMortems.reduce((n, p) => n + (p.displaced_people ?? 0), 0);
  const openIds = new Map(activeIncidents.map((i) => [i.id, i]));
  const waits = logs
    .map((l) => ({ l, i: l.incident_id ? openIds.get(l.incident_id) : undefined }))
    .filter((x) => x.i?.call_timestamp)
    .map((x) => (new Date(x.l.dispatch_timestamp).getTime() - new Date(x.i!.call_timestamp).getTime()) / 60_000)
    .filter((m) => m >= 0);
  const avgResponse = waits.length ? readable(waits.reduce((a, b) => a + b, 0) / waits.length) : 'N/A';
  const resourcesDispatched = logs.filter((l) => l.resource_type).length;
  const liveLogs = logs.filter((l) => !l.incident_id || openIds.has(l.incident_id));

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('Disaster management')}</h1>
          <p className="text-muted-foreground">{t('Deployments, periodic updates and after-action reports.')}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/disaster/dispatch" className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold">
            {t('+ Dispatch resources')}</Link>
          <Link href="/disaster/post-mortem" className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm hover:bg-muted">
            {t('Post-mortems')}</Link>
        </div>
      </header>

      {/* Criti: what needs attention now, for this person. */}
      <CritiTiles />
      <Suspense fallback={null}><AttendanceNow viewerRole={role} ownSilo={silo} silo={'EthekwiniDisaster'} /></Suspense>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Active incidents', value: activeIncidents.length, tone: 'text-severity-critical-ink' },
          { label: 'Displaced people', value: displaced, tone: 'text-severity-medium-ink' },
          { label: 'Avg response', value: avgResponse, tone: 'text-accent' },
          { label: 'Resources dispatched', value: resourcesDispatched, tone: '' },
        ].map((t) => (
          <Card key={t.label}><CardContent className="p-4">
            <p className="text-xs uppercase text-muted-foreground">{t.label}</p>
            <p className={`mt-2 text-3xl font-bold ${t.tone}`}>{t.value}</p>
          </CardContent></Card>
        ))}
      </section>
      {lowStock.length ? (
        <p className="text-sm text-severity-medium-ink">{t('{length} relief stock item{value} running low.', { length: lowStock.length, value: lowStock.length === 1 ? '' : 's' })}</p>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t('Disaster map')}</CardTitle>
            <CardDescription>{t('Active disaster-silo incidents.')}</CardDescription>
          </CardHeader>
          <CardContent className="p-2">
            <LeafletMap
              height={320}
              markers={activeIncidents.map((i) => ({
                id: i.id,
                lat: i.location_lat,
                lng: i.location_lng,
                kind: i.incident_severity.toLowerCase(),
                popupHtml: `<strong>${escapeHtml(i.incident_number)}</strong><br/>${escapeHtml(i.incident_type)}<br/><a href="/incidents/${escapeHtml(i.id)}">Open →</a>`,
              }))}
            />
          </CardContent>
        </Card>
        <WindWidget />
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">{t('Deployment monitor')}</h2>
        {liveLogs.length === 0 && (
          <Card><CardContent className="p-8 text-center text-muted-foreground">
            {t('No active disaster deployments.')}</CardContent></Card>
        )}
        {liveLogs.map((log) => {
          const updates = (Array.isArray(log.updates) ? log.updates : []) as TimelineEntry[];
          return (
            <Card key={log.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="font-mono">{log.incident_number}</CardTitle>
                    <CardDescription>
                      {t('{value} · {location} · {value2} deployed {timeAgo}', { value: log.incident_type, location: log.location, value2: log.resource_type, timeAgo: timeAgo(log.dispatch_timestamp) })}
                    </CardDescription>
                  </div>
                  <Link href="/disaster/partners" className="text-sm text-accent hover:underline">
                    {t('Mutual-aid partners →')}</Link>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p>{log.description}</p>
                <div className="rounded-md border border-border/60 bg-bg-soft p-3">
                  <p className="mb-2 text-xs uppercase text-muted-foreground">{t('Timeline ({length})', { length: updates.length })}</p>
                  <ul className="space-y-1.5">
                    {updates.length === 0 && <li className="text-muted-foreground">{t('No periodic updates yet.')}</li>}
                    {[...updates].reverse().map((u, i) => (
                      <li key={i} className="flex gap-3">
                        <span className="shrink-0 font-mono text-xs text-muted-foreground">{formatSaTime(u.timestamp)}</span>
                        <span>{u.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <form action={periodicUpdateAction} className="flex gap-2">
                  <input type="hidden" name="log_id" value={log.id} />
                  <input
                    name="text" required placeholder={t('Log periodic update…')}
                    className="h-10 flex-1 rounded-md border border-border bg-bg-soft px-3 text-sm"
                  />
                  <button type="submit" className="h-10 rounded-md bg-accent px-4 text-sm font-semibold">{t('Log update')}</button>
                </form>
              </CardContent>
            </Card>
          );
        })}
      </section>
    </div>
  );
}
