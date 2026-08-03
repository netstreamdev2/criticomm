import { useCallback, useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator, Platform, Pressable, StyleSheet, Text } from 'react-native';
import { AuthProvider, useAuth } from '@/lib/auth';
import { BrandingProvider } from '@/lib/branding';
import { NotificationsProvider, useNotificationRouting } from '@/lib/notifications';
import { DutyProvider, useDuty } from '@/lib/duty';
import { SyncProvider } from '@/lib/sync';
import { AlertBanners, AssignmentAlert } from '@/components/alerts';
import { PanicButton } from '@/components/panic-button';
import { SyncTray } from '@/components/sync-tray';
import { colors, space, type } from '@/lib/theme';

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
  return (
    <View style={styles.splash}>
      <Text style={styles.errBrand}>CRITICOMM</Text>
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
  const { session, loading } = useAuth();
  const { shiftStarted, checking } = useDuty();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const inLogin = segments[0] === 'login';
    if (!session && !inLogin) { router.replace('/login'); return; }
    if (session && inLogin) { router.replace('/'); return; }

    // Signed in but today's readiness flow is outstanding — send them there
    // before anything else. A crew member should meet the mental check on
    // opening the app, not have to find it.
    if (session && !checking && shiftStarted === false) {
      // segments is a narrow tuple type, so match on membership rather than
      // indexing into it.
      const seg = segments as readonly string[];
      // Profile stays reachable. Someone who fails the readiness check can
      // never satisfy the gate — correct, they are not fit to attend — but
      // they must still be able to see who they are signed in as and sign
      // out. A gate with no exit is a trap, not a control.
      const allowed = seg.includes('shift') || seg.includes('profile');
      if (!allowed) router.replace('/(tabs)/shift');
    }
  }, [session, loading, segments, router, shiftStarted, checking]);

  if (loading) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.splashBrand}>CRITICOMM</Text>
        <Text style={styles.splashSub}>Restoring your session…</Text>
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
  return (
    <AuthProvider>
      <StatusBar style="light" />
      <DutyProvider>
      <AuthGate>
        <BrandingProvider>
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
              headerTitleStyle: { fontWeight: '800', fontSize: 17 },
              headerShadowVisible: false,
              contentStyle: { backgroundColor: colors.bg },
            }}
          >
            <Stack.Screen name="login" options={{ headerShown: false }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen
              name="incident/[id]"
              options={{ title: 'Incident', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="assistant"
              options={{ title: 'Criti', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="leave"
              options={{ title: 'Leave', headerBackTitle: 'Back' }}
            />
          </Stack>

          {/* Overlays sit above every screen in the stack. */}
          <AlertBanners />
          <AssignmentAlert />
          <PanicButton />
          <SyncTray />
        </NotificationsProvider>
        </SyncProvider>
        </BrandingProvider>
      </AuthGate>
      </DutyProvider>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
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
});
