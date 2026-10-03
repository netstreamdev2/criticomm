import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, makeStyles } from '@/lib/theme';

/** Header bell, top-right on every tab: opens the alert inbox, shows the unread count. */
export function AlertsBell({ count }: { count: number }) {
  const styles = useStyles();
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push('/alerts')}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={count > 0 ? `Alerts, ${count} unread` : 'Alerts'}
      style={({ pressed }) => [styles.bell, pressed && { opacity: 0.7 }]}
    >
      <Ionicons name={count > 0 ? 'notifications' : 'notifications-outline'} size={22} color={colors.text} />
      {count > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/** Header search, left of the bell. Icon only for now — search is not wired yet. */
export function HeaderSearch() {
  const styles = useStyles();
  return (
    <Pressable
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel="Search"
      style={({ pressed }) => [styles.search, pressed && { opacity: 0.7 }]}
    >
      <Ionicons name="search-outline" size={22} color={colors.text} />
    </Pressable>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  search: { marginRight: 4, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  bell: { marginRight: 16, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute', top: 1, right: -2, minWidth: 18, height: 18, borderRadius: 9,
    paddingHorizontal: 4, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: colors.bgSoft,
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
}));
