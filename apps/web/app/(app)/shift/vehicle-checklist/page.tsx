import { redirect } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { CheckField, SelectField } from '@/components/fields';
import { vehicleChecklistAction } from '../actions';

export const metadata = { title: 'Vehicle Checklist · HikTech' };

const ITEMS = [
  { name: 'lights_functional', label: 'Emergency lights + siren functional' },
  { name: 'tires_condition_ok', label: 'Tyres — tread and pressure OK' },
  { name: 'equipment_stocked', label: 'Operational equipment stocked and secured' },
  { name: 'comms_working', label: 'Radio / MDT communications working' },
  { name: 'brakes_responsive', label: 'Brakes responsive' },
];

export default async function VehicleChecklistPage({
  searchParams,
}: {
  searchParams: Promise<{ apparatus?: string }>;
}) {
  const { apparatus } = await searchParams;
  if (!apparatus) redirect('/shift/vehicle-selection');

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Start of shift — vehicle inspection</h1>
        <p className="text-muted-foreground">Step 3 of 3. Completing this places you on duty.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Pre-trip checklist</CardTitle>
          <CardDescription>Report any defect to fleet before going on duty.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={vehicleChecklistAction} className="space-y-3">
            <input type="hidden" name="apparatus_id" value={apparatus} />
            <SelectField
              name="fuel_level" label="Fuel level" required
              options={['1/4', '1/2', '3/4', 'Full']} defaultValue="Full"
            />
            {ITEMS.map((c) => (
              <CheckField key={c.name} name={c.name} label={c.label} />
            ))}
            <button type="submit" className="h-10 w-full rounded-md bg-primary text-sm font-semibold">
              Complete inspection & go on duty
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
