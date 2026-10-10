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
  Crosshair, Layers, Maximize2, Minimize2, Shapes, Siren, Wind, X,
} from 'lucide-react';
import {
  listBodycamHolders, listCameras, listCrimeZones, listHydrants, subscribeBodycams, type LiveMapZone, type OnDutyOfficer,
} from '@criticom/api';
import {
  DEPARTMENT_NAMES, canDrawMapZones, canWatchBodycam,
  type Database, type MapZoneKind, type MapZoneShape, type Silo, type UserRole,
} from '@criticom/db';
import { BodycamViewer, type BodycamTarget, type ViewReason } from '@/components/bodycam/bodycam-viewer';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { useLiveIncidents } from '@/lib/live-incidents';
import { useOnDutyOfficers } from '@/lib/on-duty';
import { useLiveZones } from '@/lib/live-zones';
import {
  BASEMAPS, CRIME_KINDS, HYDRANT_COLOUR, LAYER_GROUPS, LAYERS, SEVERITY_COLOUR, WEATHER_LAYERS,
  compass, crimeZones, hasPosition, isBasemap, isCrimeKind, isSos, isStale, parseFacilities,
  parseTraffic, restoreLayers, summariseIncidents,
  type Basemap, type CrimeKind, type CrimeStation, type Facility, type LayerId, type TrafficItem,
} from '@/lib/ops-map/layers';
import { fromGeometry, kindsForShape, zoneKind, type LatLng, type ZoneDraft } from '@/lib/ops-map/zones';
import { cn } from '@/lib/utils';
import { saveZoneAction } from '@/app/(app)/incidents/map/actions';
import * as M from './markers';
import { ZoneDrawController, type DrawSnapshot } from './zones/draw-controller';
import { drawZones, zoneBounds } from './zones/render';
import { ZoneCard } from './zones/zone-card';
import { ZoneEditor, type EditorIncident, type ZoneFormInit } from './zones/zone-editor';
import { DrawToolbar, PlacingBar, ZonesList } from './zones/zone-tools';
import { DispatchMapModal } from '@/components/dispatch-map-modal';

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
const DATA_GROUPS = ['incidents', 'units', 'zones', 'cameras', 'crime', 'hydrants', 'traffic', 'facilities'] as const;
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
  /** Layers this viewer may switch on (availableLayers). */
  layers: LayerId[];
  /** What they open with until they choose (defaultLayers). */
  defaults: LayerId[];
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
};

