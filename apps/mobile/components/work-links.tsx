import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { tx } from '@criticom/db/i18n';
import { useFeatures } from '@/lib/features';
import { useAuth } from '@/lib/auth';
import { departmentOf } from '@/lib/department';
import { colors, radius, space, makeStyles } from '@/lib/theme';
import { useFinesTab } from '@/components/fines-card';
import { useT } from '@/lib/i18n';
import { isRadioDevice } from '@/lib/radio-keys';

type IconName = keyof typeof Ionicons.glyphMap;
type Row = { href: string; icon: IconName; tone: string; title: string; sub: string };

/**
 * My work on the profile: one clear button per section, each opening its own
 * page with all its detail. One list, so nothing has to be scrolled past to
 * find it.
 */
export function WorkLinks() {
  const { t } = useT();
  const styles = useStyles();
  const router = useRouter();
  const { enabled } = useFeatures();
  const fines = useFinesTab();
  const { silo } = useAuth();

  const rows: Row[] = [
    { href: '/(tabs)/shift', icon: 'clipboard-outline', tone: colors.accent, title: tx('My shift'), sub: tx('Start of shift, your unit and kit') },
    { href: '/(tabs)/schedule', icon: 'calendar-outline', tone: colors.accent, title: tx('My schedule'), sub: tx('Your shifts, swaps and days off') },
    { href: '/kit', icon: 'construct-outline', tone: '#f59e0b', title: tx('Radio and hard hat'), sub: tx('What is booked to you today') },
    { href: '/my-incidents', icon: 'warning-outline', tone: colors.critical, title: tx('My incidents'), sub: tx('The calls you worked') },
    { href: '/my-performance', icon: 'stats-chart-outline', tone: colors.low, title: tx('My performance'), sub: tx('Your figures this month') },
    // Fire & Rescue's site inspections (0106).
    ...(departmentOf(silo) === 'fire' ? [{ href: '/inspections', icon: 'business-outline' as IconName, tone: '#f97316', title: tx('Site inspections'), sub: tx('Sites due and new inspections') }] : []),
    ...(fines ? [{ href: '/(tabs)/fines', icon: 'receipt-outline' as IconName, tone: colors.medium, title: tx('Fines'), sub: tx('Notices you issued') }] : []),
    // The radio or hard hat itself: connection, battery, start-up and its buttons.
    ...(isRadioDevice() ? [{ href: '/radio-setup', icon: 'radio-outline' as IconName, tone: colors.accent, title: tx('Radio setup'), sub: tx('Connection, battery and buttons') }] : []),
    ...(enabled('mobile.leave') ? [{ href: '/leave', icon: 'airplane-outline' as IconName, tone: colors.low, title: tx('Leave'), sub: tx('Apply for leave and see your balance') }] : []),
  ];

  return (
    <View style={styles.list}>
      {rows.map((r, i) => (
        <Pressable
          key={r.href}
          accessibilityRole="button"
          accessibilityLabel={`${t(r.title)}. ${t(r.sub)}`}
          onPress={() => router.push(r.href as never)}
          style={({ pressed }) => [styles.row, i > 0 && styles.divider, pressed && styles.pressed]}
        >
          <View style={[styles.icon, { backgroundColor: `${r.tone}22` }]}>
            <Ionicons name={r.icon} size={20} color={r.tone} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.title} numberOfLines={1}>{t(r.title)}</Text>
            <Text style={styles.sub} numberOfLines={1}>{t(r.sub)}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.muted} />
        </Pressable>
      ))}
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  list: {
    marginBottom: space.lg, overflow: 'hidden', borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.panelBorder, backgroundColor: colors.panel,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 64, paddingHorizontal: space.md, paddingVertical: space.sm },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  pressed: { backgroundColor: colors.bgSoft },
  icon: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontSize: 16, fontWeight: '800' },
  sub: { color: colors.textDim, fontSize: 13, marginTop: 1 },
}));
