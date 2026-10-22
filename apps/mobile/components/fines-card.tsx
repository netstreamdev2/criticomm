import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { canIssueFines } from '@criticom/db/roles';
import { rand } from '@criticom/db/fines';
import { useAuth } from '@/lib/auth';
import { useFeature } from '@/lib/features';
import { useMyFines } from '@/lib/fines';
import { colors, radius, space, makeStyles, useTheme } from '@/lib/theme';
import { useT } from '@/lib/i18n';

const RED = '#ef4444';
const AMBER = '#f59e0b';
const GREEN = '#22c55e';
const BLUE = '#3b82f6';

/** "R12.5k" — the strip has room for a short figure only. */
function short(amount: number): string {
  if (amount >= 1_000_000) return `R${(amount / 1_000_000).toFixed(1)}m`;
  if (amount >= 10_000) return `R${(amount / 1000).toFixed(1)}k`;
  return rand(amount).replace(/\.00$/, '');
}

/**
 * Fines on the profile, under My performance: the two things an officer
 * does — issue a fine, look up one they issued — and this month's figures.
 * Shown only to those who serve notices.
 */
/** Fines are a tab of their own for those who issue them (Police, with fines switched on). */
export function useFinesTab(): boolean {
  const { role, silo } = useAuth();
  const enabled = useFeature('mobile.fines');
  return Boolean(enabled && canIssueFines({ role, silo }));
}

export function FinesCard() {
  const { role, silo } = useAuth();
  const enabled = useFeature('mobile.fines');
  if (!enabled || !canIssueFines({ role, silo })) return null;
  return <FinesCardBody />;
}

/**
 * Fines on the home, cut to what is done at the roadside: issue a fine, check
 * what someone owes. A notice not yet sent shows as one line. Same rule as
 * the card for who sees it.
 */
export function FinesQuick() {
  const { role, silo } = useAuth();
  const enabled = useFeature('mobile.fines');
  if (!enabled || !canIssueFines({ role, silo })) return null;
  return <FinesQuickBody />;
}

