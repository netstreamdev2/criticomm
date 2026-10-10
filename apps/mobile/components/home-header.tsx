import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/lib/auth';
import { personTitle, wordsFor } from '@/lib/department';
import { useDuty } from '@/lib/duty';
import { useOpenCall, useReportingFor } from '@/lib/open-call';
import { pickActivity, type Activity } from '@/lib/response';
import { colors, radius, space, type, makeStyles } from '@/lib/theme';

const GREEN = '#22c55e';

/** Read at render time, so the tones follow the light/dark theme; on the way in the department's own vehicle. */
const ACTIVITY = (silo: string): Record<Activity['kind'], { label: string; icon: keyof typeof Ionicons.glyphMap; tone: string }> => ({
  idle: { label: 'Idle', icon: 'pause-circle-outline', tone: colors.idle },
  en_route: { label: 'En route', icon: wordsFor(silo).movingIcon, tone: colors.accent },
  on_scene: { label: 'On scene', icon: 'location', tone: colors.critical },
  transporting: { label: 'Transporting', icon: 'medkit', tone: colors.purple },
  reporting: { label: 'Filing report', icon: 'document-text', tone: colors.cyan },
  assigned: { label: 'Assigned to you', icon: 'person-add', tone: colors.medium },
});
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

/** The time now, re-rendered on each minute boundary rather than polled. */
function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const d = new Date();
      setNow(d);
      timer = setTimeout(tick, 60_000 - (d.getSeconds() * 1000 + d.getMilliseconds()) + 50);
    };
    tick();
    return () => clearTimeout(timer);
  }, []);
  return now;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Home header: the time, who is signed in, and whether they are on duty.
 * Duty is live from the personnel table, so it flips the moment it changes
 * anywhere; tapping it goes to start of shift until that is done.
 */
export function HomeHeader() {
  const styles = useStyles();
  const router = useRouter();
  const { fullName, silo } = useAuth();
  const { shiftStarted, onDuty } = useDuty();
  const now = useClock();
  const { calls, reportQueued, awaiting } = useOpenCall();
  const reportingFor = useReportingFor();
  // Several incidents: show the most pressing (report > on scene > en route);
  // one assigned and not yet responded to shows instead of idle.
  const activity = pickActivity(calls, (id) => reportQueued.has(id) || reportingFor === id, awaiting);
  const act = ACTIVITY(silo)[activity.kind];
  const actLabel = activity.kind === 'assigned' && activity.count > 1
    ? `${activity.count} assigned to you`
    : act.label;

  const openActivity = () => {
    if (activity.kind === 'idle') return;
    // Not responded yet: the drawer, where Responding is one tap away.
    if (activity.kind === 'assigned') {
      router.push({ pathname: '/(tabs)/incidents', params: { open: activity.incidentId } });
      return;
    }
    router.push(`/incident/${activity.incidentId}`);
  };

  const name = (fullName || '').split('@')[0]?.trim() || personTitle(silo);
  const live = onDuty === true;
  const dutyLabel = shiftStarted === false && !live ? 'SHIFT NOT STARTED' : live ? 'ON DUTY' : 'OFF DUTY';

  return (
    <View style={styles.wrap}>
      <View style={styles.top}>
        <View>
          <Text style={styles.time} accessibilityLabel={`Time ${now.getHours()}:${pad(now.getMinutes())}`}>
            {pad(now.getHours())}:{pad(now.getMinutes())}
          </Text>
          <Text style={styles.date}>
            {DAYS[now.getDay()]}, {now.getDate()} {MONTHS[now.getMonth()]}
          </Text>
          <Pressable
            disabled={activity.kind === 'idle'}
            onPress={openActivity}
            accessibilityRole={activity.kind === 'idle' ? 'text' : 'button'}
            accessibilityLabel={activity.kind === 'idle' ? actLabel : `${actLabel}, ${activity.incidentNumber}`}
            hitSlop={6}
            style={[styles.activity, { borderColor: `${act.tone}55`, backgroundColor: `${act.tone}1f` }]}
          >
            <Ionicons name={act.icon} size={12} color={act.tone} />
            <Text style={[styles.activityText, { color: act.tone }]}>{actLabel.toUpperCase()}</Text>
            {activity.kind !== 'idle' ? <Ionicons name="arrow-forward" size={12} color={act.tone} /> : null}
          </Pressable>
        </View>
        <View style={styles.right}>
          <Pressable
            onPress={() => router.push(shiftStarted === false ? '/(tabs)/shift' : '/(tabs)/profile')}
            accessibilityRole="button"
            accessibilityLabel={dutyLabel.toLowerCase()}
            hitSlop={8}
            style={[styles.duty, !live && styles.dutyWarn]}
          >
            <View style={[styles.dot, { backgroundColor: live ? GREEN : colors.medium }]} />
            <Text style={styles.dutyText}>{dutyLabel}</Text>
          </Pressable>
          <Text style={styles.welcome}>Welcome back</Text>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
        </View>
      </View>
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  wrap: { marginBottom: space.xl },
  top: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space.md },
  time: {
    color: colors.text, fontSize: 44, fontWeight: '900', letterSpacing: -1, lineHeight: 48,
    fontVariant: ['tabular-nums'],
  },
  date: { ...type.small, color: colors.textDim, marginTop: 2 },
  activity: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 5, marginTop: space.sm,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, borderWidth: 1,
  },
  activityText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  right: { flex: 1, minWidth: 0, alignItems: 'flex-end' },
  welcome: { ...type.small, fontSize: 12, color: colors.muted, marginTop: space.sm },
  name: { ...type.h2, color: colors.text, marginTop: 1, textAlign: 'right' },
  duty: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill,
    backgroundColor: 'rgba(34,197,94,0.15)', borderWidth: 1, borderColor: 'rgba(34,197,94,0.45)',
  },
  dutyWarn: { backgroundColor: colors.mediumSoft, borderColor: `${colors.medium}66` },
  dot: { width: 7, height: 7, borderRadius: 4 },
  dutyText: { color: colors.text, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
}));
