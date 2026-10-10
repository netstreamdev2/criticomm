import { useCallback, useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { View, ActivityIndicator, Platform, Pressable, StyleSheet, Text } from 'react-native';
import { AuthProvider, useAuth } from '@/lib/auth';
import { BrandingProvider } from '@/lib/branding';
import { NotificationsProvider, useNotificationRouting } from '@/lib/notifications';
import { DutyProvider, useDuty } from '@/lib/duty';
import { SyncProvider } from '@/lib/sync';
import { FeaturesProvider } from '@/lib/features';
import { AlertBanners, AssignmentAlert } from '@/components/alerts';
import { PanicButton } from '@/components/panic-button';
import { BodycamWatchNotice } from '@/components/bodycam-watch';
import { SyncTray } from '@/components/sync-tray';
import { colors, space, type, makeStyles, useTheme, loadThemeMode } from '@/lib/theme';
import { HikTechLogo } from '@/components/hiktech-logo';
import ShiftScreen from './(tabs)/shift';
import { RUBIK_FONTS, fontFamily } from '@/lib/font';

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
  const styles = useStyles();
  return (
    <View style={styles.splash}>
      <View style={{ marginBottom: space.md }}><HikTechLogo height={16} /></View>
      <Text style={styles.errTitle}>The app hit an unexpected error</Text>
      <Text style={styles.errBody} numberOfLines={8}>
        {error?.message ?? 'No detail available.'}
      </Text>
      <Text style={styles.errHint}>
        Your session is safe. Tap below to retry — if it keeps happening, show this
        screen to your system administrator and fall back to radio.
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => { void retry(); }}
        style={({ pressed }) => [styles.errButton, { opacity: pressed ? 0.7 : 1 }]}
      >
        <Text style={styles.errButtonText}>Try again</Text>
      </Pressable>
    </View>
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const styles = useStyles();
  const { session, loading, role } = useAuth();
  const { shiftStarted, checking } = useDuty();
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
        <Text style={styles.splashSub}>Restoring your session…</Text>
      </View>
    );
  }
  // Expo Router needs its root navigator mounted before any redirects. Cover it
  // with a full-screen, touch-blocking assessment while clearance is pending.
  // Nothing underneath is visible, tappable, or exposed to screen readers.
  // The receiving doctor does not start a shift or take an ambulance.
  if (session && shiftStarted !== true && role !== 'Doctor') {
    return (
      <View style={{ flex: 1 }}>
        <View style={{ flex: 1 }} pointerEvents="none" importantForAccessibility="no-hide-descendants">
          {children}
        </View>
        <View style={StyleSheet.absoluteFillObject}>
          <ShiftScreen gated />
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
  useNotificationRouting(open);
  return null;
}

export default function RootLayout() {
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
              options={{ title: 'Incident', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="route/[id]"
              options={{ title: 'Route', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="report/[id]"
              options={{ title: 'Incident Report', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="fire-report/[id]"
              options={{ title: 'Fire Report', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="pcr/[id]"
              options={{ title: 'Patient Report', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="post-mortem/[id]"
              options={{ title: 'Post-Mortem', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="assistant"
              options={{ title: 'Criti', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="leave"
              options={{ title: 'Leave', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="end-shift"
              options={{ title: 'End of shift', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="firearm-check"
              options={{ title: 'Firearm Check', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="fines/index"
              options={{ title: 'My fines', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="fines/new"
              options={{ title: 'Issue a fine', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="fines/check"
              options={{ title: 'Check what is owed', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="fines/[id]"
              options={{ title: 'Fine', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="alerts"
              options={{ title: 'Alerts', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="my-incidents"
              options={{ title: 'My incidents', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="my-performance"
              options={{ title: 'My performance', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="live-map"
              // Full screen: the map draws its own back button under the status bar.
              options={{ title: 'Live Map', headerShown: false }}
            />
          </Stack>

          {/* Overlays sit above every screen in the stack. */}
          <AlertBanners />
          <AssignmentAlert />
          <PanicButton />
          <SyncTray />
          <BodycamWatchNotice />
        </NotificationsProvider>
        </SyncProvider>
        </FeaturesProvider>
      </AuthGate>
      </DutyProvider>
      </BrandingProvider>
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
