import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getIncidentOverview, getMyPersonnel, subscribeIncidentUpdates, subscribeNewIncidents, subscribePersonnel } from '@criticom/api';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useDuty } from '@/lib/duty';
import { useOpenCall, useReportingFor } from '@/lib/open-call';
import { pickActivity } from '@/lib/response';
import { useMapPins } from '@/lib/use-map-pins';
import { colors, radius, severityColor, space, makeStyles } from '@/lib/theme';
import { ACTIVITY, HomeHeader } from './home-header';
import { FinesQuick } from './fines-card';
import { IncidentMap } from './incident-map';
import { FireBackdrop } from './fire-ui';
import { useT } from '@/lib/i18n';

type IconName = keyof typeof Ionicons.glyphMap;

/** What differs between departments on the home; the layout is the same for every one. */
export type ServiceHomeContent = {
  /** Beside the vehicle (or station) on the "no incidents" card. */
  unitIcon: IconName;
  /** No vehicle in this department (Disaster): the card shows the station instead. */
  noVehicle?: boolean;
  /** Show how many of the team are on duty under the map. */
  showTeamOnDuty?: boolean;
  /** Issue a fine and Check owing under the card (Police). */
  fines?: boolean;
};

/**
 * The responder home, the same for Police, Fire, EMS and Disaster: the time
 * and duty, one card with the next thing to do, and the live map. Performance
 * and fines figures are on the profile; everything else is a tab away. Wide
 * screens (tablets) get a taller map.
 */
export function ServiceHome({ content }: { content: ServiceHomeContent }) {
  const { t } = useT();
  const styles = useStyles();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { session } = useAuth();
  const { teamOnDuty } = useDuty();
  const open = useOpenCall();
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

  const unit = content.noVehicle ? null : person?.apparatus;
  const where = unit?.unit_number
    ? [unit.unit_number, unit.name].filter(Boolean).join(' · ')
    : (person?.station || null);

  // One quiet line under the map instead of a row of tiles.
  const figures = [
    overview ? t('{n} live', { n: overview.live }) : null,
    overview ? t('{n} closed today', { n: overview.closedToday }) : null,
    content.showTeamOnDuty !== false && teamOnDuty !== null ? t('{n} on duty', { n: teamOnDuty }) : null,
  ].filter(Boolean).join('  ·  ');

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
            setRefreshing(true);
            void Promise.all([load(), open.refresh()]).finally(() => setRefreshing(false));
          }}
        />
      }>
        <HomeHeader minimal />

        <NowCard open={open} where={where} unitIcon={content.unitIcon} />

        {content.fines ? <FinesQuick /> : null}

        <View style={styles.mapCard}>
          <View style={styles.mapHead}>
            <View style={styles.liveDot} />
            <Text style={styles.mapTitle}>{t('Incident map')}</Text>
            <View style={{ flex: 1 }} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('Open full screen incident map')}
              hitSlop={8}
              onPress={() => router.push('/live-map')}
              style={styles.fullBtn}
            >
              <Text style={styles.full}>{t('Full map')}</Text>
              <Ionicons name="expand-outline" size={13} color={colors.accent} />
            </Pressable>
          </View>
          <IncidentMap
            pins={pins}
            onOpen={(id) => router.push(`/incident/${id}`)}
            style={[styles.map, width >= 700 && styles.mapWide]}
          />
          {figures ? <Text style={styles.figures}>{figures}</Text> : null}
        </View>
      </ScrollView>
    </View>
  );
}

/**
 * The one thing to do now, most pressing first: the incident in hand (or the
 * one waiting for a response), then starting the shift, then going on duty.
 * Nothing to do is a small, calm card. Every button opens a screen the app
 * already has; the card itself changes nothing.
 */
