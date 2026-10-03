import { useCallback, useState } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getIncidentOverview } from '@criticom/api';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { colors, radius, space, makeStyles, useTheme } from '@/lib/theme';
import { HomeHeader } from '@/components/home-header';
import { HomeKpis } from '@/components/home-kpis';
import { IncidentMap } from '@/components/incident-map';
import { useMapPins } from '@/lib/use-map-pins';
import { MyIncidents } from '@/components/my-incidents';
import { MyPerformance } from '@/components/my-performance';

type Overview = Awaited<ReturnType<typeof getIncidentOverview>>;

const GREEN = '#22c55e';
const CYAN = '#22d3ee';

/**
 * Police Home — the V4 police dashboard on a phone: the time, the officer and
 * their duty status over the earth-at-night backdrop, the at-a-glance figures
 * (live, closed today, mine, on duty) and the real-time incident map. Nothing
 * else; the rest of the app is one tab away.
 */
export function PoliceHome() {
  const styles = useStyles();
  const router = useRouter();
  const { session } = useAuth();
  const { isDark } = useTheme();

  const [overview, setOverview] = useState<Overview | null>(null);
  // Every live dispatch as a pin, kept current by Realtime.
  const { pins } = useMapPins();
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!session) return;
    // A failed count shows as a dash; the dashboard never errors at the crew.
    await getIncidentOverview(getSupabase()).then(setOverview).catch(() => setOverview(null));
  }, [session]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <View style={styles.screen}>
      {/* The earth-at-night backdrop is a dark-mode texture; light mode is plain. */}
      {isDark ? (
        <>
          <Image
            source={require('../assets/shift-earth-network-portrait.png')}
            resizeMode="cover"
            style={StyleSheet.absoluteFillObject}
            accessibilityIgnoresInvertColors
          />
          <View style={styles.scrim} pointerEvents="none" />
        </>
      ) : null}

      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressBackgroundColor={colors.bgCard}
            onRefresh={() => {
              setRefreshing(true);
              void load().finally(() => setRefreshing(false));
            }}
          />
        )}
      >
        <HomeHeader />

        {/* ── Figures ─────────────────────────────────────────────── */}
        <HomeKpis live={overview?.live} closedToday={overview?.closedToday} />
        <MyIncidents />
        <MyPerformance />

        {/* ── Real-time incident map ──────────────────────────────── */}
        <View style={styles.mapCard}>
          <View style={styles.mapHead}>
            <Ionicons name="planet-outline" size={22} color={colors.cyan} />
            <View style={{ flex: 1 }}>
              <Text style={styles.mapTitle}>Real-Time{'\n'}Incident Map</Text>
              <Text style={styles.mapCount}>
                {pins.length} incident{pins.length === 1 ? '' : 's'} on the map · tap a pin
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                <Pressable onPress={() => router.push('/live-map')} hitSlop={8} accessibilityRole="button">
                  <Text style={styles.scan}>SCAN AREA</Text>
                </Pressable>
                <View style={styles.region}>
                  <Text style={styles.regionText}>ETHEKWINI</Text>
                </View>
              </View>
              <View style={styles.live}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>LIVE</Text>
              </View>
            </View>
          </View>
          <IncidentMap
            pins={pins}
            onOpen={(id) => router.push(`/incident/${id}`)}
            style={styles.map}
          />
        </View>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  // Keeps the city lights as texture without fighting the figures for attention.
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(5,5,16,0.55)' },
  container: { padding: space.lg, paddingBottom: space['3xl'] },

  mapCard: {
    borderRadius: radius.xl, padding: space.md, borderWidth: 1, borderColor: colors.panelBorder,
    backgroundColor: colors.panel,
  },
  mapHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, marginBottom: space.md },
  mapTitle: { color: colors.text, fontSize: 17, fontWeight: '800', lineHeight: 21 },
  mapCount: { color: colors.muted, fontSize: 11, marginTop: 3 },
  scan: { color: colors.cyan, fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  region: { backgroundColor: '#1e88e5', borderRadius: 5, paddingHorizontal: 8, paddingVertical: 3 },
  regionText: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  live: {
    flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: GREEN,
    borderRadius: 5, paddingHorizontal: 8, paddingVertical: 3,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' },
  liveText: { color: '#fff', fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  map: { height: 380, borderRadius: radius.lg, overflow: 'hidden' },
}));
