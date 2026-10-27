import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  Activity, Bug, CloudLightning, Droplets, ExternalLink, Flame, Globe2, History, Map as MapIcon, Satellite, ShieldAlert, Tornado, Waves, Wind,
} from 'lucide-react';
import { listLiveWarnings, listPastEvents } from '@criticom/api';
import { warningState } from '@criticom/db/disaster-warnings';
import { InfoDot } from '@/components/info-dot';
import { PageGuide } from '@/components/office/page-guide';
import { overlayFeatures, type Collection } from '@/lib/maps/sources';
import { firmsFiresToday, fmdNews, nicdReports, type Post } from '@/lib/maps/watch';
import { getSession } from '@/lib/session';
import { requestT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Hazard Watch · HikTech' };

const NDMC_DASHBOARD = (id: string) => `https://www.arcgis.com/apps/dashboards/${id}`;
const day = new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'short' });

/** A source that does not answer gives null, never a broken page. */
const settle = <T,>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

/**
 * Every outside source the desk watches, on one page, in our own words: the
 * latest from each (warnings, flooding and fires from space, river
 * forecasts, earthquakes, disasters in the region, cyclones, air quality,
 * disease, foot-and-mouth, drought, fire and flood risk, past disasters).
 * Each card says what it is (i), shows it on the map, and opens the source.
 */
