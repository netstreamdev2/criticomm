import { useCallback, useEffect, useState } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { countUnreadAlerts, subscribeAlerts, subscribeMyAlertReads } from '@criticom/api';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useFeature } from '@/lib/features';
import { colors, type } from '@/lib/theme';

/**
 * Live unread count for the Alerts tab badge.
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
  const unread = useUnreadAlerts();
  const alertsOn = useFeature('mobile.alerts_inbox');

  return (
    <Tabs
      screenOptions={{
        headerStyle: {
          backgroundColor: colors.bgSoft,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.border,
          // The default iOS header shadow reads as a grey smear on a near-black bar.
          ...(Platform.OS === 'ios' ? { shadowOpacity: 0 } : { elevation: 0 }),
        },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '800', fontSize: 17, letterSpacing: -0.2 },
        tabBarStyle: {
          backgroundColor: colors.bgSoft,
          borderTopColor: colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: Platform.OS === 'ios' ? 86 : 62,
          paddingTop: 6,
          paddingBottom: Platform.OS === 'ios' ? 28 : 8,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { ...type.small, fontSize: 11, fontWeight: '700' },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Criticomm',
          tabBarLabel: 'Home',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'grid' : 'grid-outline'} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="incidents"
        options={{
          title: 'My Incidents',
          tabBarLabel: 'Incidents',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'radio' : 'radio-outline'} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          href: alertsOn ? undefined : null,
          title: 'Alerts',
          tabBarBadge: unread > 0 ? (unread > 99 ? '99+' : unread) : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.primary, color: '#fff', fontSize: 10 },
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'notifications' : 'notifications-outline'} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="schedule"
        options={{
          title: 'My Schedule',
          tabBarLabel: 'Schedule',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'calendar' : 'calendar-outline'} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="shift"
        options={{
          title: 'Shift',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'clipboard' : 'clipboard-outline'} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'person' : 'person-outline'} color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
