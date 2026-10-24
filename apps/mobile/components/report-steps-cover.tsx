import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space, type, makeStyles } from '@/lib/theme';
import { onTone } from '@/components/report-wizard';
import { useT } from '@/lib/i18n';

type IconName = keyof typeof Ionicons.glyphMap;

/** One step of a report as its tile shows it. */
export type StepTile = {
  key: string;
  title: string;
  icon: string;
  /** "3 of 5 answered", "2 to fix", "Signed". */
  state: string;
  done: boolean;
  /** Something on this step stops the report filing. */
  toFix: boolean;
};

/**
 * The report's own card, as the case report's on the police screen: tap to
 * fill it in step by step. Required until every step is ready.
 */
export function ReportStartCard({ title, sub, icon, tone, ready, onPress }: {
  title: string; sub: string; icon: IconName; tone: string; ready: boolean; onPress: () => void;
}) {
  const { t } = useT();
  const styles = useStyles();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${ready ? t('Ready') : t('required')}`}
      style={({ pressed }) => [
        styles.card,
        { borderColor: `${tone}88`, backgroundColor: `${tone}1f` },
        ready && styles.cardReady,
        pressed && { opacity: 0.85 },
      ]}
    >
      <View style={[styles.cardIcon, { backgroundColor: tone }]}>
        <Ionicons name={icon} size={20} color={onTone(tone)} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardSub}>{sub}</Text>
      </View>
      {ready ? (
        <View style={[styles.tick, { backgroundColor: colors.low }]}><Ionicons name="checkmark" size={16} color="#fff" /></View>
      ) : (
        <View style={[styles.required, { backgroundColor: tone }]}>
          <Text style={[styles.requiredText, { color: onTone(tone) }]}>{t('REQUIRED')}</Text>
        </View>
      )}
    </Pressable>
  );
}

/** Every step as a tile: done, to fix, or how far along. Tap one to open it. */
export function StepTiles({ tiles, tone, onOpen }: { tiles: readonly StepTile[]; tone: string; onOpen: (index: number) => void }) {
  const { t } = useT();
  const styles = useStyles();
  return (
    <View style={styles.grid}>
      {tiles.map((s, i) => {
        const edge = s.toFix ? colors.critical : tone;
        return (
          <Pressable
            key={s.key}
            onPress={() => onOpen(i)}
            accessibilityRole="button"
            accessibilityLabel={`${t('Step {n}', { n: i + 1 })}: ${t(s.title)}, ${s.state}`}
            style={({ pressed }) => [
              styles.tile,
              {
                borderColor: s.toFix ? colors.critical : s.done ? edge : `${edge}55`,
                backgroundColor: s.toFix ? colors.criticalSoft : s.done ? `${edge}2e` : `${edge}12`,
              },
              pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
            ]}
          >
            <View style={[styles.band, { backgroundColor: edge }]} />
            <View style={styles.head}>
              <View style={[styles.icon, { backgroundColor: s.done ? edge : `${edge}33` }]}>
                <Ionicons name={s.icon as IconName} size={16} color={s.done ? onTone(edge) : edge} />
              </View>
              {s.toFix ? (
                <Ionicons name="alert-circle" size={20} color={colors.critical} />
              ) : s.done ? (
                <View style={[styles.tickSmall, { backgroundColor: edge }]}><Ionicons name="checkmark" size={14} color={onTone(edge)} /></View>
              ) : null}
            </View>
            <Text style={[styles.step, { color: edge }]}>{t('Step {n}', { n: i + 1 })}</Text>
            <Text style={styles.title} numberOfLines={2}>{t(s.title)}</Text>
            <Text style={[styles.state, s.toFix && { color: colors.critical, fontWeight: '800' }]} numberOfLines={1}>{s.state}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, marginTop: space.md, marginBottom: space.sm,
    borderRadius: radius.lg, borderWidth: 1.5,
  },
  cardReady: { borderColor: `${colors.low}aa`, backgroundColor: colors.lowSoft },
  cardIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { ...type.bodyStrong, fontSize: 16, color: colors.text, fontWeight: '800' },
  cardSub: { ...type.small, fontSize: 12, color: colors.textDim, marginTop: 2 },
  required: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  requiredText: { fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  tick: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.md },
  tile: {
    width: '48%', flexGrow: 1, padding: space.md, paddingLeft: space.md + 4, borderRadius: radius.lg,
    borderWidth: 1.5, overflow: 'hidden', minHeight: 116,
  },
  band: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  icon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  tickSmall: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  step: { fontSize: 11, fontWeight: '900', letterSpacing: 1, marginTop: space.sm, textTransform: 'uppercase' },
  title: { ...type.bodyStrong, color: colors.text, marginTop: 1 },
  state: { ...type.small, fontSize: 11, color: colors.muted, marginTop: 4 },
}));
