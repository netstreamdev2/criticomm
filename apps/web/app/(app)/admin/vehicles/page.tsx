import { listApparatus } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { FormSection, TextField, SelectField } from '@/components/fields';
import { getSession } from '@/lib/session';
import { createApparatusAction, setApparatusStatusAction } from '../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Fleet Admin · HikTech' };

const STATUSES = ['Available', 'In Use', 'En Route', 'On Scene', 'Out of Service', 'Maintenance', 'Decommissioned'];

export default async function AdminVehiclesPage() {
  const { supabase } = await getSession();
  const vehicles = await listApparatus(supabase);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Fleet management</h1>
        <p className="text-muted-foreground">Apparatus register across all silos.</p>
      </header>

      <form action={createApparatusAction} className="space-y-4">
        <FormSection title="Add vehicle">
          <SelectField name="silo" label="Silo" required
            options={['MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster', 'Ethekwini']} />
          <TextField name="unit_number" label="Unit number" required />
          <TextField name="name" label="Name" required />
          <SelectField name="type" label="Type" required
            options={['Patrol vehicle', 'Fire engine', 'Ladder truck', 'Ambulance', 'Rescue unit', 'Command vehicle', 'Water tanker', 'Motorcycle', 'Other']} />
          <TextField name="make" label="Make" />
          <TextField name="model" label="Model" />
          <TextField name="license_plate" label="License plate" />
          <TextField name="station_number" label="Station" />
        </FormSection>
        <button type="submit" className="h-10 w-full rounded-md bg-primary text-sm font-semibold">Add vehicle</button>
      </form>

      <Card>
        <CardHeader><CardTitle>{vehicles.length} vehicles</CardTitle></CardHeader>
        <CardContent className="p-0">
          <SimpleTable headers={['Unit', 'Silo', 'Type', 'Plate', 'Station', 'Status']} empty="No vehicles registered.">
            {vehicles.map((v) => (
              <Tr key={v.id}>
                <Td className="font-semibold">{v.unit_number} — {v.name}</Td>
                <Td>{v.silo}</Td>
                <Td>{v.type}</Td>
                <Td className="font-mono">{v.license_plate ?? '—'}</Td>
                <Td>{v.station_number ?? '—'}</Td>
                <Td>
                  <form action={setApparatusStatusAction} className="flex items-center gap-2">
                    <input type="hidden" name="id" value={v.id} />
                    <select name="status" defaultValue={v.status} className="h-8 rounded-md border border-border bg-bg-soft px-2 text-xs">
                      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <button type="submit" className="h-8 rounded-md bg-accent px-3 text-xs font-semibold">Set</button>
                  </form>
                </Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
