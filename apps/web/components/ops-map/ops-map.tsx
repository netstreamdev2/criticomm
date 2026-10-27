'use client';

/**
 * The live operations map: the dispatch board's map and /incidents/map.
 *
 * One Leaflet map that lives for the whole visit. Layers are switched on and
 * off in place and incidents and officers move in place as realtime events
 * arrive, so the view never resets under the person watching it. V4's
 * _MapCore layer toggles (crime zones, hydrants, weather, traffic, POIs)
 * come across here, with every API key kept server-side.
 *
 * Full screen turns it into a wall display for a control-room TV over HDMI:
 * the map covers the console, the browser goes full screen, a HUD shows the
 * clock and live counts, controls fade when the mouse is still, the screen
 * is kept awake, and the view follows the incidents. SOS and alert pop-ups
 * still appear over it — they sit higher in the overlay scale.
 *
 * Perimeters and zones (migration 0053): command and control-room staff draw
 * cordons, closures, search areas and points here — to the metre — and choose
 * who receives them. Every console sees shared zones live, with who set each
 * one, when and why. Field officers' phones do not receive them yet.
 *
 * The wall is a `position: fixed` overlay (z-60, above the sidebar and
 * topbar, below toasts at 70 and the SOS dialog at 85–95), and the whole
 * document goes full screen rather than the map element, so those pop-ups
 * stay visible. Fixed positioning needs every ancestor to be free of
 * transform, filter and backdrop-filter: keep it that way where it is used.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import 'leaflet/dist/leaflet.css';
import type * as Leaflet from 'leaflet';
import {
  Crosshair, Layers, Maximize2, Minimize2, Search, Shapes, Siren, Wind, X,
} from 'lucide-react';
import {
  listBodycamHolders, listCameras, listCrimeZones, listDutyTracks, listHydrantsInArea, subscribeBodycams,
  type DutyTrackPoint, type LiveMapZone, type OnDutyOfficer,
} from '@criticom/api';
import {
  DEPARTMENT_NAMES, canDismissSos, canDrawMapZones, canWatchBodycam,
  type Database, type MapZoneKind, type MapZoneShape, type Silo, type UserRole,
} from '@criticom/db';
import { BodycamViewer, type BodycamTarget, type ViewReason } from '@/components/bodycam/bodycam-viewer';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { useLiveIncidents } from '@/lib/live-incidents';
import { useOnDutyOfficers } from '@/lib/on-duty';
import { useLiveZones } from '@/lib/live-zones';
import {
  BASEMAPS, CRIME_KINDS, HYDRANT_COLOUR, LAYER_GROUPS, LAYERS, SEVERITY_COLOUR, WEATHER_LAYERS,
  compass, crimeZones, hasPosition, isBasemap, isCrimeKind, isSos, isStale, isWeatherLayer, offlineSince, parseFacilities,
  parseTraffic, restoreLayers, ROUTE_COLOUR, routeSegments, summariseIncidents,
  type Basemap, type CrimeKind, type CrimeStation, type Facility, type LayerId, type MapLayerId, type TrafficItem,
} from '@/lib/ops-map/layers';
import {
  CATALOGUE, catalogueOverlay, matchesSearch, type CatalogueOverlay, type LegendItem, type OverlayFeatureProps,
} from '@/lib/ops-map/catalogue';
import { InfoDot } from '@/components/info-dot';
import { distanceM, fromGeometry, kindsForShape, zoneKind, type LatLng, type ZoneDraft } from '@/lib/ops-map/zones';
import { cn, escapeHtml, timeAgo } from '@/lib/utils';
import { saveZoneAction } from '@/app/(app)/incidents/map/actions';
import * as M from './markers';
import { ZoneDrawController, type DrawSnapshot } from './zones/draw-controller';
import { drawZones, zoneBounds } from './zones/render';
import { ZoneCard } from './zones/zone-card';
import { ZoneEditor, type EditorIncident, type ZoneFormInit } from './zones/zone-editor';
import { DrawToolbar, PlacingBar, ZonesList } from './zones/zone-tools';
import { DispatchMapModal } from '@/components/dispatch-map-modal';
import { DismissSos } from '@/components/sos-dismiss';
import { useT } from '@/components/i18n';
import {
  aircraftIcon, aircraftTooltip, parseAircraft, parseVessels, shelterIcon, shelterTooltip, vesselIcon, vesselTooltip,
  type Aircraft, type MapShelter, type Vessel,
} from './air-sea';

type L = typeof Leaflet;
type Incident = Database['public']['Tables']['incidents']['Row'];
type Hydrant = Database['public']['Tables']['hydrants']['Row'];
type Camera = Database['public']['Tables']['cameras']['Row'];

type WeatherNow = {
  configured?: boolean;
  windSpeedMs?: number | null;
  windDeg?: number | null;
  tempC?: number | null;
  description?: string | null;
  error?: string;
};

const DURBAN: [number, number] = [-29.8587, 31.0218];
/** Hydrants show from street level: zoomed out, the city's 34,000 would bury the map. */
const HYDRANT_MIN_ZOOM = 15;
/** SOS pins this close together are listed together in one card. */
const SOS_SPOT_M = 60;
// v2: the perimeters layer arrived, on by default.
const STORE = 'criticom:ops-map:v2';
/** Someone touching the map pauses auto-fit for this long. */
const HANDS_OFF_MS = 60_000;
/** How long a new call keeps its "just arrived" pulse. */
const FRESH_MS = 2 * 60_000;
const BANNER_MS = 12_000;
const IDLE_MS = 4_000;

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const BASE_TILES: Record<Basemap, Array<{ url: string; attribution?: string; maxNativeZoom?: number }>> = {
  // Esri's dark canvas: same provider (and CSP entry) as the satellite imagery.
  dark: [
    { url: `${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, attribution: 'Tiles &copy; Esri', maxNativeZoom: 16 },
    { url: `${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, maxNativeZoom: 16 },
  ],
  street: [{ url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '&copy; OpenStreetMap contributors' }],
  satellite: [{ url: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, attribution: 'Tiles &copy; Esri' }],
};
const BASEMAP_LABEL: Record<Basemap, string> = { dark: 'Dark', street: 'Street', satellite: 'Satellite' };

const WEATHER_OPACITY: Record<(typeof WEATHER_LAYERS)[number], number> = {
  rain: 0.85, clouds: 0.7, temp: 0.55, wind: 0.6,
};

/** Overlays drawn from data (weather layers are tiles, handled apart). */
const DATA_GROUPS = ['incidents', 'units', 'routes', 'zones', 'cameras', 'crime', 'hydrants', 'traffic', 'facilities', 'flights', 'vessels', 'shelters'] as const;
type DataGroup = (typeof DATA_GROUPS)[number];
type GroupKey = DataGroup | 'sos';

const SA_CLOCK = new Intl.DateTimeFormat('en-ZA', {
  timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});
const SA_DATE = new Intl.DateTimeFormat('en-ZA', {
  timeZone: 'Africa/Johannesburg', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
});

type WakeLockLike = { release(): Promise<void> };
const wakeLock = () =>
  (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLockLike> } }).wakeLock;

/** Proxy feeds answer `{ configured: false, message }` when their key is missing. */
async function fetchFeed(url: string): Promise<{ ok: true; json: unknown } | { ok: false; message: string }> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    const json: unknown = await res.json().catch(() => null);
    const body = (json ?? {}) as { configured?: unknown; message?: unknown };
    if (body.configured === false) {
      return { ok: false, message: typeof body.message === 'string' ? body.message : 'Not configured on the server.' };
    }
    if (!res.ok) {
      return { ok: false, message: res.status === 429 ? 'Too many requests — try again in a minute.' : 'The feed did not answer.' };
    }
    return { ok: true, json };
  } catch {
    return { ok: false, message: 'The feed did not answer.' };
  }
}

export type OpsMapProps = {
  /** Server-rendered open incidents and on-duty officers, for the first paint. */
  incidents: Incident[];
  officers: OnDutyOfficer[];
  /** Department scope; undefined for every department. */
  silo?: Silo;
  /** Layers this viewer may switch on (availableLayers), the outside overlays among them on the Disaster maps. */
  layers: MapLayerId[];
  /** What they open with until they choose (defaultLayers). */
  defaults: MapLayerId[];
  /** The administrator's default basemap (Operations Settings). */
  basemap: Basemap;
  /** "All departments" or the department's name, for the wall display. */
  scopeLabel: string;
  height?: number | string;
  /** Open as the wall display (a kiosk link: /incidents/map?wall=1). */
  startInWall?: boolean;
  /** Who is looking: decides whether they may draw, and which zones they may change. */
  me: { id: string; role: UserRole; silo: Silo };
  /** Open with this zone in view and its card open (/incidents/map?zone=…). */
  focusZoneId?: string | null;
  /** Link new drawings to this call (/incidents/map?incident=…). */
  drawForIncidentId?: string | null;
  /**
   * Bodycams (0054): mark officers wearing one, and let this viewer open the
   * live feed from the officer's marker. Set when the Body Cams screen is open
   * to them; each bodycam is still checked against their department.
   */
  bodycams?: boolean;
  /**
   * On the dispatch console a click on a call opens the live dispatch map
   * (officers, road routes, minutes away) instead of the incident page.
   * canAssign lets the dispatcher assign from it.
   */
  liveRoutes?: { canAssign: boolean } | null;
  /**
   * The call logger's dashboard: only the calls `me` logged, no officers, no
   * drawing, and a click zooms in instead of opening anything.
   */
  onlyMine?: boolean;
  /** Reception centres to show on the Shelters layer (0113): the Disaster desk's register. */
  shelters?: MapShelter[];
  /** Switched on as the map opens, on top of what the viewer chose before (a "Show on the map" link). */
  alsoOn?: MapLayerId[];
};

