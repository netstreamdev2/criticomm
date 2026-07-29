import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator, Platform, StyleSheet, Text } from 'react-native';
import { AuthProvider, useAuth } from '@/lib/auth';
import { colors, space, type } from '@/lib/theme';

function AuthGate({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const inLogin = segments[0] === 'login';
    if (!session && !inLogin) router.replace('/login');
    if (session && inLogin) router.replace('/');
  }, [session, loading, segments, router]);

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

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="light" />
      <AuthGate>
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
        </Stack>
      </AuthGate>
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
});
