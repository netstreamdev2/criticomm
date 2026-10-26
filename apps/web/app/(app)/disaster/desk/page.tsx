import Link from 'next/link';
import { Network, Plus, Siren, TriangleAlert } from 'lucide-react';
import { listCallFacts, listCallouts, listLastDeskUpdates, listOpenDisasterIncidents } from '@criticom/api';
import { deskChecks, isWorking, lastHeard } from '@criticom/api/criti/disaster';
import { hazardGroup } from '@criticom/db/disaster-plan';
import { IncidentLive } from '@/components/incident-live';
import { InfoTile } from '@/components/disaster/info-tile';
import { toDeskCallout, toDeskUpdate } from '@/lib/disaster-desk';
import { getSession } from '@/lib/session';
import { requestT } from '@/lib/i18n';
import { DeskCards, type DeskCard } from './desk-cards';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Disaster Desk · HikTech' };

/**
 * The Disaster desk (0111): every open call sent to Disaster, as cards of one
 * size, newest first, with filters for what needs the desk (DeskCards). The
 * three figures on top say on hover what they count and list the calls
 * behind them. Each card opens its command board.
 */
export default async function DisasterDeskPage() {
  const { t } = await requestT();
  const { supabase } = await getSession();
  const open = await listOpenDisasterIncidents(supabase).catch(() => []);
  const ids = open.map((i) => i.id);
  const [callouts, updates, factsList] = await Promise.all([listCallouts(supabase, ids), listLastDeskUpdates(supabase, ids), listCallFacts(supabase, ids)]);
  const facts = new Map(factsList.map((f) => [f.incident_id, f]));
  const now = new Date();

  const cards: DeskCard[] = open.map((i) => {
    const mine = callouts.filter((c) => c.incident_id === i.id).map(toDeskCallout);
    const ups = updates.filter((u) => u.incident_id === i.id).map(toDeskUpdate);
    const checks = deskChecks({ calledInAt: i.call_timestamp, callouts: mine, updates: ups }, now).filter((c) => c.level !== 'info');
    const f = facts.get(i.id);
    return {
      id: i.id, number: i.incident_number, title: f?.short_title || i.disaster_type || i.incident_type,
      hazard: f?.hazard ?? null, group: hazardGroup(f?.hazard ?? i.disaster_type ?? i.incident_type), severity: i.incident_severity, level: f?.level ?? 'Bronze',
      place: [i.location_address, i.suburb].filter(Boolean).join(', '), calledAt: i.call_timestamp,
      heardAt: lastHeard({ calledInAt: i.call_timestamp, callouts: mine, updates: ups }), description: i.call_description || null,
      checks: checks.map((c) => ({ text: c.text, urgent: c.level === 'urgent' })),
      partners: mine.filter(isWorking).map((c) => ({ id: c.id, name: c.name, status: c.status })), calledOut: mine.length,
    };
  }).sort((a, b) => b.calledAt.localeCompare(a.calledAt));
  const titleOf = new Map(cards.map((c) => [c.id, c.title]));
  const working = callouts.filter((c) => isWorking({ status: c.status }));
  const needing = cards.filter((c) => c.checks.length);

  return (
    <div className="space-y-6">
      <IncidentLive />
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('Disaster desk')}</h1>
          <p className="text-muted-foreground">{t('Every open call sent to Disaster, newest first. Open one to run it.')}</p>
        </div>
        <div className="flex flex-wrap items-stretch gap-3">
          <div className="w-36">
            <InfoTile size="small" label={t('Open calls')} value={cards.length} icon={<Siren className="h-5 w-5" aria-hidden />}
              tone={cards.length ? 'critical' : 'calm'} explain={t('Every Disaster incident not closed yet, newest first.')}
              items={cards.map((c) => ({ key: c.id, label: c.title, note: c.number, href: `/disaster/desk/${c.id}` }))} />
          </div>
          <div className="w-36">
            <InfoTile size="small" label={t('Need action')} value={needing.length} icon={<TriangleAlert className="h-5 w-5" aria-hidden />}
              tone={needing.length ? 'warn' : 'calm'}
              explain={t('Incidents where the desk must do something now: nobody called out yet, no news for too long, or a partner who has not set off.')}
              items={needing.map((c) => ({ key: c.id, label: c.title, note: c.checks[0]!.text, href: `/disaster/desk/${c.id}`, urgent: c.checks[0]!.urgent }))} />
          </div>
          <div className="w-36">
            <InfoTile size="small" align="right" label={t('Partners working')} value={working.length} icon={<Network className="h-5 w-5" aria-hidden />}
              tone="info" explain={t('Partners called out who have not left the scene yet, on every open incident.')}
              items={working.map((c) => ({ key: c.id, label: c.agency_name, note: `${t(c.status)} · ${titleOf.get(c.incident_id) ?? ''}`, href: `/disaster/desk/${c.incident_id}` }))}
              more={{ href: '/disaster/partners', label: t('Partner list') }} />
          </div>
          <Link href="/disaster/partners" className="inline-flex items-center rounded-xl border border-border bg-bg-card px-4 text-sm font-semibold shadow-sm hover:bg-muted">
            {t('Partner list')}
          </Link>
          <Link href="/disaster/desk/new" className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm">
            <Plus className="h-4 w-4" aria-hidden />{t('Add an incident')}
          </Link>
        </div>
      </header>

      <DeskCards cards={cards} />
    </div>
  );
}
