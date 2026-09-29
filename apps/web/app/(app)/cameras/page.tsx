import Link from 'next/link';
import { requireFeaturePage } from '@/lib/features';
import { Film } from 'lucide-react';
import { listCameras } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { getSession } from '@/lib/session';
import { ImportCamerasButton } from './import-button';
import { LiveWall } from './live-wall';
import { TrafficPanel } from './traffic-panel';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Surveillance · HikTech' };

export default async function CamerasPage() {
  await requireFeaturePage('web.cameras');
  const { supabase } = await getSession();
  const cameras = await listCameras(supabase);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Surveillance</h1>
          <p className="text-muted-foreground">
            SANRAL matrix today, Hikvision next — the wall switches over the moment the
            integration is enabled, no redeploy.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/cameras/footage"
            className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-semibold hover:bg-muted"
          >
            <Film className="h-4 w-4" /> CCTV footage
          </Link>
          <ImportCamerasButton />
        </div>
      </header>

      <LiveWall />

      <TrafficPanel />

      <Card>
        <CardHeader>
          <CardTitle>{cameras.length} cameras</CardTitle>
          <CardDescription>Imported from the i-traffic feed.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable headers={['ID', 'Name', 'Roadway', 'Direction', 'Coordinates', 'Feed']} empty="No cameras imported — run the i-traffic import.">
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
    </div>
  );
}
