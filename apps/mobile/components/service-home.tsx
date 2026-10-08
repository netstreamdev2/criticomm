import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getIncidentOverview, getMyPersonnel, subscribeIncidentUpdates, subscribeNewIncidents, subscribePersonnel } from '@criticom/api';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useDuty } from '@/lib/duty';
import { useSync } from '@/lib/sync';
import { useDept } from '@/lib/branding';
import { useMapPins } from '@/lib/use-map-pins';
import { colors, radius, space, makeStyles } from '@/lib/theme';
import { HomeHeader } from './home-header';
import { HomeKpis } from './home-kpis';
import { MyIncidents } from './my-incidents';
import { MyPerformance } from './my-performance';
import { IncidentMap } from './incident-map';
import { FireBackdrop } from './fire-ui';

type IconName = keyof typeof Ionicons.glyphMap;

/** What a department's home says; the layout is the same for every one. */
export type ServiceHomeContent = {
  /** Eyebrow on the station panel, e.g. FIRE & RESCUE. */
  eyebrow: string;
  icon: IconName;
  /** e.g. YOUR APPLIANCE / YOUR AMBULANCE. */
  unitLabel: string;
  unitIcon: IconName;
  noUnit: string;
  unitA11y: string;
};

/**
 * The responder home for Fire and EMS: the Police look (backdrop, panels,
 * blue accent, map card) with the department's own content. Wide screens
 * (tablets) get a taller map; nothing else changes shape.
 */
