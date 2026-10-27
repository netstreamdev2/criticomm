import Link from 'next/link';
import { Network, Plus, Siren, TriangleAlert } from 'lucide-react';
import { listCallFacts, listCallouts, listLastDeskUpdates, listOpenDisasterIncidents, listRecoveryFacts, listReviews } from '@criticom/api';
import { RECOVERY_TASKS, openRecoveryTasks } from '@criticom/db/disaster-joc';
import { DmStatusChip } from './[id]/after-tile';
import { deskChecks, isWorking, lastHeard } from '@criticom/api/criti/disaster';
import { hazardGroup } from '@criticom/db/disaster-plan';
import { IncidentLive } from '@/components/incident-live';
import { InfoTile } from '@/components/disaster/info-tile';
import { toDeskCallout, toDeskUpdate } from '@/lib/disaster-desk';
import { getSession } from '@/lib/session';
import { requestT } from '@/lib/i18n';
import { DeskCards, type DeskCard } from './desk-cards';
import { PageGuide } from '@/components/office/page-guide';

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
  const allOpen = await listOpenDisasterIncidents(supabase).catch(() => []);
  const [factsList, recoveryFacts] = await Promise.all([listCallFacts(supabase, allOpen.map((i) => i.id)), listRecoveryFacts(supabase)]);
  const facts = new Map(factsList.map((f) => [f.incident_id, f]));
  // Stood down, in recovery or closed by the desk: off the board, onto Recovery and review (0117).
  const open = allOpen.filter((i) => (facts.get(i.id)?.dm_status ?? 'Active') === 'Active');
  const ids = open.map((i) => i.id);
  const [callouts, updates] = await Promise.all([listCallouts(supabase, ids), listLastDeskUpdates(supabase, ids)]);
  const reviews = await listReviews(supabase, recoveryFacts.map((f) => f.incident_id));
  const signedOff = new Set(reviews.filter((r) => r.signed_off_at).map((r) => r.incident_id));
  const after = recoveryFacts.filter((f) => !signedOff.has(f.incident_id));
  const afterIds = after.map((f) => f.incident_id);
  const numbers = afterIds.length
    ? new Map(((await supabase.from('incidents').select('id, incident_number, incident_type, location_address').in('id', afterIds)).data ?? [])
      .map((i) => [i.id as string, i as { id: string; incident_number: string; incident_type: string; location_address: string }]))
    : new Map<string, { id: string; incident_number: string; incident_type: string; location_address: string }>();
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

      <PageGuide id="disaster.desk" steps={[
        t('Every open incident sent to Disaster is a card, newest first. Use the filters to see what needs you now.'),
        t('Open a card to run the incident on its board.'),
        t('Add an incident opens one yourself: a field report, a warning or a site emergency plan.'),
        t('Incidents that are stood down wait under Recovery and review until their review is signed off.'),
      ]} />
      <DeskCards cards={cards} />

      {after.length ? (
        <section className="space-y-3" data-guide="desk.recovery">
          <h2 className="text-lg font-semibold">{t('Recovery and review ({n})', { n: after.length })}</h2>
          <p className="text-sm text-muted-foreground">{t('Incidents whose response is over. They stay here until their review is signed off.')}</p>
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {after.map((f) => {
              const inc = numbers.get(f.incident_id);
              const open = openRecoveryTasks(f.recovery ?? {});
              return (
                <li key={f.incident_id}>
                  <Link href={`/disaster/desk/${f.incident_id}`} className="block rounded-xl border border-border bg-bg-card p-4 shadow-sm hover:bg-muted">
                    <p className="flex flex-wrap items-center gap-2">
                      <DmStatusChip status={f.dm_status ?? 'Stood down'} />
                      <span className="font-semibold">{f.short_title || inc?.incident_type || t('Incident')}</span>
                    </p>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">{inc?.incident_number}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t('{done} of {all} recovery tasks done', { done: RECOVERY_TASKS.length - open, all: RECOVERY_TASKS.length })}
                      {' · '}{reviews.some((r) => r.incident_id === f.incident_id) ? t('Review started') : t('No review yet')}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