export default async function HazardWatchPage() {
  const { t } = await requestT();
  const { supabase } = await getSession();
  const [warnings, quakes, gdacs, cyclones, air, drought, fireRisk, floodRisk, pastFires, nicd, fmd, firms, past] = await Promise.all([
    listLiveWarnings(supabase), settle(overlayFeatures('quakes')), settle(overlayFeatures('gdacs')), settle(overlayFeatures('cyclones')),
    settle(overlayFeatures('air-quality')), settle(overlayFeatures('drought')), settle(overlayFeatures('fire-risk')), settle(overlayFeatures('flood-risk')),
    settle(overlayFeatures('past-fires')), settle(nicdReports()), settle(fmdNews()), settle(firmsFiresToday()), listPastEvents(supabase),
  ]);
  const inForce = warnings.filter((w) => warningState(w) === 'In force');
  const quakeMags = (quakes?.features ?? []).map((f) => Number(f.properties.title.replace(/\D+([\d.]+).*/, '$1'))).filter(Number.isFinite);
  const regional = [...(gdacs?.features ?? [])].sort((a, b) => rank(b.properties.colour) - rank(a.properties.colour)).slice(0, 5);
  const classes = (c: Collection | null) => {
    const m = new Map<string, number>();
    for (const f of c?.features ?? []) {
      const name = f.properties.title.replace(/^.*?:\s*/, '');
      m.set(name, (m.get(name) ?? 0) + 1);
    }
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  const worstAir = [...(air?.features ?? [])].sort((a, b) => airRank(b.properties) - airRank(a.properties))[0];
  const year = new Date().getFullYear();
  const recentFires = (pastFires?.features ?? []).filter((f) => year - Number(f.properties.title.slice(-4)) <= 5).length;
  const pastDeaths = past.reduce((n, e) => n + (e.deaths ?? 0), 0);

  return (
    <div className="space-y-6">
      <header className="max-w-3xl">
        <h1 className="flex items-center gap-2 text-2xl font-bold"><ShieldAlert className="h-6 w-6 text-accent" aria-hidden />{t('Hazard watch')}</h1>
        <p className="mt-1 text-muted-foreground">{t('The latest from every source the desk watches, in one place. Each card shows it on the map and opens the source.')}</p>
      </header>
      <PageGuide id="disaster.watch" steps={[
        t('Read the cards from the top: what is happening now first, then risk and history.'),
        t('The (i) on a card says what the source is and how to read it.'),
        t('Show on the map opens the Disaster map with that layer on. Open the source goes to the publisher’s own site.'),
      ]} />

      <h2 className="text-lg font-semibold">{t('Now')}</h2>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card icon={CloudLightning} title={t('Weather warnings')} tone={inForce.length ? 'warn' : 'calm'}
          about={t('SA Weather Service impact-based warnings that name eThekwini, read every five minutes.')}
          map="saws-areas" source="https://www.weathersa.co.za/warnings" own={{ href: '/disaster/warnings', label: t('Early warnings') }}>
          {warnings.length ? (
            <ul className="space-y-1">{warnings.slice(0, 4).map((w) => (
              <li key={w.id}><Link href={`/disaster/warnings/${w.id}`} className="font-semibold hover:underline">{w.colour} {t('Level {n}', { n: w.level })} {w.hazard}</Link>
                <span className="text-muted-foreground"> · {t(warningState(w))}</span></li>
            ))}</ul>
          ) : <p>{t('No warning for eThekwini right now.')}</p>}
        </Card>
        <Card icon={Satellite} title={t('Flooding seen from space')} tone="plain"
          about={t('NASA’s satellites map flood water every day. Clouds hide the ground, so check after the rain clears.')}
          map="flood-modis-2d" source="https://lance.modaps.eosdis.nasa.gov/flood/viewer/">
          <p>{t('The last two days from MODIS and VIIRS. Show it on the map to see where water lies where there is usually none.')}</p>
        </Card>
        <Card icon={Waves} title={t('River floods forecast')} tone="plain"
          about={t('The Global Flood Awareness System forecasts the big rivers each day, three days ahead. It does not see small streams or flash floods.')}
          map="river-floods-3d" source="https://global-flood.emergency.copernicus.eu">
          <p>{t('Rivers forecast to rise above a flood level in the next three days are coloured on the map.')}</p>
        </Card>
        <Card icon={Flame} title={t('Fires burning now')} tone={firms ? 'warn' : 'plain'}
          about={t('Fires and hot spots NASA’s satellites saw in the last 24 hours. A dot can also be a hot factory roof.')}
          map="fires-now" source="https://firms.modaps.eosdis.nasa.gov/map/">
          {firms == null ? <p>{t('On the map: the last 24 hours. (A free FIRMS key on the server adds the count here.)')}</p>
            : <p><b className="text-2xl tabular-nums">{firms}</b> {t('hot spots over eThekwini in the last 24 hours.')}</p>}
        </Card>
        <Card icon={Activity} title={t('Earthquakes')} tone={quakeMags.some((m) => m >= 4) ? 'warn' : 'plain'}
          about={t('Earthquakes in and around South Africa in the last 30 days, from the Council for Geoscience’s seismographs.')}
          map="quakes" source="https://www.geoscience.org.za" failed={!quakes}>
          <p><b className="text-2xl tabular-nums">{quakeMags.length}</b> {t('in the last 30 days')}{quakeMags.length ? ` · ${t('largest {m}', { m: Math.max(...quakeMags).toFixed(1) })}` : ''}</p>
        </Card>
        <Card icon={Globe2} title={t('Disasters in the region')} tone={regional.some((f) => f.properties.colour !== '#16a34a') ? 'warn' : 'plain'}
          about={t('Current floods, cyclones, droughts, quakes and fires in southern Africa from GDACS, the UN and European Commission’s alert system.')}
          map="gdacs" source="https://www.gdacs.org" failed={!gdacs}>
          {regional.length ? <ul className="space-y-1">{regional.map((f) => (
            <li key={`${f.properties.title}-${f.properties.url}`} className="flex gap-2">
              <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: f.properties.colour }} />
              <a href={f.properties.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{f.properties.title}</a>
            </li>
          ))}</ul> : <p>{t('Nothing current in the region.')}</p>}
        </Card>
        <Card icon={Tornado} title={t('Tropical cyclones')} tone={(cyclones?.features.length ?? 0) > 0 ? 'warn' : 'calm'}
          about={t('Active tropical storms in the south-west Indian Ocean, their tracks and forecast cones. The season is November to April.')}
          map="cyclones" source="https://ndmcgis.maps.arcgis.com/apps/instant/sidebar/index.html?appid=63ae0e8abce94879b101a6ed755966ef" failed={!cyclones}>
          <p>{cyclones?.features.length ? [...new Set(cyclones.features.map((f) => f.properties.title))].join(', ') : t('No tropical cyclone in the south-west Indian Ocean now.')}</p>
        </Card>
        <Card icon={Wind} title={t('Air quality')} tone={worstAir && airRank(worstAir.properties) >= 3 ? 'warn' : 'plain'}
          about={t('How clean the air is across eThekwini this hour. The national network (SAAQIS) measures it; without a WAQI key the figure is modelled.')}
          map="air-quality" source="https://saaqis.environment.gov.za" failed={!air}>
          <p>{worstAir ? t('Worst across the city: {band}', { band: t(AIR_BANDS[airRank(worstAir.properties)] ?? '—') }) : '—'}</p>
          {air?.note ? <p className="text-xs text-muted-foreground">{t(air.note)}</p> : null}
        </Card>
        <Card icon={Bug} title={t('Disease outbreaks')} tone="plain"
          about={t('The National Institute for Communicable Diseases’ latest reports: outbreaks, weekly situation reports and alerts.')}
          source="https://www.nicd.ac.za" failed={!nicd}>
          <Posts posts={nicd ?? []} />
        </Card>
        <Card icon={Bug} title={t('Foot-and-mouth disease')} tone="plain"
          about={t('Foot-and-mouth news from RMIS, the red meat industry’s animal health service. It matters for livestock movement and the port.')}
          source="https://rmis.co.za" failed={!fmd}>
          <Posts posts={fmd ?? []} />
        </Card>
        <Card icon={Bug} title={t('COVID-19')} tone="plain"
          about={t('The World Health Organization’s global COVID-19 figures. For South Africa’s own reports, see the NICD card.')}
          source="https://data.who.int/dashboards/covid19/cases">
          <p>{t('Global figures on the WHO’s dashboard.')}</p>
        </Card>
      </div>

      <h2 className="text-lg font-semibold">{t('Risk and history')}</h2>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card icon={Droplets} title={t('Drought')} tone="plain"
          about={t('How dry each river catchment has been over 24 months (the standardised precipitation index), from the NDMC. Copernicus’s drought observatory adds Africa-wide indicators.')}
          map="drought" source={NDMC_DASHBOARD('42de70656a4545edbd627e157d515c17')} more={{ href: 'https://drought.emergency.copernicus.eu', label: 'Copernicus' }} failed={!drought}>
          <Classes rows={classes(drought)} />
          {drought?.note ? <p className="text-xs text-muted-foreground">{t(drought.note)}</p> : null}
        </Card>
        <Card icon={Waves} title={t('Flood risk this season')} tone="plain"
          about={t('The NDMC’s indicative flood risk for eThekwini’s areas this season: hazard, vulnerability and capacity combined.')}
          map="flood-risk" source="https://ndmc.maps.arcgis.com" failed={!floodRisk}>
          <Classes rows={classes(floodRisk)} />
        </Card>
        <Card icon={Flame} title={t('Fire risk this season')} tone="plain"
          about={t('The NDMC’s indicative fire risk for eThekwini’s areas this season.')}
          map="fire-risk" source={NDMC_DASHBOARD('dae46c99f6e44b2c81d49258d26333e0')} failed={!fireRisk}>
          <Classes rows={classes(fireRisk)} />
        </Card>
        <Card icon={History} title={t('Past disasters on record')} tone="plain"
          about={t('The SA Weather Service’s record of weather disasters in eThekwini, and the major events of 2017 to 2022.')}
          map="past-events" source={NDMC_DASHBOARD('46adb0d909be49848b860e15cc17b461')} own={{ href: '/disaster/records', label: t('Past disasters') }}>
          <p><b className="text-2xl tabular-nums">{past.length}</b> {t('events · {d} deaths recorded', { d: pastDeaths })}</p>
          {past.length === 0 ? <p className="text-xs text-muted-foreground">{t('Load them on the Past disasters page.')}</p> : null}
        </Card>
        <Card icon={Flame} title={t('Past fires from satellite')} tone="plain"
          about={t('Fires the satellites saw with high confidence in eThekwini since 2000, from the NDMC’s fire analysis.')}
          map="past-fires" source={NDMC_DASHBOARD('7493ea9078e44c9a89009b6825a788fa')} failed={!pastFires}>
          <p><b className="text-2xl tabular-nums">{pastFires?.features.length ?? '—'}</b> {t('since 2000 · {n} in the last 5 years', { n: recentFires })}</p>
        </Card>
      </div>
    </div>
  );

  function Card({ icon: Icon, title, tone, about, map, source, own, more, failed, children }: {
    icon: typeof Flame; title: string; tone: 'warn' | 'calm' | 'plain'; about: string; map?: string; source: string;
    own?: { href: string; label: string }; more?: { href: string; label: string }; failed?: boolean; children: ReactNode;
  }) {
    return (
      <section className={cn('flex flex-col rounded-2xl border border-t-4 border-border bg-bg-card p-4 shadow-sm',
        tone === 'warn' ? 'border-t-severity-medium' : tone === 'calm' ? 'border-t-severity-low' : 'border-t-border')}>
        <div className="mb-2 flex items-center gap-2">
          <Icon className="h-5 w-5 shrink-0 text-accent" aria-hidden />
          <h3 className="min-w-0 flex-1 font-semibold">{title}</h3>
          <InfoDot title={title} text={about} />
        </div>
        <div className="flex-1 space-y-1 text-sm">
          {failed ? <p className="text-severity-medium-ink">{t('The source did not answer just now. Try again in a few minutes.')}</p> : children}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-2 text-sm font-semibold">
          {own ? <Link href={own.href} className="text-accent hover:underline">{own.label}</Link> : null}
          {map ? (
            <Link href={`/disaster/map?layer=${map}`} className="inline-flex items-center gap-1 text-accent hover:underline">
              <MapIcon className="h-4 w-4" aria-hidden />{t('Show on the map')}
            </Link>
          ) : null}
          <a href={source} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:text-fg hover:underline">
            <ExternalLink className="h-4 w-4" aria-hidden />{t('Open the source')}
          </a>
          {more ? <a href={more.href} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-fg hover:underline">{more.label}</a> : null}
        </div>
      </section>
    );
  }

  function Posts({ posts }: { posts: Post[] }) {
    if (!posts.length) return <p>{t('Nothing new.')}</p>;
    return (
      <ul className="space-y-1">
        {posts.slice(0, 5).map((p) => (
          <li key={p.url}>
            <a href={p.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{p.title}</a>
            {p.date ? <span className="text-muted-foreground"> · {day.format(new Date(p.date))}</span> : null}
          </li>
        ))}
      </ul>
    );
  }

  function Classes({ rows }: { rows: Array<[string, number]> }) {
    if (!rows.length) return <p>—</p>;
    return (
      <ul className="space-y-0.5">
        {rows.map(([name, n]) => <li key={name} className="flex justify-between gap-3"><span>{t(name)}</span><span className="font-semibold tabular-nums">{n}</span></li>)}
      </ul>
    );
  }
}

/** GDACS's colours, most serious first. */
function rank(colour: string) {
  return colour === '#dc2626' ? 3 : colour === '#f97316' ? 2 : colour === '#16a34a' ? 1 : 0;
}

/** The air quality bands, worst last. */
const AIR_BANDS = ['Good', 'Fair', 'Moderate', 'Poor', 'Very poor'];

/** A point's band, from its title (modelled) or its first line (a station), worst highest; -1 when unknown. */
function airRank(p: { title: string; lines?: string[] }) {
  const text = `${p.title} ${p.lines?.[0] ?? ''}`.toLowerCase();
  for (let i = AIR_BANDS.length - 1; i >= 0; i--) {
    if (new RegExp(`\\b${AIR_BANDS[i]!.toLowerCase()}\\b`).test(text)) return i;
  }
  return -1;
}
