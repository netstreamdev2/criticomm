import { listPersonnel } from '@criticom/api';
import type { Silo } from '@criticom/db';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { FormSection, TextField, SelectField } from '@/components/fields';
import { getSession } from '@/lib/session';
import { formatSaTime } from '@/lib/utils';
import { createPersonnelAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Personnel Admin · Criticom' };

export default async function AdminPersonnelPage({
  searchParams,
}: {
  searchParams: Promise<{ silo?: string }>;
}) {
  const { supabase } = await getSession();
  const params = await searchParams;
  const personnel = await listPersonnel(supabase, params.silo as Silo | undefined);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Personnel register</h1>
        <p className="text-muted-foreground">
          Operational staff records (HR/Staff parity). Link a record to a login from the user's profile.
        </p>
      </header>

      <form action={createPersonnelAction} className="space-y-4">
        <FormSection title="Add personnel">
          <SelectField name="silo" label="Silo" required
            options={['MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster', 'Ethekwini']} />
          <TextField name="first_name" label="First name" required />
          <TextField name="last_name" label="Last name" required />
          <TextField name="badge_number" label="Badge number" required />
          <TextField name="rank" label="Rank" required />
          <TextField name="unit" label="Unit" />
          <TextField name="station" label="Station" />
          <TextField name="platoon" label="Platoon" />
          <TextField name="emergency_contact" label="Emergency contact" />
        </FormSection>
        <button type="submit" className="h-10 w-full rounded-md bg-primary text-sm font-semibold">
          Add personnel record
        </button>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>{personnel.length} personnel</CardTitle>
          <CardDescription>Filter with ?silo=MetroPolice etc.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable
            headers={['Name', 'Badge', 'Rank', 'Silo', 'Station', 'Platoon', 'On duty', 'Last login']}
            empty="No personnel records."
          >
            {personnel.map((p) => (
              <Tr key={p.id}>
                <Td className="font-semibold">{p.first_name} {p.last_name}</Td>
                <Td className="font-mono">{p.badge_number}</Td>
                <Td>{p.rank}</Td>
                <Td>{p.silo}</Td>
                <Td>{p.station ?? '—'}</Td>
                <Td>{p.platoon ?? '—'}</Td>
                <Td>{p.is_on_duty ? <span className="text-severity-low-ink">Yes</span> : 'No'}</Td>
                <Td className="text-muted-foreground">{formatSaTime(p.last_login)}</Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
