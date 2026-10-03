import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  formatMinutes, monthlyAttended, PERF_PERIODS, periodStart, summarise, type PerfPeriod,
} from '@/lib/performance';
import { usePerformance } from '@/lib/use-performance';
import { colors, radius, space, makeStyles, useTheme } from '@/lib/theme';
import { Segmented } from '@/components/ui';

const BLUE = '#3b82f6';
const CYAN = '#22d3ee';
const GREEN = '#22c55e';
const PURPLE = '#a855f7';
const AMBER = '#f59e0b';
const RED = '#ef4444';

function Section({ title, tone, right, children }: {
  title: string; tone: string; right?: React.ReactNode; children: React.ReactNode;
}) {
  const styles = useStyles();
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={[styles.headMark, { backgroundColor: tone }]} />
        <Text style={styles.title}>{title}</Text>
        <View style={{ flex: 1 }} />
        {right}
      </View>
      {children}
    </View>
  );
}

/**
 * My performance — a field officer's own figures, worked out from what they
 * responded to (lead or backup), by period, plus this cycle's appraisal.
 */
export default function MyPerformanceScreen() {
  const styles = useStyles();
  const { isDark } = useTheme();
  const { rows, appraisal, loading, refresh } = usePerformance();
  const [period, setPeriod] = useState<PerfPeriod>('This month');
  const [refreshing, setRefreshing] = useState(false);

  const s = useMemo(() => summarise(rows, periodStart(period)), [rows, period]);
  const trend = useMemo(() => monthlyAttended(rows, 6), [rows]);
  const peak = Math.max(1, ...trend.map((t) => t.count));
  const topPeak = Math.max(1, ...s.topTypes.map((t) => t.count));
  const resolvedPct = s.attended ? Math.round((s.resolved / s.attended) * 100) : null;

  const tiles = [
    { label: 'Attended', value: String(s.attended), sub: 'lead + backup', icon: 'shield-checkmark' as const, tone: BLUE },
    { label: 'Led', value: String(s.led), sub: 'as lead officer', icon: 'star' as const, tone: CYAN },
    { label: 'Backup', value: String(s.backup), sub: 'joined others', icon: 'people' as const, tone: PURPLE },
    { label: 'Reports filed', value: String(s.reportsFiled), sub: 'as lead', icon: 'document-text' as const, tone: GREEN },
    { label: 'To scene', value: formatMinutes(s.avgToScene), sub: 'avg, responding → arrived', icon: 'speedometer' as const, tone: AMBER },
    { label: 'On scene', value: formatMinutes(s.avgOnScene), sub: 'avg, arrived → resolved', icon: 'time' as const, tone: RED },
  ];

  const score = appraisal?.finalAverage ?? appraisal?.midYearAverage ?? null;

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={styles.container}
      refreshControl={(
        <RefreshControl
          refreshing={refreshing}
          tintColor={colors.accent}
          colors={[colors.accent]}
          progressBackgroundColor={colors.bgCard}
          onRefresh={() => {
            setRefreshing(true);
            void refresh().finally(() => setRefreshing(false));
          }}
        />
      )}
    >
      <Segmented options={PERF_PERIODS} value={period} onChange={setPeriod} />

      {/* ── Figures ── */}
      <View style={styles.grid}>
        {tiles.map((t) => (
          <View key={t.label} style={styles.tile} accessible accessibilityLabel={`${t.label}: ${t.value}. ${t.sub}`}>
            <View style={[styles.accent, { backgroundColor: t.tone }]} />
            <View style={styles.tileTop}>
              <Ionicons name={t.icon} size={12} color={t.tone} />
              <Text style={styles.tileLabel} numberOfLines={1}>{t.label.toUpperCase()}</Text>
            </View>
            <Text style={[styles.tileValue, { textShadowColor: isDark ? `${t.tone}99` : 'transparent' }]}>{loading ? '—' : t.value}</Text>
            <Text style={styles.tileSub} numberOfLines={1}>{t.sub}</Text>
          </View>
        ))}
      </View>

      {/* ── Resolution ── */}
      <Section
        title="Resolved"
        tone={GREEN}
        right={<Text style={styles.headValue}>{resolvedPct === null ? '—' : `${resolvedPct}%`}</Text>}
      >
        <View style={styles.body}>
          <View style={styles.track}>
            <View style={[styles.trackFill, { width: `${resolvedPct ?? 0}%`, backgroundColor: GREEN }]} />
          </View>
          <Text style={styles.note}>
            {s.resolved} of {s.attended} attended incident{s.attended === 1 ? '' : 's'} resolved or closed ({period.toLowerCase()}).
          </Text>
        </View>
      </Section>

      {/* ── Trend ── */}
      <Section title="Attended by month" tone={BLUE} right={<Text style={styles.headHint}>last 6 months</Text>}>
        <View style={styles.chart}>
          {trend.map((t, i) => {
            const current = i === trend.length - 1;
            return (
              <View key={`${t.label}-${i}`} style={styles.barCol}>
                <Text style={styles.barValue}>{t.count || ''}</Text>
                <View style={styles.barTrack}>
                  <View
                    style={[styles.bar, {
                      height: `${Math.max(4, (t.count / peak) * 100)}%`,
                      backgroundColor: current ? BLUE : `${BLUE}66`,
                    }]}
                  />
                </View>
                <Text style={[styles.barLabel, current && { color: colors.text }]}>{t.label}</Text>
              </View>
            );
          })}
        </View>
      </Section>

      {/* ── What they attend ── */}
      <Section title="What you attend most" tone={PURPLE}>
        <View style={styles.body}>
          {s.topTypes.length === 0 ? (
            <Text style={styles.empty}>Nothing attended {period === 'Today' ? 'today' : `in ${period.toLowerCase()}`}.</Text>
          ) : s.topTypes.map((t) => (
            <View key={t.type} style={styles.typeRow}>
              <Text style={styles.typeName} numberOfLines={1}>{t.type}</Text>
              <View style={styles.typeTrack}>
                <View style={[styles.typeFill, { width: `${(t.count / topPeak) * 100}%` }]} />
              </View>
              <Text style={styles.typeCount}>{t.count}</Text>
            </View>
          ))}
        </View>
      </Section>

      {/* ── Appraisal ── */}
      <Section
        title={`Appraisal ${appraisal?.cycleLabel ?? ''}`}
        tone={AMBER}
        right={score !== null ? (
          <Text style={styles.headValue}>{score.toFixed(1)}<Text style={styles.headHint}> / 5</Text></Text>
        ) : null}
      >
        <View style={styles.body}>
          {!appraisal?.hasPlan ? (
            <Text style={styles.empty}>No appraisal plan has been created for you this cycle yet.</Text>
          ) : appraisal.appraisal.length === 0 ? (
            <Text style={styles.empty}>Plan {appraisal.planStatus?.toLowerCase() ?? 'created'} — no scores yet.</Text>
          ) : (
            <>
              <View style={styles.kpiHead}>
                <Text style={[styles.kpiCell, { flex: 1 }]}>KPI</Text>
                <Text style={styles.kpiCell}>MID</Text>
                <Text style={styles.kpiCell}>FINAL</Text>
                <View style={{ width: 18 }} />
              </View>
              {appraisal.appraisal.map((a) => (
                <View key={a.kpiTitle} style={styles.kpiRow}>
                  <Text style={styles.kpiTitle} numberOfLines={2}>{a.kpiTitle}</Text>
                  <Text style={styles.kpiScore}>{a.midYearScore ?? '—'}</Text>
                  <Text style={styles.kpiScore}>{a.finalScore ?? '—'}</Text>
                  <Ionicons
                    name={a.approved ? 'checkmark-circle' : 'ellipse-outline'}
                    size={14}
                    color={a.approved ? GREEN : colors.muted}
                    accessibilityLabel={a.approved ? 'Approved' : 'Pending'}
                  />
                </View>
              ))}
            </>
          )}
        </View>
      </Section>

      <Text style={styles.foot}>
        Figures come from incidents you responded to in the app, as lead or backup. Times are measured on incidents you led.
      </Text>
    </ScrollView>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  container: { padding: space.lg, paddingBottom: space['3xl'] },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md, marginBottom: space.md },
  tile: {
    width: '31.5%', flexGrow: 1, overflow: 'hidden', paddingHorizontal: 10, paddingTop: 10, paddingBottom: 9,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.panelBorder, backgroundColor: colors.bgCard,
  },
  accent: { position: 'absolute', top: 0, left: 0, right: 0, height: 2, opacity: 0.9 },
  tileTop: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tileLabel: { color: colors.muted, fontSize: 8, fontWeight: '900', letterSpacing: 0.7, flexShrink: 1 },
  tileValue: {
    color: colors.text, fontSize: 20, fontWeight: '900', marginTop: 4, fontVariant: ['tabular-nums'],
    textShadowRadius: 10, textShadowOffset: { width: 0, height: 0 },
  },
  tileSub: { color: colors.muted, fontSize: 9, marginTop: 1, opacity: 0.85 },

  card: {
    marginBottom: space.md, overflow: 'hidden',
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.panelBorder, backgroundColor: colors.bgCard,
  },
  head: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: space.md, paddingTop: 10, paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider,
  },
  headMark: { width: 3, height: 12, borderRadius: 2 },
  title: { color: colors.text, fontSize: 13, fontWeight: '800' },
  headValue: { color: colors.text, fontSize: 14, fontWeight: '900' },
  headHint: { color: colors.muted, fontSize: 10, fontWeight: '700' },
  body: { padding: space.md },
  note: { color: colors.muted, fontSize: 11, marginTop: 6 },
  empty: { color: colors.muted, fontSize: 12 },

  track: { height: 6, borderRadius: 3, backgroundColor: colors.track, overflow: 'hidden' },
  trackFill: { height: '100%', borderRadius: 3 },

  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, height: 120, paddingHorizontal: space.md, paddingVertical: 10 },
  barCol: { flex: 1, alignItems: 'center', height: '100%' },
  barValue: { color: colors.textDim, fontSize: 10, fontWeight: '800', height: 14 },
  barTrack: { flex: 1, width: '70%', justifyContent: 'flex-end' },
  bar: { width: '100%', borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  barLabel: { color: colors.muted, fontSize: 9, fontWeight: '800', marginTop: 4 },

  typeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  typeName: { color: colors.textDim, fontSize: 12, width: 120 },
  typeTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.track, overflow: 'hidden' },
  typeFill: { height: '100%', borderRadius: 3, backgroundColor: PURPLE },
  typeCount: { color: colors.text, fontSize: 12, fontWeight: '800', width: 24, textAlign: 'right' },

  kpiHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 6 },
  kpiCell: { color: colors.muted, fontSize: 9, fontWeight: '900', letterSpacing: 0.8, width: 40, textAlign: 'center' },
  kpiRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline,
  },
  kpiTitle: { flex: 1, color: colors.text, fontSize: 12, fontWeight: '700' },
  kpiScore: { width: 40, textAlign: 'center', color: colors.textDim, fontSize: 12, fontWeight: '800', fontFamily: 'monospace' },

  foot: { color: colors.muted, fontSize: 10, textAlign: 'center', marginTop: space.sm, opacity: 0.8 },
}));
