import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { cleanupOnLogout, getMyPersonnel, toggleDuty } from '@criticom/api';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useNotifications } from '@/lib/notifications';
import { useDept } from '@/lib/branding';
import { DeptBadge } from '@/components/dept-badge';
import { colors, radius, space, type } from '@/lib/theme';
import { Banner, Button, Card, KeyValue, Muted, SectionLabel, Title } from '@/components/ui';

const HEARTBEAT_MS = 60_000;

export default function ProfileScreen() {
  const { session, fullName, role, silo } = useAuth();
  const { pushEnabled } = useNotifications();
  const dept = useDept();
  const [onDuty, setOnDuty] = useState(false);
  const [unit, setUnit] = useState<string | null>(null);
  const [lastPing, setLastPing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const initials = fullName.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();

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

  const confirmSignOut = () => {
    Alert.alert(
      'Sign out?',
      'Your vehicle will be released and your duty status cleared.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
      ],
    );
  };

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.container}>
      {/* Identity — badged to the responder's own service */}
      <Card accent={dept.primary_color}>
        <View style={styles.identity}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials || '—'}</Text>
            <View style={[styles.avatarStatus, { backgroundColor: onDuty ? colors.low : colors.muted }]} />
          </View>
          <View style={{ flex: 1 }}>
            <Title>{fullName}</Title>
            <Muted>{role} · {dept.short_name}</Muted>
          </View>
          <DeptBadge dept={dept} size={40} />
        </View>
        <Muted style={{ marginTop: space.sm }}>{dept.official_name}</Muted>
        <View style={{ marginTop: space.md }}>
          <KeyValue label="Assigned unit" value={unit ?? 'None'} />
          <KeyValue label="Account" value={session?.user.email ?? '—'} />
        </View>
      </Card>

      {/* Duty */}
      <SectionLabel>Duty status</SectionLabel>
      <Card accent={onDuty ? colors.low : colors.border}>
        <View style={styles.rowBetween}>
          <View style={{ flex: 1, paddingRight: space.md }}>
            <View style={styles.dutyHeading}>
              <View style={[styles.dutyDot, { backgroundColor: onDuty ? colors.low : colors.muted }]} />
              <Title>{onDuty ? 'On duty' : 'Off duty'}</Title>
            </View>
            <Muted>
              {onDuty
                ? `GPS heartbeat every ${HEARTBEAT_MS / 1000}s${lastPing ? ` · last ping ${lastPing}` : ''}`
                : 'Going on duty starts the live GPS heartbeat to dispatch.'}
            </Muted>
          </View>
          <Switch
            value={onDuty}
            onValueChange={(v) => void flipDuty(v)}
            trackColor={{ true: colors.low, false: colors.borderStrong }}
            thumbColor="#fff"
            accessibilityLabel="Toggle duty status"
          />
        </View>
        {onDuty ? (
          <View style={styles.gpsNote}>
            <Ionicons name="navigate" size={13} color={colors.low} />
            <Text style={styles.gpsText}>Dispatch can see your live position</Text>
          </View>
        ) : null}
        {error ? <View style={{ marginTop: space.md }}><Banner tone="error" onDismiss={() => setError(null)}>{error}</Banner></View> : null}
      </Card>

      {/* Alerts */}
      <SectionLabel>Dispatch alerts</SectionLabel>
      <Card accent={pushEnabled ? colors.accent : colors.medium}>
        <View style={styles.rowBetween}>
          <View style={{ flex: 1, paddingRight: space.md }}>
            <View style={styles.dutyHeading}>
              <Ionicons
                name={pushEnabled ? 'notifications' : 'notifications-off-outline'}
                size={17}
                color={pushEnabled ? colors.accent : colors.medium}
              />
              <Title>{pushEnabled ? 'Push enabled' : 'Push unavailable'}</Title>
            </View>
            <Muted>
              {pushEnabled
                ? 'Calls routed to your department reach this phone even when the screen is locked. High and Critical calls open a full-screen alert you must acknowledge.'
                : 'Notification permission was declined, or this build has no push project configured. Alerts still arrive instantly while the app is open.'}
            </Muted>
          </View>
        </View>
      </Card>

      {/* Account */}
      <SectionLabel>Account</SectionLabel>
      <Card>
        <Muted>Signing out frees your vehicle and clears duty status (V4 logout parity).</Muted>
        <View style={{ marginTop: space.md }}>
          <Button label="Sign out" icon="log-out-outline" variant="danger" onPress={confirmSignOut} />
        </View>
      </Card>

      <Text style={styles.version}>CRITICOMM Responder · eThekwini Emergency Services</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: space.lg, paddingBottom: space['3xl'] },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },

  identity: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  avatar: {
    width: 52, height: 52, borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    borderWidth: 1, borderColor: colors.borderStrong,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: colors.accent, fontSize: 18, fontWeight: '800' },
  avatarStatus: {
    position: 'absolute', right: -1, bottom: -1,
    width: 14, height: 14, borderRadius: 7,
    borderWidth: 2, borderColor: colors.bgCard,
  },

  dutyHeading: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dutyDot: { width: 8, height: 8, borderRadius: 4 },
  gpsNote: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: space.md, paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
  },
  gpsText: { ...type.small, color: colors.low, fontWeight: '600' },

  version: {
    ...type.small, fontSize: 11, color: colors.muted,
    textAlign: 'center', marginTop: space.lg,
  },
});
