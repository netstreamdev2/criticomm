import { notFound } from 'next/navigation';
import Link from 'next/link';
import { listDisasterAssessments } from '@criticom/api';
import type { DisasterBrief } from '@criticom/api/criti/disaster';
import { saStamp } from '@criticom/db/post-mortem';
import { loadDesk } from '@/lib/disaster-desk';
import { getSession } from '@/lib/session';
import { requestT } from '@/lib/i18n';
import { DeskPostMortemForm } from './form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Post-Mortem · HikTech' };

/**
 * The post-mortem from the Disaster desk (0112), as the phone files it: the
 * Official After-Action Report, filled in from the call's record (times,
 * level, hazard, municipalities, who was called out, the shelters and the
 * people in them, the assessments) for the dispatcher to check and file.
 */
export default async function DeskPostMortemPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = await requestT();
  const { id } = await params;
  const { supabase, fullName } = await getSession();
  const desk = await loadDesk(supabase, id);
  if (!desk) notFound();
  const { incident, record, facts, callShelters, register, notes } = desk;
  if (incident.report_filed_at || ['Resolved', 'Closed'].includes(incident.status)) {
    return (
      <div className="rounded-xl border border-border bg-bg-card p-6">
        <p className="font-semibold">{t('Post-mortem already filed')}</p>
        <Link href={`/incidents/${incident.id}`} className="mt-2 inline-block text-sm text-accent hover:underline">{t('Open the call record')}</Link>
      </div>
    );
  }
  const assessments = await listDisasterAssessments(supabase, incident.id).catch(() => []);
  const brief = (record.brief?.brief ?? null) as DisasterBrief | null;
  const sum = (k: 'injured' | 'deaths' | 'people_displaced' | 'households_affected' | 'homes_destroyed' | 'homes_damaged') =>
    assessments.reduce((n, a) => n + (a[k] ?? 0), 0);
  const sheltered = callShelters.reduce((n, o) => n + o.peak_people, 0);
  const lastLeft = record.callouts.map((c) => c.left_at).filter((x): x is string => !!x).sort().at(-1);
  const hall = new Map(register.map((s) => [s.id, s.name]));
  const most = (...xs: Array<number | null | undefined>) => String(Math.max(0, ...xs.map((x) => x ?? 0)));

  return (
    <DeskPostMortemForm
      incidentId={incident.id}
      number={incident.incident_number}
      title={facts?.short_title || incident.disaster_type || incident.incident_type}
      location={incident.location_address}
      facts={{
        hazard: facts?.hazard ?? null, level: facts?.highest_level ?? 'Bronze', municipalities: facts?.municipalities ?? [],
        docActivated: !!facts?.doc_activated_at, scgConvened: !!facts?.scg_convened_at, fcp: facts?.fcp_location ?? null, eoc: facts?.eoc_location ?? null,
      }}
      callouts={record.callouts.map((c) => ({ name: c.agency_name, type: c.resource_type, status: c.status, calledAt: c.called_at, onSceneAt: c.on_scene_at, leftAt: c.left_at }))}
      shelters={callShelters.map((o) => ({ name: hall.get(o.shelter_id) ?? t('Shelter'), peak: o.peak_people, households: o.households, relief: o.relief ?? {} }))}
      timeline={[
        ...notes.map((n) => ({ at: n.at, text: n.text })),
        ...record.updates.map((u) => ({ at: u.logged_at, text: `${u.from_name ? `${u.from_name}: ` : ''}${u.text}` })),
        ...record.callouts.map((c) => ({ at: c.called_at, text: `${c.agency_name} called out` })),
      ].sort((a, b) => a.at.localeCompare(b.at))}
      initial={{
        start_time: saStamp(incident.call_timestamp),
        end_time: saStamp(lastLeft ? new Date(lastLeft) : new Date()),
        injuries: most(sum('injured'), brief?.figures?.injured),
        fatalities: most(sum('deaths'), brief?.figures?.deaths),
        displaced_people: most(sum('people_displaced'), sheltered, brief?.figures?.peopleDisplaced),
        households_affected: String(sum('households_affected')),
        homes_destroyed: String(sum('homes_destroyed')),
        homes_damaged: String(sum('homes_damaged')),
        people_sheltered: String(sheltered),
        reporting_officer: fullName,
        local_disaster_recommended: 'no',
      }}
    />
  );
}
