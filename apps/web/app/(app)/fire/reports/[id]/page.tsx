import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFirefighterReport } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Fire Report · Criticom' };

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === '' || value === false || value === 0) return null;
  return (
    <div>
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className="text-sm">{value === true ? 'Yes' : value}</p>
    </div>
  );
}

const min = (s: number) => (s > 0 ? `${Math.round(s / 60)} min` : null);

export default async function FireReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase } = await getSession();
  const r = await getFirefighterReport(supabase, id).catch(() => null);
  if (!r) notFound();

  const sections: Array<{ title: string; items: Array<[string, React.ReactNode]> }> = [
    {
      title: 'Incident',
      items: [
        ['Date / time', `${r.date_of_incident} ${r.time_of_incident}`],
        ['Type', r.type_of_incident], ['Location', r.location],
        ['Department', r.fire_department_name], ['Station', r.station_number],
        ['Dispatch', min(r.dispatch_time_seconds)], ['Arrival', min(r.arrival_time_seconds)],
        ['Clear', min(r.clear_time_seconds)], ['Total on scene', min(r.total_time_on_scene_seconds)],
      ],
    },
    {
      title: 'Scene & operations',
      items: [
        ['Smoke', r.smoke_conditions], ['Flame spread', r.flame_spread], ['Heat', r.heat_signature],
        ['Observations', r.initial_observations], ['Hazards', r.hazards_identified],
        ['Suppression', r.fire_suppression_details],
        ['Search & rescue', r.search_and_rescue_performed], ['Persons rescued', r.persons_rescued],
        ['Ventilation', r.ventilation_conducted && (r.ventilation_type ?? 'Yes')],
        ['Salvage/overhaul', r.salvage_overhaul],
        ['Hazmat', r.hazmat_operations && (r.hazmat_description ?? 'Yes')],
        ['Medical aid', r.medical_aid_provided && (r.medical_aid_description ?? 'Yes')],
        ['Utilities secured', r.utilities_secured && (r.utility_details ?? 'Yes')],
      ],
    },
    {
      title: 'Origin, cause & property',
      items: [
        ['Origin room', r.point_of_origin_room], ['Origin object', r.point_of_origin_object],
        ['Ignition source', r.ignition_source], ['Cause', r.fire_cause],
        ['Investigation', r.fire_investigation_conducted && (r.fire_investigation_reason ?? 'Yes')],
        ['Property type', r.property_type], ['Owner', r.property_owner],
        ['Property value', r.property_value > 0 && `R${Number(r.property_value).toLocaleString()}`],
        ['Damage estimate', r.damage_estimate > 0 && `R${Number(r.damage_estimate).toLocaleString()}`],
        ['Contents value', r.contents_value > 0 && `R${Number(r.contents_value).toLocaleString()}`],
        ['Insurance', r.insurance_info],
      ],
    },
    {
      title: 'Casualties & review',
      items: [
        ['Civilian injuries', r.civilian_injuries], ['Civilian fatalities', r.civilian_fatalities],
        ['Firefighter injuries', r.firefighter_injuries], ['Firefighter fatalities', r.firefighter_fatalities],
        ['Injury details', r.civilian_injury_details], ['Treatment', r.treatment_provided && (r.treatment_details ?? 'Yes')],
        ['Other agencies', r.other_agencies_on_scene], ['Mutual aid', r.mutual_aid_used],
        ['Equipment', r.equipment_used], ['Challenges', r.challenges_faced],
        ['Successes', r.successes], ['Recommendations', r.recommendations],
      ],
    },
  ];

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="font-mono text-2xl font-bold">{r.report_number}</h1>
          <p className="text-muted-foreground">
            {r.type_of_incident} · {r.reporting_officer_name}{r.reporting_officer_rank ? ` (${r.reporting_officer_rank})` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href={`/api/pdf/fire-report/${r.id}`}
            className="no-print rounded-md border border-border px-4 py-2 text-sm hover:bg-muted"
          >
            ⬇ PDF
          </a>
          <Link href={`/fire/pir/publish/${r.id}`} className="rounded-md bg-accent px-4 py-2 text-sm font-semibold">
            Publish public report
          </Link>
        </div>
      </header>

      {sections.map((s) => (
        <Card key={s.title}>
          <CardHeader><CardTitle>{s.title}</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            {s.items.map(([label, value]) => <Item key={label} label={label} value={value} />)}
          </CardContent>
        </Card>
      ))}

      {r.narrative_summary && (
        <Card>
          <CardHeader><CardTitle>Narrative</CardTitle></CardHeader>
          <CardContent><p className="whitespace-pre-wrap text-sm">{r.narrative_summary}</p></CardContent>
        </Card>
      )}
    </div>
  );
}