function NowCard({ open, where, unitIcon }: {
  open: ReturnType<typeof useOpenCall>;
  where: string | null;
  unitIcon: IconName;
}) {
  const { t } = useT();
  const styles = useStyles();
  const router = useRouter();
  const { silo } = useAuth();
  const { shiftStarted, onDuty } = useDuty();
  const reportingFor = useReportingFor();
  const { calls, awaiting, reportQueued } = open;
  const activity = pickActivity(calls, (id) => reportQueued.has(id) || reportingFor === id, awaiting);

  if (activity.kind !== 'idle') {
    const act = ACTIVITY(silo)[activity.kind];
    const assigned = activity.kind === 'assigned';
    const call = calls.find((c) => c.id === activity.incidentId)
      ?? awaiting.find((a) => a.id === activity.incidentId);
    const label = assigned && activity.count > 1 ? t('{n} assigned to you', { n: activity.count }) : t(act.label);
    const more = calls.length + awaiting.length - 1;
    const sev = call?.incident_severity;
    // Not responded yet: the drawer, where Responding is one tap away.
    const go = () => (assigned
      ? router.push({ pathname: '/(tabs)/incidents', params: { open: activity.incidentId } })
      : router.push(`/incident/${activity.incidentId}`));

    return (
      <View style={[styles.card, { borderColor: `${act.tone}66` }]}>
        <View style={[styles.bar, { backgroundColor: act.tone }]} />
        <View style={styles.line}>
          <Ionicons name={act.icon} size={14} color={act.tone} />
          <Text style={[styles.state, { color: act.tone }]}>{label.toUpperCase()}</Text>
          <View style={{ flex: 1 }} />
          {more > 0 ? (
            <Pressable
              onPress={() => router.push('/my-incidents')}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('{more} more of your incidents', { more })}
              style={styles.more}
            >
              <Text style={styles.moreText}>{t('+{n} more', { n: more })}</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={[styles.line, { marginTop: space.sm }]}>
          <Text style={styles.number}>{activity.incidentNumber}</Text>
          {sev ? (
            <View style={[styles.sev, { backgroundColor: `${severityColor(sev)}22` }]}>
              <Text style={[styles.sevText, { color: severityColor(sev) }]}>{sev.toUpperCase()}</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.title} numberOfLines={1}>{call?.incident_type ?? t('Incident')}</Text>
        {call?.location_address ? (
          <View style={[styles.line, { alignItems: 'flex-start' }]}>
            <Ionicons name="location-outline" size={13} color={colors.muted} style={{ marginTop: 1 }} />
            <Text style={styles.sub} numberOfLines={2}>{call.location_address}</Text>
          </View>
        ) : null}

        <Pressable
          onPress={go}
          accessibilityRole="button"
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        >
          <Text style={styles.buttonText}>{assigned ? t('Open and respond') : t('Open incident')}</Text>
          <Ionicons name="arrow-forward" size={18} color="#fff" />
        </Pressable>
      </View>
    );
  }

  if (shiftStarted === false && onDuty !== true) {
    return (
      <Prompt
        icon="clipboard-outline"
        title={t('Your shift has not started')}
        action={t('Start shift')}
        onPress={() => router.push('/(tabs)/shift')}
      />
    );
  }

  if (onDuty === false) {
    return (
      <Prompt
        icon="moon-outline"
        title={t('You are off duty')}
        action={t('Go on duty')}
        onPress={() => router.push('/(tabs)/profile')}
      />
    );
  }

  return (
    <View style={[styles.card, styles.calm]} accessible accessibilityLabel={where ? `${t('No incidents for you')}. ${where}` : t('No incidents for you')}>
      <View style={styles.calmIcon}>
        <Ionicons name="checkmark" size={18} color={colors.low} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.calmTitle}>{t('No incidents for you')}</Text>
        {where ? (
          <View style={styles.line}>
            <Ionicons name={unitIcon} size={12} color={colors.muted} />
            <Text style={styles.sub} numberOfLines={1}>{where}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** A card with one thing to do before the day can start. */
function Prompt({ icon, title, action, onPress }: {
  icon: IconName; title: string; action: string; onPress: () => void;
}) {
  const styles = useStyles();
  return (
    <View style={[styles.card, { borderColor: `${colors.medium}66` }]}>
      <View style={[styles.bar, { backgroundColor: colors.medium }]} />
      <View style={styles.line}>
        <Ionicons name={icon} size={18} color={colors.medium} />
        <Text style={styles.promptTitle}>{title}</Text>
      </View>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        <Text style={styles.buttonText}>{action}</Text>
        <Ionicons name="arrow-forward" size={18} color="#fff" />
      </Pressable>
    </View>
  );
}

const GREEN = '#22c55e';

const useStyles = makeStyles(() => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  // flexGrow lets the map take whatever height is left, so a phone needs no scrolling.
  container: { flexGrow: 1, padding: space.lg, paddingBottom: space['3xl'], width: '100%', maxWidth: 960, alignSelf: 'center' },

  card: {
    marginBottom: space.lg, overflow: 'hidden',
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.panelBorder,
    backgroundColor: colors.panel, padding: space.md, paddingLeft: space.md + 3,
  },
  bar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  state: { fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  more: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.accentSoft },
  moreText: { color: colors.accent, fontSize: 11, fontWeight: '800' },
  number: { color: colors.accent, fontSize: 12, fontFamily: 'monospace', fontWeight: '700' },
  sev: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.pill },
  sevText: { fontSize: 9, fontWeight: '900', letterSpacing: 0.6 },
  title: { color: colors.text, fontSize: 20, fontWeight: '800', marginTop: 2, marginBottom: 2 },
  sub: { color: colors.textDim, fontSize: 13, flexShrink: 1 },
  button: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    minHeight: 50, marginTop: space.md, borderRadius: radius.md, backgroundColor: colors.accent,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.985 }] },
  promptTitle: { color: colors.text, fontSize: 17, fontWeight: '800', flexShrink: 1 },

  calm: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingLeft: space.md },
  calmIcon: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.lowSoft,
  },
  calmTitle: { color: colors.text, fontSize: 15, fontWeight: '800', marginBottom: 2 },

  mapCard: {
    flex: 1, borderRadius: radius.xl, padding: space.md, borderWidth: 1, borderColor: colors.panelBorder,
    backgroundColor: colors.panel,
  },
  mapHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.sm },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: GREEN },
  mapTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  fullBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  full: { color: colors.accent, fontSize: 12, fontWeight: '800' },
  map: { flex: 1, minHeight: 260, borderRadius: radius.lg, overflow: 'hidden' },
  mapWide: { minHeight: 480 },
  figures: { color: colors.muted, fontSize: 12, fontWeight: '600', textAlign: 'center', marginTop: space.sm },
}));
