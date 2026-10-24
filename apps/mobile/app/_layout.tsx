import { useCallback, useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { View, ActivityIndicator, Platform, Pressable, StyleSheet, Text } from 'react-native';
import { AuthProvider, useAuth } from '@/lib/auth';
import { I18nProvider } from '@/lib/i18n';
import { BrandingProvider } from '@/lib/branding';
import { NotificationsProvider, useNotificationRouting } from '@/lib/notifications';
import { DutyProvider, isDutyRoute, useDuty } from '@/lib/duty';
import { OffDutyGate } from '@/components/off-duty';
import { SyncProvider } from '@/lib/sync';
import { FeaturesProvider } from '@/lib/features';
import { RadioPresence, RouteTracker } from '@/lib/route-tracker';
import { ShiftReminders } from '@/lib/shift-reminders';
import { OfflinePrefetch } from '@/lib/offline-prefetch';
import { AlertBanners, AssignmentAlert } from '@/components/alerts';
import { PanicButton } from '@/components/panic-button';
import { BodycamWatchNotice } from '@/components/bodycam-watch';
import { RadioCameraNotice } from '@/components/radio-camera-notice';
import { HatPairedBanner } from '@/components/hat-paired-banner';
import { SyncTray } from '@/components/sync-tray';
import { colors, space, type, makeStyles, useTheme, loadThemeMode } from '@/lib/theme';
import { HikTechLogo } from '@/components/hiktech-logo';
import { RUBIK_FONTS, fontFamily } from '@/lib/font';
import { useT } from '@/lib/i18n';
import { HeaderCriti } from '@/components/alerts-bell';

/**
 * Root error boundary. expo-router renders this instead of unmounting when
 * anything below it throws.
 *
 * Without it a JS failure anywhere in the tree closes the app with no message,
 * which is indistinguishable from a native crash — and on a phone in a vehicle
 * there is no console to check. Showing the error, and a way back, is the
 * difference between "the app is broken" and a report someone can act on.
 */
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  const { t } = useT();
  const styles = useStyles();
  return (
    <View style={styles.splash}>
      <View style={{ marginBottom: space.md }}><HikTechLogo height={16} /></View>
      <Text style={styles.errTitle}>{t('The app hit an unexpected error')}</Text>
      <Text style={styles.errBody} numberOfLines={8}>
        {error?.message ?? t('No detail available.')}
      </Text>
      <Text style={styles.errHint}>
        {t('Your session is safe. Tap below to retry — if it keeps happening, show this screen to your system administrator and fall back to radio.')}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => { void retry(); }}
        style={({ pressed }) => [styles.errButton, { opacity: pressed ? 0.7 : 1 }]}
      >
        <Text style={styles.errButtonText}>{t('Try again')}</Text>
      </Pressable>
    </View>
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { t } = useT();
  const styles = useStyles();
  const { session, loading, role } = useAuth();
  const { cleared, checking } = useDuty();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    // Signed out, a person may sign in or activate an account with a printed code (0049).
    const signedOutScreen = segments[0] === 'login' || segments[0] === 'activate';
    if (!session && !signedOutScreen) { router.replace('/login'); return; }
    if (session && signedOutScreen) { router.replace('/'); return; }

  }, [session, loading, segments, router]);

  if (loading || (session && checking)) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator color={colors.accent} size="large" />
        <View style={{ marginTop: space.sm }}><HikTechLogo height={16} /></View>
        <Text style={styles.splashSub}>{t('Restoring your session…')}</Text>
      </View>
    );
  }
  // Off duty the app is open: home, the roster, leave, the profile. A duty
  // screen (calls, their reports, Talk, the map, fines) is covered until today's
  // start of shift is done and they are on duty. Expo Router needs its root
  // navigator mounted, so it is covered rather than replaced: nothing
  // underneath is visible, tappable, or read out. The receiving doctor does not
  // start a shift or take an ambulance.
  if (session && role !== 'Doctor' && !cleared && isDutyRoute(segments)) {
    return (
      <View style={{ flex: 1 }}>
        <View style={{ flex: 1 }} pointerEvents="none" importantForAccessibility="no-hide-descendants">
          {children}
        </View>
        <View style={StyleSheet.absoluteFillObject}>
          <OffDutyGate />
        </View>
      </View>
    );
  }
  return <>{children}</>;
}

