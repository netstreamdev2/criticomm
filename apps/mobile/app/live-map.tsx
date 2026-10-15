import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { CRIME_KINDS, compass, heatColour } from '@criticom/db/map-layers';
import { BottomSheet } from '@/components/bottom-sheet';
import { IncidentMap, type IncidentMapHandle } from '@/components/incident-map';
import { useAuth } from '@/lib/auth';
import { personTitle } from '@/lib/department';
import {
  useCrimeCircles, useLiveZoneShapes, useOverlayChoice, useRainTiles, useWeatherNow, weatherLine,
  type OverlayId, type WeatherNow,
} from '@/lib/police-overlays';
import { useMapPins } from '@/lib/use-map-pins';
import { colors, radius, severityColor, space, makeStyles } from '@/lib/theme';
import { tx } from '@criticom/db/i18n';
import { useT } from '@/lib/i18n';

const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'] as const;
type Severity = (typeof SEVERITIES)[number];
type Scope = 'All' | 'Mine';

/** Short names for the crime categories, to fit a chip. */
const CRIME_CHIP: Record<string, string> = {
  all: tx('All'), murder: tx('Murder'), carjacking: tx('Carjacking'), burglary_residential: tx('Burglary'),
  robbery_residential: tx('Robbery'), drug_crime: tx('Drugs'), dui: tx('DUI'),
};

function weatherIcon(w: WeatherNow | null): keyof typeof Ionicons.glyphMap {
  const d = (w?.description ?? '').toLowerCase();
  if (d.includes('thunder')) return 'thunderstorm-outline';
  if (d.includes('rain') || d.includes('drizzle') || d.includes('shower')) return 'rainy-outline';
  if (d.includes('clear')) return 'sunny-outline';
  if (d.includes('few') || d.includes('scattered')) return 'partly-sunny-outline';
  return 'cloudy-outline';
}

const sentence = (s: string | null | undefined) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

/**
 * Live Map — every live dispatch as a pin, full screen, updated in real time.
 * Filter by severity or to my incidents; tap a pin to expand it, tap the card
 * to open the incident. A newly dispatched incident drops in and is offered
 * in a banner; my position shows as a blue dot once location is allowed.
 *
 * Police also get the console's overlays in a lighter form: SAPS crime zones,
 * the perimeters command has shared with them, rain radar, and the weather
 * now. Layers opens the switches; the choice is remembered on the phone.
 */
