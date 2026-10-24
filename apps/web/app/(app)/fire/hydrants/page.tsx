import Link from 'next/link';
import { countHydrants, listHydrantsToWatch } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { LeafletMap } from '@/components/leaflet-map';
import { getSession } from '@/lib/session';
import { escapeHtml, formatSaTime } from '@/lib/utils';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Hydrants · HikTech' };

const STATUS_COLOR: Record<string, string> = {
  Operational: 'text-severity-low-ink',
  'Out of Service': 'text-severity-critical-ink',
  'Maintenance Required': 'text-severity-medium-ink',
};

type Hydrant = Awaited<ReturnType<typeof listHydrantsToWatch>>['down'][number];

/**
 * The register holds the city's whole water register (about 34,000 hydrants,
 * scripts/load-hydrants.mjs --from-gis): too many for one page. Here are the
 * counts, the hydrants not in service, and the latest inspected; every
 * hydrant is on the live map, Layers → Hydrants, zoomed in.
 */
export default async function HydrantsPage() {
  const { t } = await requestT();
  const { supabase } = await getSession();
  const [counts, { down, inspected }] = await Promise.all([
    countHydrants(supabase),
    listHydrantsToWatch(supabase),
  ]);

  const table = (rows: Hydrant[], empty: string) => (
    <SimpleTable headers={['Hydrant', 'Coordinates', 'Status', 'Last inspected']} empty={empty}>
      {rows.map((h) => (
        <Tr key={h.id}>
          <Td>{h.location_name}</Td>
          <Td className="font-mono text-xs">{h.latitude.toFixed(5)}, {h.longitude.toFixed(5)}</Td>
          <Td><span className={STATUS_COLOR[h.status] ?? ''}>{h.status}</span></Td>
          <Td className="text-muted-foreground">{h.last_inspected ? formatSaTime(h.last_inspected) : 'Not yet inspected'}</Td>
        </Tr>
      ))}
    </SimpleTable>
  );

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">{t('Hydrant register')}</h1>
        <p className="text-muted-foreground">{t('Hydrant map and register.')}</p>
        <p className="text-muted-foreground">
          {t('{operational} of {total} hydrants in service.', {
            operational: counts.operational.toLocaleString('en-ZA'),
            total: counts.total.toLocaleString('en-ZA'),
          })}{' '}
          <Link href="/incidents/map" className="text-accent hover:underline">{t('See them all on the live map →')}</Link>
        </p>
      </header>

      {down.length > 0 ? (
        <Card>
          <CardContent className="p-2">
            <LeafletMap
              height={420}
              markers={down.map((h) => ({
                id: h.id,
                lat: h.latitude,
                lng: h.longitude,
                kind: 'critical',
                popupHtml: `<strong>${escapeHtml(h.location_name)}</strong><br/>${escapeHtml(h.status)}`,
              }))}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('Not in service ({length})', { length: down.length })}</CardTitle>
          <CardDescription>{t('Out of service or needing maintenance.')}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">{table(down, t('Every hydrant is in service.'))}</CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('Latest inspected')}</CardTitle>
          <CardDescription>{t('In service, newest inspection first.')}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">{table(inspected, t('No hydrant inspected yet.'))}</CardContent>
      </Card>
    </div>
  );
}
