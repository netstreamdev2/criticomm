import { notFound } from 'next/navigation';
import { getFirefighterReport } from '@criticom/api';
import { FormSection, TextField, TextAreaField } from '@/components/fields';
import { getSession } from '@/lib/session';
import { publishPirAction } from '../../../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Publish PIR · Criticom' };

export default async function PublishPirPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;
  const { supabase, fullName } = await getSession();
  const r = await getFirefighterReport(supabase, reportId).catch(() => null);
  if (!r) notFound();

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Publish public incident report</h1>
        <p className="text-muted-foreground">
          Review the raw report <span className="font-mono">{r.report_number}</span> and sanitise it for release.
          Remove names, exact addresses and investigative details.
        </p>
      </header>

      <form action={publishPirAction} className="space-y-4">
        <input type="hidden" name="firefighter_report_id" value={r.id} />

        <FormSection title="Header">
          <TextField name="public_report_number" label="PIR number" placeholder="Auto-generated if blank" />
          <TextField name="date_of_incident" label="Date" type="date" required defaultValue={r.date_of_incident} />
          <TextField name="time_of_incident" label="Time" type="time" required defaultValue={r.time_of_incident.slice(0, 5)} />
          <TextField name="incident_type" label="Incident type" defaultValue={r.type_of_incident} />
          <TextField name="fire_department_name" label="Department" defaultValue={r.fire_department_name} />
          <TextField name="station_number" label="Station" defaultValue={r.station_number} />
        </FormSection>

        <FormSection title="Public content">
          <TextField
            name="public_location" label="Public location (generalised)" required
            defaultValue={r.location} className="sm:col-span-2 lg:col-span-3"
          />
          <TextAreaField
            name="public_summary" label="Public summary" required rows={4}
            defaultValue={r.narrative_summary} className="sm:col-span-2 lg:col-span-3"
          />
          <TextAreaField name="damage_assessment" label="Damage assessment" className="sm:col-span-2 lg:col-span-3" />
          <TextAreaField name="cause_summary" label="Cause summary" defaultValue={r.fire_cause} className="sm:col-span-2 lg:col-span-3" />
          <TextAreaField name="actions_taken" label="Actions taken" className="sm:col-span-2 lg:col-span-3" />
          <TextAreaField name="public_safety_advisory" label="Public safety advisory" className="sm:col-span-2 lg:col-span-3" />
        </FormSection>

        <FormSection title="Casualty totals">
          <TextField name="total_civilian_injuries" label="Civilian injuries" type="number" defaultValue={r.civilian_injuries} />
          <TextField name="total_civilian_fatalities" label="Civilian fatalities" type="number" defaultValue={r.civilian_fatalities} />
          <TextField name="total_responder_injuries" label="Responder injuries" type="number" defaultValue={r.firefighter_injuries} />
          <TextField name="total_responder_fatalities" label="Responder fatalities" type="number" defaultValue={r.firefighter_fatalities} />
        </FormSection>

        <FormSection title="Authorization">
          <TextField name="authorizing_officer_name" label="Authorizing officer" required defaultValue={fullName} />
          <TextField name="authorizing_officer_id" label="Officer ID" />
        </FormSection>

        <button type="submit" className="h-11 w-full rounded-md bg-primary text-sm font-semibold">
          Publish public report
        </button>
      </form>
    </div>
  );
}
