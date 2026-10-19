import { featureEnabled, getOperationalSettings, listActiveIncidents, listOnDutyOfficers } from '@criticom/api';
import { DEPARTMENT_NAMES, canAccess, canDrawMapZones, canSeeRoutes } from '@criticom/db';
import { OpsMap } from '@/components/ops-map/ops-map';
import { getFeatures } from '@/lib/features';
import { availableLayers, defaultLayers } from '@/lib/ops-map/layers';
import { getSession, siloFilter } from '@/lib/session';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Live Map · HikTech' };

/**
 * The live operations map at full size. `?wall=1` opens straight into the
 * wall display — the link to bookmark on a control-room TV. `?zone=<id>`
 * opens on one perimeter (console notices link here); `?incident=<id>`
 * links new drawings to that call (the incident page's "Draw a perimeter").
 */
export default async function LiveMapPage({
  searchParams,
}: {
  searchParams: Promise<{ wall?: string; zone?: string; incident?: string }>;
}) {
  const { t } = await requestT();
  const { supabase, silo, role, userId } = await getSession();
  const { wall, zone, incident } = await searchParams;
  const sf = siloFilter(silo);
  const [incidents, officers, settings] = await Promise.all([
    listActiveIncidents(supabase, sf),
    listOnDutyOfficers(supabase, sf ? [sf] : undefined).catch(() => []),
    getOperationalSettings(supabase),
  ]);

  return (
    <div className="space-y-3">
      <header>
        <h1 className="text-2xl font-bold">{t('Live operations map')}</h1>
        <p className="text-muted-foreground">
          {t('Calls, officers, perimeters, crime zones, hydrants and weather, live. Choose what shows under')}{' '}<strong>{t('Layers')}</strong>; <strong>{t('Full screen')}</strong> {' '}{t('(or F) turns it into a wall display.')}{canDrawMapZones(role) && ' Draw a cordon or zone with the tools on the right of the map.'}
        </p>
      </header>

      <OpsMap
        incidents={incidents}
        officers={officers}
        silo={sf}
        layers={availableLayers({ cameras: canAccess('/sanral', role, silo), routes: canSeeRoutes(role) })}
        defaults={defaultLayers(role)}
        basemap={settings['map.default_basemap']}
        scopeLabel={sf ? DEPARTMENT_NAMES[sf] : 'All departments'}
        height="max(520px, calc(100dvh - 12rem))"
        startInWall={wall === '1'}
        me={{ id: userId, role, silo }}
        focusZoneId={zone ?? null}
        drawForIncidentId={incident ?? null}
        bodycams={canAccess('/cameras', role, silo) && featureEnabled(await getFeatures(), 'web.cameras')}
      />
    </div>
  );
}
