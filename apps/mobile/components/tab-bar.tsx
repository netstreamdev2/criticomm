import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { colors, makeStyles } from '@/lib/theme';
import { useFinesTab } from '@/components/fines-card';
import { tx } from '@criticom/db/i18n';
import { useT } from '@/lib/i18n';

type TabBarProps = Parameters<NonNullable<React.ComponentProps<typeof Tabs>['tabBar']>>[0];
type IconName = React.ComponentProps<typeof Ionicons>['name'];

/**
 * The curved tab bar: two tabs either side of a raised red Incidents button
 * that sits in a notch cut into the navy bar. Incidents is the centre because
 * it is the screen a responder opens most, and the one that must be found
 * without looking.
 */

/** Height of the bar above the safe-area inset. */
const BAR = 64;
const BUTTON = 62;
/** Depth of the notch the centre button sits in. */
const NOTCH_DEPTH = 38;
/** How far the centre button rises above the top edge of the bar. */
export const CENTRE_RISE = BUTTON / 2 - 4;
const CENTRE_SLOT = 96;

const SIDE_TABS: Record<string, { label: string; icon: IconName; active: IconName }> = {
  index: { label: tx('Home'), icon: 'home-outline', active: 'home' },
  shift: { label: tx('Shift'), icon: 'clipboard-outline', active: 'clipboard' },
  fines: { label: tx('Fines'), icon: 'receipt-outline', active: 'receipt' },
  schedule: { label: tx('Schedule'), icon: 'calendar-outline', active: 'calendar' },
  profile: { label: tx('Profile'), icon: 'person-outline', active: 'person' },
};
// Fines sit next to Home for those who issue them; Shift is then on Home and the profile.
const LEFT = ['index', 'shift'];
const LEFT_WITH_FINES = ['index', 'fines'];
const RIGHT = ['schedule', 'profile'];
const CENTRE = 'incidents';

/** Total bar height including the bottom inset — for overlays that must clear it. */
export function useTabBarHeight() {
  const insets = useSafeAreaInsets();
  return BAR + Math.max(insets.bottom, 8);
}

function barPath(w: number, h: number) {
  const cx = w / 2;
  const d = NOTCH_DEPTH;
  return [
    'M0,0',
    `L${cx - 58},0`,
    `C${cx - 40},0 ${cx - 40},${d} ${cx},${d}`,
    `C${cx + 40},${d} ${cx + 40},0 ${cx + 58},0`,
    `L${w},0 L${w},${h} L0,${h} Z`,
  ].join(' ');
}

function edgePath(w: number) {
  const cx = w / 2;
  const d = NOTCH_DEPTH;
  return `M0,0.5 L${cx - 58},0.5 C${cx - 40},0.5 ${cx - 40},${d + 0.5} ${cx},${d + 0.5} C${cx + 40},${d + 0.5} ${cx + 40},0.5 ${cx + 58},0.5 L${w},0.5`;
}

export function CurvedTabBar({ state, navigation }: TabBarProps) {
  const { t } = useT();
  const styles = useStyles();
  const { width } = useWindowDimensions();
  const height = useTabBarHeight();
  const bottomPad = height - BAR;

  const focusedName = state.routes[state.index]?.name;
  const left = useFinesTab() ? LEFT_WITH_FINES : LEFT;

  const press = (name: string) => {
    const route = state.routes.find((r) => r.name === name);
    if (!route) return;
    const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (focusedName !== name && !event.defaultPrevented) navigation.navigate(route.name, route.params);
  };

  const side = (name: string) => {
    const meta = SIDE_TABS[name];
    if (!meta || !state.routes.some((r) => r.name === name)) return null;
    const focused = focusedName === name;
    const tone = focused ? colors.text : colors.muted;
    return (
      <Pressable
        key={name}
        onPress={() => press(name)}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={t(meta.label)}
        style={styles.tab}
      >
        <Ionicons name={focused ? meta.active : meta.icon} size={22} color={tone} />
        <Text style={[styles.label, { color: tone }, focused && styles.labelActive]}>{t(meta.label)}</Text>
      </Pressable>
    );
  };

  const centreFocused = focusedName === CENTRE;

  return (
    <View style={[styles.wrap, { height }]}>
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Path d={barPath(width, height)} fill={colors.bgCard} />
        <Path d={edgePath(width)} stroke={colors.borderStrong} strokeWidth={1} fill="none" />
      </Svg>

      <View style={[styles.row, { paddingBottom: bottomPad }]}>
        {left.map(side)}
        {/* Same structure as a side tab, with the raised button in place of the
            icon, so the label lines up with the others. */}
        <Pressable
          onPress={() => press(CENTRE)}
          accessible={false}
          style={[styles.tab, { flex: 0, width: CENTRE_SLOT }]}
        >
          <View style={{ height: 22 }} />
          <Text style={[styles.label, { color: centreFocused ? colors.text : colors.muted }, centreFocused && styles.labelActive]}>
            {t('Incidents')}
          </Text>
        </Pressable>
        {RIGHT.map(side)}
      </View>

      <Pressable
        onPress={() => press(CENTRE)}
        accessibilityRole="tab"
        accessibilityState={{ selected: centreFocused }}
        accessibilityLabel={t('Incidents')}
        style={({ pressed }) => [
          styles.centre,
          { left: width / 2 - BUTTON / 2 },
          centreFocused && styles.centreFocused,
          pressed && { transform: [{ scale: 0.94 }] },
        ]}
      >
        <Ionicons name={centreFocused ? 'warning' : 'warning-outline'} size={28} color="#fff" />
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  // The notch shows the app background, so the bar reads as cut out.
  wrap: { backgroundColor: colors.bg },
  row: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, paddingTop: 6 },
  label: { fontSize: 11, fontWeight: '600' },
  labelActive: { fontWeight: '800' },
  centre: {
    position: 'absolute',
    top: -CENTRE_RISE,
    width: BUTTON,
    height: BUTTON,
    borderRadius: BUTTON / 2,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.bg,
    shadowColor: colors.primary,
    shadowOpacity: 0.55,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 10,
  },
  centreFocused: { borderColor: '#ffffff' },
}));
