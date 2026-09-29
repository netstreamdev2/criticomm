import { listDevices } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { FormSection, TextField, SelectField } from '@/components/fields';
import { getSession } from '@/lib/session';
import { formatSaTime } from '@/lib/utils';
import { createDeviceAction } from '../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Devices Admin · HikTech' };

export default async function AdminDevicesPage() {
  const { supabase } = await getSession();
  const devices = await listDevices(supabase);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Device enrolment</h1>
        <p className="text-muted-foreground">MDTs, radios and tablets registered per silo.</p>
      </header>

      <form action={createDeviceAction} className="space-y-4">
        <FormSection title="Enrol device">
          <SelectField name="silo" label="Silo" required
            options={['MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster', 'Ethekwini']} />
          <TextField name="device_id" label="Device ID / serial" required />
          <SelectField name="device_type" label="Type" options={['MDT', 'Radio', 'Tablet', 'Bodycam', 'Phone', 'Other']} />
          <TextField name="model" label="Model" />
          <TextField name="assigned_station" label="Assigned station" />
        </FormSection>
        <button type="submit" className="h-10 w-full rounded-md bg-primary text-sm font-semibold">Enrol device</button>
      </form>

      <Card>
        <CardHeader><CardTitle>{devices.length} devices</CardTitle></CardHeader>
        <CardContent className="p-0">
          <SimpleTable headers={['Device ID', 'Silo', 'Type', 'Model', 'Station', 'Active', 'Enrolled']} empty="No devices enrolled.">
            {devices.map((d) => (
              <Tr key={d.id}>
                <Td className="font-mono">{d.device_id}</Td>
                <Td>{d.silo}</Td>
                <Td>{d.device_type ?? '—'}</Td>
                <Td>{d.model ?? '—'}</Td>
                <Td>{d.assigned_station ?? '—'}</Td>
                <Td>{d.is_active ? <span className="text-severity-low-ink">Yes</span> : <span className="text-severity-critical-ink">No</span>}</Td>
                <Td className="text-muted-foreground">{formatSaTime(d.enrolled_date)}</Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
