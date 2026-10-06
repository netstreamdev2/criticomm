import { useCallback, useState } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
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
import { FireBackdrop, FIRE_ORANGE, FIRE_PHOTO } from './fire-ui';

export function FireHome() {
  const styles = useStyles();
  const router = useRouter();
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
    // RLS also includes control-room calls routed to Fire; a silo filter would omit them.
    const offNew = subscribeNewIncidents(sb, 'all', update);
    const offUpdates = subscribeIncidentUpdates(sb, 'all', update);
    const offPerson = subscribePersonnel(sb, update, { userId: session?.user.id });
    return () => { clearTimeout(timer); offNew(); offUpdates(); offPerson(); };
  }, [load, session?.user.id]));

  return (
    <View style={styles.screen}>
      <FireBackdrop />
      <ScrollView contentContainerStyle={styles.container} refreshControl={
        <RefreshControl refreshing={refreshing} tintColor={FIRE_ORANGE} onRefresh={() => {
          setRefreshing(true); void load().finally(() => setRefreshing(false));
        }} />
      }>
        <HomeHeader />
        <View style={styles.hero}>
          <Image source={FIRE_PHOTO} resizeMode="cover" style={[StyleSheet.absoluteFillObject, { width: '100%', height: '100%' }]} />
          <View style={styles.heroShade} />
          <View style={styles.heroBody}>
            <View style={styles.eyebrowRow}><Ionicons name="flame" size={15} color="#fdba74" /><Text style={styles.eyebrow}>FIRE & RESCUE</Text></View>
            <Text style={styles.heroTitle}>Ready for the call.</Text>
            <Text style={styles.heroSubtitle}>{person?.station || dept.official_name}</Text>
            <View style={styles.heroFooter}>
              <View style={styles.heroChip}><Ionicons name="people" size={13} color="#ffedd5" /><Text style={styles.heroChipText}>{teamOnDuty ?? '—'} on duty</Text></View>
              <View style={styles.heroChip}><Ionicons name={online ? 'cloud-done-outline' : 'cloud-offline-outline'} size={13} color="#ffedd5" /><Text style={styles.heroChipText}>{failed.length ? `${failed.length} need retry` : pending.length ? `${pending.length} queued` : online ? 'Connected' : 'Offline'}</Text></View>
            </View>
          </View>
        </View>

        <HomeKpis live={overview?.live} closedToday={overview?.closedToday} />
        <Pressable accessibilityRole="button" accessibilityLabel="View your Fire shift and appliance checks" onPress={() => router.push('/(tabs)/shift')} style={styles.appliance}>
          <View style={styles.applianceIcon}><Ionicons name="bus-outline" size={25} color={FIRE_ORANGE} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.smallLabel}>YOUR APPLIANCE</Text>
            <Text style={styles.applianceTitle}>{person?.apparatus?.unit_number ?? 'No appliance assigned'}</Text>
            <Text style={styles.sub}>{person?.apparatus?.name ?? 'Complete your start-of-shift checks'}</Text>
          </View>
          <View style={styles.dutyChip}><View style={[styles.dot, { backgroundColor: onDuty ? colors.low : colors.medium }]} /><Text style={styles.sub}>{onDuty === null ? 'Checking' : onDuty ? 'On duty' : 'Off duty'}</Text></View>
          <Ionicons name="chevron-forward" size={16} color={colors.muted} />
        </Pressable>
        <MyIncidents />
        <MyPerformance />
        <View style={styles.mapCard}>
          <View style={styles.mapHead}>
            <View style={styles.mapMark}><Ionicons name="flame-outline" size={21} color={FIRE_ORANGE} /></View>
            <View style={{ flex: 1 }}><Text style={styles.mapTitle}>Fire response map</Text><Text style={styles.sub}>{pins.length} mapped incident{pins.length === 1 ? '' : 's'}</Text></View>
            <Pressable accessibilityRole="button" accessibilityLabel="Open full screen incident map" hitSlop={8} onPress={() => router.push('/live-map')} style={styles.mapOpen}><Ionicons name="expand" size={18} color={FIRE_ORANGE} /></Pressable>
          </View>
          <IncidentMap pins={pins} onOpen={(id) => router.push(`/incident/${id}`)} style={styles.map} />
        </View>
        <View style={styles.shortcuts}>
          {([['calendar-outline', 'My schedule', '/(tabs)/schedule'], ['clipboard-outline', 'Shift record', '/(tabs)/shift']] as const).map(([icon, label, href]) => (
            <Pressable key={href} accessibilityRole="button" onPress={() => router.push(href)} style={styles.shortcut}>
              <Ionicons name={icon} size={19} color={FIRE_ORANGE} /><Text style={styles.shortcutText}>{label}</Text><Ionicons name="chevron-forward" size={13} color={colors.muted} />
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, overflow: 'hidden' },
  container: { padding: space.lg, paddingBottom: space['3xl'], width: '100%', maxWidth: 960, alignSelf: 'center' },
  hero: { minHeight: 190, borderRadius: radius.xl, overflow: 'hidden', marginBottom: space.lg, borderWidth: 1, borderColor: '#f9731655' },
  heroShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(19,13,10,0.65)' },
  heroBody: { padding: space.lg, flex: 1, justifyContent: 'center' },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  eyebrow: { color: '#fed7aa', fontSize: 10, letterSpacing: 2.5, fontWeight: '800' },
  heroTitle: { fontSize: 29, lineHeight: 36, color: '#fff', fontWeight: '900', marginTop: 10, letterSpacing: -0.6 },
  heroSubtitle: { color: '#ffedd5', fontSize: 13, marginTop: 4 },
  heroFooter: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 18 },
  heroChip: { flexDirection: 'row', gap: 5, alignItems: 'center', paddingHorizontal: 9, paddingVertical: 5, backgroundColor: '#0f172a80', borderRadius: radius.pill, borderWidth: 1, borderColor: '#fed7aa40' },
  heroChipText: { fontSize: 11, fontWeight: '600', color: '#ffedd5' },
  appliance: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: space.md, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.panelBorder, borderRadius: radius.lg, marginBottom: space.lg },
  applianceIcon: { width: 46, height: 46, borderRadius: 12, backgroundColor: '#f9731618', alignItems: 'center', justifyContent: 'center' },
  smallLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 1.2, color: colors.muted },
  applianceTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginVertical: 2 },
  sub: { fontSize: 11, color: colors.textDim, lineHeight: 16 },
  dutyChip: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  mapCard: { borderRadius: radius.xl, padding: space.md, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.panelBorder },
  mapHead: { flexDirection: 'row', gap: 9, alignItems: 'center', marginBottom: space.md },
  mapMark: { width: 38, height: 38, borderRadius: 10, backgroundColor: '#f9731618', alignItems: 'center', justifyContent: 'center' },
  mapTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  mapOpen: { padding: 12 },
  map: { height: 330, borderRadius: radius.lg, overflow: 'hidden' },
  shortcuts: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: space.md },
  shortcut: { flexGrow: 1, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', minHeight: 52, borderWidth: 1, borderColor: colors.panelBorder, backgroundColor: colors.panel, borderRadius: radius.md, paddingHorizontal: 12 },
  shortcutText: { fontSize: 12, fontWeight: '700', color: colors.text },
}));
