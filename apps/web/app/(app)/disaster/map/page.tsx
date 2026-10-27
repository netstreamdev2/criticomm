import { getOperationalSettings, listCallFacts, listOpenDisasterIncidents, listOpenShelters, listShelters } from '@criticom/api';
import { OpsMap } from '@/components/ops-map/ops-map';
import { PageGuide } from '@/components/office/page-guide';
import { isCatalogueId } from '@/lib/ops-map/catalogue';
import { availableLayers } from '@/lib/ops-map/layers';
import { getSession } from '@/lib/session';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Disaster Map · HikTech' };

/**
 * The Disaster map at full size: the open incidents and halls with every
 * overlay the desk can use (warnings, flooding and fires from space, river
 * forecasts, risk, wards and their councillors, past disasters, the April
 * 2022 floods). Layers has a search box; Full screen makes it a wall display.
 */
export default async function DisasterMapPage({ searchParams }: { searchParams: Promise<{ layer?: string }> }) {
  const { t } = await requestT();
  const { layer } = await searchParams;
  // ?layer= from a "Show on the map" link: that overlay goes on as the map opens.
  const alsoOn = layer && isCatalogueId(layer) ? [layer] : [];
  const { supabase, userId, role, silo } = await getSession();
  const [allOpen, register, openings, settings] = await Promise.all([
    listOpenDisasterIncidents(supabase).catch(() => []),
    listShelters(supabase).catch(() => []),
    listOpenShelters(supabase).catch(() => []),
    getOperationalSettings(supabase).catch(() => null),
  ]);
  const status = new Map((await listCallFacts(supabase, allOpen.map((i) => i.id))).map((f) => [f.incident_id, f.dm_status ?? 'Active']));
  const open = allOpen.filter((i) => (status.get(i.id) ?? 'Active') === 'Active');
  const inHall = new Map<string, number>();
  for (const o of openings) inHall.set(o.shelter_id, (inHall.get(o.shelter_id) ?? 0) + o.people_now);

  return (
    <div className="space-y-3">
      <header>
        <h1 className="text-2xl font-bold">{t('Disaster map')}</h1>
        <p className="text-muted-foreground">{t('Open incidents and halls, with warnings, hazards, risk, wards and past disasters. Choose what shows under Layers.')}</p>
      </header>
      <PageGuide id="disaster.map" steps={[
        t('Press Layers, then type what you need: flood, fire, ward, school. Tick it to put it on the map.'),
        t('The (i) beside a layer says what it shows and where it comes from.'),
        t('Click anything on the map for its details. Warnings, wards and past disasters all open.'),
        t('Full screen turns the map into a wall display for the control room TV.'),
      ]} />
      <OpsMap incidents={open} officers={[]} silo="EthekwiniDisaster"
        layers={availableLayers({ cameras: false, shelters: true, catalogue: true })}
        defaults={['incidents', 'zones', 'shelters', 'radar', 'saws-areas', 'wards']}
        basemap={settings?.['map.default_basemap'] ?? 'dark'} scopeLabel={t('Disaster Management')}
        height="max(520px, calc(100dvh - 15rem))" me={{ id: userId, role, silo }} alsoOn={alsoOn}
        shelters={register.filter((h) => h.lat != null && h.lng != null).map((h) => ({
          id: h.id, name: h.name, lat: h.lat!, lng: h.lng!, capacity: h.capacity, people: inHall.get(h.id) ?? 0 }))} />
    </div>
  );
}
