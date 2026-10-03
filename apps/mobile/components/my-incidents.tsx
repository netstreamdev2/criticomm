import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useOpenCall } from '@/lib/open-call';
import { colors, radius, severityColor, space, makeStyles } from '@/lib/theme';

/** Rows visible at once; the rest scroll inside the card. */
const VISIBLE_ROWS = 3;
const ROW_HEIGHT = 50;

const AMBER = '#f59e0b';

/** Status pill colours, in the same family as the home activity chip. */
/** Read at render time, so it follows the light/dark theme. */
const STATUS_TONE = (): Record<string, string> => ({
  Assigned: colors.medium,
  Dispatched: colors.medium,
  'En Route': colors.accent,
  Arrived: colors.critical,
  'On Scene': colors.critical,
  Transporting: colors.purple,
});

type Row = {
  id: string;
  number: string;
  type: string;
  location: string;
  severity: string | null;
  status: string;
  tag: string;
  tagTone: string;
};

/**
 * "My incidents" under the KPIs — a miniature of the console's table: what is
 * assigned to me and waiting (amber, on top), then what I am responding to.
 * Three rows show at a time and the rest scroll inside the card; tapping a
 * row opens its drawer, "View all" opens the My incidents page.
 */
export function MyIncidents() {
  const styles = useStyles();
  const router = useRouter();
  const { calls, awaiting } = useOpenCall();

  const rows: Row[] = [
    ...awaiting.map((a) => ({
      id: a.id,
      number: a.incident_number,
      type: a.incident_type ?? 'Incident',
      location: a.location_address ?? '',
      severity: a.incident_severity ?? null,
      status: 'Assigned',
      tag: 'RESPOND',
      tagTone: colors.medium,
    })),
    ...calls.map((c) => ({
      id: c.id,
      number: c.incident_number,
      type: c.incident_type ?? 'Incident',
      location: c.location_address ?? '',
      severity: c.incident_severity ?? null,
      status: c.status ?? 'En Route',
      tag: c.role === 'backup' ? 'BACKUP' : 'LEAD',
      tagTone: c.role === 'backup' ? colors.cyan : colors.accent,
    })),
  ];

  const open = (id: string) => router.push({ pathname: '/(tabs)/incidents', params: { open: id } });

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={styles.headMark} />
        <Text style={styles.title}>My incidents</Text>
        <View style={styles.count}>
          <Text style={styles.countText}>{rows.length}</Text>
        </View>
        <View style={{ flex: 1 }} />
        <Pressable
          onPress={() => router.push('/my-incidents')}
          hitSlop={8}
          accessibilityRole="button"
          style={styles.viewAllBtn}
        >
          <Text style={styles.viewAll}>View all</Text>
          <Ionicons name="chevron-forward" size={12} color={colors.accent} />
        </Pressable>
      </View>

      {rows.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="file-tray-outline" size={18} color={colors.muted} />
          <Text style={styles.emptyText}>No incidents assigned to you.</Text>
        </View>
      ) : (
        <ScrollView
          style={{ maxHeight: VISIBLE_ROWS * ROW_HEIGHT }}
          nestedScrollEnabled
          showsVerticalScrollIndicator={rows.length > VISIBLE_ROWS}
        >
          {rows.map((r, i) => {
        const sev = r.severity ? severityColor(r.severity) : colors.borderStrong;
        const tone = STATUS_TONE()[r.status] ?? colors.muted;
        return (
          <Pressable
            key={r.id}
            onPress={() => open(r.id)}
            accessibilityRole="button"
            accessibilityLabel={`${r.number}, ${r.type}, ${r.status}, ${r.tag.toLowerCase()}`}
            style={({ pressed }) => [styles.row, i > 0 && styles.rowDivider, pressed && { opacity: 0.75 }]}
          >
            <View style={[styles.sevBar, { backgroundColor: sev }]} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={styles.line}>
                <Text style={styles.number}>{r.number}</Text>
                <Text style={styles.type} numberOfLines={1}>{r.type}</Text>
              </View>
              {r.location ? (
                <View style={styles.line}>
                  <Ionicons name="location-outline" size={10} color={colors.muted} />
                  <Text style={styles.location} numberOfLines={1}>{r.location}</Text>
                </View>
              ) : null}
            </View>
            <View style={styles.right}>
              <View style={[styles.pill, { backgroundColor: `${tone}22`, borderColor: `${tone}66` }]}>
                <View style={[styles.pillDot, { backgroundColor: tone }]} />
                <Text style={[styles.pillText, { color: tone }]}>{r.status.toUpperCase()}</Text>
              </View>
              <Text style={[styles.tag, { color: r.tagTone }]}>{r.tag}</Text>
            </View>
          </Pressable>
        );
          })}
        </ScrollView>
      )}
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
  headMark: { width: 3, height: 12, borderRadius: 2, backgroundColor: colors.accent },
  title: { color: colors.text, fontSize: 13, fontWeight: '800' },
  count: {
    minWidth: 20, height: 18, paddingHorizontal: 5, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft,
  },
  countText: { color: colors.accent, fontSize: 10, fontWeight: '900' },
  viewAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  viewAll: { color: colors.accent, fontSize: 11, fontWeight: '800' },

  empty: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 },
  emptyText: { color: colors.muted, fontSize: 12 },

  row: { flexDirection: 'row', alignItems: 'center', gap: 10, height: ROW_HEIGHT, paddingRight: space.md },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  sevBar: { width: 3, alignSelf: 'stretch', borderTopRightRadius: 2, borderBottomRightRadius: 2 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  number: { color: colors.accent, fontSize: 11, fontFamily: 'monospace', fontWeight: '700' },
  type: { color: colors.text, fontSize: 12, fontWeight: '700', flexShrink: 1 },
  location: { color: colors.muted, fontSize: 11, flexShrink: 1, marginTop: 2 },
  right: { alignItems: 'flex-end', gap: 3 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.pill, borderWidth: 1,
  },
  pillDot: { width: 5, height: 5, borderRadius: 3 },
  pillText: { fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  tag: { fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },

}));