export function OpsMap({
  incidents: initialIncidents, officers: initialOfficers, silo, layers: available, defaults,
  basemap: defaultBasemap, scopeLabel, height = 560, startInWall = false,
  me, focusZoneId = null, drawForIncidentId = null, bodycams = false, liveRoutes = null,
}: OpsMapProps) {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;

  const incidents = useLiveIncidents(initialIncidents, silo);
  const silos = useMemo(() => (silo ? [silo] : undefined), [silo]);
  const officers = useOnDutyOfficers(initialOfficers, silos);
  /** The call whose live dispatch map is open. */
  const [routingId, setRoutingId] = useState<string | null>(null);
  const routing = routingId ? incidents.find((i) => i.id === routingId) ?? null : null;
  const liveRoutesRef = useRef(liveRoutes);
  liveRoutesRef.current = liveRoutes;

  /* ── What is switched on (remembered per browser) ─────────────────── */

  const availableKey = available.join(',');
  const defaultsKey = defaults.join(',');
  const [active, setActive] = useState<LayerId[]>(() => restoreLayers(defaults, available, []));
  const [basemap, setBasemap] = useState<Basemap>(defaultBasemap);
  const [crimeKind, setCrimeKind] = useState<CrimeKind>('all');
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    const allowed = availableKey.split(',') as LayerId[];
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? 'null') as Record<string, unknown> | null;
      if (saved && typeof saved === 'object') {
        if ('layers' in saved) setActive(restoreLayers(saved.layers, allowed, []));
        if (isBasemap(saved.basemap)) setBasemap(saved.basemap);
        if (isCrimeKind(saved.crimeKind)) setCrimeKind(saved.crimeKind);
      }
    } catch {
      /* private window or blocked storage — the defaults stand */
    }
    setRestored(true);
  }, [availableKey]);

  useEffect(() => {
    if (!restored) return;
    try {
      localStorage.setItem(STORE, JSON.stringify({ layers: active, basemap, crimeKind }));
    } catch {
      /* not fatal */
    }
  }, [restored, active, basemap, crimeKind]);

  const isOn = useCallback((id: LayerId) => active.includes(id), [active]);
  const toggle = (id: LayerId) =>
    setActive((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const resetLayers = () => {
    setActive(restoreLayers(defaultsKey.split(','), availableKey.split(',') as LayerId[], []));
    setBasemap(defaultBasemap);
    setCrimeKind('all');
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
  }, [ready, active, weatherOff]);

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
          if (wallRef.current) focus(lat, lng);
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
      const stale = isStale(o.seenAt, now);
      const cam = camHolders.get(o.userId) ?? null;
      const key = `${busy}|${stale}|${Boolean(cam)}`;
      const tip = M.unitTooltip(o, stale, cam?.serial);
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

  /* ── Reference layers, fetched the first time they are switched on ── */

  const [crime, setCrime] = useState<{ year: string | null; stations: CrimeStation[] } | null>(null);
  const [hydrants, setHydrants] = useState<Hydrant[] | null>(null);
  const [cameras, setCameras] = useState<Camera[] | null>(null);
  const [facilities, setFacilities] = useState<Facility[] | null>(null);
  const [traffic, setTraffic] = useState<TrafficItem[] | null>(null);
  const [notes, setNotes] = useState<Partial<Record<LayerId, string>>>({});
  const loading = useRef(new Set<LayerId>());

  const note = useCallback((id: LayerId, text: string | null) => {
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
    load('hydrants', hydrants, () => listHydrants(sb), (rows) => {
      setHydrants(rows);
      if (!rows.length) note('hydrants', 'The hydrant register is empty.');
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
  }, [active, crime, hydrants, cameras, facilities, note]);

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
    if (!ready || !L || !g || !hydrants) return;
    g.clearLayers();
    for (const h of hydrants) {
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
  const canDraw = canDrawMapZones(me.role);
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
      <div ref={el} className="absolute inset-0" role="region" aria-label="Live operations map" />

      {/* Top row: controls on the left, wall title and counts on the right. */}
      <div className="pointer-events-none absolute inset-x-3 top-3 z-[5] flex flex-row-reverse items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-start justify-end gap-2">
          {wall ? (
            <>
              <WallTitle scopeLabel={scopeLabel} />
              <Stat label="Live incidents" value={summary.live} />
              <Stat label="Critical / high" value={summary.urgent} tone={summary.urgent ? 'urgent' : undefined} />
              {summary.sos > 0 && <Stat label="SOS active" value={summary.sos} tone="sos" />}
              <Stat
                label="Officers on duty"
                value={officers.length}
                detail={placedOfficers < officers.length ? `${placedOfficers} on the map` : undefined}
              />
              <WeatherStat weather={weather} />
            </>
          ) : (
            summary.sos > 0 && (
              <span className="ops-glass pointer-events-auto inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-red-300">
                <Siren className="h-4 w-4 animate-pulse" /> {summary.sos} SOS active
              </span>
            )
          )}
        </div>

        <div className="ops-map-chrome pointer-events-auto flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => { setSelectedZoneId(null); setSheet((v) => (v === 'zones' ? null : 'zones')); }}
            aria-expanded={sheet === 'zones'}
            title="Perimeters and zones in force"
            className="ops-glass ops-btn"
          >
            <Shapes className="h-4 w-4" /> Perimeters
            <span className="rounded bg-white/15 px-1.5 text-[10px] tabular-nums">{zones.length}</span>
          </button>
          <button
            type="button"
            onClick={() => { setSelectedZoneId(null); setSheet((v) => (v === 'layers' ? null : 'layers')); }}
            aria-expanded={sheet === 'layers'}
            className="ops-glass ops-btn"
          >
            <Layers className="h-4 w-4" /> Layers
            <span className="rounded bg-white/15 px-1.5 text-[10px] tabular-nums">{overlays}</span>
          </button>
          <fieldset className="ops-glass flex rounded-lg p-0.5">
            <legend className="sr-only">Basemap</legend>
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
                New call · {banner.incident_number}
              </p>
              <p className="truncate text-slate-100">
                {banner.incident_type} · {banner.incident_severity} · {banner.location_address}
              </p>
            </div>
            <button type="button" onClick={() => setBanner(null)} aria-label="Dismiss" className="ml-1 text-slate-300 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <Legend isOn={isOn} wall={wall} unplaced={summary.unplaced} crimeYear={crimeYear} bodycams={camHolders.size > 0} />

      {wall && !nativeFs && (
        <p className="ops-map-chrome ops-glass pointer-events-none absolute bottom-3 left-1/2 z-[5] -translate-x-1/2 rounded-md px-3 py-1 text-xs text-slate-300">
          F11 for edge-to-edge · Esc to leave
        </p>
      )}

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

/* ── Pieces ─────────────────────────────────────────────────────────── */

function WallTitle({ scopeLabel }: { scopeLabel: string }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="ops-glass rounded-xl px-4 py-2.5">
      <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.25em] text-sky-300">
        <span className="live-dot" /> Live operations
      </p>
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
  if (!weather?.configured || weather.error || weather.tempC == null) return null;
  const kmh = weather.windSpeedMs != null ? Math.round(weather.windSpeedMs * 3.6) : null;
  return (
    <div className="ops-glass rounded-xl px-4 py-2.5">
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-300">Durban weather</p>
      <p className="mt-0.5 text-3xl font-bold tabular-nums text-white">{Math.round(weather.tempC)}°</p>
      <p className="flex items-center gap-1 text-xs capitalize text-slate-300">
        {kmh != null && (
          <>
            <Wind className="h-3 w-3" /> {kmh} km/h {compass(weather.windDeg)} ·{' '}
          </>
        )}
        {weather.description}
      </p>
    </div>
  );
}

function LayerPanel({
  available, isOn, toggle, notes, weatherOff, crimeKind, setCrimeKind, crimeYear, onReset, onClose,
}: {
  available: LayerId[];
  isOn: (id: LayerId) => boolean;
  toggle: (id: LayerId) => void;
  notes: Partial<Record<LayerId, string>>;
  weatherOff: boolean;
  crimeKind: CrimeKind;
  setCrimeKind: (k: CrimeKind) => void;
  crimeYear: string | null;
  onReset: () => void;
  onClose: () => void;
}) {
  return (
    <div className="ops-map-chrome ops-glass absolute left-3 top-16 z-[6] max-h-[calc(100%-5.5rem)] w-80 max-w-[calc(100%-1.5rem)] overflow-y-auto rounded-xl p-3 text-slate-100 shadow-2xl">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-300">Map layers</p>
        <button type="button" onClick={onClose} aria-label="Close layers" className="text-slate-300 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>
      {LAYER_GROUPS.map((group) => {
        const defs = LAYERS.filter((l) => l.group === group && available.includes(l.id));
        if (!defs.length) return null;
        return (
          <fieldset key={group} className="mb-3">
            <legend className="mb-1 text-[11px] font-bold uppercase tracking-wider text-sky-300">{group}</legend>
            {group === 'Weather' && weatherOff && (
              <p className="mb-1 text-xs text-amber-300">Weather needs OPENWEATHER_API_KEY on the server.</p>
            )}
            {defs.map((l) => (
              <div key={l.id} className="rounded-lg px-2 py-1.5 hover:bg-white/5">
                <label className="flex cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={isOn(l.id)}
                    onChange={() => toggle(l.id)}
                    className="mt-0.5 h-4 w-4 accent-sky-400"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{l.label}</span>
                    <span className="block text-xs text-slate-400">{l.hint}</span>
                    {notes[l.id] && isOn(l.id) && (
                      <span className="mt-0.5 block text-xs text-amber-300">{notes[l.id]}</span>
                    )}
                  </span>
                </label>
                {l.id === 'crime' && isOn('crime') && (
                  <div className="mt-1.5 pl-6">
                    <select
                      value={crimeKind}
                      onChange={(ev) => setCrimeKind(ev.target.value as CrimeKind)}
                      aria-label="Crime category"
                      className="w-full rounded-md border border-white/15 bg-slate-900 px-2 py-1 text-xs text-slate-100"
                    >
                      {CRIME_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
                    </select>
                    {crimeYear && <p className="mt-1 text-[11px] text-slate-400">SAPS financial year {crimeYear}</p>}
                  </div>
                )}
              </div>
            ))}
          </fieldset>
        );
      })}
      <button
        type="button"
        onClick={onReset}
        className="w-full rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10"
      >
        Reset to my desk&apos;s defaults
      </button>
    </div>
  );
}

function Legend({ isOn, wall, unplaced, crimeYear, bodycams }: {
  isOn: (id: LayerId) => boolean; wall: boolean; unplaced: number; crimeYear: string | null; bodycams: boolean;
}) {
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
      {isOn('crime') && (
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-8 rounded-full" style={{ background: 'linear-gradient(90deg,#facc15,#f97316,#dc2626)' }} />
          Crime{crimeYear ? ` ${crimeYear}` : ''}
        </span>
      )}
      {isOn('hydrants') && dot(HYDRANT_COLOUR.Operational!, 'Hydrant')}
      {isOn('hydrants') && dot(HYDRANT_COLOUR['Out of Service']!, 'Hydrant out of service')}
      {isOn('cameras') && dot('#2dd4bf', 'SANRAL camera')}
      {isOn('traffic') && dot('#fb923c', 'Traffic')}
      {unplaced > 0 && isOn('incidents') && (
        <span className="text-amber-300">{unplaced} call{unplaced === 1 ? '' : 's'} without a map position</span>
      )}
    </div>
  );
}
