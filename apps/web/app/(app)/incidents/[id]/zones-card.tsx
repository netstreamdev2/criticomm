import Link from 'next/link';
import { PencilRuler } from 'lucide-react';
import type { MapZone } from '@criticom/api';
import { DEPARTMENT_NAMES, canDrawMapZones, type UserRole } from '@criticom/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { describeAudience, describeShape, fromGeometry, roleWords, zoneKind } from '@/lib/ops-map/zones';
import { formatSaTime } from '@/lib/utils';
import { requestT } from '@/lib/i18n';

/**
 * Perimeters and zones set against this call, in force or stood down: what,
 * who set it and why, who received it, and how it ended. The record stays
 * with the call after the map has moved on.
 */
export async function IncidentZonesCard({ zones, incidentId, incidentNumber, role, isClosed }: {
  zones: MapZone[];
  incidentId: string;
  incidentNumber: string;
  role: UserRole;
  isClosed: boolean;
}) {
  const { t } = await requestT();
  const canDraw = canDrawMapZones(role) && !isClosed;
  if (!zones.length && !canDraw) return null;
  const now = Date.now();
  const dept = (s: MapZone['silo']) => DEPARTMENT_NAMES[s] ?? s;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>{t('Perimeters & zones ({length})', { length: zones.length })}</CardTitle>
            <CardDescription>{t('Cordons, closures and points set on the live map for this call.')}</CardDescription>
          </div>
          {canDraw && (
            <Link
              href={`/incidents/map?incident=${incidentId}`}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-semibold"
            >
              <PencilRuler className="h-4 w-4" /> {' '}{t('Draw a perimeter')}</Link>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {zones.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('None set for {incidentNumber} yet.', { incidentNumber })}</p>
        ) : (
          <ul className="space-y-3 text-sm">
            {zones.map((z) => {
              const kind = zoneKind(z.kind);
              const expired = z.status === 'active' && z.active_until != null && new Date(z.active_until).getTime() <= now;
              const live = z.status === 'active' && !expired && !isClosed;
              const shape = describeShape(
                { shape: z.shape, points: fromGeometry(z.shape, z.geometry), radiusM: z.radius_m },
                { areaM2: z.area_m2, lengthM: z.length_m },
              );
              return (
                <li key={z.id} className="rounded-md border border-border/60 bg-bg-soft p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="font-semibold">
                      <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: kind.colour }} />
                      {kind.label}: {z.name}
                    </p>
                    <span className="text-xs font-semibold text-muted-foreground">
                      {z.status === 'ended' ? 'Removed' : expired ? 'Expired' : isClosed ? 'Call closed' : 'In force'}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('Set by {value}{value2} · {saTime}', { value: z.created_by_name ?? 'Unknown', value2: z.created_by_role ? ` (${roleWords(z.created_by_role)}, ${dept(z.silo)})` : '', saTime: formatSaTime(z.created_at) })}
                  </p>
                  {z.reason && <p className="mt-1.5 whitespace-pre-wrap">{z.reason}</p>}
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {describeAudience(z, dept, incidentNumber)} · <span className="font-mono">{shape}</span>
                    {z.active_until && z.status === 'active' ? ` · until ${formatSaTime(z.active_until)}` : ''}
                  </p>
                  {z.status === 'ended' && (
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {t('Removed by {value} · {saTime}{value2}', { value: z.ended_by_name ?? 'unknown', saTime: formatSaTime(z.ended_at), value2: z.end_reason ? ` — ${z.end_reason}` : '' })}
                    </p>
                  )}
                  {live && (
                    <Link href={`/incidents/map?zone=${z.id}`} className="mt-1.5 inline-block text-xs font-semibold text-accent hover:underline">
                      {t('Show on the map →')}</Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
