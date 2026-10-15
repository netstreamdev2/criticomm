import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { dayLabel, getMyMonth, getMyShiftNow, lineActive, saDay, saTime, type MyMonth, type ScheduleLine } from '@criticom/api';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { colors, space, type, makeStyles } from '@/lib/theme';
import { Card, Muted } from '@/components/ui';
import { useT } from '@/lib/i18n';

/** On the profile: the next shift, and this month at a glance. Opens My Schedule. */
export function MyShiftsCard() {
  const { t } = useT();
  const styles = useStyles();
  const router = useRouter();
  const { session, silo } = useAuth();
  const [next, setNext] = useState<ScheduleLine | null>(null);
  const [month, setMonth] = useState<MyMonth | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    const sb = getSupabase();
    const [n, m] = await Promise.all([
      getMyShiftNow(sb, session.user.id).catch(() => null),
      getMyMonth(sb, { userId: session.user.id, silo, month: saDay().slice(0, 7) }).catch(() => null),
    ]);
    setNext(n);
    setMonth(m);
  }, [session, silo]);
  useEffect(() => { void load(); }, [load]);

  const thisMonth = (month?.lines ?? []).filter((l) => l.duty_date?.startsWith(saDay().slice(0, 7)) && lineActive(l.status, l.cancelled_at));
  const done = thisMonth.filter((l) => l.end_at && Date.parse(l.end_at) < Date.now());
  const late = done.filter((l) => (l.attendance?.late_minutes ?? 0) > (month?.settings.grace ?? 10)).length;
  const missed = done.filter((l) => !l.attendance?.checked_in_at && !l.attendance?.outcome).length;
  const shiftLine = (l: ScheduleLine) => `${name(l)} · ${dayLabel(l.duty_date ?? saDay(), t)} · ${saTime(l.start_at!)}–${saTime(l.end_at!)}`;
  const name = (l: ScheduleLine) => (l.template_id && month?.templates.find((item) => item.id === l.template_id)?.name) || l.activity_type || t('Shift');

  return (
    <Pressable onPress={() => router.push('/(tabs)/schedule')} accessibilityRole="button" accessibilityLabel={t('My schedule')}>
      <Card>
        <View style={styles.row}>
          <Ionicons name="calendar-outline" size={18} color={colors.accent} />
          <Text style={styles.title}>{t('My shifts')}</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.muted} style={{ marginLeft: 'auto' }} />
        </View>
        <Muted>
          {next?.start_at && next.end_at
            ? (Date.parse(next.start_at) <= Date.now() ? t('Now: {shift}', { shift: shiftLine(next) }) : t('Next: {shift}', { shift: shiftLine(next) }))
            : t('Nothing on your roster in the next day.')}
        </Muted>
        <Muted>
          {thisMonth.length === 1 ? t('This month: 1 shift') : t('This month: {n} shifts', { n: thisMonth.length })}
          {late ? t(' · {late} late', { late }) : ''}{missed ? t(' · {missed} not started', { missed }) : ''}
        </Muted>
      </Card>
    </Pressable>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.xs },
  title: { ...type.bodyStrong, color: colors.text },
}));
