import { listActiveIncidents, getOnDutyResponders } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { LeafletMap, type MapMarker } from '@/components/leaflet-map';
import { getSession, siloFilter } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Live Map · Criticom' };

export default async function LiveMapPage() {
  const { supabase, silo } = await getSession();
  const [incidents, responders] = await Promise.all([
    listActiveIncidents(supabase, siloFilter(silo)),
    getOnDutyResponders(supabase, siloFilter(silo)).catch(() => []),
  ]);

  const markers: MapMarker[] = [
    ...incidents.map((i) => ({
      id: i.id,
      lat: i.location_lat,
      lng: i.location_lng,
      kind: i.incident_severity.toLowerCase(),
      popupHtml: `
        <strong>${i.incident_number}</strong><br/>
        ${i.incident_type} · ${i.incident_severity}<br/>
        ${i.status}
      `,
      // Hover previews; click opens the incident.
      href: `/incidents/${i.id}`,
    })),
    ...responders
      .filter((r) => r.latitude != null && r.longitude != null)
      .map((r) => ({
        id: `resp-${r.id}`,
        lat: r.latitude!,
        lng: r.longitude!,
        kind: 'unit',
        popupHtml: `<strong>${r.first_name} ${r.last_name}</strong><br/>${r.silo} · ${r.station ?? ''}`,
      })),
  ];

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Live operations map</h1>
        <p className="text-muted-foreground">
          {incidents.length} active incidents · {responders.length} responders on duty.
          Severity-coloured incidents, purple = on-duty units.
        </p>
      </header>

      <Card>
        <CardContent className="p-2">
          <LeafletMap markers={markers} height={560} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Legend</CardTitle>
          <CardDescription>Marker colours by severity.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4 text-sm">
          {[
            ['#ef4444', 'Critical'], ['#f97316', 'High'], ['#f59e0b', 'Medium'],
            ['#22c55e', 'Low'], ['#a78bfa', 'On-duty responder'],
          ].map(([color, label]) => (
            <span key={label} className="inline-flex items-center gap-2">
              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
              {label}
            </span>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
