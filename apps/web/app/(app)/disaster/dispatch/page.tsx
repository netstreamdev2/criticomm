import { listMutualAidPartners } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { FormSection, TextField, TextAreaField, SelectField } from '@/components/fields';
import { getSession } from '@/lib/session';
import { dispatchResourcesAction } from '../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dispatch Resources · Criticom' };

const DISASTER_TYPES = [
  'Flood', 'Storm / severe weather', 'Fire — informal settlement', 'Landslide',
  'Building collapse', 'Civil unrest', 'Drought', 'Epidemic', 'Coastal / marine', 'Other',
];
const RESOURCE_TYPES = [
  'Rescue teams', 'Relief supplies', 'Heavy machinery', 'Medical teams',
  'Shelter & housing', 'Water & sanitation', 'Power restoration', 'Communications', 'General',
];

export default async function DispatchResourcesPage() {
  const { supabase } = await getSession();
  const partners = await listMutualAidPartners(supabase);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Dispatch disaster resources</h1>
        <p className="text-muted-foreground">Creates a deployment log you can update from the monitor.</p>
      </header>

      <form action={dispatchResourcesAction} className="space-y-4">
        <FormSection title="Deployment">
          <TextField name="incident_number" label="Incident number" placeholder="Auto-generated if blank" />
          <SelectField name="incident_type" label="Disaster type" options={DISASTER_TYPES} required />
          <SelectField name="resource_type" label="Resource type" options={RESOURCE_TYPES} required />
          <TextField name="location" label="Location" required className="sm:col-span-2" />
          <TextAreaField name="description" label="Situation description" required className="sm:col-span-2 lg:col-span-3" />
        </FormSection>
        <button type="submit" className="h-11 w-full rounded-md bg-primary text-sm font-semibold">
          Dispatch resources
        </button>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>Mutual-aid directory ({partners.length})</CardTitle>
          <CardDescription>Partners are filtered by resource type in the field app.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2">
          {partners.slice(0, 10).map((p) => (
            <div key={p.id} className="rounded-md border border-border/60 bg-bg-soft p-3 text-sm">
              <p className="font-semibold">{p.agency_name}</p>
              <p className="text-xs text-muted-foreground">
                {p.resource_type} · {p.contact_number ?? 'no number'} · {p.radio_frequency ?? 'no freq'}
              </p>
            </div>
          ))}
          {partners.length === 0 && (
            <p className="text-sm text-muted-foreground sm:col-span-2">
              Directory empty — seed the 41-partner list via supabase/seed.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