function FinesQuickBody() {
  const { t } = useT();
  const styles = useStyles();
  const router = useRouter();
  const { figures, queued } = useMyFines();
  const waiting = queued.filter((q) => q.status === 'queued').length;
  const stuck = queued.filter((q) => q.status === 'failed').length;

  return (
    <View style={styles.quick}>
      <View style={styles.quickRow}>
        <Pressable
          onPress={() => router.push('/fines/new')}
          accessibilityRole="button"
          accessibilityLabel={t('Issue a fine. {today} issued today', { today: figures.today })}
          style={({ pressed }) => [styles.issue, pressed && styles.pressed]}
        >
          <View style={styles.issueIcon}><Ionicons name="receipt" size={20} color="#fff" /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.issueTitle}>{t('Issue a fine')}</Text>
            <Text style={styles.issueSub}>{t('{n} today', { n: figures.today })}</Text>
          </View>
          <Ionicons name="arrow-forward" size={18} color="#fff" />
        </Pressable>
        <Pressable
          onPress={() => router.push('/fines/check')}
          accessibilityRole="button"
          accessibilityLabel={t('Check what someone owes')}
          style={({ pressed }) => [styles.quickCheck, pressed && styles.pressed]}
        >
          <Ionicons name="search" size={18} color={colors.accent} />
          <Text style={styles.quickCheckText}>{t('Check owing')}</Text>
        </Pressable>
      </View>
      {waiting + stuck > 0 ? (
        <Pressable onPress={() => router.push('/fines')} accessibilityRole="button" style={styles.quickQueue}>
          <Ionicons name={stuck > 0 ? 'warning' : 'cloud-upload-outline'} size={13} color={stuck > 0 ? colors.critical : colors.medium} />
          <Text style={[styles.queueText, { color: stuck > 0 ? colors.critical : colors.medium }]}>
            {stuck > 0
              ? stuck === 1 ? t('1 fine not sent') : t('{n} fines not sent', { n: stuck })
              : waiting === 1 ? t('1 fine waiting for signal') : t('{n} fines waiting for signal', { n: waiting })}
          </Text>
          <Ionicons name="chevron-forward" size={13} color={colors.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

function FinesCardBody() {
  const { t } = useT();
  const styles = useStyles();
  const { isDark } = useTheme();
  const router = useRouter();
  const { figures, queued, notices } = useMyFines();
  const waiting = queued.filter((q) => q.status === 'queued').length;
  const stuck = queued.filter((q) => q.status === 'failed').length;

  const kpis = [
    { key: 'today', label: t('TODAY'), value: String(figures.today), tone: RED, a11y: t('{n} issued today', { n: figures.today }) },
    { key: 'month', label: t('THIS MONTH'), value: String(figures.thisMonth), tone: BLUE, a11y: t('{n} issued this month', { n: figures.thisMonth }) },
    { key: 'value', label: t('VALUE'), value: short(figures.valueThisMonth), tone: AMBER, a11y: t('{amount} issued this month', { amount: rand(figures.valueThisMonth) }) },
    { key: 'paid', label: t('PAID'), value: short(figures.paid), tone: GREEN, a11y: t('{amount} paid against your fines', { amount: rand(figures.paid) }) },
  ];

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={styles.headMark} />
        <Text style={styles.title}>{t('Fines')}</Text>
        <View style={styles.period}><Text style={styles.periodText}>{t('AARTO · BY-LAW')}</Text></View>
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => router.push('/fines')} hitSlop={8} accessibilityRole="button" style={styles.viewAllBtn}>
          <Text style={styles.viewAll}>{t('View all')}</Text>
          <Ionicons name="chevron-forward" size={12} color={colors.accent} />
        </Pressable>
      </View>

      <View style={styles.actions}>
        <Pressable
          onPress={() => router.push('/fines/new')}
          accessibilityRole="button"
          accessibilityLabel={t('Issue a fine')}
          style={({ pressed }) => [styles.issue, pressed && styles.pressed]}
        >
          <View style={styles.issueIcon}><Ionicons name="receipt" size={20} color="#fff" /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.issueTitle}>{t('Issue a fine')}</Text>
            <Text style={styles.issueSub} numberOfLines={1}>{t('AARTO 01 · Section 56 · 341')}</Text>
          </View>
          <Ionicons name="arrow-forward" size={18} color="#fff" />
        </Pressable>

        <Pressable
          onPress={() => router.push('/fines')}
          accessibilityRole="button"
          accessibilityLabel={t('My fines, {length} notices', { length: notices.length })}
          style={({ pressed }) => [styles.mine, pressed && styles.pressed]}
        >
          <Ionicons name="documents-outline" size={18} color={colors.accent} />
          <Text style={styles.mineCount}>{notices.length}</Text>
          <Text style={styles.mineLabel}>{t('MY FINES')}</Text>
        </Pressable>
      </View>

      <Pressable
        onPress={() => router.push('/fines/check')}
        accessibilityRole="button"
        style={({ pressed }) => [styles.check, pressed && styles.pressed]}
      >
        <Ionicons name="search" size={15} color={colors.accent} />
        <Text style={styles.checkText}>{t('Check what someone owes')}</Text>
        <Text style={styles.checkHint}>{t('ID or registration')}</Text>
        <Ionicons name="chevron-forward" size={14} color={colors.muted} />
      </Pressable>

      <View style={styles.metrics}>
        {kpis.map((k, i) => (
          <View key={k.key} style={[styles.metric, i > 0 && styles.divider]} accessible accessibilityLabel={k.a11y}>
            <Text
              style={[styles.value, { textShadowColor: isDark ? `${k.tone}99` : 'transparent' }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
            >
              {k.value}
            </Text>
            <View style={styles.labelRow}>
              <View style={[styles.dot, { backgroundColor: k.tone }]} />
              <Text style={styles.label}>{k.label}</Text>
            </View>
          </View>
        ))}
      </View>

      {waiting + stuck > 0 ? (
        <Pressable onPress={() => router.push('/fines')} style={[styles.queue, stuck > 0 && styles.queueBad]} accessibilityRole="button">
          <Ionicons name={stuck > 0 ? 'warning' : 'cloud-upload-outline'} size={13} color={stuck > 0 ? colors.critical : colors.medium} />
          <Text style={[styles.queueText, { color: stuck > 0 ? colors.critical : colors.medium }]}>
            {stuck > 0
              ? stuck === 1 ? t('1 notice refused — open to see why') : t('{n} notices refused — open to see why', { n: stuck })
              : waiting === 1 ? t('1 notice waiting for signal — slip already printable') : t('{n} notices waiting for signal — slips already printable', { n: waiting })}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  card: {
    marginBottom: space.lg, overflow: 'hidden',
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.panelBorder,
    backgroundColor: colors.panel,
  },
  head: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: space.md, paddingTop: 10, paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider,
  },
  headMark: { width: 3, height: 12, borderRadius: 2, backgroundColor: RED },
  title: { color: colors.text, fontSize: 13, fontWeight: '800' },
  period: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: colors.hairline },
  periodText: { color: colors.muted, fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  viewAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  viewAll: { color: colors.accent, fontSize: 11, fontWeight: '800' },

  actions: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.md, paddingTop: space.md },
  issue: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 58,
    paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: colors.primary,
  },
  issueIcon: {
    width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  issueTitle: { color: '#fff', fontSize: 15, fontWeight: '900' },
  issueSub: { color: 'rgba(255,255,255,0.85)', fontSize: 10, fontWeight: '700', marginTop: 1 },
  mine: {
    width: 88, alignItems: 'center', justifyContent: 'center', gap: 1, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.accentSoft,
  },
  mineCount: { color: colors.text, fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] },
  mineLabel: { color: colors.muted, fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.985 }] },
  check: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: space.md, marginTop: space.sm,
    paddingHorizontal: space.md, minHeight: 40, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  checkText: { color: colors.text, fontSize: 13, fontWeight: '800' },
  checkHint: { color: colors.muted, fontSize: 11, flex: 1 },

  metrics: { flexDirection: 'row', paddingVertical: 10 },
  metric: { flex: 1, paddingHorizontal: space.sm, alignItems: 'center' },
  divider: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.divider },
  value: {
    color: colors.text, fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'],
    textShadowRadius: 10, textShadowOffset: { width: 0, height: 0 },
  },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  label: { color: colors.muted, fontSize: 8.5, fontWeight: '800', letterSpacing: 0.8 },

  queue: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: space.md, paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider, backgroundColor: colors.mediumSoft,
  },
  queueBad: { backgroundColor: colors.criticalSoft },
  queueText: { fontSize: 11, fontWeight: '700', flex: 1 },

  quick: { marginBottom: space.lg },
  quickRow: { flexDirection: 'row', gap: space.sm },
  quickCheck: {
    width: 96, alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.panelBorder, backgroundColor: colors.panel,
  },
  quickCheckText: { color: colors.text, fontSize: 11, fontWeight: '800' },
  quickQueue: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.xs, paddingTop: space.sm },
}));
