import { listTrainingRecords, listCertifications, listPersonnel } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { FormSection, TextField, SelectField, TextAreaField } from '@/components/fields';
import { getSession, siloFilter } from '@/lib/session';
import { addTrainingAction, addCertificationAction } from './actions';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Training · HikTech' };

type PersonnelJoin = { personnel?: { first_name?: string; last_name?: string; badge_number?: string } };
const who = (r: PersonnelJoin) =>
  r.personnel ? `${r.personnel.first_name} ${r.personnel.last_name} (${r.personnel.badge_number})` : '—';

export default async function TrainingPage() {
  const { t } = await requestT();
  const { supabase, silo } = await getSession();
  const [records, certs, personnel] = await Promise.all([
    listTrainingRecords(supabase),
    listCertifications(supabase),
    listPersonnel(supabase, siloFilter(silo)),
  ]);

  const personnelOptions = personnel.map((p) => ({
    value: p.id, label: `${p.first_name} ${p.last_name} (${p.badge_number})`,
  }));
  const soon = new Date();
  soon.setMonth(soon.getMonth() + 2);
  const expiring = certs.filter((c) => new Date(c.expiry_date) < soon);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">{t('Training & certifications')}</h1>
        <p className="text-muted-foreground">
          {expiring.length > 0
            ? `${expiring.length} certification${expiring.length === 1 ? '' : 's'} expiring within 2 months.`
            : 'No certifications expiring soon.'}
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <form action={addTrainingAction} className="space-y-4">
          <FormSection title={t('Log training')}>
            <SelectField name="personnel_id" label={t('Member')} options={personnelOptions} required className="sm:col-span-2" />
            <TextField name="training_name" label={t('Training name')} required />
            <TextField name="date_completed" label={t('Date completed')} type="date" required />
            <TextAreaField name="notes_learned" label={t('Notes / outcomes')} className="sm:col-span-2 lg:col-span-3" />
          </FormSection>
          <button type="submit" className="h-10 w-full rounded-md bg-primary text-sm font-semibold">{t('Log training')}</button>
        </form>

        <form action={addCertificationAction} className="space-y-4">
          <FormSection title={t('Add certification')}>
            <SelectField name="personnel_id" label={t('Member')} options={personnelOptions} required className="sm:col-span-2" />
            <TextField name="name" label={t('Certification')} required />
            <TextField name="issued_by" label={t('Issued by')} />
            <TextField name="date_achieved" label={t('Date achieved')} type="date" />
            <TextField name="expiry_date" label={t('Expiry date')} type="date" required />
            <TextField name="remarks" label={t('Remarks')} />
          </FormSection>
          <button type="submit" className="h-10 w-full rounded-md bg-accent text-sm font-semibold">{t('Add certification')}</button>
        </form>
      </div>

      <Card>
        <CardHeader><CardTitle>{t('Training records ({length})', { length: records.length })}</CardTitle></CardHeader>
        <CardContent className="p-0">
          <SimpleTable headers={['Member', 'Training', 'Completed', 'Notes']} empty={t('No training logged.')}>
            {records.slice(0, 50).map((r) => (
              <Tr key={r.id}>
                <Td>{who(r as PersonnelJoin)}</Td>
                <Td className="font-semibold">{r.training_name}</Td>
                <Td className="font-mono">{r.date_completed}</Td>
                <Td className="max-w-[280px] truncate">{r.notes_learned ?? '—'}</Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('Certifications ({length})', { length: certs.length })}</CardTitle>
          <CardDescription>{t('Sorted by expiry — expiring rows are highlighted.')}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable headers={['Member', 'Certification', 'Issued by', 'Achieved', 'Expires']} empty={t('No certifications.')}>
            {certs.slice(0, 50).map((c) => {
              const isExpiring = new Date(c.expiry_date) < soon;
              return (
                <Tr key={c.id}>
                  <Td>{who(c as PersonnelJoin)}</Td>
                  <Td className="font-semibold">{c.name}</Td>
                  <Td>{c.issued_by ?? '—'}</Td>
                  <Td className="font-mono">{c.date_achieved ?? '—'}</Td>
                  <Td className={`font-mono ${isExpiring ? 'font-semibold text-severity-critical-ink' : ''}`}>
                    {c.expiry_date}
                  </Td>
                </Tr>
              );
            })}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
