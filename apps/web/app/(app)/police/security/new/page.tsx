import { FormSection, TextField, TextAreaField, SelectField, CheckField } from '@/components/fields';
import { getSession } from '@/lib/session';
import { createSecurityReportAction } from '../actions';

export const metadata = { title: 'New Security Report · Criticom' };

const INCIDENT_TYPES = [
  'Trespassing', 'Theft', 'Burglary', 'Vandalism', 'Assault', 'Suspicious activity',
  'Alarm activation', 'Access control breach', 'Fire/safety hazard', 'Medical emergency', 'Other',
];

export default async function NewSecurityReportPage() {
  const { fullName } = await getSession();
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Security guard incident report</h1>
        <p className="text-muted-foreground">V4 SecuritiesController parity — SIRA-compliant register entry.</p>
      </header>

      <form action={createSecurityReportAction} className="space-y-4">
        <FormSection title="Guard">
          <TextField name="guard_name" label="Guard name" defaultValue={fullName} required />
          <TextField name="guard_id" label="Guard ID" />
          <TextField name="badge_number" label="Badge number" />
          <TextField name="contact_number" label="Contact number" />
          <TextField name="sira_number" label="SIRA number" />
          <SelectField name="sira_grade" label="SIRA grade" options={['', 'A', 'B', 'C', 'D', 'E']} />
          <CheckField name="firearm_issued" label="Firearm issued" />
          <TextField name="firearm_number" label="Firearm number" />
        </FormSection>

        <FormSection title="Scene">
          <TextField name="location" label="Location" required className="sm:col-span-2" />
          <TextField name="zone_code" label="Zone code" />
          <SelectField name="weather_conditions" label="Weather" options={['', 'Clear', 'Rain', 'Fog', 'Wind', 'Storm']} />
          <SelectField name="lighting_conditions" label="Lighting" options={['', 'Daylight', 'Well lit', 'Poorly lit', 'Dark']} />
        </FormSection>

        <FormSection title="Incident">
          <SelectField name="incident_type" label="Incident type" options={INCIDENT_TYPES} required />
          <TextField name="incident_code" label="Incident code" />
          <SelectField name="severity_level" label="Severity" options={['Low', 'Medium', 'High', 'Critical']} />
          <TextField name="incident_start_time" label="Start" type="datetime-local" defaultValue={local} required />
          <TextField name="incident_end_time" label="End" type="datetime-local" />
          <CheckField name="is_emergency" label="Emergency" />
          <CheckField name="is_repeat_incident" label="Repeat incident" />
          <TextField name="previous_incident_reference" label="Previous incident ref" />
          <TextAreaField name="incident_description" label="Description" required rows={4} className="sm:col-span-2 lg:col-span-3" />
        </FormSection>

        <FormSection title="Response">
          <TextAreaField name="actions_taken" label="Actions taken" className="sm:col-span-2 lg:col-span-3" />
          <TextField name="equipment_used" label="Equipment used" />
          <CheckField name="authorities_notified" label="Authorities notified" />
          <TextField name="authorities_contacted" label="Authorities contacted" />
          <TextField name="supervisor_name" label="Supervisor" />
          <TextAreaField name="supervisor_remarks" label="Supervisor remarks" />
          <TextAreaField name="additional_notes" label="Additional notes" className="sm:col-span-2 lg:col-span-3" />
        </FormSection>

        <button type="submit" className="h-11 w-full rounded-md bg-primary text-sm font-semibold">
          File security report
        </button>
      </form>
    </div>
  );
}
