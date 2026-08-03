import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { cleanupOnLogout, getMyPersonnel, toggleDuty } from '@criticom/api';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useNotifications, type PushStatus } from '@/lib/notifications';
import { useSync } from '@/lib/sync';
import { useDept } from '@/lib/branding';
import { DeptBadge } from '@/components/dept-badge';
import { colors, radius, space, type } from '@/lib/theme';
import { Banner, Button, Card, KeyValue, Muted, SectionLabel, Title } from '@/components/ui';

const HEARTBEAT_MS = 60_000;

/**
 * Push status in plain words. A supervisor checking a handset before a shift
 * needs to know whether it will ring, and if not, whether that is fixable here
 * (permission) or a build/hardware fact (no FCM, emulator) — "push unavailable"
 * on its own sends people to the wrong place.
 */
const PUSH_COPY: Record<PushStatus, { heading: string; detail: string }> = {
  checking: {
    heading: 'Checking push…',
    detail: 'Registering this handset for dispatch notifications.',
  },
  enabled: {
    heading: 'Push enabled',
    detail: 'Calls routed to your department reach this phone even when the screen is locked. High and Critical calls open a full-screen alert you must acknowledge.',
  },
  denied: {
    heading: 'Notifications blocked',
    detail: 'This phone will not ring for a dispatch. Turn notifications on for Criticom in the device settings. Alerts still arrive instantly while the app is open.',
  },
  unsupported: {
    heading: 'Push not in this build',
    detail: 'This build has no push service configured, so alerts arrive only while the app is open. Report it to your system administrator before carrying this handset on shift.',
  },
  simulator: {
    heading: 'Push unavailable on this device',
    detail: 'Emulators and simulators cannot register for push. Alerts still arrive while the app is open.',
  },
  error: {
    heading: 'Push registration failed',
    detail: 'This phone could not be registered for dispatch notifications. Alerts still arrive while the app is open — report this so the handset can be checked.',
  },
};

export default function ProfileScreen() {
  const { session, fullName, role, silo } = useAuth();
  const { pushEnabled, pushStatus, releasePushToken } = useNotifications();
  const { enqueue, pending, failed, online } = useSync();
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

  /**
   * GPS heartbeat — posts position to personnel.lat/lng while on duty
   * (V4 UpdateLiveLocation).
   *
   * Goes through the outbox rather than straight to the server so that losing
   * signal does not lose the position: the queue keeps only the newest fix
   * (see `dedupeKeyOf`), and on reconnect dispatch gets where the crew is now
   * rather than a rewind through where they were.
   */
  const sendHeartbeat = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('Location permission denied — dispatch cannot see your position.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      await enqueue({
        kind: 'duty_location',
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
      });
      setLastPing(new Date().toLocaleTimeString());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [enqueue]);

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
    // Drop the push registration first: after signOut the session can no longer
    // satisfy the RLS check on push_tokens, and a row left behind sends this
    // person's calls to whoever carries the handset next.
    await releasePushToken().catch(() => {});
    // V4 AuthController.Logout: free the vehicle + clear duty before ending the session.
    await cleanupOnLogout(sb).catch(() => {});
    await sb.auth.signOut();
  };

  const confirmSignOut = () => {
    const undelivered = pending.length + failed.length;
    // Undelivered work is held against the account that captured it, so it is
    // not lost — but the next person to carry this handset cannot send it, and
    // it will sit until this officer signs in again. Say so plainly rather than
    // letting them find out at the inquiry.
    const warning = undelivered > 0
      ? `\n\n${undelivered} update${undelivered === 1 ? '' : 's'} ${undelivered === 1 ? 'has' : 'have'} not reached the server yet. ${
          online
            ? 'Give it a moment and check the sync tray before signing out.'
            : 'It stays on this phone under your account and sends the next time you sign in with signal.'
        }`
      : '';

    Alert.alert(
      'Sign out?',
      `Your vehicle will be released and your duty status cleared.${warning}`,
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
              <Title>{PUSH_COPY[pushStatus].heading}</Title>
            </View>
            <Muted>{PUSH_COPY[pushStatus].detail}</Muted>
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
