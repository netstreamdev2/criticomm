import Link from 'next/link';
import { listDisasterLogs, listReliefStocks, listPostMortems, listActiveIncidents } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { LeafletMap } from '@/components/leaflet-map';
import { WindWidget } from './wind-widget';
import { getSession } from '@/lib/session';
import { formatSaTime, timeAgo } from '@/lib/utils';
import { periodicUpdateAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Disaster Management · HikTech' };

type TimelineEntry = { timestamp: string; text: string };

export default async function DisasterPage() {
  const { supabase } = await getSession();
  const [logs, stocks, postMortems, activeIncidents] = await Promise.all([
    listDisasterLogs(supabase),
    listReliefStocks(supabase),
    listPostMortems(supabase),
    listActiveIncidents(supabase, 'EthekwiniDisaster').catch(() => []),
  ]);
  const lowStock = stocks.filter((s) => s.quantity < 10);

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Disaster management</h1>
          <p className="text-muted-foreground">Deployments, periodic updates and after-action reports.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/disaster/dispatch" className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold">
            + Dispatch resources
          </Link>
          <Link href="/disaster/post-mortem" className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm hover:bg-muted">
            Post-mortems
          </Link>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-4">
        <Card><CardContent className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Active deployments</p>
          <p className="mt-2 text-3xl font-bold">{logs.length}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Relief stock lines</p>
          <p className="mt-2 text-3xl font-bold">{stocks.length}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Low stock items</p>
          <p className="mt-2 text-3xl font-bold text-severity-medium-ink">{lowStock.length}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Post-mortems filed</p>
          <p className="mt-2 text-3xl font-bold">{postMortems.length}</p>
        </CardContent></Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Disaster map</CardTitle>
            <CardDescription>Active disaster-silo incidents.</CardDescription>
          </CardHeader>
          <CardContent className="p-2">
            <LeafletMap
              height={320}
              markers={activeIncidents.map((i) => ({
                id: i.id,
                lat: i.location_lat,
                lng: i.location_lng,
                kind: i.incident_severity.toLowerCase(),
                popupHtml: `<strong>${i.incident_number}</strong><br/>${i.incident_type}<br/><a href="/incidents/${i.id}">Open →</a>`,
              }))}
            />
          </CardContent>
        </Card>
        <WindWidget />
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Deployment monitor</h2>
        {logs.length === 0 && (
          <Card><CardContent className="p-8 text-center text-muted-foreground">
            No active disaster deployments.
          </CardContent></Card>
        )}
        {logs.map((log) => {
          const updates = (Array.isArray(log.updates) ? log.updates : []) as TimelineEntry[];
          return (
            <Card key={log.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="font-mono">{log.incident_number}</CardTitle>
                    <CardDescription>
                      {log.incident_type} · {log.location} · {log.resource_type} deployed {timeAgo(log.dispatch_timestamp)}
                    </CardDescription>
                  </div>
                  <Link href="/disaster/partners" className="text-sm text-accent hover:underline">
                    Mutual-aid partners →
                  </Link>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p>{log.description}</p>
                <div className="rounded-md border border-border/60 bg-bg-soft p-3">
                  <p className="mb-2 text-xs uppercase text-muted-foreground">Timeline ({updates.length})</p>
                  <ul className="space-y-1.5">
                    {updates.length === 0 && <li className="text-muted-foreground">No periodic updates yet.</li>}
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
                    name="text" required placeholder="Log periodic update…"
                    className="h-10 flex-1 rounded-md border border-border bg-bg-soft px-3 text-sm"
                  />
                  <button type="submit" className="h-10 rounded-md bg-accent px-4 text-sm font-semibold">Log update</button>
                </form>
              </CardContent>
            </Card>
          );
        })}
      </section>
    </div>
  );
}
