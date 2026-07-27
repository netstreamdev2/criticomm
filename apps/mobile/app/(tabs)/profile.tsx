import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { cleanupOnLogout, getMyPersonnel, toggleDuty } from '@criticom/api';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/theme';
import { Button, Card, Muted, Title } from '@/components/ui';

const HEARTBEAT_MS = 60_000;

export default function ProfileScreen() {
  const { session, fullName, role, silo } = useAuth();
  const [onDuty, setOnDuty] = useState(false);
  const [unit, setUnit] = useState<string | null>(null);
  const [lastPing, setLastPing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    const me = await getMyPersonnel(getSupabase(), session.user.id).catch(() => null);
    if (me) {
      setOnDuty(me.is_on_duty);
      const apparatus = (me as { apparatus?: { unit_number?: string; name?: string } }).apparatus;
      setUnit(apparatus?.unit_number ? `${apparatus.unit_number} — ${apparatus.name ?? ''}` : null);
    }
  }, [session]);

  useEffect(() => { void load(); }, [load]);

  /** GPS heartbeat — posts position to personnel.lat/lng while on duty (V4 UpdateLiveLocation). */
  const sendHeartbeat = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('Location permission denied — dispatch cannot see your position.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      await toggleDuty(getSupabase(), {
        onDuty: true,
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      });
      setLastPing(new Date().toLocaleTimeString());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (onDuty) {
      void sendHeartbeat();
      timer.current = setInterval(() => void sendHeartbeat(), HEARTBEAT_MS);
    }
    return () => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    };
  }, [onDuty, sendHeartbeat]);

  const flipDuty = async (value: boolean) => {
    setOnDuty(value);
    setError(null);
    try {
      await toggleDuty(getSupabase(), { onDuty: value });
      if (!value) setLastPing(null);
    } catch (e) {
      setOnDuty(!value);
      setError((e as Error).message);
    }
  };

  const signOut = async () => {
    const sb = getSupabase();
    // V4 AuthController.Logout: free the vehicle + clear duty before ending the session.
    await cleanupOnLogout(sb).catch(() => {});
    await sb.auth.signOut();
  };

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.container}>
      <Card>
        <Title>{fullName}</Title>
        <Muted>{role} · {silo}</Muted>
        {unit && <Muted>Assigned unit: {unit}</Muted>}
      </Card>

      <Card>
        <View style={styles.rowBetween}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Title>{onDuty ? 'On duty' : 'Off duty'}</Title>
            <Muted>
              {onDuty
                ? `GPS heartbeat every ${HEARTBEAT_MS / 1000}s${lastPing ? ` · last ping ${lastPing}` : ''}`
                : 'Going on duty starts the live GPS heartbeat to dispatch.'}
            </Muted>
          </View>
          <Switch
            value={onDuty}
            onValueChange={(v) => void flipDuty(v)}
            trackColor={{ true: colors.low, false: colors.border }}
            thumbColor="#fff"
          />
        </View>
        {error && <Text style={styles.error}>{error}</Text>}
      </Card>

      <Card>
        <Title>Account</Title>
        <Muted>Signing out frees your vehicle and clears duty status (V4 logout parity).</Muted>
        <View style={{ marginTop: 12 }}>
          <Button label="Sign out" variant="danger" onPress={() => void signOut()} />
        </View>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 32 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  error: {
    color: colors.critical, backgroundColor: `${colors.critical}22`,
    borderRadius: 8, padding: 10, marginTop: 12, fontSize: 13,
  },
});
