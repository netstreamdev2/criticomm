import { Pressable, StyleSheet, Text, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, makeStyles } from '@/lib/theme';
import { useT } from '@/lib/i18n';
import { useFeatures } from '@/lib/features';
import { CritiHead } from '@/components/criti-head';

/** Header bell, top-right on every tab: opens the alert inbox, shows the unread count. */
export function AlertsBell({ count }: { count: number }) {
  const { t } = useT();
  const styles = useStyles();
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push('/alerts')}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={count > 0 ? t('Alerts, {count} unread', { count }) : t('Alerts')}
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

/**
 * Criti, one tap from every screen (2026-10-23): it opens knowing which
 * screen it was asked from, and which call when it is a call's screen.
 */
export function HeaderCriti({ incidentId }: { incidentId?: string }) {
  const { t } = useT();
  const styles = useStyles();
  const router = useRouter();
  const pathname = usePathname();
  const { enabled } = useFeatures();
  // Not on the start of shift: those checks are the person's own answers.
  if (!enabled('mobile.assistant') || pathname === '/shift') return null;
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/assistant', params: { from: pathname, ...(incidentId ? { incident: incidentId } : {}) } })}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={t('Ask Criti')}
      style={({ pressed }) => [styles.search, pressed && { opacity: 0.7 }]}
    >
      <CritiHead size={24} />
    </Pressable>
  );
}

/** Header search, left of the bell: opens Incidents with the search box ready. */
/** HikTech Talk, one tap from every tab (0083). */
export function HeaderTalk() {
  const { t } = useT();
  const styles = useStyles();
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push('/talk')}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={t('Talk')}
      style={({ pressed }) => [styles.search, pressed && { opacity: 0.7 }]}
    >
      <Ionicons name="radio-outline" size={22} color={colors.text} />
    </Pressable>
  );
}

export function HeaderSearch() {
  const { t } = useT();
  const styles = useStyles();
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/(tabs)/incidents', params: { search: String(Date.now()) } })}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={t('Search incidents')}
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
