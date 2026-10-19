import { listSystemProfiles } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { FormSection, TextField, SelectField } from '@/components/fields';
import { getSession } from '@/lib/session';
import { formatSaTime } from '@/lib/utils';
import { createOperatorAction } from './actions';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Operators · HikTech' };

export default async function AdminOperatorsPage() {
  const { t } = await requestT();
  const { supabase } = await getSession();
  const operators = await listSystemProfiles(supabase);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">{t('Control-room operators')}</h1>
        <p className="text-muted-foreground">
          {t('Dispatcher and operator profiles, with NATO call signs.')}</p>
      </header>

      <form action={createOperatorAction} className="space-y-4">
        <FormSection title={t('Register operator')}>
          <TextField name="first_name" label={t('First name')} required />
          <TextField name="last_name" label={t('Last name')} required />
          <TextField name="badge_number" label={t('Badge number')} />
          <TextField name="rank" label={t('Rank')} />
          <SelectField name="role" label={t('Operator role')}
            options={['Dispatcher', 'ControlRoom', 'IncidentLogger', 'Supervisor']} />
          <TextField name="station" label={t('Station')} />
          <TextField name="platoon" label={t('Platoon')} />
          <TextField name="contact_number" label={t('Contact number')} />
          <TextField name="email" label={t('Email')} type="email" />
          <TextField name="emergency_contact" label={t('Emergency contact')} />
        </FormSection>
        <button type="submit" className="h-10 w-full rounded-md bg-primary text-sm font-semibold">
          {t('Register operator (call sign auto-assigned)')}</button>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>{t('{length} operators', { length: operators.length })}</CardTitle>
          <CardDescription>{t('Incident totals update as they close cases.')}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable
            headers={['Operator', 'Call sign', 'Role', 'Station', 'Incidents handled', 'On duty', 'Last login']}
            empty={t('No operator profiles.')}
          >
            {operators.map((o) => (
              <Tr key={o.id}>
                <Td className="font-semibold">
                  {o.first_name} {o.last_name}
                  <div className="text-xs font-normal text-muted-foreground">{o.email ?? ''}</div>
                </Td>
                <Td className="font-mono text-accent">{o.call_sign ?? '—'}</Td>
                <Td>{o.role ?? '—'}</Td>
                <Td>{o.station ?? '—'}</Td>
                <Td className="font-mono">{o.total_incidents_handled}</Td>
                <Td>{o.is_on_duty ? <span className="text-severity-low-ink">{t('Yes')}</span> : 'No'}</Td>
                <Td className="text-muted-foreground">{formatSaTime(o.last_login)}</Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
