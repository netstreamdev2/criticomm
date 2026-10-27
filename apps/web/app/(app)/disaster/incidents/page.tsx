import Link from 'next/link';
import { Plus } from 'lucide-react';
import { listCallFacts, listDisasterIncidents } from '@criticom/api';
import { PageGuide } from '@/components/office/page-guide';
import { getSession } from '@/lib/session';
import { requestT } from '@/lib/i18n';
import { IncidentTable, type IncidentRow } from './table';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Disaster Incidents · HikTech' };

/**
 * Every incident reported to Disaster in the last year, open or closed, with
 * its level, place, severity, people affected and status. Active ones first;
 * filters for status, level and municipality. Each opens its board.
 */
export default async function DisasterIncidentsPage() {
  const { t } = await requestT();
  const { supabase } = await getSession();
  const incidents = await listDisasterIncidents(supabase, new Date(Date.now() - 365 * 24 * 3600_000));
  const facts = new Map((await listCallFacts(supabase, incidents.map((i) => i.id))).map((f) => [f.incident_id, f]));
  const rows: IncidentRow[] = incidents.map((i) => {
    const f = facts.get(i.id);
    return {
      id: i.id, number: i.incident_number, title: f?.short_title || i.disaster_type || i.incident_type, hazard: f?.hazard ?? i.disaster_type ?? null,
      level: f?.level ?? 'Bronze', municipality: f?.municipalities?.[0] ?? 'eThekwini Metro', ward: f?.ward ?? null,
      place: [i.location_address, i.suburb].filter(Boolean).join(', '), severity: i.incident_severity,
      // The desk's status once it moved on; otherwise a case closed by case review reads as closed.
      affected: i.number_of_victims ?? 0,
      status: f?.dm_status && f.dm_status !== 'Active' ? f.dm_status : ['Resolved', 'Closed'].includes(i.status) ? 'Closed' : 'Active',
      updated: f?.updated_at ?? i.updated_at ?? i.call_timestamp,
    };
  });
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('Incidents')}</h1>
          <p className="text-muted-foreground">{t('Every incident reported to Disaster, its level of coordination and its record.')}</p>
        </div>
        <Link href="/disaster/desk/new" className="inline-flex h-11 items-center gap-2 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground">
          <Plus className="h-4 w-4" aria-hidden />{t('Add an incident')}
        </Link>
      </header>
      <PageGuide id="disaster.incidents" steps={[
        t('Active incidents show first. Use the filters for stood down, in recovery or closed ones.'),
        t('The bars on the left show the level: one for Bronze, two for Silver, three for Gold (the JOC).'),
        t('Open an incident to run it: the level, the JOC, relief, recovery and the review.'),
      ]} />
      <IncidentTable rows={rows} />
    </div>
  );
}
