import { listHydrants } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { LeafletMap } from '@/components/leaflet-map';
import { getSession } from '@/lib/session';
import { formatSaTime } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Hydrants · Criticom' };

const STATUS_COLOR: Record<string, string> = {
  Operational: 'text-severity-low-ink',
  'Out of Service': 'text-severity-critical-ink',
  'Maintenance Required': 'text-severity-medium-ink',
};

export default async function HydrantsPage() {
  const { supabase } = await getSession();
  const hydrants = await listHydrants(supabase);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Hydrant register</h1>
        <p className="text-muted-foreground">
          GIS view + register — V4 FireChiefController.GISMap parity.
        </p>
      </header>

      <Card>
        <CardContent className="p-2">
          <LeafletMap
            height={420}
            markers={hydrants.map((h) => ({
              id: h.id,
              lat: h.latitude,
              lng: h.longitude,
              kind: h.status === 'Operational' ? 'hydrant' : 'critical',
              popupHtml: `<strong>${h.location_name}</strong><br/>${h.status}`,
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{hydrants.length} hydrants</CardTitle>
          <CardDescription>Status and last inspection.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable headers={['Location', 'Coordinates', 'Status', 'Last inspected']} empty="No hydrants recorded.">
            {hydrants.map((h) => (
              <Tr key={h.id}>
                <Td>{h.location_name}</Td>
                <Td className="font-mono text-xs">{h.latitude.toFixed(5)}, {h.longitude.toFixed(5)}</Td>
                <Td><span className={STATUS_COLOR[h.status] ?? ''}>{h.status}</span></Td>
                <Td className="text-muted-foreground">{formatSaTime(h.last_inspected)}</Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
