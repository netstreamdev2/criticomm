import Link from 'next/link';
import { requireFeaturePage } from '@/lib/features';
import { Map as MapIcon } from 'lucide-react';
import { listCameras } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { getSession } from '@/lib/session';
import { ImportCamerasButton } from './import-button';
import { ITrafficMap } from './itraffic-map';
import { LiveWall } from './live-wall';
import { TrafficPanel } from './traffic-panel';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'SANRAL Cameras · HikTech' };

/** `?lat=&lng=` (from an incident) centres the matrix on that spot. */
function focusFrom(lat?: string, lng?: string) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!lat || !lng || !Number.isFinite(la) || !Number.isFinite(ln)) return undefined;
  if (Math.abs(la) > 90 || Math.abs(ln) > 180) return undefined;
  return { lat: la, lng: ln };
}

/**
 * SANRAL freeway cameras: V4's CCTV matrix (i-traffic's own map, no key
 * needed), the traffic feed, and the i-traffic camera registry once an API
 * key is issued. The registry cameras are also a layer on the live map.
 */
export default async function SanralCamerasPage({
  searchParams,
}: {
  searchParams: Promise<{ lat?: string; lng?: string }>;
}) {
  await requireFeaturePage('web.cameras');
  const { supabase } = await getSession();
  const [cameras, params] = await Promise.all([listCameras(supabase), searchParams]);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">SANRAL Cameras</h1>
          <p className="text-muted-foreground">
            Freeway cameras, overhead signs and live traffic from SANRAL&apos;s i-traffic.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/incidents/map"
            className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-semibold hover:bg-muted"
          >
            <MapIcon className="h-4 w-4" /> Live map
          </Link>
          <ImportCamerasButton />
        </div>
      </header>

      <ITrafficMap focus={focusFrom(params.lat, params.lng)} />

      <TrafficPanel />

      {cameras.length > 0 ? (
        <>
          <LiveWall />
          <Card>
            <CardHeader>
              <CardTitle>{cameras.length} cameras</CardTitle>
              <CardDescription>Imported from the i-traffic feed. These also show on the live map.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <SimpleTable headers={['ID', 'Name', 'Roadway', 'Direction', 'Coordinates', 'Feed']} empty="No cameras imported.">
                {cameras.map((c) => (
                  <Tr key={c.id}>
                    <Td className="font-mono text-xs">{c.id}</Td>
                    <Td>{c.name ?? '—'}</Td>
                    <Td>{c.roadway_name ?? '—'}</Td>
                    <Td>{c.direction_of_travel ?? '—'}</Td>
                    <Td className="font-mono text-xs">
                      {c.latitude != null && c.longitude != null ? `${c.latitude.toFixed(4)}, ${c.longitude.toFixed(4)}` : '—'}
                    </Td>
                    <Td>
                      {c.url && !c.blocked ? (
                        <a href={c.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">Open</a>
                      ) : '—'}
                    </Td>
                  </Tr>
                ))}
              </SimpleTable>
            </CardContent>
          </Card>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          The camera registry (for the live map layer) is empty. It fills from the i-traffic API once SANRAL
          issues a key (<code className="font-mono text-xs">ITRAFFIC_API_KEY</code>); the matrix above works without one.
        </p>
      )}
    </div>
  );
}
