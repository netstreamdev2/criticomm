import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';
import { colors, space, type, makeStyles } from '@/lib/theme';

/**
 * The live map, as on the V4 console: satellite imagery of the metro.
 *
 * Display only for now — no units, incidents or tracking are drawn yet. It is
 * Leaflet in a WebView rather than a native map so it runs in Expo Go and in
 * builds without a Google Maps API key.
 */

/** Durban CBD — the centre of the eThekwini metro. */
const CENTRE = { lat: -29.8587, lng: 31.0218, zoom: 12 };

const HTML = `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  html, body, #map { height: 100%; margin: 0; background: #050510; }
  .leaflet-control-attribution { background: rgba(5,5,16,0.7) !important; color: #9ca3af; font-size: 9px; }
  .leaflet-control-attribution a { color: #9ca3af; }
  .leaflet-bar a { background: #fff; color: #111; }
</style>
</head><body><div id="map"></div><script>
  function send(m) { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(m); }
  // Leaflet comes from a CDN; with no signal it never arrives.
  if (typeof L === 'undefined') { send('error'); } else {
    var map = L.map('map', { zoomControl: true, attributionControl: true })
      .setView([${CENTRE.lat}, ${CENTRE.lng}], ${CENTRE.zoom});
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics'
    }).addTo(map);
    send('ready');
  }
</script></body></html>`;

export function LiveMap({ style }: { style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <View style={[styles.wrap, style]}>
      <WebView
        source={{ html: HTML }}
        originWhitelist={['*']}
        style={styles.web}
        onMessage={(e) => (e.nativeEvent.data === 'ready' ? setReady(true) : setFailed(true))}
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
}

const useStyles = makeStyles(() => StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  web: { flex: 1, backgroundColor: colors.bg },
  overlay: {
    ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center',
    gap: space.sm, backgroundColor: colors.bg, padding: space.xl,
  },
  text: { ...type.small, color: colors.muted, textAlign: 'center' },
}));
