import { FormSection, TextField, TextAreaField, SelectField } from '@/components/fields';
import { getSession } from '@/lib/session';
import { createFirearmAction } from '../../actions';
import { requestT } from '@/lib/i18n';

export const metadata = { title: 'Issue Firearm · HikTech' };

export default async function NewFirearmPage() {
  const { t } = await requestT();
  const { fullName } = await getSession();
  const now = new Date();
  const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const end = new Date(now.getTime() + 12 * 3600 * 1000);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">{t('Firearm authorization')}</h1>
        <p className="text-muted-foreground">{t('Add a firearm to the issue register.')}</p>
      </header>

      <form action={createFirearmAction} className="space-y-4">
        <FormSection title={t('Employee')}>
          <TextField name="employee_name" label={t('Employee name')} required />
          <TextField name="company_number" label={t('Company / force number')} />
          <TextField name="id_number" label={t('ID number')} required />
          <TextField name="posted_location" label={t('Posted location')} />
        </FormSection>

        <FormSection title={t('Firearm')}>
          <TextField name="form_number" label={t('Form number')} placeholder={t('Auto-generated if blank')} />
          <TextField name="firearm_number" label={t('Firearm serial number')} required />
          <TextField name="make" label={t('Make / model')} />
          <TextField name="rounds_ammunition" label={t('Rounds issued')} type="number" defaultValue={15} required />
          <SelectField name="chamber_status" label={t('Chamber status')} options={['Cleared', 'Loaded', 'Unknown']} defaultValue="Cleared" />
        </FormSection>

        <FormSection title={t('Authorization window')}>
          <TextField name="from_date" label={t('From')} type="datetime-local" defaultValue={local(now)} required />
          <TextField name="to_date" label={t('To')} type="datetime-local" defaultValue={local(end)} required />
          <TextField name="issued_by" label={t('Issued by')} defaultValue={fullName} />
          <TextAreaField name="notes" label={t('Notes')} className="sm:col-span-2 lg:col-span-3" />
        </FormSection>

        <button type="submit" className="h-11 w-full rounded-md bg-primary text-sm font-semibold">
          {t('Issue firearm')}</button>
      </form>
    </div>
  );
}
