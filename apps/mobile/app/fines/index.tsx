import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { canIssueFines } from '@criticom/db/roles';
import { fineStage, isOverdue, normaliseReg, rand, saDate, STAGE_INFO, type FineStatus } from '@criticom/db/fines';
import { useAuth } from '@/lib/auth';
import { provisionalRef, statusTone, useMyFines, type NoticeGroup } from '@/lib/fines';
import { colors, radius, space, timeAgo, makeStyles } from '@/lib/theme';
import { Banner, Button, EmptyState, Input, SectionLabel } from '@/components/ui';
import { tx } from '@criticom/db/i18n';
import { useT } from '@/lib/i18n';

type Filter = 'All' | 'Today' | 'Overdue' | FineStatus;
const FILTERS: Filter[] = [tx('All'), tx('Today'), tx('Overdue'), 'Unpaid', 'Partially Paid', 'Paid', 'Disputed', 'Cancelled'];

/**
 * My fines — every notice this officer served, newest first, with the
 * month's figures on top and anything still waiting for signal pinned above
 * the list. Tapping one opens its slip.
 */
export default function MyFinesScreen() {
  const { t } = useT();
  const styles = useStyles();
  const router = useRouter();
  const { role, silo } = useAuth();
  const { notices, figures, queued, loading, error, refresh } = useMyFines();
  const [filter, setFilter] = useState<Filter>('All');
  const [q, setQ] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    const reg = normaliseReg(q);
    const today = saDate(new Date());
    return notices.filter((n) => {
      if (filter === 'Today' && saDate(n.first.issued_at) !== today) return false;
      if (filter === 'Overdue' && !n.fines.some((f) => isOverdue(f, today))) return false;
      if (filter !== 'All' && filter !== 'Today' && filter !== 'Overdue' && !n.fines.some((f) => f.status === filter)) return false;
      if (!term) return true;
      return n.fines.some((f) =>
        f.fine_number.toLowerCase().includes(term)
        || (f.notice_number ?? '').toLowerCase().includes(term)
        || f.offender_name.toLowerCase().includes(term)
        || f.offence_description.toLowerCase().includes(term)
        || (reg && (f.vehicle_reg ?? '').includes(reg)));
    });
  }, [notices, filter, q]);

  const stats = [
    { label: t('TODAY'), value: String(figures.today), tone: '#ef4444' },
    { label: t('THIS MONTH'), value: String(figures.thisMonth), tone: '#3b82f6' },
    { label: t('OUTSTANDING'), value: rand(figures.outstanding).replace(/\.00$/, ''), tone: '#a855f7' },
    { label: t('OVERDUE'), value: String(figures.overdue), tone: '#dc2626' },
  ];

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      refreshControl={(
        <RefreshControl
          refreshing={refreshing}
          tintColor={colors.accent}
          colors={[colors.accent]}
          progressBackgroundColor={colors.bgCard}
          onRefresh={() => { setRefreshing(true); void refresh().finally(() => setRefreshing(false)); }}
        />
      )}
    >
      {canIssueFines({ role, silo }) ? (
        <Button label={t('Issue a fine')} icon="receipt-outline" size="lg" onPress={() => router.push('/fines/new')} />
      ) : null}

      <View style={styles.stats}>
        {stats.map((s, i) => (
          <View key={s.label} style={[styles.stat, i > 0 && styles.divider]}>
            <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{s.value}</Text>
            <View style={styles.statLabelRow}>
              <View style={[styles.dot, { backgroundColor: s.tone }]} />
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          </View>
        ))}
      </View>

      {error ? <Banner tone="error">{error}</Banner> : null}

      {queued.length ? (
        <>
          <SectionLabel>{t('Waiting to send')}</SectionLabel>
          {queued.map((e) => (
            <Pressable
              key={e.id}
              onPress={() => router.push(`/fines/${e.id}`)}
              style={({ pressed }) => [styles.row, styles.rowQueued, e.status === 'failed' && styles.rowFailed, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
            >
              <Ionicons
                name={e.status === 'failed' ? 'warning' : 'cloud-upload-outline'}
                size={18}
                color={e.status === 'failed' ? colors.critical : colors.medium}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{provisionalRef(e.id)} · {e.op.label}</Text>
                <Text style={styles.rowMeta} numberOfLines={1}>
                  {e.status === 'failed' ? (e.lastError ? t('Refused: {reason}', { reason: e.lastError }) : t('Refused: see the slip')) : t('{noticeType} · {timeAgo} · prints now, numbers later', { noticeType: e.op.noticeType, timeAgo: timeAgo(e.occurredAt) })}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.muted} />
            </Pressable>
          ))}
        </>
      ) : null}

      <View style={{ marginTop: space.md }}>
        <Input value={q} onChangeText={setQ} placeholder={t('Search number, registration, name, offence')} icon="search-outline" autoCorrect={false} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
        {FILTERS.map((f) => {
          const on = f === filter;
          return (
            <Pressable key={f} onPress={() => setFilter(f)} style={[styles.filter, on && styles.filterOn]} accessibilityRole="radio" accessibilityState={{ selected: on }}>
              <Text style={[styles.filterText, on && { color: '#fff' }]}>{t(f)}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <SectionLabel>{`${shown.length} notice${shown.length === 1 ? '' : 's'}`}</SectionLabel>
      {!loading && shown.length === 0 ? (
        <EmptyState
          icon="receipt-outline"
          title={notices.length ? t('Nothing matches') : t('No fines yet')}
          body={notices.length ? t('Try another filter or search.') : t('Fines you issue appear here, with their slips.')}
        />
      ) : null}
      {shown.map((n) => <NoticeRow key={n.key} n={n} onOpen={() => router.push(`/fines/${n.first.id}`)} />)}
    </ScrollView>
  );
}

function NoticeRow({ n, onOpen }: { n: NoticeGroup; onOpen: () => void }) {
  const { t } = useT();
  const styles = useStyles();
  const status = n.fines.some((f) => f.status === 'Unpaid') ? 'Unpaid' : n.first.status;
  const tone = statusTone(status, colors);
  const stage = fineStage(n.first);
  const late = n.fines.some((f) => isOverdue(f));
  return (
    <Pressable onPress={onOpen} style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]} accessibilityRole="button">
      <View style={[styles.rail, { backgroundColor: tone }]} />
      <View style={{ flex: 1 }}>
        <View style={styles.rowTop}>
          <Text style={styles.rowTitle}>
            {n.first.fine_number}{n.fines.length > 1 ? ` +${n.fines.length - 1}` : ''}
          </Text>
          <Text style={styles.reg}>{n.first.vehicle_reg ?? n.first.notice_type}</Text>
        </View>
        <Text style={styles.rowOffence} numberOfLines={1}>{n.fines.map((f) => f.offence_description).join(' · ')}</Text>
        <Text style={styles.rowMeta} numberOfLines={1}>{n.first.offender_name} · {timeAgo(n.first.issued_at)}</Text>
        <Text style={[styles.stage, late && { color: colors.critical }]} numberOfLines={1}>
          {late ? '⚠ ' : ''}{t(stage)}{STAGE_INFO[stage].tone === 'ok' && n.first.due_date ? t(' · pay by {due_date}', { due_date: n.first.due_date }) : ''}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Text style={[styles.amount, status === 'Cancelled' && styles.struck]}>{rand(n.total)}</Text>
        <View style={[styles.pill, { borderColor: `${tone}88`, backgroundColor: `${tone}1f` }]}>
          <Text style={[styles.pillText, { color: tone }]}>{t(status)}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  container: { padding: space.lg, paddingBottom: space['3xl'] },

  stats: {
    flexDirection: 'row', marginTop: space.md, marginBottom: space.md, overflow: 'hidden',
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.panelBorder, backgroundColor: colors.panel,
  },
  stat: { flex: 1, alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4 },
  divider: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.divider },
  statValue: { color: colors.text, fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] },
  statLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  statLabel: { color: colors.muted, fontSize: 8.5, fontWeight: '800', letterSpacing: 0.8 },

  filters: { gap: 6, paddingVertical: space.sm },
  filter: {
    paddingHorizontal: 12, minHeight: 34, justifyContent: 'center', borderRadius: 17,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgElevated,
  },
  filterOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  filterText: { color: colors.textDim, fontSize: 12, fontWeight: '800' },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, paddingLeft: space.md + 4,
    marginBottom: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.bgCard, overflow: 'hidden',
  },
  rowQueued: { borderColor: `${colors.medium}66`, backgroundColor: colors.mediumSoft },
  rowFailed: { borderColor: `${colors.critical}66`, backgroundColor: colors.criticalSoft },
  rail: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rowTitle: { color: colors.text, fontSize: 14, fontWeight: '900', fontFamily: 'monospace' },
  reg: {
    color: colors.text, fontSize: 11, fontWeight: '900', letterSpacing: 1, paddingHorizontal: 6, paddingVertical: 1,
    borderRadius: 4, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.bgElevated,
  },
  rowOffence: { color: colors.textDim, fontSize: 12, marginTop: 3 },
  rowMeta: { color: colors.muted, fontSize: 11, marginTop: 2 },
  stage: { color: colors.textDim, fontSize: 11, fontWeight: '800', marginTop: 2 },
  amount: { color: colors.text, fontSize: 14, fontWeight: '900', fontVariant: ['tabular-nums'] },
  struck: { textDecorationLine: 'line-through', color: colors.muted },
  pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  pillText: { fontSize: 9, fontWeight: '900', letterSpacing: 0.4, textTransform: 'uppercase' },
}));