export function OpsMap({
  incidents: initialIncidents, officers: initialOfficers, silo, layers: available, defaults,
  basemap: defaultBasemap, scopeLabel, height = 560, startInWall = false,
  me, focusZoneId = null, drawForIncidentId = null, bodycams = false, liveRoutes = null, onlyMine = false, shelters = [], alsoOn = [],
}: OpsMapProps) {
  const { t } = useT();
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;

  const liveIncidents = useLiveIncidents(initialIncidents, silo);
  const incidents = useMemo(
    () => (onlyMine ? liveIncidents.filter((i) => i.created_by === me.id) : liveIncidents),
    [onlyMine, liveIncidents, me.id],
  );
  const silos = useMemo(() => (silo ? [silo] : undefined), [silo]);
  const officers = useOnDutyOfficers(onlyMine ? [] : initialOfficers, silos, !onlyMine);
  /** The call whose live dispatch map is open. */
  const [routingId, setRoutingId] = useState<string | null>(null);
  const routing = routingId ? incidents.find((i) => i.id === routingId) ?? null : null;
  // An SOS pin opens its own card (open the call, or dismiss it as a mistake, 0093)
  // for those who may dismiss; it closes by itself once the SOS is gone.
  // Anchored to the spot, not one call: SOS presses from the same place sit on
  // top of each other, so the card lists every open SOS within ~60 m of it,
  // each to open or dismiss, and closes when none is left.
  const [sosSpot, setSosSpot] = useState<{ lat: number; lng: number } | null>(null);
  const sosHere = useMemo(() => (sosSpot
    ? incidents
      .filter((i) => isSos(i) && distanceM(sosSpot, { lat: i.location_lat, lng: i.location_lng }) <= SOS_SPOT_M)
      .sort((a, b) => Date.parse(b.incident_created_at) - Date.parse(a.incident_created_at))
    : []), [sosSpot, incidents]);
  const mayDismissSos = canDismissSos(me.role);
  const mayDismissRef = useRef(mayDismissSos);
  mayDismissRef.current = mayDismissSos;
  const liveRoutesRef = useRef(liveRoutes);
  liveRoutesRef.current = liveRoutes;
  const onlyMineRef = useRef(onlyMine);
  onlyMineRef.current = onlyMine;

  /* ── What is switched on (remembered per browser) ─────────────────── */

  const availableKey = available.join(',');
  const defaultsKey = defaults.join(',');
  const alsoOnKey = alsoOn.join(',');
  const [active, setActive] = useState<MapLayerId[]>(() => restoreLayers(defaults, available, []));
  const [basemap, setBasemap] = useState<Basemap>(defaultBasemap);
  const [crimeKind, setCrimeKind] = useState<CrimeKind>('all');
  /** How see-through each outside overlay is, 0.2 to 1, when the viewer changed it. */
  const [opacity, setOpacityMap] = useState<Record<string, number>>({});
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    const allowed = availableKey.split(',') as MapLayerId[];
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? 'null') as Record<string, unknown> | null;
      if (saved && typeof saved === 'object') {
        if ('layers' in saved) setActive(restoreLayers(saved.layers, allowed, []));
        if (isBasemap(saved.basemap)) setBasemap(saved.basemap);
        if (isCrimeKind(saved.crimeKind)) setCrimeKind(saved.crimeKind);
        if (saved.opacity && typeof saved.opacity === 'object') {
          setOpacityMap(Object.fromEntries(Object.entries(saved.opacity as Record<string, unknown>)
            .filter(([id, v]) => catalogueOverlay(id) && typeof v === 'number' && v >= 0.2 && v <= 1)) as Record<string, number>);
        }
      }
    } catch {
      /* private window or blocked storage — the defaults stand */
    }
    const extra = alsoOnKey ? (alsoOnKey.split(',') as MapLayerId[]).filter((id) => allowed.includes(id)) : [];
    if (extra.length) setActive((cur) => [...new Set([...cur, ...extra])]);
    setRestored(true);
  }, [availableKey, alsoOnKey]);

  useEffect(() => {
    if (!restored) return;
    try {
      localStorage.setItem(STORE, JSON.stringify({ layers: active, basemap, crimeKind, opacity }));
    } catch {
      /* not fatal */
    }
  }, [restored, active, basemap, crimeKind, opacity]);

  const isOn = useCallback((id: MapLayerId) => active.includes(id), [active]);
  const toggle = (id: MapLayerId) =>
    setActive((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const setOpacity = (id: string, v: number) => setOpacityMap((cur) => ({ ...cur, [id]: v }));
  const resetLayers = () => {
    setActive(restoreLayers(defaultsKey.split(','), availableKey.split(',') as MapLayerId[], []));
    setBasemap(defaultBasemap);
    setCrimeKind('all');
    setOpacityMap({});
  };

  /* ── Wall display state ───────────────────────────────────────────── */

  const [wall, setWall] = useState(startInWall);
  const wallRef = useRef(wall);
  wallRef.current = wall;
  const [follow, setFollow] = useState(startInWall);
  /** The left-hand panel: map layers or the list of zones. */
  const [sheet, setSheet] = useState<'layers' | 'zones' | null>(null);
  const [idle, setIdle] = useState(false);
  const [nativeFs, setNativeFs] = useState(false);

  /* ── Leaflet ──────────────────────────────────────────────────────── */

  const el = useRef<HTMLDivElement>(null);
  const lib = useRef<L | null>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const canvas = useRef<Leaflet.Canvas | null>(null);
  const groups = useRef<Partial<Record<GroupKey, Leaflet.LayerGroup>>>({});
  const baseLayers = useRef<Leaflet.TileLayer[]>([]);
  const weatherTiles = useRef<Partial<Record<string, Leaflet.TileLayer>>>({});
  /** The outside overlays on the map, each with its refresh timer. */
  const outside = useRef(new Map<string, { layer: Leaflet.TileLayer | Leaflet.GeoJSON; timer?: ReturnType<typeof setInterval> }>());
  const incidentMarkers = useRef(new Map<string, { marker: Leaflet.Marker; key: string; sos: boolean }>());
  const unitMarkers = useRef(new Map<string, { marker: Leaflet.Marker; key: string }>());
  const lastTouch = useRef(0);
  /** The drawing under way, if any. Clicks on pins go to it instead of opening calls. */
  const drawer = useRef<ZoneDrawController | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    // Leaflet touches `window` at import time — load it inside the effect.
    void import('leaflet').then((L) => {
      const node = el.current;
      if (disposed || !node) return;
      const map = L.map(node, { zoomControl: false, worldCopyJump: true }).setView(DURBAN, 11);
      L.control.zoom({ position: 'bottomleft' }).addTo(map);
      map.attributionControl.setPosition('bottomleft');
      canvas.current = L.canvas({ padding: 0.5 });
      for (const key of [...DATA_GROUPS, 'sos'] as GroupKey[]) groups.current[key] = L.layerGroup();
      // An SOS is never switched off.
      groups.current.sos!.addTo(map);

      // Anyone handling the map pauses auto-fit for a minute.
      const touched = () => { lastTouch.current = Date.now(); };
      const events = ['pointerdown', 'wheel', 'touchstart', 'keydown'] as const;
      for (const ev of events) node.addEventListener(ev, touched, { passive: true });

      lib.current = L;
      mapRef.current = map;
      setReady(true);
      cleanup = () => {
        for (const ev of events) node.removeEventListener(ev, touched);
        drawer.current?.destroy();
        drawer.current = null;
        map.remove();
        mapRef.current = null;
        groups.current = {};
        baseLayers.current = [];
        weatherTiles.current = {};
        for (const o of outside.current.values()) if (o.timer) clearInterval(o.timer);
        outside.current.clear();
        incidentMarkers.current.clear();
        unitMarkers.current.clear();
      };
    });
    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  // Basemap.
  useEffect(() => {
    const map = mapRef.current;
    const L = lib.current;
    if (!ready || !map || !L) return;
    for (const t of baseLayers.current) t.remove();
    baseLayers.current = BASE_TILES[basemap].map((t, i) =>
      L.tileLayer(t.url, {
        maxZoom: 19, maxNativeZoom: t.maxNativeZoom, attribution: t.attribution, zIndex: i + 1,
      }).addTo(map),
    );
  }, [ready, basemap]);

  /* ── Weather (status for the HUD, and whether the tiles can work) ─── */

  const [weather, setWeather] = useState<WeatherNow | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch('/api/wind', { cache: 'no-store' })
        .then((r) => r.json() as Promise<WeatherNow>)
        .then((d) => { if (alive) setWeather(d); })
        .catch(() => {});
    void load();
    const t = setInterval(load, 10 * 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  const weatherOff = weather?.configured === false;

  // Which overlays are on the map.
  useEffect(() => {
    const map = mapRef.current;
    const L = lib.current;
    if (!ready || !map || !L) return;
    for (const id of DATA_GROUPS) {
      const g = groups.current[id];
      if (!g) continue;
      if (active.includes(id) && !map.hasLayer(g)) g.addTo(map);
      if (!active.includes(id) && map.hasLayer(g)) g.remove();
    }
    for (const w of WEATHER_LAYERS) {
      const on = active.includes(w) && !weatherOff;
      let tiles = weatherTiles.current[w];
      if (on && !tiles) {
        tiles = L.tileLayer(`/api/weather/tiles/${w}/{z}/{x}/{y}`, {
          opacity: WEATHER_OPACITY[w], zIndex: 5, maxZoom: 19, maxNativeZoom: 12,
          attribution: 'Weather &copy; OpenWeather',
        });
        weatherTiles.current[w] = tiles;
      }
      if (tiles && on && !map.hasLayer(tiles)) tiles.addTo(map);
      if (tiles && !on && map.hasLayer(tiles)) tiles.remove();
    }
    // Rain radar (0113): measured rain, served through the console.
    const radarOn = active.includes('radar');
    let radar = weatherTiles.current.radar;
    if (radarOn && !radar) {
      radar = L.tileLayer('/api/weather/radar/{z}/{x}/{y}', {
        opacity: 0.6, zIndex: 6, maxZoom: 19, maxNativeZoom: 7, attribution: 'Radar &copy; RainViewer',
      });
      weatherTiles.current.radar = radar;
    }
    if (radar && radarOn && !map.hasLayer(radar)) radar.addTo(map);
    if (radar && !radarOn && map.hasLayer(radar)) radar.remove();
  }, [ready, active, weatherOff]);

  // The radar frame moves on every ten minutes: redraw it while it is on.
  useEffect(() => {
    if (!ready || !active.includes('radar')) return;
    const t = setInterval(() => weatherTiles.current.radar?.redraw(), 10 * 60_000);
    return () => clearInterval(t);
  }, [ready, active]);

  /* ── New calls: a pulse on the pin and a banner ───────────────────── */

  const knownIds = useRef<Set<string> | null>(null);
  const freshTimers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const [freshIds, setFreshIds] = useState<ReadonlySet<string>>(() => new Set());
  const [banner, setBanner] = useState<Incident | null>(null);

  useEffect(() => {
    const ids = new Set(incidents.map((i) => i.id));
    const known = knownIds.current;
    knownIds.current = ids;
    if (!known) return; // first load: nothing is "new"
    const added = incidents.filter((i) => !known.has(i.id));
    if (!added.length) return;
    setFreshIds((prev) => new Set([...prev, ...added.map((a) => a.id)]));
    // The SOS has its own siren and dialog; the banner announces ordinary calls.
    const call = added.find((i) => !isSos(i));
    if (call) setBanner(call);
    freshTimers.current.push(setTimeout(() => {
      setFreshIds((prev) => {
        const next = new Set(prev);
        for (const a of added) next.delete(a.id);
        return next;
      });
    }, FRESH_MS));
  }, [incidents]);

  useEffect(() => () => { for (const t of freshTimers.current) clearTimeout(t); }, []);

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), BANNER_MS);
    return () => clearTimeout(t);
  }, [banner]);

  /* ── Incidents and SOS, moved in place ────────────────────────────── */

  const focus = useCallback((lat: number, lng: number) => {
    lastTouch.current = Date.now();
    mapRef.current?.flyTo([lat, lng], Math.max(mapRef.current.getZoom(), 16), { duration: 0.8 });
  }, []);

  useEffect(() => {
    const L = lib.current;
    const gInc = groups.current.incidents;
    const gSos = groups.current.sos;
    if (!ready || !L || !gInc || !gSos) return;
    const seen = new Set<string>();
    for (const i of incidents) {
      if (!hasPosition(i.location_lat, i.location_lng)) continue;
      seen.add(i.id);
      const sos = isSos(i);
      const fresh = freshIds.has(i.id);
      const key = `${sos}|${i.incident_severity}|${fresh}`;
      const tip = sos ? M.sosTooltip(i) : M.incidentTooltip(i);
      const z = sos ? M.SOS_Z : (M.SEVERITY_Z[i.incident_severity] ?? 0);
      let entry = incidentMarkers.current.get(i.id);
      if (entry && entry.sos !== sos) {
        (entry.sos ? gSos : gInc).removeLayer(entry.marker);
        incidentMarkers.current.delete(i.id);
        entry = undefined;
      }
      if (!entry) {
        const marker = L.marker([i.location_lat, i.location_lng], {
          icon: sos ? M.sosIcon(L) : M.incidentIcon(L, i, fresh),
          zIndexOffset: z,
          riseOnHover: true,
          keyboard: false,
        });
        marker.bindTooltip(tip, { direction: 'top', opacity: 0.97 });
        const { id, location_lat: lat, location_lng: lng } = i;
        // On the console a click opens the call; on the wall it zooms in for the room.
        marker.on('click', () => {
          // While drawing, a call's pin is where the point goes — exactly.
          const d = drawer.current;
          if (d) {
            if (d.placing) d.place({ lat, lng });
            return;
          }
          if (wallRef.current || onlyMineRef.current) focus(lat, lng);
          else if (sos && mayDismissRef.current) setSosSpot({ lat, lng });
          else if (liveRoutesRef.current) setRoutingId(id);
          else routerRef.current.push(`/incidents/${id}`);
        });
        (sos ? gSos : gInc).addLayer(marker);
        incidentMarkers.current.set(i.id, { marker, key, sos });
      } else {
        entry.marker.setLatLng([i.location_lat, i.location_lng]);
        if (entry.key !== key) {
          entry.marker.setIcon(sos ? M.sosIcon(L) : M.incidentIcon(L, i, fresh));
          entry.marker.setZIndexOffset(z);
          entry.key = key;
        }
        entry.marker.setTooltipContent(tip);
      }
    }
    for (const [id, entry] of incidentMarkers.current) {
      if (seen.has(id)) continue;
      (entry.sos ? gSos : gInc).removeLayer(entry.marker);
      incidentMarkers.current.delete(id);
    }
  }, [ready, incidents, freshIds, focus]);

  /* ── Bodycams (0054): who is wearing one, and the feed being watched ── */

  const [camHolders, setCamHolders] = useState<ReadonlyMap<string, { bodycamId: string; serial: string; silo: Silo }>>(() => new Map());
  const viewerRole = me.role;
  const viewerSilo = me.silo;
  useEffect(() => {
    if (!bodycams) return;
    let sb: ReturnType<typeof getBrowserSupabase>;
    try {
      sb = getBrowserSupabase();
    } catch {
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = () => {
      void listBodycamHolders(sb)
        .then((rows) => {
          if (!alive) return;
          setCamHolders(new Map(rows
            .filter((r) => canWatchBodycam({ role: viewerRole, silo: viewerSilo }, r.silo, 'live'))
            .map((r) => [r.userId, { bodycamId: r.bodycamId, serial: r.serial, silo: r.silo }])));
        })
        .catch(() => { /* before 0054 is run there are no bodycams to mark */ });
    };
    load();
    const off = subscribeBodycams(sb, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(load, 800);
    });
    return () => {
      alive = false;
      off();
      if (timer) clearTimeout(timer);
    };
  }, [bodycams, viewerRole, viewerSilo]);
  const camHoldersRef = useRef(camHolders);
  camHoldersRef.current = camHolders;

  /** The officer whose bodycam is open in the left-hand panel. */
  const [watching, setWatching] = useState<BodycamTarget | null>(null);
  const [lastReason, setLastReason] = useState<ViewReason | null>(null);

  /* ── Officers ─────────────────────────────────────────────────────── */

  // Staleness changes with time alone, so re-check it every minute.
  const [minute, setMinute] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setMinute((m) => m + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const L = lib.current;
    const g = groups.current.units;
    if (!ready || !L || !g) return;
    const now = Date.now();
    const seen = new Set<string>();
    for (const o of officers) {
      if (!hasPosition(o.lat, o.lng)) continue;
      seen.add(o.userId);
      const busy = Boolean(o.busyWith);
      // Offline (the phone has not reached the server for a few minutes) greys
      // the marker like an old position: where it stands is where they were.
      const since = offlineSince(o, now);
      const stale = isStale(o.seenAt, now) || Boolean(since);
      const cam = camHolders.get(o.userId) ?? null;
      const key = `${busy}|${stale}|${Boolean(cam)}`;
      const tip = M.unitTooltip(o, stale, cam?.serial, since);
      const entry = unitMarkers.current.get(o.userId);
      if (!entry) {
        const marker = L.marker([o.lat!, o.lng!], { icon: M.unitIcon(L, busy, stale, Boolean(cam)), keyboard: false, zIndexOffset: -100 });
        marker.bindTooltip(tip, { direction: 'top', opacity: 0.97 });
        const { userId, name } = o;
        marker.on('click', () => {
          const at = marker.getLatLng();
          const d = drawer.current;
          if (d) {
            if (d.placing) d.place({ lat: at.lat, lng: at.lng });
            return;
          }
          if (wallRef.current) focus(at.lat, at.lng);
          // Wearing a bodycam this viewer may watch: open it in the panel.
          const worn = camHoldersRef.current.get(userId);
          if (worn) {
            setSheet(null);
            setSelectedZoneId(null);
            setWatching({ bodycamId: worn.bodycamId, serial: worn.serial, officer: name || null });
          }
        });
        g.addLayer(marker);
        unitMarkers.current.set(o.userId, { marker, key });
      } else {
        entry.marker.setLatLng([o.lat!, o.lng!]);
        if (entry.key !== key) {
          entry.marker.setIcon(M.unitIcon(L, busy, stale, Boolean(cam)));
          entry.key = key;
        }
        entry.marker.setTooltipContent(tip);
      }
    }
    for (const [id, entry] of unitMarkers.current) {
      if (seen.has(id)) continue;
      g.removeLayer(entry.marker);
      unitMarkers.current.delete(id);
    }
  }, [ready, officers, minute, focus, camHolders]);

  /* ── Routes driven (0071) ─────────────────────────────────────────── */
  // Each on-duty officer's route since they went on duty, offline stretches
  // included once the phone has sent them. Read again every half minute
  // while the layer is on; the database decides whose routes come back.

  const routesOn = active.includes('routes');
  const [routes, setRoutes] = useState<DutyTrackPoint[]>([]);
  const crewKey = useMemo(() => officers.map((o) => o.userId).sort().join(','), [officers]);
  const routeOfficersRef = useRef(officers);
  routeOfficersRef.current = officers;

  /* ── Reference layers, fetched the first time they are switched on ── */

  const [crime, setCrime] = useState<{ year: string | null; stations: CrimeStation[] } | null>(null);
  const [hydrants, setHydrants] = useState<Hydrant[] | null>(null);
  const [cameras, setCameras] = useState<Camera[] | null>(null);
  const [facilities, setFacilities] = useState<Facility[] | null>(null);
  const [traffic, setTraffic] = useState<TrafficItem[] | null>(null);
  const [notes, setNotes] = useState<Partial<Record<MapLayerId, string>>>({});
  const loading = useRef(new Set<LayerId>());

  const note = useCallback((id: MapLayerId, text: string | null) => {
    setNotes((cur) => {
      const next = { ...cur };
      if (text) next[id] = text;
      else delete next[id];
      return next;
    });
  }, []);

  useEffect(() => {
    let sb: ReturnType<typeof getBrowserSupabase>;
    try {
      sb = getBrowserSupabase();
    } catch {
      return;
    }
    const load = <T,>(id: LayerId, have: unknown, run: () => Promise<T>, done: (v: T) => void) => {
      if (!active.includes(id) || have !== null || loading.current.has(id)) return;
      loading.current.add(id);
      run()
        .then((v) => { note(id, null); done(v); })
        .catch(() => note(id, 'Could not load — switch it off and on to retry.'))
        .finally(() => loading.current.delete(id));
    };
    load('crime', crime, () => listCrimeZones(sb), (r) => {
      setCrime(r);
      if (!r.stations.length) note('crime', 'No crime statistics loaded yet (pnpm db:load-crime).');
    });
    load('cameras', cameras, () => listCameras(sb), (rows) => {
      setCameras(rows);
      if (!rows.some((c) => hasPosition(c.latitude, c.longitude))) note('cameras', 'No registered camera has a position.');
    });
    load('facilities', facilities, () => fetchFeed('/api/external/pois'), (feed) => {
      if (feed.ok) {
        setFacilities(parseFacilities(feed.json));
      } else {
        note('facilities', feed.message);
        setFacilities([]);
      }
    });
  }, [active, crime, cameras, facilities, note]);

  /*
   * The outside overlays (catalogue.ts): pictures from /api/maps/tiles, or
   * features from /api/maps/features already coloured and worded by the
   * server. Each is fetched when switched on and again on its own schedule;
   * a source that does not answer leaves a note under its switch.
   */
  const opacityRef = useRef(opacity);
  opacityRef.current = opacity;
  const tRef = useRef(t);
  tRef.current = t;
  useEffect(() => {
    const map = mapRef.current;
    const L = lib.current;
    if (!ready || !map || !L) return;
    for (const o of CATALOGUE as readonly CatalogueOverlay[]) {
      const id = o.id as MapLayerId;
      const on = active.includes(id);
      const have = outside.current.get(o.id);
      if (!on && have) {
        if (have.timer) clearInterval(have.timer);
        have.layer.remove();
        outside.current.delete(o.id);
        note(id, null);
        continue;
      }
      if (!on || have) continue;
      const alpha = opacityRef.current[o.id] ?? o.opacity ?? 1;
      if (o.kind === 'tiles') {
        const layer = L.tileLayer(`/api/maps/tiles/${o.id}/{z}/{x}/{y}`, {
          opacity: alpha, zIndex: 7, maxZoom: 19, maxNativeZoom: o.maxNativeZoom ?? 12, attribution: escapeHtml(o.source),
        }).addTo(map);
        const timer = o.refreshMinutes ? setInterval(() => layer.redraw(), o.refreshMinutes * 60_000) : undefined;
        outside.current.set(o.id, { layer, timer });
        continue;
      }
      const renderer = canvas.current ?? undefined;
      const layer = L.geoJSON(undefined, {
        style: (f) => overlayStyle(f?.properties as OverlayFeatureProps | undefined, opacityRef.current[o.id] ?? 1),
        pointToLayer: (f, at) => L.circleMarker(at, {
          radius: (f.properties as OverlayFeatureProps).radius ?? 6, color: '#0f172a', weight: 1,
          fillColor: (f.properties as OverlayFeatureProps).colour, fillOpacity: 0.9, renderer,
        }),
        onEachFeature: (f, l) => {
          const props = f.properties as OverlayFeatureProps;
          l.bindPopup(overlayPopup(props, o, tRef.current));
          if (props.ward != null && props.outline) l.bindTooltip(escapeHtml(props.title), { sticky: true });
        },
      }).addTo(map);
      const load = () => fetch(`/api/maps/features/${o.id}`, { cache: 'no-store' })
        .then(async (r) => {
          const j = (await r.json().catch(() => null)) as { features?: unknown[]; note?: string; error?: string } | null;
          if (!r.ok || !j?.features) {
            note(id, j?.error ?? 'Could not load. It tries again in a few minutes.');
            return;
          }
          layer.clearLayers();
          layer.addData(j as Parameters<typeof layer.addData>[0]);
          note(id, j.note ?? (j.features.length ? null : 'Nothing to show here now.'));
        })
        .catch(() => note(id, 'Could not load. It tries again in a few minutes.'));
      void load();
      const timer = setInterval(load, (o.refreshMinutes ?? 24 * 60) * 60_000);
      outside.current.set(o.id, { layer, timer });
    }
  }, [ready, active, note]);

  // A change of see-through applies to what is on the map now.
  useEffect(() => {
    const L = lib.current;
    if (!L) return;
    for (const [id, o] of outside.current) {
      const def = catalogueOverlay(id);
      if (o.layer instanceof L.TileLayer) o.layer.setOpacity(opacity[id] ?? def?.opacity ?? 1);
      else o.layer.setStyle((f) => overlayStyle(f?.properties as OverlayFeatureProps | undefined, opacity[id] ?? 1));
    }
  }, [opacity]);

  // Hydrants: the city's whole register is about 34,000, so only those in
  // view are read, from street level, again each time the map stops moving.
  const hydrantsOn = active.includes('hydrants');
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !hydrantsOn) return;
    let sb: ReturnType<typeof getBrowserSupabase>;
    try {
      sb = getBrowserSupabase();
    } catch {
      return;
    }
    let asked = 0;
    let wait: ReturnType<typeof setTimeout> | undefined;
    const read = () => {
      const ask = ++asked;
      if (map.getZoom() < HYDRANT_MIN_ZOOM) {
        setHydrants([]);
        note('hydrants', 'Zoom in to street level to see hydrants.');
        return;
      }
      const b = map.getBounds().pad(0.2);
      listHydrantsInArea(sb, { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() })
        .then((rows) => {
          if (ask !== asked) return;
          setHydrants(rows);
          note('hydrants', rows.length ? null : 'No hydrants on the register here.');
        })
        .catch(() => { if (ask === asked) note('hydrants', 'Could not load — switch it off and on to retry.'); });
    };
    const later = () => { clearTimeout(wait); wait = setTimeout(read, 300); };
    read();
    map.on('moveend', later);
    return () => {
      asked++;
      clearTimeout(wait);
      map.off('moveend', later);
      setHydrants(null);
    };
  }, [ready, hydrantsOn, note]);

  // Aircraft every half minute, ships every minute, while switched on (0113).
  const [aircraft, setAircraft] = useState<Aircraft[] | null>(null);
  const [vessels, setVessels] = useState<Vessel[] | null>(null);
  const flightsOn = active.includes('flights');
  const vesselsOn = active.includes('vessels');
  useEffect(() => {
    if (!flightsOn) return;
    let alive = true;
    // Open data is named on the map while it is shown (its licence, ODbL).
    let credit: string | null = null;
    const load = async () => {
      const feed = await fetchFeed('/api/external/flights');
      if (!alive) return;
      if (!feed.ok) { note('flights', feed.message); setAircraft([]); return; }
      const source = (feed.json as { source?: unknown })?.source;
      if (typeof source === 'string' && !credit) {
        credit = `Aircraft &copy; ${escapeHtml(source)}`;
        mapRef.current?.attributionControl?.addAttribution(credit);
      }
      const rows = parseAircraft(feed.json);
      note('flights', rows.length ? null : 'No aircraft in view right now.');
      setAircraft(rows);
    };
    void load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
      if (credit) mapRef.current?.attributionControl?.removeAttribution(credit);
    };
  }, [flightsOn, note]);
  useEffect(() => {
    if (!vesselsOn) return;
    let alive = true;
    let soon: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      const feed = await fetchFeed('/api/external/vessels');
      if (!alive) return;
      if (!feed.ok) { note('vessels', feed.message); setVessels([]); return; }
      const rows = parseVessels(feed.json);
      // Just switched on: ships report every few seconds to three minutes, so look again soon.
      const warming = (feed.json as { warming?: unknown })?.warming === true;
      note('vessels', rows.length ? null : warming ? 'Ships appear over the next few minutes.' : 'No ships reported right now.');
      setVessels(rows);
      if (warming) soon = setTimeout(load, 15_000);
    };
    void load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); if (soon) clearTimeout(soon); };
  }, [vesselsOn, note]);
  useEffect(() => {
    const L = lib.current;
    const g = groups.current.flights;
    if (!ready || !L || !g || !aircraft) return;
    g.clearLayers();
    for (const a of aircraft) {
      L.marker([a.lat, a.lng], { icon: aircraftIcon(L, a), keyboard: false, zIndexOffset: 300 })
        .bindTooltip(aircraftTooltip(a), { direction: 'top', opacity: 0.97 }).addTo(g);
    }
  }, [ready, aircraft]);
  useEffect(() => {
    const L = lib.current;
    const g = groups.current.vessels;
    if (!ready || !L || !g || !vessels) return;
    g.clearLayers();
    for (const v of vessels) {
      L.marker([v.lat, v.lng], { icon: vesselIcon(L, v), keyboard: false, zIndexOffset: 200 })
        .bindTooltip(vesselTooltip(v), { direction: 'top', opacity: 0.97 }).addTo(g);
    }
  }, [ready, vessels]);
  const shelterKey = shelters.map((x) => `${x.id}:${x.people}:${x.capacity}`).join(',');
  useEffect(() => {
    const L = lib.current;
    const g = groups.current.shelters;
    if (!ready || !L || !g) return;
    g.clearLayers();
    for (const x of shelters) {
      L.marker([x.lat, x.lng], { icon: shelterIcon(L, x), keyboard: false, zIndexOffset: 400 })
        .bindTooltip(shelterTooltip(x), { direction: 'top', opacity: 0.97 }).addTo(g);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, shelterKey]);

  // Traffic changes by the minute: reload every five while it is on.
  const trafficOn = active.includes('traffic');
  useEffect(() => {
    if (!trafficOn) return;
    let alive = true;
    const load = async () => {
      const feed = await fetchFeed('/api/external/traffic');
      if (!alive) return;
      if (!feed.ok) {
        note('traffic', feed.message);
        setTraffic([]);
        return;
      }
      note('traffic', null);
      setTraffic(parseTraffic(feed.json));
    };
    void load();
    const t = setInterval(load, 5 * 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [trafficOn, note]);

  useEffect(() => {
    if (!routesOn || !crewKey) {
      setRoutes([]);
      return;
    }
    let sb: ReturnType<typeof getBrowserSupabase>;
    try {
      sb = getBrowserSupabase();
    } catch {
      return;
    }
    let alive = true;
    const load = () => {
      const starts = routeOfficersRef.current
        .map((o) => o.onDutySince)
        .filter((t): t is string => Boolean(t))
        .sort((a, b) => Date.parse(a) - Date.parse(b));
      void listDutyTracks(sb, { since: starts[0] ?? null, userIds: crewKey.split(',') })
        .then((rows) => {
          if (!alive) return;
          setRoutes(rows);
          note('routes', null);
        })
        .catch(() => { if (alive) note('routes', 'Routes could not load. They try again in a moment.'); });
    };
    load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [routesOn, crewKey, note]);

  useEffect(() => {
    const L = lib.current;
    const g = groups.current.routes;
    if (!ready || !L || !g) return;
    g.clearLayers();
    if (!routes.length) return;
    const byOfficer = new Map<string, DutyTrackPoint[]>();
    for (const r of routes) {
      const list = byOfficer.get(r.userId);
      if (list) list.push(r);
      else byOfficer.set(r.userId, [r]);
    }
    for (const o of officers) {
      const since = o.onDutySince ? Date.parse(o.onDutySince) : Number.NEGATIVE_INFINITY;
      const mine = (byOfficer.get(o.userId) ?? []).filter((r) => Date.parse(r.at) >= since);
      const colour = ROUTE_COLOUR[o.silo] ?? '#a78bfa';
      for (const seg of routeSegments(mine)) {
        L.polyline(seg.points, {
          color: colour,
          weight: seg.offline ? 3 : 4,
          opacity: seg.offline ? 0.9 : 0.7,
          dashArray: seg.offline ? '6 8' : undefined,
          lineCap: 'round',
          lineJoin: 'round',
          renderer: canvas.current ?? undefined,
        }).bindTooltip(M.routeTooltip(o, seg), { sticky: true, opacity: 0.97 }).addTo(g);
      }
    }
  }, [ready, routes, officers]);

  const crimeYear = crime?.year ?? null;
  const crimeCircles = useMemo(() => (crime ? crimeZones(crime.stations, crimeKind) : []), [crime, crimeKind]);

  useEffect(() => {
    const L = lib.current;
    const g = groups.current.crime;
    if (!ready || !L || !g) return;
    g.clearLayers();
    for (const c of crimeCircles) {
      L.circle([c.lat, c.lng], {
        radius: c.radius, color: c.colour, weight: 1.5, opacity: 0.8,
        fillColor: c.colour, fillOpacity: 0.1 + 0.32 * c.share, renderer: canvas.current ?? undefined,
      })
        .bindTooltip(M.crimeTooltip(c, crimeKind, crimeYear, crimeCircles.length), { sticky: true, opacity: 0.97 })
        .addTo(g);
    }
  }, [ready, crimeCircles, crimeKind, crimeYear]);

  useEffect(() => {
    const L = lib.current;
    const g = groups.current.hydrants;
    if (!ready || !L || !g) return;
    g.clearLayers();
    for (const h of hydrants ?? []) {
      if (!hasPosition(h.latitude, h.longitude)) continue;
      const colour = HYDRANT_COLOUR[h.status] ?? '#38bdf8';
      L.circleMarker([h.latitude, h.longitude], {
        radius: 4.5, weight: 1.5, color: '#ffffff', fillColor: colour, fillOpacity: 0.95,
        renderer: canvas.current ?? undefined,
      }).bindTooltip(M.hydrantTooltip(h), { direction: 'top', opacity: 0.97 }).addTo(g);
    }
  }, [ready, hydrants]);

  useEffect(() => {
    const L = lib.current;
    const g = groups.current.cameras;
    if (!ready || !L || !g || !cameras) return;
    g.clearLayers();
    for (const c of cameras) {
      if (!hasPosition(c.latitude, c.longitude) || c.blocked) continue;
      L.circleMarker([c.latitude!, c.longitude!], {
        radius: 4.5, weight: 1.5, color: '#0f172a', fillColor: '#2dd4bf', fillOpacity: 0.95,
        renderer: canvas.current ?? undefined,
      }).bindTooltip(M.cameraTooltip(c), { direction: 'top', opacity: 0.97 }).addTo(g);
    }
  }, [ready, cameras]);

  useEffect(() => {
    const L = lib.current;
    const g = groups.current.facilities;
    if (!ready || !L || !g || !facilities) return;
    g.clearLayers();
    for (const f of facilities) {
      L.marker([f.lat, f.lng], { icon: M.facilityIcon(L, f), keyboard: false, zIndexOffset: -200 })
        .bindTooltip(M.facilityTooltip(f), { direction: 'top', opacity: 0.97 })
        .addTo(g);
    }
  }, [ready, facilities]);

  useEffect(() => {
    const L = lib.current;
    const g = groups.current.traffic;
    if (!ready || !L || !g || !traffic) return;
    g.clearLayers();
    for (const t of traffic) {
      const tip = M.trafficTooltip(t);
      const layer = t.points.length > 1
        ? L.polyline(t.points, { color: '#fb923c', weight: 5, opacity: 0.85, dashArray: '8 6', renderer: canvas.current ?? undefined })
        : L.circleMarker(t.points[0]!, { radius: 5, weight: 2, color: '#fff7ed', fillColor: '#fb923c', fillOpacity: 1, renderer: canvas.current ?? undefined });
      layer.bindTooltip(tip, { sticky: true, opacity: 0.97 }).addTo(g);
    }
  }, [ready, traffic]);

  /* ── Framing: fit once, then follow the incidents when asked ──────── */

  const officersRef = useRef(officers);
  officersRef.current = officers;
  const fitted = useRef(false);

  const fit = useCallback(() => {
    const map = mapRef.current;
    const L = lib.current;
    if (!map || !L) return;
    let points: Array<[number, number]> = incidents
      .filter((i) => hasPosition(i.location_lat, i.location_lng))
      .map((i) => [i.location_lat, i.location_lng]);
    if (!points.length) {
      points = officersRef.current.filter((o) => hasPosition(o.lat, o.lng)).map((o) => [o.lat!, o.lng!]);
    }
    if (!points.length) {
      map.setView(DURBAN, 11);
      return;
    }
    map.fitBounds(L.latLngBounds(points).pad(0.2), { maxZoom: 14 });
  }, [incidents]);

  useEffect(() => {
    if (!ready) return;
    if (!fitted.current) {
      fitted.current = true;
      // Opened to draw for one call: start close in on it, at a zoom fit for placing points.
      const call = drawForIncidentId ? incidents.find((i) => i.id === drawForIncidentId) : undefined;
      if (call && hasPosition(call.location_lat, call.location_lng)) {
        mapRef.current?.setView([call.location_lat, call.location_lng], 17);
      } else {
        fit();
      }
      return;
    }
    // Never move the map out from under someone drawing.
    if (follow && !drawer.current && Date.now() - lastTouch.current > HANDS_OFF_MS) fit();
  }, [ready, fit, follow]);

  const toggleFollow = () => {
    // Switching it on frames the calls now, even if the map was just handled.
    if (!follow) lastTouch.current = 0;
    setFollow(!follow);
  };

  /* ── Perimeters and zones ─────────────────────────────────────────── */

  const { zones, loaded: zonesLoaded, unavailable: zonesUnavailable, reload: reloadZones } = useLiveZones();
  const zonesRef = useRef(zones);
  zonesRef.current = zones;
  const canDraw = canDrawMapZones(me.role) && !onlyMine;
  const deptName = useCallback((s: Silo) => DEPARTMENT_NAMES[s] ?? s, []);
  const [drawSnap, setDrawSnap] = useState<DrawSnapshot | null>(null);
  const [editing, setEditing] = useState<{ mode: 'new' | 'edit'; zoneId: string | null; init: ZoneFormInit } | null>(null);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(focusZoneId);
  const selectedZone = zones.find((z) => z.id === selectedZoneId) ?? null;
  const editingZoneId = editing?.zoneId ?? null;

  const editorIncidents: EditorIncident[] = useMemo(() => incidents
    .filter((i) => hasPosition(i.location_lat, i.location_lng))
    .map((i) => ({
      id: i.id, number: i.incident_number, type: i.incident_type, address: i.location_address,
      lat: i.location_lat, lng: i.location_lng,
    })), [incidents]);

  const stopDrawing = useCallback(() => {
    drawer.current?.destroy();
    drawer.current = null;
    setDrawSnap(null);
    setEditing(null);
  }, []);

  const startDrawing = (shape: MapZoneShape) => {
    const L = lib.current;
    const map = mapRef.current;
    if (!L || !map || drawer.current) return;
    setSheet(null);
    setSelectedZoneId(null);
    drawer.current = new ZoneDrawController({
      L, map, shape, colour: kindsForShape(shape)[0]!.colour, emit: setDrawSnap, onCancel: stopDrawing,
    });
    setEditing({
      mode: 'new',
      zoneId: null,
      init: {
        kind: null, name: '', reason: '', incidentId: drawForIncidentId, visibility: null,
        sharedSilos: [], activeUntil: null,
      },
    });
  };

  const editZone = (zone: LiveMapZone) => {
    const L = lib.current;
    const map = mapRef.current;
    if (!L || !map) return;
    drawer.current?.destroy();
    setSelectedZoneId(null);
    drawer.current = new ZoneDrawController({
      L, map, shape: zone.shape, colour: zoneKind(zone.kind).colour, emit: setDrawSnap, onCancel: stopDrawing,
      existing: { points: fromGeometry(zone.shape, zone.geometry), radiusM: zone.radius_m },
    });
    setEditing({
      mode: 'edit',
      zoneId: zone.id,
      init: {
        kind: zone.kind, name: zone.name, reason: zone.reason ?? '', incidentId: zone.incident_id,
        visibility: zone.visibility, sharedSilos: zone.shared_silos, activeUntil: zone.active_until,
      },
    });
  };

  const recolour = useCallback((kind: MapZoneKind) => drawer.current?.setColour(zoneKind(kind).colour), []);
  const moveDrawingTo = useCallback((p: LatLng) => {
    drawer.current?.setPosition(p);
    const map = mapRef.current;
    if (map && !map.getBounds().contains(p)) map.panTo(p);
  }, []);
  const setDrawingRadius = useCallback((m: number) => drawer.current?.setRadius(m), []);

  /** A zone just saved here: its card opens once the live list has it. */
  const awaitingZone = useRef<string | null>(null);

  const saveZone = async (draft: ZoneDraft) => {
    const result = await saveZoneAction(editingZoneId, draft);
    if (result.ok) {
      stopDrawing();
      awaitingZone.current = result.id;
      setSelectedZoneId(result.id);
      reloadZones();
    }
    return result;
  };

  /** Bring a zone into view and open its card. */
  const focusZone = useCallback((id: string) => {
    setSelectedZoneId(id);
    setSheet(null);
    const L = lib.current;
    const map = mapRef.current;
    const zone = zonesRef.current.find((z) => z.id === id);
    const bounds = L && zone ? zoneBounds(L, zone) : null;
    if (!map || !bounds) return;
    lastTouch.current = Date.now();
    map.flyToBounds(bounds.pad(0.35), { maxZoom: 17, duration: 0.6 });
  }, []);

  // A link to one zone (a console notice, the incident page) opens on it.
  const linkedFocusDone = useRef(false);
  useEffect(() => {
    if (!ready || linkedFocusDone.current || !focusZoneId || !zones.some((z) => z.id === focusZoneId)) return;
    linkedFocusDone.current = true;
    focusZone(focusZoneId);
  }, [ready, zones, focusZoneId, focusZone]);

  // A zone stood down, expired or no longer shared elsewhere closes its card here
  // — but not one just saved here that the live list has not caught up with yet.
  useEffect(() => {
    if (!zonesLoaded || !selectedZoneId) return;
    if (zones.some((z) => z.id === selectedZoneId)) {
      if (awaitingZone.current === selectedZoneId) awaitingZone.current = null;
    } else if (awaitingZone.current !== selectedZoneId) {
      setSelectedZoneId(null);
    }
  }, [zonesLoaded, zones, selectedZoneId]);

  useEffect(() => {
    const L = lib.current;
    const g = groups.current.zones;
    if (!ready || !L || !g) return;
    drawZones(L, g, zones, {
      selectedId: selectedZoneId,
      hiddenId: editingZoneId,
      isDrawing: () => Boolean(drawer.current),
      onSelect: (id) => {
        setSelectedZoneId(id);
        setSheet(null);
      },
      onSnap: (p) => {
        if (drawer.current?.placing) drawer.current.place(p);
      },
    });
  }, [ready, zones, selectedZoneId, editingZoneId]);

  // One panel on the left at a time: opening layers, a zone or a drawing closes the feed.
  useEffect(() => {
    if (editing || selectedZoneId || sheet) setWatching(null);
  }, [editing, selectedZoneId, sheet]);

  /* ── Wall display ─────────────────────────────────────────────────── */

  const enterWall = useCallback(() => {
    setWall(true);
    setFollow(true);
    setSheet(null);
    const root = document.documentElement;
    if (!document.fullscreenElement && root.requestFullscreen) {
      root.requestFullscreen().catch(() => { /* refused or unsupported: the overlay still covers the page */ });
    }
  }, []);

  const exitWall = useCallback(() => {
    setWall(false);
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  // Leaving the browser's full screen (Esc) leaves the wall with it.
  useEffect(() => {
    const onChange = () => {
      const fs = Boolean(document.fullscreenElement);
      setNativeFs(fs);
      if (!fs && wallRef.current) setWall(false);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // F toggles the wall; Esc leaves an overlay-only wall (a kiosk link).
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.repeat) return;
      const t = ev.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      if (drawer.current) return;
      if (ev.key === 'f' || ev.key === 'F') {
        ev.preventDefault();
        if (wallRef.current) exitWall();
        else enterWall();
      } else if (ev.key === 'Escape' && wallRef.current && !document.fullscreenElement) {
        exitWall();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enterWall, exitWall]);

  // While on the wall: no page scroll, the screen stays awake, the map refits its new size.
  useEffect(() => {
    const map = mapRef.current;
    const settle = [setTimeout(() => map?.invalidateSize(), 60), setTimeout(() => map?.invalidateSize(), 400)];
    if (!wall) return () => { for (const t of settle) clearTimeout(t); };

    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // The browser drops the lock whenever the tab is hidden; take it again on return.
    let lock: WakeLockLike | null = null;
    let left = false;
    const acquire = () => {
      wakeLock()?.request('screen').then((l) => {
        if (left) void l.release().catch(() => {});
        else lock = l;
      }).catch(() => {});
    };
    acquire();
    const onVisible = () => { if (document.visibilityState === 'visible') acquire(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      left = true;
      for (const t of settle) clearTimeout(t);
      document.body.style.overflow = overflow;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => {});
    };
  }, [wall]);

  // Controls and cursor fade when the mouse is still; the map and HUD stay.
  useEffect(() => {
    if (!wall) {
      setIdle(false);
      return;
    }
    let t: ReturnType<typeof setTimeout> | undefined;
    const wake = () => {
      setIdle(false);
      if (t) clearTimeout(t);
      t = setTimeout(() => setIdle(true), IDLE_MS);
    };
    wake();
    const events = ['pointermove', 'pointerdown', 'keydown'] as const;
    for (const ev of events) window.addEventListener(ev, wake);
    return () => {
      if (t) clearTimeout(t);
      for (const ev of events) window.removeEventListener(ev, wake);
    };
  }, [wall]);

  /* ── Render ───────────────────────────────────────────────────────── */

  const summary = summariseIncidents(incidents);
  const placedOfficers = officers.filter((o) => hasPosition(o.lat, o.lng)).length;
  const overlays = active.length;

  return (
    <div
      className={cn(
        'ops-map relative isolate overflow-hidden bg-[#0b1220]',
        wall ? 'fixed inset-0 z-[60]' : 'rounded-lg border border-border',
      )}
      style={wall ? undefined : { height }}
      data-wall={wall}
      data-idle={wall && idle && !sheet && !selectedZoneId && !editing && !watching}
    >
      <div ref={el} className="absolute inset-0" role="region" aria-label={t('Live operations map')} />

      {/* Top row: controls on the left, wall title and counts on the right. */}
      <div className="pointer-events-none absolute inset-x-3 top-3 z-[5] flex flex-row-reverse items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-start justify-end gap-2">
          {wall ? (
            <>
              <WallTitle scopeLabel={scopeLabel} />
              <Stat label={t('Live incidents')} value={summary.live} />
              <Stat label={t('Critical / high')} value={summary.urgent} tone={summary.urgent ? 'urgent' : undefined} />
              {summary.sos > 0 && <Stat label={t('SOS active')} value={summary.sos} tone="sos" />}
              <Stat
                label={t('Officers on duty')}
                value={officers.length}
                detail={placedOfficers < officers.length ? `${placedOfficers} on the map` : undefined}
              />
              <WeatherStat weather={weather} />
            </>
          ) : (
            summary.sos > 0 && (
              <span className="ops-glass pointer-events-auto inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-red-300">
                <Siren className="h-4 w-4 animate-pulse" /> {' '}{t('{sos} SOS active', { sos: summary.sos })}</span>
            )
          )}
        </div>

        <div className="ops-map-chrome pointer-events-auto flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => { setSelectedZoneId(null); setSheet((v) => (v === 'zones' ? null : 'zones')); }}
            aria-expanded={sheet === 'zones'}
            title={t('Perimeters and zones in force')}
            className="ops-glass ops-btn"
          >
            <Shapes className="h-4 w-4" /> {' '}{t('Perimeters')}<span className="rounded bg-white/15 px-1.5 text-[10px] tabular-nums">{zones.length}</span>
          </button>
          <button
            type="button"
            onClick={() => { setSelectedZoneId(null); setSheet((v) => (v === 'layers' ? null : 'layers')); }}
            aria-expanded={sheet === 'layers'}
            className="ops-glass ops-btn"
          >
            <Layers className="h-4 w-4" /> {' '}{t('Layers')}<span className="rounded bg-white/15 px-1.5 text-[10px] tabular-nums">{overlays}</span>
          </button>
          <fieldset className="ops-glass flex rounded-lg p-0.5">
            <legend className="sr-only">{t('Basemap')}</legend>
            {BASEMAPS.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setBasemap(b)}
                aria-pressed={basemap === b}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-semibold transition-colors',
                  basemap === b ? 'bg-white text-slate-900' : 'text-slate-200 hover:bg-white/10',
                )}
              >
                {BASEMAP_LABEL[b]}
              </button>
            ))}
          </fieldset>
          <button
            type="button"
            onClick={toggleFollow}
            aria-pressed={follow}
            title={follow
              ? 'Keeping every open call in view (pauses for a minute when you move the map)'
              : 'Keep every open call in view as calls come and go'}
            className={cn('ops-glass ops-btn', follow && 'text-sky-300')}
          >
            <Crosshair className="h-4 w-4" /> {follow ? 'Following' : 'Follow'}
          </button>
          <button
            type="button"
            onClick={wall ? exitWall : enterWall}
            disabled={Boolean(editing)}
            title={editing
              ? 'Finish or cancel the drawing first'
              : wall ? 'Leave the wall display (F or Esc)' : 'Full screen wall display (F)'}
            className="ops-btn rounded-lg bg-sky-500 text-slate-950 shadow-lg hover:bg-sky-400 disabled:opacity-50"
          >
            {wall ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            {wall ? 'Exit' : 'Full screen'}
          </button>
        </div>
      </div>

      {editing && drawSnap?.phase === 'placing' && (
        <PlacingBar
          snapshot={drawSnap}
          onFinish={() => drawer.current?.finish()}
          onUndo={() => drawer.current?.undo()}
          onCancel={stopDrawing}
        />
      )}

      {/* One panel on the left at a time: the drawing's form, a zone's card, a bodycam, the zones, or the layers. */}
      {editing ? (
        drawSnap?.phase === 'editing' && (
          <ZoneEditor
            key={editing.zoneId ?? 'new'}
            mode={editing.mode}
            snapshot={drawSnap}
            init={editing.init}
            incidents={editorIncidents}
            mySilo={me.silo}
            deptName={deptName}
            onKind={recolour}
            onPosition={moveDrawingTo}
            onRadius={setDrawingRadius}
            onSave={saveZone}
            onCancel={stopDrawing}
          />
        )
      ) : selectedZone ? (
        <ZoneCard
          key={selectedZone.id}
          zone={selectedZone}
          me={me}
          deptName={deptName}
          onClose={() => setSelectedZoneId(null)}
          onEdit={() => editZone(selectedZone)}
          onEnded={() => {
            setSelectedZoneId(null);
            reloadZones();
          }}
        />
      ) : watching ? (
        <BodycamViewer
          key={watching.bodycamId}
          target={watching}
          kind="live"
          tone="map"
          defaultReason={lastReason}
          onReason={setLastReason}
          onClose={() => setWatching(null)}
          className="ops-map-chrome absolute left-3 top-16 z-[7] w-[26rem] max-w-[calc(100%-1.5rem)] shadow-2xl"
        />
      ) : sheet === 'zones' ? (
        <ZonesList
          zones={zones}
          meId={me.id}
          deptName={deptName}
          unavailable={zonesUnavailable}
          onPick={focusZone}
          onClose={() => setSheet(null)}
        />
      ) : sheet === 'layers' ? (
        <LayerPanel
          available={available}
          isOn={isOn}
          toggle={toggle}
          notes={zonesUnavailable ? { ...notes, zones: zonesUnavailable } : notes}
          weatherOff={weatherOff}
          crimeKind={crimeKind}
          setCrimeKind={setCrimeKind}
          crimeYear={crimeYear}
          opacity={opacity}
          setOpacity={setOpacity}
          onReset={resetLayers}
          onClose={() => setSheet(null)}
        />
      ) : null}

      {canDraw && ready && !wall && (
        <DrawToolbar
          active={editing ? (drawSnap?.shape ?? null) : null}
          onPick={startDrawing}
          disabled={zonesUnavailable}
        />
      )}

      {banner && !editing && (
        // On the wall the counts fill the top, so the banner sits above the legend.
        <div className={cn(
          'pointer-events-none absolute inset-x-0 z-[6] flex justify-center px-3',
          wall ? 'bottom-14' : 'top-16',
        )}>
          <div className="alert-modal-enter ops-glass pointer-events-auto flex max-w-xl items-center gap-3 rounded-xl px-4 py-2.5">
            <span
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ background: SEVERITY_COLOUR[banner.incident_severity] ?? SEVERITY_COLOUR.Medium }}
            />
            <div className="min-w-0 text-sm">
              <p className="font-bold uppercase tracking-wider text-sky-300">
                {t('New call · {value}', { value: banner.incident_number })}
              </p>
              <p className="truncate text-slate-100">
                {banner.incident_type} · {banner.incident_severity} · {banner.location_address}
              </p>
            </div>
            <button type="button" onClick={() => setBanner(null)} aria-label={t('Dismiss')} className="ml-1 text-slate-300 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <Legend isOn={isOn} wall={wall} unplaced={summary.unplaced} crimeYear={crimeYear} bodycams={camHolders.size > 0}
        outside={(CATALOGUE as readonly CatalogueOverlay[]).filter((o) => active.includes(o.id as MapLayerId))} />

      {wall && !nativeFs && (
        <p className="ops-map-chrome ops-glass pointer-events-none absolute bottom-3 left-1/2 z-[5] -translate-x-1/2 rounded-md px-3 py-1 text-xs text-slate-300">
          {t('F11 for edge-to-edge · Esc to leave')}</p>
      )}

      {sosSpot && sosHere.length && !wall ? (
        <div className="ops-map-chrome absolute left-1/2 top-14 z-[6] w-[min(92%,26rem)] -translate-x-1/2 rounded-xl border-2 border-severity-critical bg-bg-card p-4 text-fg shadow-2xl">
          <div className="flex items-start justify-between gap-2">
            <p className="flex items-center gap-2 font-bold text-severity-critical-ink">
              <Siren className="h-5 w-5 animate-pulse" />
              {sosHere.length === 1 ? t('SOS') : t('{n} SOS here', { n: sosHere.length })}
            </p>
            <button type="button" onClick={() => setSosSpot(null)} aria-label={t('Close')} className="rounded-md p-1 hover:bg-muted"><X className="h-4 w-4" /></button>
          </div>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">{sosHere[0]!.location_address}</p>
          <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto">
            {sosHere.map((i) => (
              <li key={i.id} className="rounded-lg border border-border p-2.5">
                <p className="truncate text-sm font-bold">{i.caller_name ?? i.responding_officer ?? t('Officer')}</p>
                <p className="text-xs text-muted-foreground">{i.incident_number} · {timeAgo(i.incident_created_at)} · {i.status}</p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button" onClick={() => routerRef.current.push(`/incidents/${i.id}`)}
                    className="h-9 flex-1 rounded-lg bg-severity-critical px-3 text-sm font-bold text-white"
                  >
                    {t('Open the call')}
                  </button>
                  <DismissSos
                    incidentId={i.id} className="h-9 flex-1"
                    label={t("{value}'s SOS", { value: i.caller_name ?? 'the officer' })}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {routing && liveRoutes ? (
        <DispatchMapModal
          incident={{
            id: routing.id, number: routing.incident_number, type: routing.incident_type,
            severity: routing.incident_severity, address: routing.location_address,
            lat: routing.location_lat, lng: routing.location_lng,
          }}
          initialOfficers={officers}
          canAssign={liveRoutes.canAssign}
          onClose={() => setRoutingId(null)}
        />
      ) : null}
    </div>
  );
}

/* ── Outside overlays ───────────────────────────────────────────────── */

/** An area or line from an outside overlay: its own colour; outlines stay clickable inside. */
function overlayStyle(p: OverlayFeatureProps | undefined, alpha: number): Leaflet.PathOptions {
  const colour = p?.colour ?? '#38bdf8';
  return p?.outline
    ? { color: colour, weight: 2, opacity: Math.max(alpha, 0.6), fillColor: colour, fillOpacity: 0.02 }
    : { color: colour, weight: 1, opacity: Math.max(alpha, 0.5), fillColor: colour, fillOpacity: 0.45 * alpha };
}

/** The pop-up: what it is, a line or two, and where it comes from. Our own pages open here; outside ones in a new tab. */
function overlayPopup(p: OverlayFeatureProps, o: CatalogueOverlay, t: (s: string, v?: Record<string, string | number>) => string): string {
  const lines = (p.lines ?? []).filter(Boolean).map((l) => `<div>${escapeHtml(l)}</div>`).join('');
  const link = !p.url ? ''
    : p.url.startsWith('/') ? `<a href="${escapeHtml(p.url)}">${escapeHtml(t('Open'))}</a>`
      : `<a href="${escapeHtml(p.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(t('More'))}</a>`;
  return `<div style="min-width:12rem;max-width:18rem"><strong>${escapeHtml(p.title)}</strong>${lines}`
    + `<div style="margin-top:4px;font-size:11px;opacity:.75">${escapeHtml(t(o.label))}${link ? ` · ${link}` : ''}</div></div>`;
}

/** The legend's entries for the outside overlays switched on, each colour once. */
function legendItems(outside: readonly CatalogueOverlay[]): LegendItem[] {
  const seen = new Set<string>();
  return outside.flatMap((o) => o.legend).filter((x) => {
    const k = `${x.colour}-${x.label}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/* ── Pieces ─────────────────────────────────────────────────────────── */

function WallTitle({ scopeLabel }: { scopeLabel: string }) {
  const { t } = useT();
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="ops-glass rounded-xl px-4 py-2.5">
      <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.25em] text-sky-300">
        <span className="live-dot" /> {' '}{t('Live operations')}</p>
      <p className="mt-0.5 font-mono text-3xl font-bold tabular-nums text-white">
        {now ? SA_CLOCK.format(now) : '--:--:--'}
      </p>
      <p className="text-xs text-slate-300">
        {now ? SA_DATE.format(now) : ''} · {scopeLabel}
      </p>
    </div>
  );
}

function Stat({ label, value, detail, tone }: {
  label: string; value: number; detail?: string; tone?: 'urgent' | 'sos';
}) {
  return (
    <div className={cn('ops-glass min-w-[7.5rem] rounded-xl px-4 py-2.5', tone === 'sos' && 'ops-stat-sos')}>
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-300">{label}</p>
      <p className={cn(
        'mt-0.5 text-3xl font-bold tabular-nums',
        tone === 'urgent' ? 'text-orange-400' : tone === 'sos' ? 'text-red-400' : 'text-white',
      )}>
        {value}
      </p>
      {detail && <p className="text-xs text-slate-400">{detail}</p>}
    </div>
  );
}

function WeatherStat({ weather }: { weather: WeatherNow | null }) {
  const { t } = useT();
  if (!weather?.configured || weather.error || weather.tempC == null) return null;
  const kmh = weather.windSpeedMs != null ? Math.round(weather.windSpeedMs * 3.6) : null;
  return (
    <div className="ops-glass rounded-xl px-4 py-2.5">
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-300">{t('Durban weather')}</p>
      <p className="mt-0.5 text-3xl font-bold tabular-nums text-white">{Math.round(weather.tempC)}°</p>
      <p className="flex items-center gap-1 text-xs capitalize text-slate-300">
        {kmh != null && (
          <>
            <Wind className="h-3 w-3" /> {' '}{t('{kmh} km/h {compass} ·', { kmh, compass: compass(weather.windDeg) })}{' '}
          </>
        )}
        {weather.description}
      </p>
    </div>
  );
}

type PanelRow = {
  id: MapLayerId; label: string; group: string; hint: string; about: string; source: string; sourceUrl: string;
  keywords: string; tiles: boolean; legend: readonly LegendItem[];
};

/**
 * The layers, one list: the map's own and, on the Disaster maps, the outside
 * overlays. A search box (flood, ward, fire…), a chip for each group, what is
 * on now at the top with a quick off, and for each layer its (i) (what it
 * shows and where it comes from), its note if it did not load, its legend
 * and, for the pictures, how see-through it is.
 */
function LayerPanel({
  available, isOn, toggle, notes, weatherOff, crimeKind, setCrimeKind, crimeYear, opacity, setOpacity, onReset, onClose,
}: {
  available: MapLayerId[];
  isOn: (id: MapLayerId) => boolean;
  toggle: (id: MapLayerId) => void;
  notes: Partial<Record<MapLayerId, string>>;
  weatherOff: boolean;
  crimeKind: CrimeKind;
  setCrimeKind: (k: CrimeKind) => void;
  crimeYear: string | null;
  opacity: Record<string, number>;
  setOpacity: (id: string, v: number) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('');
  const rows = useMemo<PanelRow[]>(() => [
    ...LAYERS.filter((l) => available.includes(l.id)).map((l) => ({
      id: l.id as MapLayerId, label: l.label, group: l.group as string, hint: l.hint, about: l.hint, source: '', sourceUrl: '',
      keywords: '', tiles: isWeatherLayer(l.id) || l.id === 'radar', legend: [],
    })),
    ...(CATALOGUE as readonly CatalogueOverlay[]).filter((o) => available.includes(o.id as MapLayerId)).map((o) => ({
      id: o.id as MapLayerId, label: o.label, group: o.group as string, hint: o.hint, about: o.about, source: o.source,
      sourceUrl: o.sourceUrl, keywords: o.keywords, tiles: o.kind === 'tiles', legend: o.legend,
    })),
  ], [available]);
  const groups = [...new Set(rows.map((r) => r.group))];
  const shown = rows.filter((r) => (!group || r.group === group) && matchesSearch(r, q));
  const on = rows.filter((r) => isOn(r.id));
  const outsideIds = new Set<string>(CATALOGUE.map((o) => o.id));

  return (
    <div className="ops-map-chrome ops-glass absolute left-3 top-16 z-[6] flex max-h-[calc(100%-5.5rem)] w-[23rem] max-w-[calc(100%-1.5rem)] flex-col rounded-xl text-slate-100 shadow-2xl">
      <div className="space-y-2 border-b border-white/10 p-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-300">{t('Map layers')}</p>
          <button type="button" onClick={onClose} aria-label={t('Close layers')} className="grid h-8 w-8 place-items-center rounded-md text-slate-300 hover:bg-white/10 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
        <label className="relative block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search: flood, ward, fire, school…')}
            aria-label={t('Search the layers')}
            className="h-10 w-full rounded-md border border-white/15 bg-slate-900/80 pl-8 pr-8 text-sm text-slate-100 placeholder:text-slate-400" />
          {q ? (
            <button type="button" onClick={() => setQ('')} aria-label={t('Clear the search')} className="absolute right-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded text-slate-300 hover:bg-white/10">
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </label>
        {groups.length > 1 ? (
          <div className="flex flex-wrap gap-1.5">
            {['', ...groups].map((g) => (
              <button key={g || 'all'} type="button" aria-pressed={group === g} onClick={() => setGroup(g)}
                className={cn('rounded-full border px-2.5 py-1 text-xs font-semibold',
                  group === g ? 'border-sky-400 bg-sky-400/20 text-sky-200' : 'border-white/15 text-slate-300 hover:bg-white/10')}>
                {g ? t(g) : t('All')}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {!q && !group && on.length ? (
          <div className="mb-3">
            <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-sky-300">{t('On now ({n})', { n: on.length })}</p>
            <div className="flex flex-wrap gap-1.5">
              {on.map((r) => (
                <button key={r.id} type="button" onClick={() => toggle(r.id)} title={t('Switch off')}
                  className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold hover:bg-white/20">
                  {t(r.label)}<X className="h-3 w-3" aria-hidden />
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {shown.length === 0 ? <p className="py-6 text-center text-sm text-slate-300">{t('No layer matches.')}</p> : null}
        {groups.filter((g) => shown.some((r) => r.group === g)).map((g) => (
          <fieldset key={g} className="mb-3">
            <legend className="mb-1 text-[11px] font-bold uppercase tracking-wider text-sky-300">{t(g)}</legend>
            {g === 'Weather' && weatherOff && (
              <p className="mb-1 text-xs text-amber-300">{t('Weather needs OPENWEATHER_API_KEY on the server.')}</p>
            )}
            {shown.filter((r) => r.group === g).map((r) => (
              <div key={r.id} className="rounded-lg px-2 py-1.5 hover:bg-white/5">
                <div className="flex items-start gap-1">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5">
                    <input type="checkbox" checked={isOn(r.id)} onChange={() => toggle(r.id)} className="mt-0.5 h-4 w-4 shrink-0 accent-sky-400" />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{t(r.label)}</span>
                      <span className="block text-xs text-slate-400">{t(r.hint)}</span>
                      {notes[r.id] && isOn(r.id) && (
                        <span className="mt-0.5 block text-xs text-amber-300">{t(notes[r.id]!)}</span>
                      )}
                    </span>
                  </label>
                  {outsideIds.has(r.id) ? (
                    <InfoDot title={t(r.label)} text={`${t(r.about)} ${t('From: {source}.', { source: r.source })}`} className="text-slate-300" />
                  ) : null}
                </div>
                {isOn(r.id) && r.legend.length ? (
                  <div className="mt-1 flex flex-wrap gap-x-2.5 gap-y-1 pl-6 text-[11px] text-slate-300">
                    {r.legend.map((x) => (
                      <span key={`${x.colour}-${x.label}`} className="inline-flex items-center gap-1">
                        <span className={cn(x.shape === 'area' ? 'h-2.5 w-3.5 rounded-sm' : x.shape === 'line' ? 'h-0.5 w-4 rounded-full' : 'h-2.5 w-2.5 rounded-full')}
                          style={{ background: x.colour }} />
                        {t(x.label)}
                      </span>
                    ))}
                  </div>
                ) : null}
                {isOn(r.id) && r.tiles && outsideIds.has(r.id) ? (
                  <label className="mt-1.5 flex items-center gap-2 pl-6 text-[11px] text-slate-300">
                    {t('See-through')}
                    <input type="range" min={0.2} max={1} step={0.1} value={opacity[r.id] ?? catalogueOverlay(r.id)?.opacity ?? 1}
                      onChange={(e) => setOpacity(r.id, Number(e.target.value))} className="h-1.5 flex-1 accent-sky-400" aria-label={t('How see-through {layer} is', { layer: t(r.label) })} />
                  </label>
                ) : null}
                {isOn(r.id) && r.sourceUrl ? (
                  <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-1 block pl-6 text-[11px] font-semibold text-sky-300 hover:underline">
                    {t('Open the source')}
                  </a>
                ) : null}
                {r.id === 'crime' && isOn('crime') && (
                  <div className="mt-1.5 pl-6">
                    <select
                      value={crimeKind}
                      onChange={(ev) => setCrimeKind(ev.target.value as CrimeKind)}
                      aria-label={t('Crime category')}
                      className="w-full rounded-md border border-white/15 bg-slate-900 px-2 py-1 text-xs text-slate-100"
                    >
                      {CRIME_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
                    </select>
                    {crimeYear && <p className="mt-1 text-[11px] text-slate-400">{t('SAPS financial year {crimeYear}', { crimeYear })}</p>}
                  </div>
                )}
              </div>
            ))}
          </fieldset>
        ))}
      </div>

      <div className="border-t border-white/10 px-3 py-2.5">
        <button
          type="button"
          onClick={onReset}
          className="w-full rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10"
        >
          {t('Reset to my desk\'s defaults')}</button>
      </div>
    </div>
  );
}

function Legend({ isOn, wall, unplaced, crimeYear, bodycams, outside }: {
  isOn: (id: MapLayerId) => boolean; wall: boolean; unplaced: number; crimeYear: string | null; bodycams: boolean;
  outside: readonly CatalogueOverlay[];
}) {
  const { t } = useT();
  const dot = (colour: string, label: string, ring?: string) => (
    <span key={label} className="inline-flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: colour, boxShadow: ring ? `0 0 0 2px ${ring}` : undefined }} />
      {label}
    </span>
  );
  return (
    <div className={cn(
      'ops-glass pointer-events-none absolute bottom-3 right-3 z-[5] flex max-w-[calc(100%-6rem)] flex-wrap gap-x-3 gap-y-1 rounded-lg px-3 py-2 text-slate-200',
      wall ? 'text-xs' : 'text-[11px]',
    )}>
      {dot('#dc2626', 'SOS', '#fca5a5')}
      {isOn('incidents') && (['Critical', 'High', 'Medium', 'Low'] as const).map((s) => dot(SEVERITY_COLOUR[s]!, s))}
      {isOn('units') && dot('#a78bfa', 'Officer available')}
      {isOn('units') && dot('#a78bfa', 'Officer on a call', '#f59e0b')}
      {isOn('units') && bodycams && dot('#ef4444', 'Bodycam on: click the officer to watch')}
      {isOn('routes') && (
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-5 rounded-full bg-slate-200" />
          {t('Route')}</span>
      )}
      {isOn('routes') && (
        <span className="inline-flex items-center gap-1.5">
          <span className="w-5 border-t-2 border-dashed border-slate-200" />
          {t('No signal')}</span>
      )}
      {isOn('crime') && (
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-8 rounded-full" style={{ background: 'linear-gradient(90deg,#facc15,#f97316,#dc2626)' }} />
          {t('Crime{value}', { value: crimeYear ? ` ${crimeYear}` : '' })}
        </span>
      )}
      {isOn('hydrants') && dot(HYDRANT_COLOUR.Operational!, 'Hydrant')}
      {isOn('hydrants') && dot(HYDRANT_COLOUR['Out of Service']!, 'Hydrant out of service')}
      {isOn('cameras') && dot('#2dd4bf', 'SANRAL camera')}
      {isOn('traffic') && dot('#fb923c', 'Traffic')}
      {isOn('shelters') && dot('#16a34a', 'Shelter')}
      {isOn('flights') && dot('#facc15', 'Aircraft')}
      {isOn('vessels') && dot('#38bdf8', 'Ship')}
      {legendItems(outside).map((x) => (
        <span key={`${x.colour}-${x.label}`} className="inline-flex items-center gap-1.5">
          <span className={cn(x.shape === 'area' ? 'h-2.5 w-3.5 rounded-sm' : x.shape === 'line' ? 'h-0.5 w-4 rounded-full' : 'h-2.5 w-2.5 rounded-full')}
            style={{ background: x.colour }} />
          {t(x.label)}
        </span>
      ))}
      {unplaced > 0 && isOn('incidents') && (
        <span className="text-amber-300">{t('{unplaced} call{value} without a map position', { unplaced, value: unplaced === 1 ? '' : 's' })}</span>
      )}
    </div>
  );
}
