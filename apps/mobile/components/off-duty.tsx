import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { dayLabel, getMyDay, saDay, saTime, type MyDay } from '@criticom/api';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useDuty } from '@/lib/duty';
import { colors, radius, space, makeStyles } from '@/lib/theme';
import { Banner, Button } from '@/components/ui';
import { useT } from '@/lib/i18n';

/**
 * Off duty, the app stays open; only the duty screens ask first.
 *
 *   TodayCard    what today is for me: on leave, my shift now or next, or
 *                nothing on the roster. Tapping it opens My Schedule.
 *   OffDutyGate  in front of a duty screen while off duty: start today's
 *                shift (if its check is not done), or go back on duty (one
 *                tap, if it is), or go back home.
 */

/** Today's shift or leave, read again each time the screen comes into view. */
export function useMyDay(): MyDay | null {
  const { session } = useAuth();
  const [day, setDay] = useState<MyDay | null>(null);
  useFocusEffect(useCallback(() => {
    if (!session) return;
    let alive = true;
    void getMyDay(getSupabase(), session.user.id)
      .then((d) => { if (alive) setDay(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, [session?.user.id]));
  return day;
}

export function TodayCard({ day }: { day: MyDay | null }) {
  const { t } = useT();
  const styles = useStyles();
  const router = useRouter();
  if (!day) return null;

  let icon: keyof typeof Ionicons.glyphMap = 'calendar-outline';
  let tone = colors.accent;
  let label = t('TODAY');
  let title = t('No shift on your roster today');
  let sub: string | null = null;

  if (day.leave) {
    icon = 'airplane-outline';
    tone = colors.low;
    label = t('ON LEAVE');
    title = day.leave.absence ? t(day.leave.absence) : t('On leave today');
    sub = t('Back after {day}', { day: dayLabel(day.leave.until, t) });
  } else if (day.shift?.start_at && day.shift.end_at) {
    const now = Date.now();
    const start = Date.parse(day.shift.start_at);
    const on = start <= now;
    const today = saDay(now) === saDay(start);
    icon = 'time-outline';
    tone = on ? colors.low : colors.accent;
    label = on ? t('YOUR SHIFT NOW') : today ? t('YOUR SHIFT TODAY') : t('YOUR NEXT SHIFT');
    title = `${today ? '' : `${dayLabel(saDay(start), t)} · `}${saTime(day.shift.start_at)} – ${saTime(day.shift.end_at)}`;
    sub = [day.shift.post, day.shift.station, day.shift.vehicle, day.shift.call_sign].filter(Boolean).join(' · ') || null;
  }

  return (
    <Pressable
      onPress={() => router.push('/(tabs)/schedule')}
      accessibilityRole="button"
      accessibilityLabel={[label, title, sub].filter(Boolean).join('. ')}
      style={({ pressed }) => [styles.today, pressed && { opacity: 0.85 }]}
    >
      <View style={[styles.todayIcon, { backgroundColor: `${tone}22` }]}>
        <Ionicons name={icon} size={20} color={tone} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.todayLabel, { color: tone }]}>{label}</Text>
        <Text style={styles.todayTitle} numberOfLines={1}>{title}</Text>
        {sub ? <Text style={styles.todaySub} numberOfLines={1}>{sub}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  );
}

/** In front of a duty screen while off duty. */
export function OffDutyGate() {
  const { t } = useT();
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { shiftStarted, checking, goOnDuty } = useDuty();
  const day = useMyDay();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (checking && shiftStarted === null) {
    return <View style={[styles.gate, styles.center]}><ActivityIndicator color={colors.accent} /></View>;
  }

  // Today's start-of-shift check is the record that they were fit for duty: no calls before it.
  const needsStart = shiftStarted !== true;
  const backOn = () => {
    setError(null);
    setBusy(true);
    void goOnDuty()
      .then((ok) => { if (!ok) setError(t('You are on duty, but today’s start of shift could not be confirmed. Check your signal and try again.')); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <ScrollView
      style={styles.gate}
      contentContainerStyle={[styles.gateBody, { paddingTop: insets.top + space['2xl'], paddingBottom: insets.bottom + space['2xl'] }]}
    >
      <View style={styles.moon}>
        <Ionicons name={needsStart ? 'clipboard-outline' : 'moon-outline'} size={34} color={colors.medium} />
      </View>
      <Text style={styles.gateTitle}>{needsStart ? t('Start your shift first') : t('You are off duty')}</Text>
      <Text style={styles.gateText}>
        {needsStart
          ? t('Incidents and calls open once today’s start of shift is done.')
          : t('Go on duty to see incidents and receive calls.')}
      </Text>

      <TodayCard day={day} />

      {error ? <Banner tone="error" onDismiss={() => setError(null)}>{error}</Banner> : null}

      <View style={{ gap: space.sm, alignSelf: 'stretch' }}>
        {needsStart ? (
          <Button label={t('Start my shift')} icon="play" size="lg" onPress={() => router.replace('/(tabs)/shift')} />
        ) : (
          <Button label={t('Go on duty')} icon="radio" size="lg" busy={busy} onPress={backOn} />
        )}
        <Button label={t('Back to home')} variant="subtle" onPress={() => router.replace('/')} disabled={busy} />
      </View>
    </ScrollView>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  today: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, alignSelf: 'stretch',
    marginBottom: space.lg, padding: space.md, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.panelBorder, backgroundColor: colors.panel,
  },
  todayIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  todayLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  todayTitle: { color: colors.text, fontSize: 16, fontWeight: '800', marginTop: 1 },
  todaySub: { color: colors.textDim, fontSize: 13, marginTop: 1 },

  gate: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  gateBody: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg, maxWidth: 520, width: '100%', alignSelf: 'center' },
  moon: {
    width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.mediumSoft, marginBottom: space.lg,
  },
  gateTitle: { color: colors.text, fontSize: 24, fontWeight: '800', textAlign: 'center' },
  gateText: { color: colors.textDim, fontSize: 15, textAlign: 'center', marginTop: space.sm, marginBottom: space.xl, lineHeight: 21 },
}));
