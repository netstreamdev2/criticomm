import { listSystemProfiles } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { FormSection, TextField, SelectField } from '@/components/fields';
import { getSession } from '@/lib/session';
import { formatSaTime } from '@/lib/utils';
import { createOperatorAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Operators · HikTech' };

export default async function AdminOperatorsPage() {
  const { supabase } = await getSession();
  const operators = await listSystemProfiles(supabase);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Control-room operators</h1>
        <p className="text-muted-foreground">
          Dispatcher/operator profile records with auto-generated NATO call signs (SystemProfile parity).
        </p>
      </header>

      <form action={createOperatorAction} className="space-y-4">
        <FormSection title="Register operator">
          <TextField name="first_name" label="First name" required />
          <TextField name="last_name" label="Last name" required />
          <TextField name="badge_number" label="Badge number" />
          <TextField name="rank" label="Rank" />
          <SelectField name="role" label="Operator role"
            options={['Dispatcher', 'ControlRoom', 'IncidentLogger', 'Supervisor']} />
          <TextField name="station" label="Station" />
          <TextField name="platoon" label="Platoon" />
          <TextField name="contact_number" label="Contact number" />
          <TextField name="email" label="Email" type="email" />
          <TextField name="emergency_contact" label="Emergency contact" />
        </FormSection>
        <button type="submit" className="h-10 w-full rounded-md bg-primary text-sm font-semibold">
          Register operator (call sign auto-assigned)
        </button>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>{operators.length} operators</CardTitle>
          <CardDescription>Incident totals update as they close cases.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable
            headers={['Operator', 'Call sign', 'Role', 'Station', 'Incidents handled', 'On duty', 'Last login']}
            empty="No operator profiles."
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
                <Td>{o.is_on_duty ? <span className="text-severity-low-ink">Yes</span> : 'No'}</Td>
                <Td className="text-muted-foreground">{formatSaTime(o.last_login)}</Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
