import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useOrg } from '@/lib/branding';
import { colors, makeStyles } from '@/lib/theme';
import { DeptBadge } from './dept-badge';
import { PoliceBadge } from './police-badge';

/**
 * The municipality's crest and name, small and muted: a letterhead on report
 * screens, a sign-off on the profile. It sits beside HikTech's mark, never
 * in its place. On a police report, the police badge goes with it.
 */
export function OrgMark({ size = 22, align = 'left', police = false, style }: {
  size?: number;
  align?: 'left' | 'center';
  police?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles();
  const org = useOrg();
  return (
    <View
      style={[styles.row, align === 'center' && { justifyContent: 'center' }, style]}
      accessible
      accessibilityLabel={org.official_name}
    >
      <DeptBadge dept={org} size={size} />
      {police ? <PoliceBadge size={size} /> : null}
      <Text style={styles.name} numberOfLines={1}>{org.official_name}</Text>
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, opacity: 0.9 },
  name: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.3, flexShrink: 1 },
}));
