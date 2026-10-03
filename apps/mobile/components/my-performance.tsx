import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { formatMinutes, monthlyAttended, periodStart, summarise } from '@/lib/performance';
import { usePerformance } from '@/lib/use-performance';
import { colors, radius, space, makeStyles, useTheme } from '@/lib/theme';

const BLUE = '#3b82f6';
const CYAN = '#22d3ee';
const GREEN = '#22c55e';
const AMBER = '#f59e0b';

/** Five segments, filled to the score out of 5. */
function ScoreBar({ score }: { score: number }) {
  const styles = useStyles();
  return (
    <View style={styles.scoreBar}>
      {[1, 2, 3, 4, 5].map((n) => {
        const fill = Math.max(0, Math.min(1, score - (n - 1)));
        return (
          <View key={n} style={styles.scoreSeg}>
            <View style={[styles.scoreFill, { width: `${fill * 100}%` }]} />
          </View>
        );
      })}
    </View>
  );
}

/**
 * "My performance" under My incidents — this month at a glance: incidents
 * attended (and the 6-month trend), time to scene, reports filed, and the
 * appraisal score. "View all" opens the full My performance page.
 */
export function MyPerformance() {
  const styles = useStyles();
  const { isDark } = useTheme();
  const router = useRouter();
  const { rows, appraisal } = usePerformance();
  const month = summarise(rows, periodStart('This month'));
  const trend = monthlyAttended(rows, 6);
  const peak = Math.max(1, ...trend.map((t) => t.count));
  const score = appraisal?.finalAverage ?? appraisal?.midYearAverage ?? null;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={styles.headMark} />
        <Text style={styles.title}>My performance</Text>
        <View style={styles.period}>
          <Text style={styles.periodText}>THIS MONTH</Text>
        </View>
        <View style={{ flex: 1 }} />
        <Pressable
          onPress={() => router.push('/my-performance')}
          hitSlop={8}
          accessibilityRole="button"
          style={styles.viewAllBtn}
        >
          <Text style={styles.viewAll}>View all</Text>
          <Ionicons name="chevron-forward" size={12} color={colors.accent} />
        </Pressable>
      </View>

      <View style={styles.metrics}>
        <View style={[styles.metric, { flex: 1.3 }]} accessible accessibilityLabel={`Attended ${month.attended} this month, ${month.led} as lead, ${month.backup} as backup`}>
          <View style={styles.attendedRow}>
            <Text style={[styles.value, { textShadowColor: isDark ? `${BLUE}99` : 'transparent' }]}>{month.attended}</Text>
            {/* Six-month trend, this month on the right. */}
            <View style={styles.spark}>
              {trend.map((t, i) => (
                <View
                  key={`${t.label}-${i}`}
                  style={[
                    styles.sparkBar,
                    { height: 3 + (t.count / peak) * 19, backgroundColor: i === trend.length - 1 ? BLUE : `${BLUE}55` },
                  ]}
                />
              ))}
            </View>
          </View>
          <Text style={styles.label}>ATTENDED</Text>
          <Text style={styles.sub}>{month.led} lead · {month.backup} backup</Text>
        </View>

        <View style={[styles.metric, styles.divider]} accessible accessibilityLabel={`Average time to scene ${formatMinutes(month.avgToScene)}`}>
          <Text style={[styles.value, { textShadowColor: isDark ? `${CYAN}99` : 'transparent' }]}>{formatMinutes(month.avgToScene)}</Text>
          <Text style={styles.label}>TO SCENE</Text>
          <Text style={styles.sub}>avg, as lead</Text>
        </View>

        <View style={[styles.metric, styles.divider]} accessible accessibilityLabel={`${month.reportsFiled} reports filed this month`}>
          <Text style={[styles.value, { textShadowColor: isDark ? `${GREEN}99` : 'transparent' }]}>{month.reportsFiled}</Text>
          <Text style={styles.label}>REPORTS</Text>
          <Text style={styles.sub}>filed</Text>
        </View>
      </View>

      <View style={styles.appraisal} accessible accessibilityLabel={score !== null ? `Appraisal ${score} out of 5` : 'No appraisal plan yet'}>
        <Ionicons name="ribbon-outline" size={13} color={AMBER} />
        <Text style={styles.appraisalLabel}>Appraisal {appraisal?.cycleLabel ?? ''}</Text>
        <View style={{ flex: 1 }} />
        {score !== null ? (
          <>
            <ScoreBar score={score} />
            <Text style={styles.score}>{score.toFixed(1)}<Text style={styles.scoreOf}> / 5</Text></Text>
          </>
        ) : (
          <Text style={styles.noPlan}>{appraisal?.hasPlan ? 'Not scored yet' : 'No plan yet'}</Text>
        )}
      </View>
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
  headMark: { width: 3, height: 12, borderRadius: 2, backgroundColor: AMBER },
  title: { color: colors.text, fontSize: 13, fontWeight: '800' },
  period: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: colors.hairline },
  periodText: { color: colors.muted, fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  viewAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  viewAll: { color: colors.accent, fontSize: 11, fontWeight: '800' },

  metrics: { flexDirection: 'row', paddingVertical: 10 },
  metric: { flex: 1, paddingHorizontal: space.md },
  divider: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.divider },
  attendedRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  value: {
    color: colors.text, fontSize: 20, fontWeight: '900', fontVariant: ['tabular-nums'],
    textShadowRadius: 10, textShadowOffset: { width: 0, height: 0 },
  },
  spark: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 22, marginBottom: 4 },
  sparkBar: { width: 4, borderRadius: 1 },
  label: { color: colors.muted, fontSize: 9, fontWeight: '800', letterSpacing: 0.9, marginTop: 1 },
  sub: { color: colors.muted, fontSize: 10, marginTop: 1, opacity: 0.8 },

  appraisal: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: space.md, paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider,
  },
  appraisalLabel: { color: colors.textDim, fontSize: 11, fontWeight: '700' },
  scoreBar: { flexDirection: 'row', gap: 2 },
  scoreSeg: { width: 12, height: 5, borderRadius: 2, overflow: 'hidden', backgroundColor: colors.track },
  scoreFill: { height: '100%', backgroundColor: AMBER },
  score: { color: colors.text, fontSize: 12, fontWeight: '900', marginLeft: 4 },
  scoreOf: { color: colors.muted, fontSize: 10, fontWeight: '700' },
  noPlan: { color: colors.muted, fontSize: 11 },
}));
