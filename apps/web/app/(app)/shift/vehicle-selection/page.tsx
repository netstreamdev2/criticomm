import { listAvailableVehicles } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { getSession } from '@/lib/session';
import { assignVehicleAction } from '../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Vehicle Selection · Criticom' };

export default async function VehicleSelectionPage() {
  const { supabase, silo } = await getSession();
  const vehicles = await listAvailableVehicles(supabase, silo === 'Ethekwini' ? 'MetroPolice' : silo);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Start of shift — vehicle selection</h1>
        <p className="text-muted-foreground">Step 2 of 3. Pick your unit for this shift.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{vehicles.length} vehicles available</CardTitle>
          <CardDescription>Selecting a vehicle marks it In Use and assigns it to you.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {vehicles.length === 0 && (
            <p className="py-6 text-center text-muted-foreground">
              No vehicles available in your silo. Contact fleet control.
            </p>
          )}
          {vehicles.map((v) => (
            <form key={v.id} action={assignVehicleAction} className="flex items-center justify-between rounded-md border border-border bg-bg-soft p-4">
              <input type="hidden" name="apparatus_id" value={v.id} />
              <div>
                <p className="font-semibold">{v.unit_number} — {v.name}</p>
                <p className="text-xs text-muted-foreground">
                  {v.type}{v.license_plate ? ` · ${v.license_plate}` : ''}{v.fuel_level ? ` · Fuel ${v.fuel_level}` : ''}
                </p>
              </div>
              <button type="submit" className="rounded-md bg-primary px-4 py-2 text-sm font-semibold">Select</button>
            </form>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
