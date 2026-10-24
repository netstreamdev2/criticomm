import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { listFireInspections, listFirePremises, type FirePremises, type FireSiteInspection } from '@criticom/api';
import { addDays, premisesState, saDay } from '@criticom/db/fire-inspection';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useSync } from '@/lib/sync';
import { departmentOf } from '@/lib/department';
import { colors, radius, space, makeStyles } from '@/lib/theme';
import { Button, EmptyState, Input, SectionLabel } from '@/components/ui';
import { useT } from '@/lib/i18n';

const STATE_TONE = (): Record<ReturnType<typeof premisesState>, string> => ({
  'Never inspected': colors.medium, Overdue: colors.critical, 'Notice open': colors.high, 'Due soon': colors.medium, 'Up to date': colors.low,
});
const OUTCOME_TONE = (): Record<string, string> => ({
  Compliant: colors.low, 'Compliance notice': colors.high, Instruction: colors.critical,
});

/**
 * Site inspections for Fire & Rescue (0106): the sites due (never inspected,
 * overdue, a notice to follow up, due in the next two weeks), the register to
 * search, and this inspector's own visits. Open without a start of shift:
 * fire safety inspectors do not ride the appliances.
 */
export default function InspectionsScreen() {
  const { t } = useT();
  const styles = useStyles();
  const router = useRouter();
  const { session, silo } = useAuth();
  const { pending } = useSync();
  const [due, setDue] = useState<FirePremises[]>([]);
  const [found, setFound] = useState<FirePremises[] | null>(null);
  const [mine, setMine] = useState<FireSiteInspection[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const today = saDay();

  const load = useCallback(async () => {
    if (!session) return;
    const sb = getSupabase();
    await Promise.all([
      listFirePremises(sb, { dueBy: addDays(today, 14), limit: 200 }).then(setDue).catch(() => {}),
      listFireInspections(sb, { inspector: session.user.id, limit: 30 }).then(setMine).catch(() => {}),
    ]);
    setLoading(false);
  }, [session, today]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const search = async (text: string) => {
    setQ(text);
    if (text.trim().length < 2) { setFound(null); return; }
    setFound(await listFirePremises(getSupabase(), { q: text, limit: 30 }).catch(() => []));
  };

  const waiting = useMemo(() => pending.filter((e) => e.op.kind === 'fire_inspection'), [pending]);

  if (departmentOf(silo) !== 'fire') {
    return (
      <View style={[styles.center, { paddingHorizontal: space.lg }]}>
        <EmptyState icon="lock-closed-outline" title={t('For Fire & Rescue')} body={t('Site inspections are done by Fire & Rescue.')} />
      </View>
    );
  }

  const premisesRow = (p: FirePremises) => {
    const state = premisesState(p, today);
    const tone = STATE_TONE()[state];
    return (
      <Pressable
        key={p.id}
        accessibilityRole="button"
        onPress={() => router.push({ pathname: '/inspection/new', params: { premises: p.id } })}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <View style={[styles.bar, { backgroundColor: tone }]} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.rowTitle} numberOfLines={1}>{p.name}</Text>
          <Text style={styles.rowSub} numberOfLines={1}>{p.address}</Text>
          <Text style={[styles.state, { color: tone }]}>
            {t(state)}{p.next_due ? ` · ${p.next_due}` : ''}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.muted} />
      </Pressable>
    );
  };

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.accent} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} />}
    >
      <Button label={t('New site inspection')} icon="add-circle" variant="success" size="lg" onPress={() => router.push('/inspection/new')} />

      <View style={{ marginTop: space.lg }}>
        <Input icon="search" value={q} onChangeText={(v) => void search(v)} placeholder={t('Find a site by name or address')} />
      </View>
      {found ? (
        <View style={styles.list}>
          {found.length ? found.map(premisesRow) : <Text style={styles.none}>{t('No site found. Start a new inspection to add it.')}</Text>}
        </View>
      ) : null}

      {waiting.length ? (
        <>
          <SectionLabel>{t('Waiting to send')}</SectionLabel>
          <View style={styles.list}>
            {waiting.map((e) => (
              <View key={e.id} style={styles.row}>
                <Ionicons name="time-outline" size={18} color={colors.medium} />
                <Text style={[styles.rowTitle, { flex: 1 }]} numberOfLines={1}>{e.op.kind === 'fire_inspection' ? e.op.label : ''}</Text>
              </View>
            ))}
          </View>
        </>
      ) : null}

      <SectionLabel>{t('Due for inspection')}</SectionLabel>
      {loading ? <ActivityIndicator color={colors.accent} /> : (
        <View style={styles.list}>
          {due.length ? due.map(premisesRow) : <Text style={styles.none}>{t('Nothing due in the next two weeks.')}</Text>}
        </View>
      )}

      <SectionLabel>{t('My inspections')}</SectionLabel>
      <View style={styles.list}>
        {mine.length ? mine.map((i) => {
          const tone = OUTCOME_TONE()[i.outcome ?? ''] ?? (i.result === 'PASS' ? colors.low : colors.high);
          return (
            <Pressable
              key={i.id}
              accessibilityRole="button"
              onPress={() => router.push(`/inspection/${i.id}`)}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <View style={[styles.bar, { backgroundColor: tone }]} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.rowTitle} numberOfLines={1}>{i.business_name}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>{i.inspection_ref} · {i.inspected_at.slice(0, 10)}</Text>
                <Text style={[styles.state, { color: tone }]}>{t(i.outcome ?? i.result)}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </Pressable>
          );
        }) : <Text style={styles.none}>{t('No inspections yet.')}</Text>}
      </View>
    </ScrollView>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  container: { padding: space.lg, paddingBottom: space['3xl'] },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  list: {
    marginBottom: space.md, overflow: 'hidden', borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.panelBorder, backgroundColor: colors.panel,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 64, paddingHorizontal: space.md, paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider,
  },
  pressed: { backgroundColor: colors.bgSoft },
  bar: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
  rowTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  rowSub: { color: colors.textDim, fontSize: 13, marginTop: 1 },
  state: { fontSize: 12, fontWeight: '800', marginTop: 2 },
  none: { color: colors.muted, fontSize: 14, padding: space.md },
}));
