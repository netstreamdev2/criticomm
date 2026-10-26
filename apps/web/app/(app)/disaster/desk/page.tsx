import Link from 'next/link';
import { ChevronRight, MapPin, TriangleAlert, Truck } from 'lucide-react';
import { listCallFacts, listCallouts, listLastDeskUpdates, listOpenDisasterIncidents } from '@criticom/api';
import { deskChecks, isWorking, lastHeard } from '@criticom/api/criti/disaster';
import { IncidentLive } from '@/components/incident-live';
import { toDeskCallout, toDeskUpdate } from '@/lib/disaster-desk';
import { getSession } from '@/lib/session';
import { requestT } from '@/lib/i18n';
import { cn, timeAgo } from '@/lib/utils';
import { LevelChip } from './[id]/call-facts';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Disaster Desk · HikTech' };

const TOP: Record<string, string> = {
  Critical: 'border-t-severity-critical', High: 'border-t-severity-high', Medium: 'border-t-severity-medium', Low: 'border-t-severity-low',
};
const SEVERITY_RANK: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };
const PARTNER_TONE: Record<string, string> = {
  Called: 'bg-sky-500/15 text-sky-300', 'On the way': 'bg-severity-medium/15 text-severity-medium-ink', 'On scene': 'bg-severity-low/15 text-severity-low-ink',
};

/**
 * The Disaster desk (0111): every open call sent to Disaster, as tiles on
 * one screen. A call that needs the desk now (nobody called out, no news for
 * too long, a partner not on the way) or is critical gets a big tile; the
 * rest are small. Each opens its command board.
 */
export default async function DisasterDeskPage() {
  const { t } = await requestT();
  const { supabase } = await getSession();
  const open = await listOpenDisasterIncidents(supabase).catch(() => []);
  const ids = open.map((i) => i.id);
  const [callouts, updates, factsList] = await Promise.all([listCallouts(supabase, ids), listLastDeskUpdates(supabase, ids), listCallFacts(supabase, ids)]);
  const facts = new Map(factsList.map((f) => [f.incident_id, f]));
  const now = new Date();
  const rows = open.map((i) => {
    const mine = callouts.filter((c) => c.incident_id === i.id).map(toDeskCallout);
    const ups = updates.filter((u) => u.incident_id === i.id).map(toDeskUpdate);
    const checks = deskChecks({ calledInAt: i.call_timestamp, callouts: mine, updates: ups }, now).filter((c) => c.level !== 'info');
    const f = facts.get(i.id);
    const big = checks.some((c) => c.level === 'urgent') || i.incident_severity === 'Critical' || f?.level === 'Gold';
    return { i, f, mine, checks, big, heard: lastHeard({ calledInAt: i.call_timestamp, callouts: mine, updates: ups }) };
  }).sort((a, b) => Number(b.big) - Number(a.big) || Number(b.checks.length > 0) - Number(a.checks.length > 0)
    || (SEVERITY_RANK[a.i.incident_severity] ?? 9) - (SEVERITY_RANK[b.i.incident_severity] ?? 9)
    || b.i.call_timestamp.localeCompare(a.i.call_timestamp));
  const working = callouts.filter((c) => isWorking({ status: c.status })).length;
  const needing = rows.filter((r) => r.checks.length).length;

  return (
    <div className="space-y-6">
      <IncidentLive />
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('Disaster desk')}</h1>
          <p className="text-muted-foreground">{t('Every open call sent to Disaster. Open one to run it.')}</p>
        </div>
        <div className="flex flex-wrap items-stretch gap-2">
          {[
            { label: t('Open calls'), value: rows.length, tone: rows.length ? 'text-severity-critical-ink' : '' },
            { label: t('Need the desk'), value: needing, tone: needing ? 'text-severity-medium-ink' : '' },
            { label: t('Partners working'), value: working, tone: 'text-accent' },
          ].map((x) => (
            <div key={x.label} className="min-w-[7.5rem] rounded-xl border border-border bg-bg-card px-4 py-2 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{x.label}</p>
              <p className={cn('text-2xl font-bold tabular-nums', x.tone)}>{x.value}</p>
            </div>
          ))}
          <Link href="/disaster/partners" className="inline-flex items-center rounded-xl border border-border bg-bg-card px-4 text-sm font-semibold shadow-sm hover:bg-muted">
            {t('Partner list')}
          </Link>
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-bg-card p-10 text-center shadow-sm">
          <p className="text-lg font-semibold">{t('All clear')}</p>
          <p className="text-sm text-muted-foreground">{t('No open disaster calls.')}</p>
        </div>
      ) : null}

      <ul className="grid grid-flow-row-dense auto-rows-[minmax(10rem,auto)] grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {rows.map(({ i, f, mine, checks, big, heard }) => {
          const live = mine.filter(isWorking);
          return (
            <li key={i.id} className={cn(big && 'sm:col-span-2 sm:row-span-2')}>
              <Link href={`/disaster/desk/${i.id}`}
                className={cn('group flex h-full flex-col gap-3 rounded-xl border border-t-4 border-border bg-bg-card shadow-sm transition hover:bg-muted',
                  TOP[i.incident_severity] ?? 'border-t-accent', big ? 'p-6' : 'p-5')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-xs">
                      <LevelChip level={f?.level ?? 'Bronze'} />
                      <span className="rounded-full bg-muted px-2 py-0.5 font-bold uppercase tracking-wide">{i.incident_severity}</span>
                      <span className="font-mono text-muted-foreground">{i.incident_number}</span>
                    </p>
                    <p className={cn('mt-1 font-semibold leading-tight', big ? 'text-2xl' : 'text-base')}>{f?.short_title || i.disaster_type || i.incident_type}</p>
                    {f?.hazard ? <p className="text-sm text-muted-foreground">{f.hazard}{f.municipalities.length > 1 ? ` · ${f.municipalities.join(', ')}` : ''}</p> : null}
                    <p className="mt-0.5 flex items-center gap-1 truncate text-sm text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />{[i.location_address, i.suburb].filter(Boolean).join(', ')}
                    </p>
                  </div>
                  <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-muted-foreground group-hover:text-fg" aria-hidden />
                </div>

                {big && i.call_description ? <p className="line-clamp-3 text-[15px]">{i.call_description}</p> : null}

                {checks.length ? (
                  <ul className="space-y-1">
                    {checks.slice(0, big ? 3 : 1).map((c) => (
                      <li key={c.text} className={cn('flex items-start gap-1.5 font-medium', big ? 'text-[15px]' : 'text-sm',
                        c.level === 'urgent' ? 'text-severity-critical-ink' : 'text-severity-medium-ink')}>
                        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{c.text}
                      </li>
                    ))}
                  </ul>
                ) : null}

                {big && live.length ? (
                  <ul className="flex flex-wrap gap-1.5">
                    {live.map((c) => (
                      <li key={c.id} className={cn('rounded-full px-2.5 py-1 text-xs font-semibold', PARTNER_TONE[c.status])}>{c.name} · {c.status}</li>
                    ))}
                  </ul>
                ) : null}

                <p className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>{t('Called in {ago}', { ago: timeAgo(i.call_timestamp) })}</span>
                  <span className="inline-flex items-center gap-1"><Truck className="h-3.5 w-3.5" aria-hidden />
                    {live.length ? t('{n} partners working', { n: live.length }) : mine.length ? t('All partners left') : t('Nobody called out')}</span>
                  <span>{t('Last news {ago}', { ago: timeAgo(heard) })}</span>
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
