import Link from 'next/link';
import { listMutualAidPartners, listOpenDisasterIncidents } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FormSection, SelectField, TextAreaField, TextField } from '@/components/fields';
import { getSession } from '@/lib/session';
import { dispatchResourcesAction } from '../actions';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dispatch Resources · HikTech' };

const DISASTER_TYPES = [
  'Flood', 'Storm / severe weather', 'Fire — informal settlement', 'Landslide',
  'Building collapse', 'Civil unrest', 'Drought', 'Epidemic', 'Coastal / marine', 'Other',
];
const RESOURCE_TYPES = [
  'Rescue teams', 'Relief supplies', 'Heavy machinery', 'Medical teams',
  'Shelter & housing', 'Water & sanitation', 'Power restoration', 'Communications', 'General',
];
const ERRORS: Record<string, string> = {
  missing: 'Choose the incident and the resources, and describe the situation.',
  incident: 'That incident could not be found.',
};

export default async function DispatchResourcesPage({ searchParams }: { searchParams: Promise<{ error?: string; incident?: string }> }) {
  const { t } = await requestT();
  const { supabase } = await getSession();
  const params = await searchParams;
  const [partners, incidents] = await Promise.all([
    listMutualAidPartners(supabase).catch(() => []),
    listOpenDisasterIncidents(supabase).catch(() => []),
  ]);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">{t('Dispatch resources')}</h1>
        <p className="text-muted-foreground">{t('Resources sent to an open incident. Dispatching again updates its deployment.')}</p>
      </header>

      {params.error && ERRORS[params.error] ? (
        <div role="alert" className="rounded-lg border border-severity-critical/40 bg-severity-critical/10 px-4 py-3 text-sm text-severity-critical-ink">
          {ERRORS[params.error]}
        </div>
      ) : null}

      {incidents.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">{t('No open Disaster Management incidents.')}</CardContent></Card>
      ) : (
        <form action={dispatchResourcesAction} className="space-y-4">
          <FormSection title={t('Deployment')}>
            <SelectField
              name="incident_id" label={t('Incident')} required className="sm:col-span-2 lg:col-span-3"
              defaultValue={params.incident ?? null}
              options={[{ value: '', label: '-- Select incident --' }, ...incidents.map((i) => ({
                value: i.id, label: `${i.incident_number} · ${i.disaster_type || i.incident_type} · ${i.location_address}`,
              }))]}
            />
            <SelectField name="incident_type" label={t('Disaster type')} options={[{ value: '', label: 'As logged' }, ...DISASTER_TYPES.map((t) => ({ value: t, label: t }))]} />
            <SelectField name="resource_type" label={t('Resource type')} required options={[{ value: '', label: '-- Select --' }, ...RESOURCE_TYPES.map((t) => ({ value: t, label: t }))]} />
            <TextField name="location" label={t('Location')} placeholder={t('As logged')} />
            <TextAreaField name="description" label={t('Situation description')} required className="sm:col-span-2 lg:col-span-3" />
          </FormSection>
          <button type="submit" className="h-11 w-full rounded-md bg-primary text-sm font-semibold">{t('Dispatch resources')}</button>
        </form>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t('Mutual-aid partners ({length})', { length: partners.length })}</CardTitle>
          <Link href="/disaster/partners" className="text-sm text-accent hover:underline">{t('All partners')}</Link>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2">
          {partners.slice(0, 10).map((p) => (
            <div key={p.id} className="rounded-md border border-border/60 bg-bg-soft p-3 text-sm">
              <p className="font-semibold">{p.agency_name}</p>
              <p className="text-xs text-muted-foreground">
                {p.resource_type} · {p.contact_number ?? '—'} · {p.radio_frequency ?? '—'}
              </p>
            </div>
          ))}
          {partners.length === 0 ? <p className="text-sm text-muted-foreground sm:col-span-2">{t('No partners registered.')}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
