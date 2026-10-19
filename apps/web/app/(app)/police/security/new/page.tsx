import { FormSection, TextField, TextAreaField, SelectField, CheckField } from '@/components/fields';
import { getSession } from '@/lib/session';
import { createSecurityReportAction } from '../actions';
import { requestT } from '@/lib/i18n';

export const metadata = { title: 'New Security Report · HikTech' };

const INCIDENT_TYPES = [
  'Trespassing', 'Theft', 'Burglary', 'Vandalism', 'Assault', 'Suspicious activity',
  'Alarm activation', 'Access control breach', 'Fire/safety hazard', 'Medical emergency', 'Other',
];

export default async function NewSecurityReportPage() {
  const { t } = await requestT();
  const { fullName } = await getSession();
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">{t('Security guard incident report')}</h1>
        <p className="text-muted-foreground">{t('SIRA-compliant register entry.')}</p>
      </header>

      <form action={createSecurityReportAction} className="space-y-4">
        <FormSection title={t('Guard')}>
          <TextField name="guard_name" label={t('Guard name')} defaultValue={fullName} required />
          <TextField name="guard_id" label={t('Guard ID')} />
          <TextField name="badge_number" label={t('Badge number')} />
          <TextField name="contact_number" label={t('Contact number')} />
          <TextField name="sira_number" label={t('SIRA number')} />
          <SelectField name="sira_grade" label={t('SIRA grade')} options={['', 'A', 'B', 'C', 'D', 'E']} />
          <CheckField name="firearm_issued" label={t('Firearm issued')} />
          <TextField name="firearm_number" label={t('Firearm number')} />
        </FormSection>

        <FormSection title={t('Scene')}>
          <TextField name="location" label={t('Location')} required className="sm:col-span-2" />
          <TextField name="zone_code" label={t('Zone code')} />
          <SelectField name="weather_conditions" label={t('Weather')} options={['', 'Clear', 'Rain', 'Fog', 'Wind', 'Storm']} />
          <SelectField name="lighting_conditions" label={t('Lighting')} options={['', 'Daylight', 'Well lit', 'Poorly lit', 'Dark']} />
        </FormSection>

        <FormSection title={t('Incident')}>
          <SelectField name="incident_type" label={t('Incident type')} options={INCIDENT_TYPES} required />
          <TextField name="incident_code" label={t('Incident code')} />
          <SelectField name="severity_level" label={t('Severity')} options={['Low', 'Medium', 'High', 'Critical']} />
          <TextField name="incident_start_time" label={t('Start')} type="datetime-local" defaultValue={local} required />
          <TextField name="incident_end_time" label={t('End')} type="datetime-local" />
          <CheckField name="is_emergency" label={t('Emergency')} />
          <CheckField name="is_repeat_incident" label={t('Repeat incident')} />
          <TextField name="previous_incident_reference" label={t('Previous incident ref')} />
          <TextAreaField name="incident_description" label={t('Description')} required rows={4} className="sm:col-span-2 lg:col-span-3" />
        </FormSection>

        <FormSection title={t('Response')}>
          <TextAreaField name="actions_taken" label={t('Actions taken')} className="sm:col-span-2 lg:col-span-3" />
          <TextField name="equipment_used" label={t('Equipment used')} />
          <CheckField name="authorities_notified" label={t('Authorities notified')} />
          <TextField name="authorities_contacted" label={t('Authorities contacted')} />
          <TextField name="supervisor_name" label={t('Supervisor')} />
          <TextAreaField name="supervisor_remarks" label={t('Supervisor remarks')} />
          <TextAreaField name="additional_notes" label={t('Additional notes')} className="sm:col-span-2 lg:col-span-3" />
        </FormSection>

        <button type="submit" className="h-11 w-full rounded-md bg-primary text-sm font-semibold">
          {t('File security report')}</button>
      </form>
    </div>
  );
}
