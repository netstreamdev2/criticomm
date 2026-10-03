import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { IncidentMap, type IncidentMapHandle } from '@/components/incident-map';
import { useMapPins } from '@/lib/use-map-pins';
import { colors, radius, severityColor, space, makeStyles } from '@/lib/theme';

const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'] as const;
type Severity = (typeof SEVERITIES)[number];
type Scope = 'All' | 'Mine';


/**
 * Live Map — every live dispatch as a pin, full screen, updated in real time.
 * Filter by severity or to my incidents; tap a pin to expand it, tap the card
 * to open the incident. A newly dispatched incident drops in and is offered
 * in a banner; my position shows as a blue dot once location is allowed.
 */
export default function LiveMapScreen() {
  const styles = useStyles();
  const router = useRouter();
  const map = useRef<IncidentMapHandle>(null);
  const { pins, unlocated, freshIds } = useMapPins();
  const [scope, setScope] = useState<Scope>('All');
  const [severities, setSeverities] = useState<Set<Severity>>(new Set());
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const watcher = useRef<Location.LocationSubscription | null>(null);

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
        style={StyleSheet.absoluteFill}
      />

      {/* ── Filters ── */}
      <View style={styles.top} pointerEvents="box-none">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
          <View style={styles.scope}>
            {(['All', 'Mine'] as const).map((s) => (
              <Pressable
                key={s}
                onPress={() => setScope(s)}
                accessibilityRole="button"
                accessibilityState={{ selected: scope === s }}
                style={[styles.scopeBtn, scope === s && styles.scopeOn]}
              >
                <Text style={[styles.scopeText, scope === s && { color: '#fff' }]}>{s}</Text>
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
                accessibilityLabel={`${s} severity`}
                style={[styles.chip, { borderColor: on ? tone : colors.panelBorder }, on && { backgroundColor: `${tone}33` }]}
              >
                <View style={[styles.dot, { backgroundColor: tone }]} />
                <Text style={[styles.chipText, on && { color: colors.text }]}>{s}</Text>
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
            accessibilityLabel={`New incident ${arrival.number}, ${arrival.type}. Show on map`}
            style={[styles.banner, { borderColor: `${arrival.color}88` }]}
          >
            <View style={[styles.bannerDot, { backgroundColor: arrival.color }]} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.bannerKicker}>NEW INCIDENT · {arrival.severity.toUpperCase()}</Text>
              <Text style={styles.bannerTitle} numberOfLines={1}>{arrival.number} · {arrival.type}</Text>
            </View>
            <Text style={styles.bannerAction}>Show</Text>
            <Pressable
              onPress={() => setDismissed((d) => new Set(d).add(arrival.id))}
              hitSlop={10}
              accessibilityLabel="Dismiss"
            >
              <Ionicons name="close" size={16} color={colors.muted} />
            </Pressable>
          </Pressable>
        ) : null}
      </View>

      {/* ── Map controls ── */}
      <View style={styles.controls}>
        <Pressable onPress={() => map.current?.fitAll()} style={styles.ctrl} accessibilityRole="button" accessibilityLabel="Show all incidents">
          <Ionicons name="scan-outline" size={20} color={colors.text} />
        </Pressable>
        <Pressable onPress={() => void locate()} style={styles.ctrl} accessibilityRole="button" accessibilityLabel="My location">
          <Ionicons name={me ? 'locate' : 'locate-outline'} size={20} color={me ? colors.accent : colors.text} />
        </Pressable>
      </View>

      {/* ── Legend ── */}
      <View style={styles.legend} pointerEvents="none">
        <View style={styles.legendHead}>
          <View style={styles.liveDot} />
          <Text style={styles.legendTitle}>
            LIVE · {shown.length} incident{shown.length === 1 ? '' : 's'}
          </Text>
        </View>
        <View style={styles.legendRow}>
          {SEVERITIES.map((s) => (
            <View key={s} style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: severityColor(s) }]} />
              <Text style={styles.legendText}>{s}</Text>
            </View>
          ))}
          <View style={styles.legendItem}>
            <View style={styles.sosTag}><Text style={styles.sosTagText}>SOS</Text></View>
            <Text style={styles.legendText}>Officer</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={styles.mineRing} />
            <Text style={styles.legendText}>Mine</Text>
          </View>
        </View>
        {unlocated > 0 ? (
          <Text style={styles.unlocated}>
            {unlocated} incident{unlocated === 1 ? ' has' : 's have'} no location from dispatch and {unlocated === 1 ? 'is' : 'are'} not pinned.
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },

  top: { position: 'absolute', top: space.sm, left: 0, right: 0, gap: space.sm },
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

  controls: { position: 'absolute', right: space.md, top: 110, gap: space.sm },
  ctrl: {
    width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.panelBorder,
  },

  legend: {
    position: 'absolute', left: space.md, right: space.md, bottom: space.lg,
    paddingHorizontal: 12, paddingVertical: 9, borderRadius: radius.md, backgroundColor: colors.panel,
    borderWidth: 1, borderColor: colors.panelBorder,
  },
  legendHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#22c55e' },
  legendTitle: { color: colors.text, fontSize: 11, fontWeight: '900', letterSpacing: 0.8 },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendText: { color: colors.textDim, fontSize: 11 },
  mineRing: { width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: '#60a5fa' },
  unlocated: { color: colors.medium, fontSize: 10, marginTop: 6 },
  sosTag: { backgroundColor: '#ef4444', borderRadius: 3, paddingHorizontal: 3, paddingVertical: 1 },
  sosTagText: { color: '#fff', fontSize: 8, fontWeight: '900' },
}));
