import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getIncident } from '@criticom/api';
import type { Database } from '@criticom/db/types';
import { getSupabase } from '@/lib/supabase';
import { openDirections } from '@/lib/navigate';
import { formatDistance } from '@/lib/incident-search';
import { colors, radius, severityColor, space, type, makeStyles, useTheme } from '@/lib/theme';
import { Button } from '@/components/ui';

type Incident = Database['public']['Tables']['incidents']['Row'];
type Point = { lat: number; lng: number };
type Route = { minutes: number; km: number; path: Array<[number, number]>; from: Point };

/** Re-route once the officer has moved this far from where the last route started. */
const REROUTE_KM = 0.15;
/** Inside this distance the officer is at the scene. */
const ARRIVED_KM = 0.05;

function kmBetween(a: Point, b: Point) {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** The road route from the officer to the scene: key-free OSRM, the same router the console uses. */
async function fetchRoute(from: Point, to: Point): Promise<Route | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`,
      { signal: ctrl.signal },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      code: string; routes?: Array<{ duration: number; distance: number; geometry: { coordinates: Array<[number, number]> } }>;
    };
    const route = data.code === 'Ok' ? data.routes?.[0] : undefined;
    if (!route) return null;
    return {
      minutes: Math.max(1, Math.round(route.duration / 60)),
      km: route.distance / 1000,
      path: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      from,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const js = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

const HTML = `<!doctype html><html><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  html, body, #map { height: 100%; margin: 0; background: #050510; }
  body.light, body.light #map { background: #f2f4f9; }
  .leaflet-control-attribution { font-size: 9px; background: rgba(5,5,16,.6) !important; color: #9ca3af; }
  body.light .leaflet-control-attribution { background: rgba(255,255,255,.85) !important; color: #5f6b7e; }
  .wrap { background: none; border: none; }
  .scene { position: relative; width: 22px; height: 22px; }
  .scene .dot { position: absolute; inset: 0; border-radius: 50%; border: 3px solid #fff; box-shadow: 0 2px 8px rgba(0,0,0,.5); }
  .scene .ring { position: absolute; inset: -14px; border-radius: 50%; opacity: .55; animation: ping 1.6s ease-out infinite; }
  .me { position: relative; width: 26px; height: 26px; }
  .me .halo { position: absolute; inset: -10px; border-radius: 50%; background: rgba(59,130,246,.22); }
  .me .arrow { position: absolute; inset: 0; border-radius: 50%; background: #3b82f6; border: 3px solid #fff;
    box-shadow: 0 2px 8px rgba(0,0,0,.5); display: flex; align-items: center; justify-content: center; }
  .me .arrow:after { content: ''; width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent;
    border-bottom: 9px solid #fff; transform: translateY(-1px); }
  @keyframes ping { 0% { transform: scale(.4); opacity: .7; } 100% { transform: scale(1.6); opacity: 0; } }
</style>
</head><body><div id="map"></div><script>
  function send(o) { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(o)); }
  if (typeof L === 'undefined') { send({ t: 'error' }); } else {
    var map = L.map('map', { zoomControl: false, attributionControl: true }).setView([-29.8587, 31.0218], 13);
    var esri = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
    var base = {
      dark: L.layerGroup([
        L.tileLayer(esri + 'World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagery &copy; Esri, Maxar' }),
        L.tileLayer(esri + 'Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, opacity: .85 }),
        L.tileLayer(esri + 'Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 })
      ]),
      light: L.layerGroup([
        L.tileLayer(esri + 'World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Tiles &copy; Esri, OpenStreetMap contributors' })
      ])
    };
    var theme = null;
    function setTheme(t) {
      t = t === 'light' ? 'light' : 'dark';
      if (t === theme) return;
      if (theme) map.removeLayer(base[theme]);
      base[t].addTo(map);
      document.body.classList.toggle('light', t === 'light');
      theme = t;
    }
    setTheme(window.__theme);
    var scene = null, me = null, line = null, casing = null, follow = true, framed = false;
    map.on('dragstart', function () { if (follow) { follow = false; send({ t: 'follow', on: false }); } });
    function frame() {
      var pts = [];
      if (me) pts.push(me.getLatLng());
      if (scene) pts.push(scene.getLatLng());
      if (line) line.getLatLngs().forEach(function (p) { pts.push(p); });
      if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: 17 });
      else if (pts.length === 1) map.setView(pts[0], 16);
    }
    window.__map = {
      setTheme: setTheme,
      setScene: function (lat, lng, colour) {
        var html = '<div class="scene"><div class="ring" style="background:' + colour + '"></div><div class="dot" style="background:' + colour + '"></div></div>';
        var icon = L.divIcon({ className: 'wrap', html: html, iconSize: [22, 22], iconAnchor: [11, 11] });
        if (scene) scene.setLatLng([lat, lng]); else scene = L.marker([lat, lng], { icon: icon, zIndexOffset: 500 }).addTo(map);
        if (!framed) { frame(); }
      },
      setMe: function (lat, lng, heading) {
        var rot = typeof heading === 'number' && heading >= 0 ? heading : 0;
        var html = '<div class="me"><div class="halo"></div><div class="arrow" style="transform: rotate(' + rot + 'deg)"></div></div>';
        var icon = L.divIcon({ className: 'wrap', html: html, iconSize: [26, 26], iconAnchor: [13, 13] });
        if (me) { me.setLatLng([lat, lng]); me.setIcon(icon); } else me = L.marker([lat, lng], { icon: icon, zIndexOffset: 1000 }).addTo(map);
        if (!framed && scene) { frame(); framed = true; }
        else if (follow) map.panTo([lat, lng], { animate: true });
      },
      setRoute: function (path) {
        if (casing) map.removeLayer(casing);
        if (line) map.removeLayer(line);
        casing = L.polyline(path, { color: '#0b3d91', weight: 9, opacity: .55 }).addTo(map);
        line = L.polyline(path, { color: '#3b82f6', weight: 5, opacity: .95 }).addTo(map);
        if (!framed && me) { frame(); framed = true; }
      },
      frame: function () { frame(); },
      follow: function () { follow = true; if (me) map.setView(me.getLatLng(), Math.max(map.getZoom(), 16)); }
    };
    send({ t: 'ready' });
  }
</script></body></html>`;

/**
 * The way to the scene, inside the app: where the officer is now, the road
 * route, minutes and distance to go, updated as the phone moves. Turn-by-turn
 * hands off to the phone's own map app.
 */
export default function RouteScreen() {
  const styles = useStyles();
  const { mode } = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const web = useRef<WebView>(null);
  const initialMode = useRef(mode).current;

  const [incident, setIncident] = useState<Incident | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [here, setHere] = useState<(Point & { heading: number | null }) | null>(null);
  const [denied, setDenied] = useState(false);
  const [route, setRoute] = useState<Route | null>(null);
  const [following, setFollowing] = useState(true);
  const routing = useRef(false);

  const run = useCallback((code: string) => {
    web.current?.injectJavaScript(`try { if (window.__map) { ${code} } } catch (e) {} true;`);
  }, []);

  useEffect(() => {
    if (!id) return;
    getIncident(getSupabase(), id).then(setIncident).catch((e: Error) => setLoadError(e.message));
  }, [id]);

  // The phone's position, live while this screen is open.
  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    void (async () => {
      let { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') status = (await Location.requestForegroundPermissionsAsync()).status;
      if (cancelled) return;
      if (status !== 'granted') { setDenied(true); return; }
      const watch = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 5, timeInterval: 2000 },
        (pos) => setHere({ lat: pos.coords.latitude, lng: pos.coords.longitude, heading: pos.coords.heading ?? null }),
      );
      if (cancelled) watch.remove(); else sub = watch;
    })().catch(() => setDenied(true));
    return () => { cancelled = true; sub?.remove(); };
  }, []);

  const scene = useMemo<Point | null>(() => (incident && (incident.location_lat || incident.location_lng)
    ? { lat: incident.location_lat, lng: incident.location_lng } : null), [incident]);

  // A fresh road route at the start and whenever the officer has moved off the last one's start.
  useEffect(() => {
    if (!here || !scene || routing.current) return;
    if (route && kmBetween(route.from, here) < REROUTE_KM) return;
    routing.current = true;
    void fetchRoute(here, scene).then((r) => { if (r) setRoute(r); }).finally(() => { routing.current = false; });
  }, [here, scene, route]);

  useEffect(() => { if (ready) run(`window.__map.setTheme(${js(mode)});`); }, [ready, mode, run]);
  useEffect(() => {
    if (ready && scene && incident) run(`window.__map.setScene(${scene.lat}, ${scene.lng}, ${js(severityColor(incident.incident_severity))});`);
  }, [ready, scene, incident, run]);
  useEffect(() => {
    if (ready && here) run(`window.__map.setMe(${here.lat}, ${here.lng}, ${here.heading ?? -1});`);
  }, [ready, here, run]);
  useEffect(() => { if (ready && route) run(`window.__map.setRoute(${js(route.path)});`); }, [ready, route, run]);

  const onMessage = (e: WebViewMessageEvent) => {
    let msg: { t?: string; on?: boolean };
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (msg.t === 'ready') setReady(true);
    else if (msg.t === 'error') setMapFailed(true);
    else if (msg.t === 'follow') setFollowing(Boolean(msg.on));
  };

  // What is left to drive: the road distance scaled by how far the officer has
  // come since it was routed, so the figures move between re-routes.
  const straight = here && scene ? kmBetween(here, scene) : null;
  const left = route && here && scene
    ? (() => {
        const atStart = kmBetween(route.from, scene);
        const ratio = atStart > 0 ? Math.min(1, (straight ?? atStart) / atStart) : 1;
        return { km: route.km * ratio, minutes: Math.max(1, Math.round(route.minutes * ratio)) };
      })()
    : null;
  const arrived = straight !== null && straight <= ARRIVED_KM;
  const sev = incident ? severityColor(incident.incident_severity) : colors.accent;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: incident?.incident_number ?? 'Route' }} />
      {scene ? (
        <WebView
          ref={web}
          source={{ html: HTML }}
          injectedJavaScriptBeforeContentLoaded={`window.__theme = ${js(initialMode)}; true;`}
          originWhitelist={['*']}
          style={styles.web}
          onMessage={onMessage}
          onError={() => setMapFailed(true)}
          setSupportMultipleWindows={false}
          overScrollMode="never"
          bounces={false}
        />
      ) : null}

      {!incident && !loadError ? (
        <View style={styles.overlay}><ActivityIndicator color={colors.accent} /></View>
      ) : loadError || (incident && !scene) ? (
        <View style={styles.overlay}>
          <Text style={styles.overlayText}>{loadError ?? 'No map pin was recorded for this incident.'}</Text>
          {incident?.location_address ? (
            <View style={{ marginTop: space.lg, alignSelf: 'stretch' }}>
              <Button label="Search the address in Maps" icon="navigate" onPress={() => { openDirections(incident); }} />
            </View>
          ) : null}
        </View>
      ) : mapFailed ? (
        <View style={styles.overlay}><Text style={styles.overlayText}>The map could not load. Check your connection.</Text></View>
      ) : null}

      {scene ? (
        <View style={[styles.mapButtons, { top: space.md }]}>
          <Pressable
            onPress={() => { setFollowing(true); run('window.__map.follow();'); }}
            style={[styles.roundBtn, following && { borderColor: colors.accent }]}
            accessibilityRole="button"
            accessibilityLabel="Follow my position"
          >
            <Ionicons name="locate" size={20} color={following ? colors.accent : colors.text} />
          </Pressable>
          <Pressable
            onPress={() => { setFollowing(false); run('window.__map.frame();'); }}
            style={styles.roundBtn}
            accessibilityRole="button"
            accessibilityLabel="Show the whole route"
          >
            <Ionicons name="scan-outline" size={20} color={colors.text} />
          </Pressable>
        </View>
      ) : null}

      {incident && scene ? (
        <View style={[styles.panel, { paddingBottom: insets.bottom + space.md }]}>
          <View style={styles.etaRow}>
            {arrived ? (
              <Text style={[styles.eta, { color: colors.low }]}>You have arrived</Text>
            ) : left ? (
              <>
                <Text style={styles.eta}>{left.minutes} min</Text>
                <Text style={styles.etaKm}>{formatDistance(left.km)}</Text>
              </>
            ) : straight !== null ? (
              <>
                <Text style={styles.eta}>{formatDistance(straight)}</Text>
                <Text style={styles.etaKm}>finding the road route…</Text>
              </>
            ) : (
              <Text style={styles.etaKm}>{denied ? 'Allow location access to see your route.' : 'Finding your location…'}</Text>
            )}
            <View style={styles.live}><View style={styles.liveDot} /><Text style={styles.liveText}>Live</Text></View>
          </View>
          <View style={styles.incidentRow}>
            <View style={[styles.sevDot, { backgroundColor: sev }]} />
            <Text style={styles.incidentType} numberOfLines={1}>{incident.incident_type}</Text>
          </View>
          <Text style={styles.address} numberOfLines={2}>{incident.location_address}</Text>
          <View style={{ marginTop: space.md }}>
            <Button label="Turn-by-turn in Maps" icon="navigate" onPress={() => { openDirections(incident); }} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  web: { flex: 1, backgroundColor: colors.bg },
  overlay: {
    ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center',
    padding: space.xl, backgroundColor: colors.bg,
  },
  overlayText: { ...type.small, color: colors.muted, textAlign: 'center' },
  mapButtons: { position: 'absolute', right: space.md, gap: space.sm },
  roundBtn: {
    width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border,
  },
  panel: {
    position: 'absolute', left: 0, right: 0, bottom: 0, padding: space.lg,
    backgroundColor: colors.bgCard, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    borderTopWidth: 1, borderColor: colors.border,
    shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: -4 }, elevation: 12,
  },
  etaRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  eta: { color: colors.text, fontSize: 28, fontWeight: '800', fontVariant: ['tabular-nums'] },
  etaKm: { color: colors.muted, fontSize: 15, fontWeight: '700', flex: 1 },
  live: { flexDirection: 'row', alignItems: 'center', gap: 5, marginLeft: 'auto' },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.low },
  liveText: { ...type.small, fontSize: 12, color: colors.low, fontWeight: '700' },
  incidentRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm },
  sevDot: { width: 10, height: 10, borderRadius: 5 },
  incidentType: { color: colors.text, fontSize: 15, fontWeight: '700', flex: 1 },
  address: { ...type.small, color: colors.muted, marginTop: 2 },
}));
