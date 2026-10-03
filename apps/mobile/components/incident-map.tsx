import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { MapPin } from '@/lib/map-pins';
import { colors, space, type, makeStyles, useTheme } from '@/lib/theme';

/**
 * The real-time incident map.
 *
 * Leaflet (open source) in a WebView, so it runs in Expo Go and in builds
 * without a Google Maps key. Tiles follow the app theme: Esri World Imagery
 * with Esri's road and place-name layers in dark mode, Esri's street map in
 * light mode — free, no key. Each incident is a pin at the
 * coordinates the dispatcher captured at intake; the app pushes the pin list
 * in whenever Supabase Realtime reports a change, so a dispatch appears on the
 * map within a moment.
 *
 * Tap a pin: it grows and expands into a card with the incident's essentials.
 * Tap the card (or the same pin again): `onOpen` — open the incident.
 *
 * Incident text is set with textContent inside the map, never as HTML, so
 * nothing typed into an incident can run in the page.
 */

/** Durban CBD — the centre of the eThekwini metro. */
const CENTRE = { lat: -29.8587, lng: 31.0218, zoom: 12 };

const HTML = `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  /* Dark by default; body.light switches every map surface to the light theme. */
  :root {
    --map-bg: #050510; --attr-bg: rgba(5,5,16,0.7); --attr-ink: #9ca3af;
    --ctrl-bg: #11112a; --ctrl-ink: #ffffff; --ctrl-line: #2e2e52;
    --card: #11112a; --card-line: #2e2e52; --card-shadow: rgba(0,0,0,.65);
    --ink: #ffffff; --ink-dim: #c9cdd8; --muted: #9ca3af; --num: #60a5fa; --accent: #3b82f6;
    --mine: #93c5fd; --pin-shadow: rgba(0,0,0,.55);
  }
  body.light {
    --map-bg: #f2f4f9; --attr-bg: rgba(255,255,255,0.85); --attr-ink: #5f6b7e;
    --ctrl-bg: #ffffff; --ctrl-ink: #0f172a; --ctrl-line: #c6cedd;
    --card: #ffffff; --card-line: #dfe4ee; --card-shadow: rgba(15,23,42,.22);
    --ink: #0f172a; --ink-dim: #334155; --muted: #5f6b7e; --num: #2563eb; --accent: #2563eb;
    --mine: #2563eb; --pin-shadow: rgba(15,23,42,.45);
  }
  html, body, #map { height: 100%; margin: 0; background: var(--map-bg); }
  .leaflet-container { background: var(--map-bg); }
  .leaflet-control-attribution { background: var(--attr-bg) !important; color: var(--attr-ink); font-size: 9px; }
  .leaflet-control-attribution a { color: var(--attr-ink); }
  .leaflet-bar a { background: var(--ctrl-bg); color: var(--ctrl-ink); border-color: var(--ctrl-line) !important; }
  .leaflet-bar { border: 1px solid var(--ctrl-line) !important; }

  .pin-wrap { background: none; border: none; }
  .pin { position: relative; width: 34px; height: 40px; transform-origin: 50% 78%; transition: transform .18s ease; }
  .pin.sel { transform: scale(1.35); }
  .pin.drop-in { animation: dropin .6s cubic-bezier(.3,1.5,.6,1); }
  .pin .drop { position: absolute; left: 5px; top: 2px; width: 24px; height: 24px; box-sizing: border-box;
    background: var(--c); border: 2px solid #fff; border-radius: 50% 50% 50% 0; transform: rotate(-45deg);
    box-shadow: 0 3px 8px var(--pin-shadow); }
  .pin.mine .drop { border-color: var(--mine); box-shadow: 0 0 0 3px rgba(59,130,246,.65), 0 3px 8px var(--pin-shadow); }
  .pin .core { position: absolute; left: 13px; top: 10px; width: 8px; height: 8px; border-radius: 50%; background: #fff; }
  .pin .tag { position: absolute; left: 50%; top: -11px; transform: translateX(-50%); background: #ef4444;
    color: #fff; font: 900 9px/1 sans-serif; letter-spacing: .5px; padding: 2px 4px; border-radius: 4px;
    border: 1px solid #fff; box-shadow: 0 2px 6px rgba(0,0,0,.6); }
  .pin.sos .drop { width: 28px; height: 28px; left: 3px; top: 0; border-width: 3px; }
  .pin .ring { position: absolute; left: 9px; top: 23px; width: 16px; height: 16px; box-sizing: border-box;
    border-radius: 50%; border: 2px solid var(--c); animation: ring 1.6s ease-out infinite; }
  @keyframes ring { from { transform: scale(.4); opacity: .9; } to { transform: scale(2.8); opacity: 0; } }
  @keyframes dropin { 0% { transform: translateY(-46px); opacity: 0; } 100% { transform: none; opacity: 1; } }

  .me { width: 22px; height: 22px; border-radius: 50%; background: rgba(59,130,246,.25);
    display: flex; align-items: center; justify-content: center; }
  .me span { width: 10px; height: 10px; border-radius: 50%; background: var(--accent); border: 2px solid #fff; }

  .inc .leaflet-popup-content-wrapper { background: var(--card); color: var(--ink); border: 1px solid var(--card-line);
    border-radius: 12px; box-shadow: 0 10px 28px var(--card-shadow); padding: 0; }
  .inc .leaflet-popup-content { margin: 0; width: 224px !important; }
  .inc .leaflet-popup-tip { background: var(--card); border: 1px solid var(--card-line); }
  .card { padding: 10px 12px 12px; font: 12px/1.35 -apple-system, Roboto, 'Segoe UI', sans-serif; }
  .card .top { display: flex; align-items: center; gap: 6px; }
  /* The severity chip is a saturated fill: white text in both themes. */
  .card .sev { font-size: 9px; font-weight: 800; letter-spacing: .6px; color: #fff; padding: 2px 6px; border-radius: 4px; }
  .card .num { font-family: monospace; color: var(--num); font-size: 11px; font-weight: 700; }
  .card .type { font-size: 14px; font-weight: 800; margin-top: 6px; color: var(--ink); }
  .card .addr { color: var(--ink-dim); margin-top: 3px; }
  .card .meta { color: var(--muted); margin-top: 4px; font-size: 11px; }
  .card .st { color: var(--ink); font-weight: 800; font-size: 10px; letter-spacing: .5px; }
  .card .holder { margin-top: 6px; color: var(--muted); font-size: 11px; }
  .card .holder.me { color: var(--num); font-weight: 700; }
  .card .open { margin-top: 9px; padding: 8px 0; text-align: center; border-radius: 8px;
    background: var(--accent); color: #fff; font-weight: 800; }
</style>
</head><body><div id="map"></div><script>
  function send(o) { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(o)); }
  // Leaflet comes from a CDN; with no signal it never arrives.
  if (typeof L === 'undefined') { send({ t: 'error' }); } else {
    var map = L.map('map', { zoomControl: true, attributionControl: true })
      .setView([${CENTRE.lat}, ${CENTRE.lng}], ${CENTRE.zoom});
    var esri = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
    // Dark: satellite imagery with Esri's road and place-name layers on top,
    // so an address can be found. Light: Esri's street map. Both free, no key.
    var base = {
      dark: L.layerGroup([
        L.tileLayer(esri + 'World_Imagery/MapServer/tile/{z}/{y}/{x}', {
          maxZoom: 19, attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics'
        }),
        L.tileLayer(esri + 'Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, opacity: 0.85 }),
        L.tileLayer(esri + 'Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 })
      ]),
      light: L.layerGroup([
        L.tileLayer(esri + 'World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
          maxZoom: 19, attribution: 'Tiles &copy; Esri, HERE, Garmin, OpenStreetMap contributors'
        })
      ])
    };
    var theme = null;
    function setTheme(next) {
      next = next === 'light' ? 'light' : 'dark';
      if (next === theme) return;
      if (theme) map.removeLayer(base[theme]);
      base[next].addTo(map);
      document.body.classList.toggle('light', next === 'light');
      theme = next;
    }
    // The app passes its theme in before this page loads; dark if it did not.
    setTheme(window.__theme);

    var pins = {}, openId = null, me = null, fitted = false;

    function safeColor(c) { return /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : '#3b82f6'; }
    function ago(iso) {
      var s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
      if (s < 60) return 'just now';
      var m = Math.floor(s / 60); if (m < 60) return m + 'm ago';
      var h = Math.floor(m / 60); if (h < 24) return h + 'h ago';
      return Math.floor(h / 24) + 'd ago';
    }
    function el(tag, cls, text) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = text;
      return e;
    }
    function icon(p, selected, dropIn) {
      var cls = 'pin' + (p.mine ? ' mine' : '') + (p.sos ? ' sos' : '') + (selected ? ' sel' : '') + (dropIn ? ' drop-in' : '');
      var ring = p.severity === 'Critical' || p.fresh || p.sos ? '<span class="ring"></span>' : '';
      var tag = p.sos ? '<span class="tag">SOS</span>' : '';
      return L.divIcon({
        className: 'pin-wrap',
        html: '<div class="' + cls + '" style="--c:' + safeColor(p.color) + '">' + ring
          + '<span class="drop"></span><span class="core"></span>' + tag + '</div>',
        iconSize: [34, 40], iconAnchor: [17, 31], popupAnchor: [0, -30]
      });
    }
    function zOf(p) { return p.sos ? 800 : p.severity === 'Critical' ? 600 : p.mine ? 500 : p.severity === 'High' ? 300 : 0; }
    function card(p) {
      var c = el('div', 'card');
      var top = el('div', 'top');
      var sev = el('span', 'sev', p.sos ? 'SOS · OFFICER EMERGENCY' : String(p.severity).toUpperCase());
      sev.style.background = safeColor(p.color);
      top.appendChild(sev);
      top.appendChild(el('span', 'num', p.number));
      c.appendChild(top);
      c.appendChild(el('div', 'type', p.type));
      if (p.address) c.appendChild(el('div', 'addr', p.address));
      var meta = el('div', 'meta');
      meta.appendChild(el('span', 'st', String(p.status).toUpperCase()));
      meta.appendChild(document.createTextNode(' · sent ' + ago(p.sentAt)));
      c.appendChild(meta);
      c.appendChild(el('div', 'holder' + (p.mine ? ' me' : ''), p.holder));
      c.appendChild(el('div', 'open', 'Open incident \\u203A'));
      L.DomEvent.disableClickPropagation(c);
      c.addEventListener('click', function () { send({ t: 'open', id: p.id }); });
      return c;
    }
    function openPopup(id) {
      var e = pins[id];
      if (!e) return;
      // Opening a new card closes the old one first (popupclose resets openId).
      L.popup({ closeButton: false, autoPan: true, autoPanPadding: [24, 70], className: 'inc', offset: [0, -2] })
        .setLatLng(e.m.getLatLng()).setContent(card(e.p)).openOn(map);
      openId = id;
      e.m.setIcon(icon(e.p, true, false));
      send({ t: 'select', id: id });
    }
    function onPin(id) {
      // Second tap on the expanded pin opens the incident.
      if (openId === id) { send({ t: 'open', id: id }); return; }
      openPopup(id);
    }
    map.on('popupclose', function () {
      if (openId && pins[openId]) pins[openId].m.setIcon(icon(pins[openId].p, false, false));
      openId = null;
      send({ t: 'select', id: null });
    });

    function fitAll() {
      var ll = Object.keys(pins).map(function (k) { return pins[k].m.getLatLng(); });
      if (me) ll.push(me.getLatLng());
      if (!ll.length) { map.setView([${CENTRE.lat}, ${CENTRE.lng}], ${CENTRE.zoom}); return; }
      if (ll.length === 1) map.setView(ll[0], 15);
      else map.fitBounds(L.latLngBounds(ll), { padding: [48, 48], maxZoom: 15 });
    }
    function setPins(list) {
      var next = {};
      list.forEach(function (p) {
        next[p.id] = true;
        var cur = pins[p.id];
        if (!cur) {
          var m = L.marker([p.lat, p.lng], { icon: icon(p, false, p.fresh), riseOnHover: true, zIndexOffset: zOf(p) });
          m.on('click', function () { onPin(p.id); });
          m.addTo(map);
          pins[p.id] = { m: m, p: p };
        } else if (JSON.stringify(cur.p) !== JSON.stringify(p)) {
          if (cur.p.lat !== p.lat || cur.p.lng !== p.lng) cur.m.setLatLng([p.lat, p.lng]);
          cur.p = p;
          cur.m.setIcon(icon(p, openId === p.id, false));
          cur.m.setZIndexOffset(zOf(p));
          if (openId === p.id) { var pop = map._popup; if (pop) pop.setContent(card(p)); }
        }
      });
      Object.keys(pins).forEach(function (id) {
        if (next[id]) return;
        if (openId === id) map.closePopup();
        map.removeLayer(pins[id].m);
        delete pins[id];
      });
      if (!fitted && list.length) { fitAll(); fitted = true; }
    }
    function focusPin(id) {
      var e = pins[id];
      if (!e) return;
      map.setView(e.m.getLatLng(), Math.max(map.getZoom(), 15));
      openPopup(id);
    }
    function setMe(lat, lng) {
      if (!me) {
        me = L.marker([lat, lng], {
          icon: L.divIcon({ className: 'pin-wrap', html: '<div class="me"><span></span></div>', iconSize: [22, 22], iconAnchor: [11, 11] }),
          interactive: false, zIndexOffset: 1000
        }).addTo(map);
      } else { me.setLatLng([lat, lng]); }
    }
    function centreMe() { if (me) map.setView(me.getLatLng(), 15); }

    window.__map = { setPins: setPins, fitAll: fitAll, focusPin: focusPin, setMe: setMe, centreMe: centreMe, setTheme: setTheme };
    send({ t: 'ready' });
  }
</script></body></html>`;

