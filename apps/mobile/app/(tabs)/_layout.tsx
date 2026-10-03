import { useCallback, useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Tabs } from 'expo-router';
import { countUnreadAlerts, subscribeAlerts, subscribeMyAlertReads } from '@criticom/api';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useFeature } from '@/lib/features';
import { colors, useTheme } from '@/lib/theme';
import { fontFamily } from '@/lib/font';
import { CurvedTabBar } from '@/components/tab-bar';
import { HikTechLogo } from '@/components/hiktech-logo';
import { AlertsBell, HeaderSearch } from '@/components/alerts-bell';
import { ThemeToggle } from '@/components/theme-toggle';

/**
 * Live unread count for the Alerts bell in the header.
 *
 * Counted server-side rather than by fetching rows and measuring them: a busy
 * shift would otherwise cap at the page size and quietly under-report. Both
 * directions are live — new alerts push it up, read receipts (from here, the
 * console, or another device) push it down — and every socket reconnect
 * re-seeds from the authoritative count so a dropped connection cannot leave
 * the badge stuck.
 */
function useUnreadAlerts(): number {
  const { session, silo } = useAuth();
  const [count, setCount] = useState(0);

  const reseed = useCallback(() => {
    if (!session) { setCount(0); return; }
    countUnreadAlerts(getSupabase()).then(setCount).catch(() => {});
  }, [session]);

  useEffect(() => {
    reseed();
    if (!session) return;
    const sb = getSupabase();
    const offAlerts = subscribeAlerts(sb, { silo }, () => reseed());
    const offReads = subscribeMyAlertReads(sb, { userId: session.user.id }, {
      onChange: () => reseed(),
      onStatus: (status) => { if (status === 'SUBSCRIBED') reseed(); },
    });
    return () => { offAlerts(); offReads(); };
  }, [session, silo, reseed]);

  return count;
}

export default function TabsLayout() {
  useTheme();
  const unread = useUnreadAlerts();
  const alertsOn = useFeature('mobile.alerts_inbox');

  return (
    <Tabs
      tabBar={(props) => <CurvedTabBar {...props} />}
      screenOptions={{
        headerStyle: {
          backgroundColor: colors.bgSoft,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.border,
          // The default iOS header shadow reads as a grey smear on a near-black bar.
          ...(Platform.OS === 'ios' ? { shadowOpacity: 0 } : { elevation: 0 }),
        },
        headerTintColor: colors.text,
        headerTitleStyle: { fontFamily, fontWeight: '800', fontSize: 17, letterSpacing: -0.2 },
        // Light/dark slide, search, then the alerts bell, top-right on every tab.
        headerRight: () => (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <ThemeToggle />
            <HeaderSearch />
            {alertsOn ? <AlertsBell count={unread} /> : <View style={{ width: 12 }} />}
          </View>
        ),
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      {/* Order here is navigation order; CurvedTabBar draws Incidents in the centre. */}
      <Tabs.Screen
        name="index"
        options={{
          title: 'HikTech',
          headerTitle: '',
          headerLeft: () => <View style={{ marginLeft: 16 }}><HikTechLogo height={14} /></View>,
        }}
      />
      <Tabs.Screen name="shift" options={{ title: 'Shift' }} />
      <Tabs.Screen name="incidents" options={{ title: 'Incidents' }} />
      <Tabs.Screen name="schedule" options={{ title: 'My Schedule' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}