export function ServiceHome({ content }: { content: ServiceHomeContent }) {
  const styles = useStyles();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { session } = useAuth();
  const { onDuty, teamOnDuty } = useDuty();
  const { online, pending, failed } = useSync();
  const dept = useDept();
  const { pins } = useMapPins();
  const [overview, setOverview] = useState<Awaited<ReturnType<typeof getIncidentOverview>> | null>(null);
  const [person, setPerson] = useState<Awaited<ReturnType<typeof getMyPersonnel>>>(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    if (!session) return;
    const sb = getSupabase();
    await Promise.all([
      getIncidentOverview(sb).then(setOverview).catch(() => setOverview(null)),
      getMyPersonnel(sb, session.user.id).then(setPerson).catch(() => setPerson(null)),
    ]);
  }, [session?.user.id]);

  useFocusEffect(useCallback(() => {
    void load();
    const sb = getSupabase();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => { clearTimeout(timer); timer = setTimeout(() => void load(), 300); };
    // RLS also includes control-room calls routed to this department; a silo filter would omit them.
    const offNew = subscribeNewIncidents(sb, 'all', update);
    const offUpdates = subscribeIncidentUpdates(sb, 'all', update);
    const offPerson = subscribePersonnel(sb, update, { userId: session?.user.id });
    return () => { clearTimeout(timer); offNew(); offUpdates(); offPerson(); };
  }, [load, session?.user.id]));

  return (
    <View style={styles.screen}>
      <FireBackdrop />
      <ScrollView contentContainerStyle={styles.container} refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={colors.accent}
          colors={[colors.accent]}
          progressBackgroundColor={colors.bgCard}
          onRefresh={() => {
            setRefreshing(true); void load().finally(() => setRefreshing(false));
          }}
        />
      }>
        <HomeHeader />
        <HomeKpis live={overview?.live} closedToday={overview?.closedToday} />

        {/* Station, crew and connection: the same panel as every other card. */}
        <View style={styles.station}>
          <View style={styles.stationHead}>
            <View style={styles.headMark} />
            <Ionicons name={content.icon} size={14} color={colors.accent} />
            <Text style={styles.stationEyebrow}>{content.eyebrow}</Text>
            <View style={{ flex: 1 }} />
            <View style={styles.chip}>
              <Ionicons name="people" size={12} color={colors.textDim} />
              <Text style={styles.chipText}>{teamOnDuty ?? '—'} on duty</Text>
            </View>
            <View style={styles.chip}>
              <Ionicons name={online ? 'cloud-done-outline' : 'cloud-offline-outline'} size={12} color={failed.length ? colors.critical : colors.textDim} />
              <Text style={[styles.chipText, failed.length ? { color: colors.critical } : null]}>
                {failed.length ? `${failed.length} need retry` : pending.length ? `${pending.length} queued` : online ? 'Connected' : 'Offline'}
              </Text>
            </View>
          </View>
          <Text style={styles.stationName}>{person?.station || dept.official_name}</Text>
        </View>

        <Pressable accessibilityRole="button" accessibilityLabel={content.unitA11y} onPress={() => router.push('/(tabs)/shift')} style={styles.appliance}>
          <View style={styles.applianceIcon}><Ionicons name={content.unitIcon} size={24} color={colors.accent} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.smallLabel}>{content.unitLabel}</Text>
            <Text style={styles.applianceTitle}>{person?.apparatus?.unit_number ?? content.noUnit}</Text>
            <Text style={styles.sub}>{person?.apparatus?.name ?? 'Complete your start-of-shift checks'}</Text>
          </View>
          <View style={styles.dutyChip}><View style={[styles.dot, { backgroundColor: onDuty ? colors.low : colors.medium }]} /><Text style={styles.sub}>{onDuty === null ? 'Checking' : onDuty ? 'On duty' : 'Off duty'}</Text></View>
          <Ionicons name="chevron-forward" size={16} color={colors.muted} />
        </Pressable>

        <MyIncidents />
        <MyPerformance />

        {/* ── Real-time incident map (the Police home's card) ── */}
        <View style={styles.mapCard}>
          <View style={styles.mapHead}>
            <Ionicons name="planet-outline" size={22} color={colors.cyan} />
            <View style={{ flex: 1 }}>
              <Text style={styles.mapTitle}>Real-Time{'\n'}Incident Map</Text>
              <Text style={styles.mapCount}>{pins.length} incident{pins.length === 1 ? '' : 's'} on the map · tap a pin</Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                <Pressable accessibilityRole="button" accessibilityLabel="Open full screen incident map" hitSlop={8} onPress={() => router.push('/live-map')}>
                  <Text style={styles.scan}>SCAN AREA</Text>
                </Pressable>
                <View style={styles.region}><Text style={styles.regionText}>ETHEKWINI</Text></View>
              </View>
              <View style={styles.live}><View style={styles.liveDot} /><Text style={styles.liveText}>LIVE</Text></View>
            </View>
          </View>
          <IncidentMap pins={pins} onOpen={(id) => router.push(`/incident/${id}`)} style={[styles.map, width >= 700 && { height: 520 }]} />
        </View>

        <View style={styles.shortcuts}>
          {([['calendar-outline', 'My schedule', '/(tabs)/schedule'], ['clipboard-outline', 'Shift record', '/(tabs)/shift']] as const).map(([icon, label, href]) => (
            <Pressable key={href} accessibilityRole="button" onPress={() => router.push(href)} style={styles.shortcut}>
              <Ionicons name={icon} size={18} color={colors.accent} /><Text style={styles.shortcutText}>{label}</Text><Ionicons name="chevron-forward" size={13} color={colors.muted} />
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const GREEN = '#22c55e';

const useStyles = makeStyles(() => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  container: { padding: space.lg, paddingBottom: space['3xl'], width: '100%', maxWidth: 960, alignSelf: 'center' },

  station: {
    marginBottom: space.lg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.panelBorder,
    backgroundColor: colors.panel, paddingHorizontal: space.md, paddingVertical: 10,
  },
  stationHead: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  headMark: { width: 3, height: 12, borderRadius: 2, backgroundColor: colors.accent },
  stationEyebrow: { color: colors.text, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  stationName: { color: colors.textDim, fontSize: 12, marginTop: 6 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: radius.pill, backgroundColor: colors.hairline,
  },
  chipText: { color: colors.textDim, fontSize: 10, fontWeight: '700' },

  appliance: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: space.md, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.panelBorder, borderRadius: radius.md, marginBottom: space.lg },
  applianceIcon: { width: 44, height: 44, borderRadius: 10, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  smallLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 1.2, color: colors.muted },
  applianceTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginVertical: 2 },
  sub: { fontSize: 11, color: colors.textDim, lineHeight: 16 },
  dutyChip: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3 },

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

  shortcuts: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: space.md },
  shortcut: { flexGrow: 1, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', minHeight: 48, borderWidth: 1, borderColor: colors.panelBorder, backgroundColor: colors.panel, borderRadius: radius.md, paddingHorizontal: 12 },
  shortcutText: { fontSize: 12, fontWeight: '700', color: colors.text },
}));