/** Tapping an OS notification jumps straight to the incident it refers to. */
function NotificationRouter() {
  const router = useRouter();
  const open = useCallback(
    (incidentId: string) => router.push(`/incident/${incidentId}`),
    [router],
  );
  const schedule = useCallback(() => router.push('/(tabs)/schedule'), [router]);
  useNotificationRouting(open, schedule);
  return null;
}

export default function RootLayout() {
  const { t } = useT();
  const { isDark } = useTheme();
  const [fontsLoaded, fontError] = useFonts(RUBIK_FONTS);
  // The saved light/dark choice is read before the first screen draws, so the
  // app never flashes the other theme.
  const [themeReady, setThemeReady] = useState(false);
  useEffect(() => {
    void loadThemeMode().finally(() => setThemeReady(true));
  }, []);
  // A font that fails to load must not leave a responder on a blank screen —
  // carry on in the system font.
  if ((!fontsLoaded && !fontError) || !themeReady) return null;

  return (
    <AuthProvider>
      {/* The person's language (docs/23, item 1), for every screen below. */}
      <I18nProvider>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      {/* Above the gate: the start-of-shift screen it draws is the signed-in
          department's, crest and name included. */}
      <BrandingProvider>
      <DutyProvider>
      <AuthGate>
        <FeaturesProvider>
        {/* Sync wraps notifications: an alert handler may need to queue work,
            and the panic path must never be blocked on the alert subsystem. */}
        <SyncProvider>
        <NotificationsProvider>
          <NotificationRouter />
          <RouteTracker />
          <RadioPresence />
          <ShiftReminders />
          <OfflinePrefetch />
          <Stack
            screenOptions={{
              headerStyle: {
                backgroundColor: colors.bgSoft,
                ...(Platform.OS === 'ios' ? { shadowOpacity: 0 } : { elevation: 0 }),
              },
              headerTintColor: colors.text,
              headerTitleStyle: { fontFamily, fontWeight: '800', fontSize: 17 },
              headerShadowVisible: false,
              contentStyle: { backgroundColor: colors.bg },
            }}
          >
            <Stack.Screen name="login" options={{ headerShown: false }} />
            <Stack.Screen name="activate" options={{ headerShown: false }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen
              name="incident/[id]"
              options={({ route }) => ({
                title: t('Incident'), headerBackTitle: t('Back'),
                headerRight: () => <HeaderCriti incidentId={(route.params as { id?: string } | undefined)?.id} />,
              })}
            />
            <Stack.Screen
              name="route/[id]"
              options={{ title: t('Route'), headerBackTitle: t('Back') }}
            />
            <Stack.Screen
              name="report/[id]"
              options={({ route }) => ({
                title: t('Incident Report'), headerBackTitle: t('Back'),
                headerRight: () => <HeaderCriti incidentId={(route.params as { id?: string } | undefined)?.id} />,
              })}
            />
            <Stack.Screen
              name="fire-report/[id]"
              options={({ route }) => ({
                title: t('Fire Report'), headerBackTitle: t('Back'),
                headerRight: () => <HeaderCriti incidentId={(route.params as { id?: string } | undefined)?.id} />,
              })}
            />
            <Stack.Screen
              name="pcr/[id]"
              options={({ route }) => ({
                title: t('Patient Report'), headerBackTitle: t('Back'),
                headerRight: () => <HeaderCriti incidentId={(route.params as { id?: string } | undefined)?.id} />,
              })}
            />
            <Stack.Screen
              name="post-mortem/[id]"
              options={({ route }) => ({
                title: t('Post-Mortem'), headerBackTitle: t('Back'),
                headerRight: () => <HeaderCriti incidentId={(route.params as { id?: string } | undefined)?.id} />,
              })}
            />
            <Stack.Screen
              name="assessment/[id]"
              options={({ route }) => ({
                title: t('Assessment'), headerBackTitle: t('Back'),
                headerRight: () => <HeaderCriti incidentId={(route.params as { id?: string } | undefined)?.id} />,
              })}
            />
            <Stack.Screen
              name="inspections"
              options={{ title: t('Site inspections'), headerBackTitle: t('Back') }}
            />
            <Stack.Screen
              name="inspection/new"
              options={{ title: t('Site inspection'), headerBackTitle: t('Back') }}
            />
            <Stack.Screen
              name="inspection/[id]"
              options={{ title: t('Inspection'), headerBackTitle: t('Back') }}
            />
            <Stack.Screen
              name="assistant"
              options={{ title: t('Criti'), headerBackTitle: t('Back') }}
            />
            <Stack.Screen
              name="leave"
              options={{ title: t('Leave'), headerBackTitle: t('Back') }}
            />
            <Stack.Screen
              name="kit"
              options={{ title: t('Radio and hard hat'), headerBackTitle: t('Back') }}
            />
            <Stack.Screen
              name="radio-setup"
              options={{ title: t('Radio setup'), headerBackTitle: t('Back') }}
            />
            <Stack.Screen
              name="end-shift"
              options={{ title: t('End of shift'), headerBackTitle: t('Back') }}
            />
            <Stack.Screen
              name="firearm-check"
              options={{ title: t('Firearm Check'), headerBackTitle: t('Back') }}
            />
            <Stack.Screen
              name="fines/index"
              options={{ title: t('My fines'), headerBackTitle: t('Back') }}
            />
            <Stack.Screen
              name="fines/new"
              options={{ title: t('Issue a fine'), headerBackTitle: t('Back') }}
            />
            <Stack.Screen
              name="fines/check"
              options={{ title: t('Check what is owed'), headerBackTitle: t('Back') }}
            />
            <Stack.Screen
              name="fines/[id]"
              options={{ title: t('Fine'), headerBackTitle: t('Back') }}
            />
            <Stack.Screen
              name="talk"
              options={{ title: t('Talk'), headerBackTitle: t('Back') }}
            />
            <Stack.Screen
              name="alerts"
              options={{ title: t('Alerts'), headerBackTitle: t('Back') }}
            />
            <Stack.Screen
              name="my-incidents"
              options={{ title: t('My incidents'), headerBackTitle: t('Back') }}
            />
            <Stack.Screen
              name="my-performance"
              options={{ title: t('My performance'), headerBackTitle: t('Back') }}
            />
            <Stack.Screen
              name="live-map"
              // Full screen: the map draws its own back button under the status bar.
              options={{ title: t('Live Map'), headerShown: false }}
            />
          </Stack>

          {/* Overlays sit above every screen in the stack. */}
          <AlertBanners />
          <AssignmentAlert />
          <PanicButton />
          <SyncTray />
          <BodycamWatchNotice />
          <RadioCameraNotice />
          <HatPairedBanner />
        </NotificationsProvider>
        </SyncProvider>
        </FeaturesProvider>
      </AuthGate>
      </DutyProvider>
      </BrandingProvider>
    </I18nProvider>
    </AuthProvider>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  splash: {
    flex: 1, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center', gap: space.md,
  },
  splashBrand: {
    color: colors.primary, fontWeight: '800',
    letterSpacing: 4, fontSize: 13, marginTop: space.sm,
  },
  splashSub: { ...type.small, color: colors.muted },

  errBrand: {
    color: colors.primary, fontWeight: '800',
    letterSpacing: 4, fontSize: 13, marginBottom: space.md,
  },
  errTitle: {
    color: colors.text, fontSize: 17, fontWeight: '700',
    textAlign: 'center', paddingHorizontal: space.lg,
  },
  errBody: {
    ...type.small, color: colors.critical, textAlign: 'center',
    paddingHorizontal: space.lg, marginTop: space.sm,
  },
  errHint: {
    ...type.small, color: colors.muted, textAlign: 'center',
    paddingHorizontal: space.lg, marginTop: space.md, lineHeight: 18,
  },
  errButton: {
    marginTop: space.lg, minHeight: 44, paddingHorizontal: space.lg,
    borderRadius: 8, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  errButtonText: { color: '#ffffff', fontWeight: '700', fontSize: 14 },
}));