/** JSON as a JS literal: the two line separators JSON allows but JS strings do not. */
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const js = (value: unknown) => JSON.stringify(value).split(LS).join('\\u2028').split(PS).join('\\u2029');

export type IncidentMapHandle = {
  /** Frame every pin (and me). */
  fitAll: () => void;
  /** Pan to an incident and expand its card. */
  focus: (id: string) => void;
  /** Pan to my position, once known. */
  centreMe: () => void;
};

export const IncidentMap = forwardRef<IncidentMapHandle, {
  pins: MapPin[];
  /** Tap on an expanded card: open that incident. */
  onOpen: (id: string) => void;
  /** The expanded pin, or null when the card closes. */
  onSelect?: (id: string | null) => void;
  /** My position, drawn as a blue dot. */
  me?: { lat: number; lng: number } | null;
  style?: StyleProp<ViewStyle>;
}>(function IncidentMap({ pins, onOpen, onSelect, me, style }, ref) {
  const styles = useStyles();
  const { mode } = useTheme();
  // The theme the page is first drawn in; later switches go through setTheme.
  const initialMode = useRef(mode).current;
  const web = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  const run = useCallback((code: string) => {
    web.current?.injectJavaScript(`try { if (window.__map) { ${code} } } catch (e) {} true;`);
  }, []);

  useEffect(() => { if (ready) run(`window.__map.setPins(${js(pins)});`); }, [ready, pins, run]);
  // Map tiles, cards and controls follow the app's light/dark toggle.
  useEffect(() => { if (ready) run(`window.__map.setTheme(${js(mode)});`); }, [ready, mode, run]);
  useEffect(() => {
    if (ready && me) run(`window.__map.setMe(${Number(me.lat)}, ${Number(me.lng)});`);
  }, [ready, me, run]);

  useImperativeHandle(ref, () => ({
    fitAll: () => run('window.__map.fitAll();'),
    focus: (id: string) => run(`window.__map.focusPin(${js(id)});`),
    centreMe: () => run('window.__map.centreMe();'),
  }), [run]);

  const onMessage = (e: WebViewMessageEvent) => {
    let msg: { t?: string; id?: string | null };
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (msg.t === 'ready') setReady(true);
    else if (msg.t === 'error') setFailed(true);
    else if (msg.t === 'open' && typeof msg.id === 'string') onOpen(msg.id);
    else if (msg.t === 'select') onSelect?.(typeof msg.id === 'string' ? msg.id : null);
  };

  return (
    <View style={[styles.wrap, style]}>
      <WebView
        ref={web}
        source={{ html: HTML }}
        injectedJavaScriptBeforeContentLoaded={`window.__theme = ${js(initialMode)}; true;`}
        originWhitelist={['*']}
        style={styles.web}
        onMessage={onMessage}
        onError={() => setFailed(true)}
        setSupportMultipleWindows={false}
        // Lets the map pan when it sits inside the scrolling Home screen (Android).
        nestedScrollEnabled
        overScrollMode="never"
        bounces={false}
      />
      {!ready && !failed ? (
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.text}>Loading map…</Text>
        </View>
      ) : null}
      {failed ? (
        <View style={styles.overlay}>
          <Text style={styles.text}>The map could not load. Check your connection.</Text>
        </View>
      ) : null}
    </View>
  );
});

const useStyles = makeStyles(() => StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  web: { flex: 1, backgroundColor: colors.bg },
  overlay: {
    ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center',
    gap: space.sm, backgroundColor: colors.bg, padding: space.xl,
  },
  text: { ...type.small, color: colors.muted, textAlign: 'center' },
}));