export default function LiveMapScreen() {
  const { t } = useT();
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { silo } = useAuth();
  // Police overlays for now; other departments keep the plain incident map.
  const police = silo === 'MetroPolice';
  const map = useRef<IncidentMapHandle>(null);
  const { pins, unlocated, freshIds } = useMapPins();
  const [scope, setScope] = useState<Scope>('All');
  const [severities, setSeverities] = useState<Set<Severity>>(new Set());
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const watcher = useRef<Location.LocationSubscription | null>(null);

  const [layersOpen, setLayersOpen] = useState(false);
  const { choice, toggle, setCrimeKind } = useOverlayChoice();
  const isOn = (id: OverlayId) => police && choice.on.includes(id);
  const crime = useCrimeCircles(isOn('crime'), choice.crimeKind);
  const zones = useLiveZoneShapes(isOn('zones'));
  const rain = useRainTiles(isOn('rain'));
  const weather = useWeatherNow();
  const weatherNow = weatherLine(weather);

  const shown = useMemo(() => pins.filter((p) =>
    (scope === 'All' || p.mine)
    && (severities.size === 0 || severities.has(p.severity as Severity))), [pins, scope, severities]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of pins) if (scope === 'All' || p.mine) c[p.severity] = (c[p.severity] ?? 0) + 1;
    return c;
  }, [pins, scope]);

  // The newest incident dispatched since the map opened, until dismissed.
  const arrival = useMemo(() => pins
    .filter((p) => freshIds.has(p.id) && !dismissed.has(p.id))
    .sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime())[0] ?? null,
  [pins, freshIds, dismissed]);

  // Follow my position while the map is open, if location is already allowed.
  const follow = async (ask: boolean) => {
    try {
      const perm = ask
        ? await Location.requestForegroundPermissionsAsync()
        : await Location.getForegroundPermissionsAsync();
      if (perm.status !== 'granted') return false;
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setMe({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      if (!watcher.current) {
        watcher.current = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, distanceInterval: 25 },
          (p) => setMe({ lat: p.coords.latitude, lng: p.coords.longitude }),
        );
      }
      return true;
    } catch {
      return false;
    }
  };
  useEffect(() => {
    void follow(false);
    return () => { watcher.current?.remove(); watcher.current = null; };
  }, []);

  const locate = async () => {
    if (me) { map.current?.centreMe(); return; }
    if (await follow(true)) setTimeout(() => map.current?.centreMe(), 400);
  };

  const toggleSeverity = (s: Severity) => setSeverities((cur) => {
    const next = new Set(cur);
    if (next.has(s)) next.delete(s); else next.add(s);
    return next;
  });

  return (
    <View style={styles.screen}>
      <IncidentMap
        ref={map}
        pins={shown}
        me={me}
        onOpen={(id) => router.push(`/incident/${id}`)}
        crime={police ? crime.circles : undefined}
        zones={police ? zones : undefined}
        rainUrl={police ? rain.url : undefined}
        zoomButtons={false}
        style={StyleSheet.absoluteFill}
      />

      <View style={[styles.top, { top: insets.top + space.sm }]} pointerEvents="box-none">
        {/* ── Back, what this is, the weather ── */}
        <View style={styles.bar} pointerEvents="box-none">
          <Pressable onPress={() => router.back()} style={styles.round} accessibilityRole="button" accessibilityLabel={t('Back')}>
            <Ionicons name="chevron-back" size={20} color={colors.text} />
          </Pressable>
          <View style={styles.titlePill}>
            <View style={styles.liveDot} />
            <Text style={styles.titleText}>{t('LIVE MAP')}</Text>
            <Text style={styles.titleCount}>{shown.length}</Text>
          </View>
          <View style={{ flex: 1 }} />
          {weatherNow ? (
            <Pressable
              onPress={() => (police ? setLayersOpen(true) : undefined)}
              style={styles.chipBox}
              accessibilityRole={police ? 'button' : 'text'}
              accessibilityLabel={t('Weather now: {sentence}, {weatherNow}', { sentence: sentence(weather?.description), weatherNow })}
            >
              <Ionicons name={weatherIcon(weather)} size={16} color={colors.text} />
              <Text style={styles.weatherText}>{weatherNow}</Text>
            </Pressable>
          ) : null}
        </View>

        {/* ── Filters ── */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
          <View style={styles.scope}>
            {([tx('All'), tx('Mine')] as const).map((s) => (
              <Pressable
                key={s}
                onPress={() => setScope(s)}
                accessibilityRole="button"
                accessibilityState={{ selected: scope === s }}
                style={[styles.scopeBtn, scope === s && styles.scopeOn]}
              >
                <Text style={[styles.scopeText, scope === s && { color: '#fff' }]}>{t(s)}</Text>
              </Pressable>
            ))}
          </View>
          {SEVERITIES.map((s) => {
            const on = severities.has(s);
            const tone = severityColor(s);
            return (
              <Pressable
                key={s}
                onPress={() => toggleSeverity(s)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={t('{severity} severity', { severity: t(s) })}
                style={[styles.chip, { borderColor: on ? tone : colors.panelBorder }, on && { backgroundColor: `${tone}33` }]}
              >
                <View style={[styles.dot, { backgroundColor: tone }]} />
                <Text style={[styles.chipText, on && { color: colors.text }]}>{t(s)}</Text>
                <Text style={styles.chipCount}>{counts[s] ?? 0}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* ── New dispatch ── */}
        {arrival ? (
          <Pressable
            onPress={() => {
              map.current?.focus(arrival.id);
              setDismissed((d) => new Set(d).add(arrival.id));
            }}
            accessibilityRole="button"
            accessibilityLabel={t('New incident {number}, {type}. Show on map', { number: arrival.number, type: arrival.type })}
            style={[styles.banner, { borderColor: `${arrival.color}88` }]}
          >
            <View style={[styles.bannerDot, { backgroundColor: arrival.color }]} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.bannerKicker}>{t('NEW INCIDENT · {severity}', { severity: arrival.severity.toUpperCase() })}</Text>
              <Text style={styles.bannerTitle} numberOfLines={1}>{arrival.number} · {arrival.type}</Text>
            </View>
            <Text style={styles.bannerAction}>{t('Show')}</Text>
            <Pressable
              onPress={() => setDismissed((d) => new Set(d).add(arrival.id))}
              hitSlop={10}
              accessibilityLabel={t('Dismiss')}
            >
              <Ionicons name="close" size={16} color={colors.muted} />
            </Pressable>
          </Pressable>
        ) : null}
      </View>

      {/* ── Map controls ── */}
      <View style={[styles.controls, { top: insets.top + 112 }]}>
        {police ? (
          <Pressable
            onPress={() => setLayersOpen(true)}
            style={[styles.ctrl, choice.on.length > 0 && styles.ctrlOn]}
            accessibilityRole="button"
            accessibilityLabel={t('Map layers')}
          >
            <Ionicons name="layers-outline" size={20} color={choice.on.length > 0 ? colors.accent : colors.text} />
          </Pressable>
        ) : null}
        <Pressable onPress={() => map.current?.fitAll()} style={styles.ctrl} accessibilityRole="button" accessibilityLabel={t('Show all incidents')}>
          <Ionicons name="scan-outline" size={20} color={colors.text} />
        </Pressable>
        <Pressable onPress={() => void locate()} style={styles.ctrl} accessibilityRole="button" accessibilityLabel={t('My location')}>
          <Ionicons name={me ? 'locate' : 'locate-outline'} size={20} color={me ? colors.accent : colors.text} />
        </Pressable>
      </View>

      {/* ── Legend ── */}
      <View style={[styles.legend, { bottom: insets.bottom + space.lg }]} pointerEvents="none">
        <View style={styles.legendRow}>
          {SEVERITIES.map((s) => (
            <View key={s} style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: severityColor(s) }]} />
              <Text style={styles.legendText}>{t(s)}</Text>
            </View>
          ))}
          <View style={styles.legendItem}>
            <View style={styles.sosTag}><Text style={styles.sosTagText}>{t('SOS')}</Text></View>
            <Text style={styles.legendText}>{personTitle(silo, t)}</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={styles.mineRing} />
            <Text style={styles.legendText}>{t('Mine')}</Text>
          </View>
        </View>
        {isOn('crime') && crime.circles.length > 0 ? (
          <View style={styles.scaleRow}>
            <Text style={styles.legendText}>{t('Crime')}</Text>
            <View style={styles.scale}>
              {[0, 0.25, 0.5, 0.75, 1].map((s) => <View key={s} style={[styles.scaleStep, { backgroundColor: heatColour(s) }]} />)}
            </View>
            <Text style={styles.legendText}>{t('more cases')}{crime.year ? ` · ${crime.year}` : ''}</Text>
          </View>
        ) : null}
        {isOn('zones') && zones.length > 0 ? (
          <Text style={styles.legendText}>
            {zones.length === 1 ? t('1 perimeter or zone in force · tap it for details') : t('{n} perimeters or zones in force · tap one for details', { n: zones.length })}
          </Text>
        ) : null}
        {unlocated > 0 ? (
          <Text style={styles.unlocated}>
            {unlocated === 1 ? t('1 incident has no location from dispatch and is not pinned.') : t('{n} incidents have no location from dispatch and are not pinned.', { n: unlocated })}
          </Text>
        ) : null}
      </View>

      {/* ── Layers and weather (police) ── */}
      {police ? (
        <BottomSheet
          visible={layersOpen}
          onClose={() => setLayersOpen(false)}
          header={(
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>{t('Map layers')}</Text>
              <Text style={styles.sheetSub}>{t('Shown with live incidents. Remembered on this phone.')}</Text>
            </View>
          )}
        >
          <View style={styles.sheetBody}>
            {weather?.configured && !weather.error ? (
              <View style={styles.wxCard}>
                <Ionicons name={weatherIcon(weather)} size={30} color={colors.accent} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.wxTemp}>
                    {weather.tempC != null ? t('{round}°C', { round: Math.round(weather.tempC) }) : '—'}
                    <Text style={styles.wxDesc}>  {sentence(weather.description)}</Text>
                  </Text>
                  <Text style={styles.wxMeta}>
                    {[
                      weather.windSpeedMs != null ? t('Wind {from} {speed} km/h', { from: compass(weather.windDeg), speed: Math.round(weather.windSpeedMs * 3.6) }) : null,
                      weather.windGustMs != null ? t('gusts {speed}', { speed: Math.round(weather.windGustMs * 3.6) }) : null,
                      weather.humidity != null ? t('humidity {n}%', { n: weather.humidity }) : null,
                    ].filter(Boolean).join(' · ')}
                  </Text>
                  <Text style={styles.wxSource}>{t('Durban now · OpenWeather')}</Text>
                </View>
              </View>
            ) : null}

            <LayerRow
              icon="flame-outline"
              tint="#f97316"
              title={t('Crime zones')}
              hint={crime.error ?? (crime.year
                ? t('SAPS station statistics, {year}. Bigger and redder means more cases.', { year: crime.year })
                : t('SAPS station statistics. Bigger and redder means more cases.'))}
              on={isOn('crime')}
              onToggle={() => toggle('crime')}
            />
            {isOn('crime') ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.kinds}>
                {CRIME_KINDS.map((k) => {
                  const on = choice.crimeKind === k.key;
                  return (
                    <Pressable
                      key={k.key}
                      onPress={() => setCrimeKind(k.key)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={k.label}
                      style={[styles.kind, on && styles.kindOn]}
                    >
                      <Text style={[styles.kindText, on && { color: '#fff' }]}>{t(CRIME_CHIP[k.key] ?? k.label)}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : null}

            <LayerRow
              icon="git-commit-outline"
              tint="#ef4444"
              title={t('Perimeters & zones')}
              hint={isOn('zones')
                ? (zones.length ? t('{length} in force: cordons, closures and points set by command.', { length: zones.length }) : t('None in force for you right now.'))
                : t('Cordons, road closures and points set by command.')}
              on={isOn('zones')}
              onToggle={() => toggle('zones')}
            />

            <LayerRow
              icon="rainy-outline"
              tint="#38bdf8"
              title={t('Rain radar')}
              hint={rain.unavailable ? t('Weather is not set up on the server yet.') : t('Where it is raining now (OpenWeather).')}
              on={isOn('rain')}
              onToggle={() => toggle('rain')}
            />
          </View>
        </BottomSheet>
      ) : null}
    </View>
  );
}

function LayerRow({ icon, tint, title, hint, on, onToggle }: {
  icon: keyof typeof Ionicons.glyphMap; tint: string; title: string; hint: string; on: boolean; onToggle: () => void;
}) {
  const styles = useStyles();
  return (
    <Pressable
      onPress={onToggle}
      style={styles.layerRow}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={title}
    >
      <View style={[styles.layerIcon, { backgroundColor: `${tint}22` }]}>
        <Ionicons name={icon} size={18} color={tint} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.layerTitle}>{title}</Text>
        <Text style={styles.layerHint}>{hint}</Text>
      </View>
      <Switch value={on} onValueChange={onToggle} trackColor={{ true: colors.accent, false: colors.panelBorder }} thumbColor="#fff" />
    </Pressable>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },

  top: { position: 'absolute', left: 0, right: 0, gap: space.sm },
  bar: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md },
  round: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.panelBorder,
  },
  titlePill: {
    flexDirection: 'row', alignItems: 'center', gap: 7, height: 40, paddingHorizontal: 14,
    borderRadius: radius.pill, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.panelBorder,
  },
  titleText: { color: colors.text, fontSize: 12, fontWeight: '900', letterSpacing: 1.2 },
  titleCount: { color: colors.muted, fontSize: 12, fontWeight: '800' },
  chipBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 12,
    borderRadius: radius.pill, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.panelBorder,
  },
  weatherText: { color: colors.text, fontSize: 12, fontWeight: '800' },

  filters: { gap: 6, paddingHorizontal: space.md, alignItems: 'center' },
  scope: {
    flexDirection: 'row', borderRadius: radius.pill, padding: 2, backgroundColor: colors.panel,
    borderWidth: 1, borderColor: colors.panelBorder,
  },
  scopeBtn: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: radius.pill },
  scopeOn: { backgroundColor: colors.accent },
  scopeText: { color: colors.textDim, fontSize: 12, fontWeight: '800' },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, height: 30, paddingHorizontal: 10,
    borderRadius: radius.pill, borderWidth: 1, backgroundColor: colors.panel,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  chipText: { color: colors.textDim, fontSize: 12, fontWeight: '700' },
  chipCount: { color: colors.muted, fontSize: 11, fontWeight: '700' },

  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: space.md,
    paddingHorizontal: 12, paddingVertical: 9, borderRadius: radius.md, borderWidth: 1, backgroundColor: colors.panel,
  },
  bannerDot: { width: 10, height: 10, borderRadius: 5 },
  bannerKicker: { color: colors.muted, fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  bannerTitle: { color: colors.text, fontSize: 13, fontWeight: '800', marginTop: 1 },
  bannerAction: { color: colors.accent, fontSize: 12, fontWeight: '800' },

  controls: { position: 'absolute', right: space.md, gap: space.sm },
  ctrl: {
    width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.panelBorder,
  },
  ctrlOn: { borderColor: colors.accent },

  legend: {
    position: 'absolute', left: space.md, right: space.md, gap: 6,
    paddingHorizontal: 12, paddingVertical: 9, borderRadius: radius.md, backgroundColor: colors.panel,
    borderWidth: 1, borderColor: colors.panelBorder,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#22c55e' },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendText: { color: colors.textDim, fontSize: 11 },
  mineRing: { width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: '#60a5fa' },
  unlocated: { color: colors.medium, fontSize: 10 },
  sosTag: { backgroundColor: '#ef4444', borderRadius: 3, paddingHorizontal: 3, paddingVertical: 1 },
  sosTagText: { color: '#fff', fontSize: 8, fontWeight: '900' },
  scaleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  scale: { flexDirection: 'row', borderRadius: 3, overflow: 'hidden' },
  scaleStep: { width: 14, height: 6 },

  sheetHead: { paddingHorizontal: space.lg, paddingBottom: space.sm },
  sheetTitle: { color: colors.text, fontSize: 17, fontWeight: '800' },
  sheetSub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  sheetBody: { paddingHorizontal: space.lg, paddingBottom: space['2xl'], gap: space.sm },
  wxCard: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, marginBottom: space.xs,
    borderRadius: radius.lg, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.panelBorder,
  },
  wxTemp: { color: colors.text, fontSize: 22, fontWeight: '900' },
  wxDesc: { color: colors.textDim, fontSize: 14, fontWeight: '600' },
  wxMeta: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  wxSource: { color: colors.muted, fontSize: 10, marginTop: 4 },
  layerRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md,
    borderRadius: radius.lg, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.panelBorder,
  },
  layerIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  layerTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  layerHint: { color: colors.muted, fontSize: 12, marginTop: 2 },
  kinds: { gap: 6, paddingVertical: 2, paddingLeft: 48 },
  kind: {
    height: 30, paddingHorizontal: 12, borderRadius: radius.pill, justifyContent: 'center',
    borderWidth: 1, borderColor: colors.panelBorder, backgroundColor: colors.panel,
  },
  kindOn: { backgroundColor: '#f97316', borderColor: '#f97316' },
  kindText: { color: colors.textDim, fontSize: 12, fontWeight: '700' },
}));
