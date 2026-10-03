import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Easing, Linking, Modal, Platform, Pressable, StyleSheet, Text, View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { asUuid } from '@/lib/outbox';
import { useSync } from '@/lib/sync';
import { useFeature } from '@/lib/features';
import { colors, radius, space, type, makeStyles } from '@/lib/theme';
import { useTabBarHeight } from '@/components/tab-bar';

/**
 * Officer-down.
 *
 * Design constraints, in the order they mattered:
 *
 *  1. **It must work with one hand, without looking.** A single fixed target in
 *     the same place on every screen, large enough to hit blind.
 *  2. **It must not fire by accident.** A panic pulls crews off other calls; a
 *     pocket press that does that a few times is how a service learns to ignore
 *     the alarm. Hence hold-to-activate, with escalating haptics so the phone
 *     tells you it is arming even face-down in a pocket.
 *  3. **It must not depend on the network.** The queue takes it immediately and
 *     delivers when there is signal, at the highest priority in the outbox.
 *  4. **It must not wait for GPS.** A fix can take fifteen seconds indoors, and
 *     the emergency cannot wait that long. We race a short timeout, fall back
 *     to the phone's last known fix (GPS needs no data signal), and send
 *     without coordinates if we have to — dispatch would rather have "officer
 *     down, position unknown" now than a precise position later.
 *  5. **It must be honest.** The confirmation follows the queued SOS: sending,
 *     delivered (with its incident number), or held on the phone with no
 *     signal — and then SMS and a call to the control room are one tap away,
 *     because the voice/SMS network often works where data does not.
 */

/** Control-room number for the no-data fallbacks (SMS, call); set per deployment. */
const CONTROL_ROOM = (process.env.EXPO_PUBLIC_CONTROL_ROOM_NUMBER ?? '').replace(/[^\d+]/g, '');
/** A last known fix older than this is not worth sending. */
const LAST_FIX_MAX_AGE_MS = 10 * 60_000;

type Fix = 'live' | 'last' | 'none';
type Sent = {
  id: string;
  at: string;
  fix: Fix;
  coords: { lat: number; lng: number; accuracy: number | null } | null;
};

const HOLD_MS = 2500;
/** Beyond this, sending late beats sending accurately. */
const GPS_TIMEOUT_MS = 4000;

export function PanicButton() {
  const styles = useStyles();
  const tabBar = useTabBarHeight();
  const panicOn = useFeature('mobile.panic');
  const { session, silo, fullName } = useAuth();
  const { enqueue, pending, failed, online } = useSync();
  const [holding, setHolding] = useState(false);
  const [sent, setSent] = useState<Sent | null>(null);
  const [incidentNumber, setIncidentNumber] = useState<string | null>(null);
  const progress = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const armed = useRef(false);
  const nudges = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Idle breathing so the control reads as live rather than decorative.
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const clearNudges = () => {
    for (const t of nudges.current) clearTimeout(t);
    nudges.current = [];
  };

  const fire = useCallback(async () => {
    armed.current = false;
    setHolding(false);
    progress.setValue(0);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // Capture the moment of the press, not the moment of delivery.
    const occurredAt = new Date().toISOString();

    // Race a fix against the clock. `Promise.race` rather than an awaited
    // timeout so a slow GPS cannot hold the emergency in the app.
    let coords: Location.LocationObjectCoords | null = null;
    let fix: Fix = 'none';
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status === 'granted') {
        coords = await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
            .then((p) => p.coords),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), GPS_TIMEOUT_MS)),
        ]);
        if (coords) fix = 'live';
        else {
          // No fresh fix in time: the phone's last one is instant and offline.
          const last = await Location.getLastKnownPositionAsync({ maxAge: LAST_FIX_MAX_AGE_MS });
          if (last) { coords = last.coords; fix = 'last'; }
        }
      }
    } catch {
      coords = null;
      fix = 'none';
    }

    setIncidentNumber(null);
    const id = await enqueue(
      {
        kind: 'panic',
        silo,
        lat: coords?.latitude ?? null,
        lng: coords?.longitude ?? null,
        accuracy: coords?.accuracy ?? null,
        responderName: fullName,
      },
      { occurredAt },
    );

    setSent({
      id,
      at: occurredAt,
      fix,
      coords: coords ? { lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy ?? null } : null,
    });
  }, [enqueue, silo, fullName, progress]);

  const startHold = () => {
    if (armed.current) return;
    armed.current = true;
    setHolding(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Escalating taps at each third of the hold: feedback you can feel without
    // watching the ring fill.
    nudges.current = [
      setTimeout(() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }, HOLD_MS / 3),
      setTimeout(() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); }, (HOLD_MS * 2) / 3),
    ];

    Animated.timing(progress, {
      toValue: 1,
      duration: HOLD_MS,
      easing: Easing.linear,
      // Width is animated, which the native driver cannot do.
      useNativeDriver: false,
    }).start(({ finished }) => {
      clearNudges();
      if (finished && armed.current) void fire();
    });
  };

  const cancelHold = () => {
    if (!armed.current) return;
    armed.current = false;
    clearNudges();
    setHolding(false);
    progress.stopAnimation(() => progress.setValue(0));
  };

  useEffect(() => () => clearNudges(), []);

  // Where the SOS is right now, read from the queue itself.
  const delivery: 'sending' | 'offline' | 'failed' | 'delivered' | null = !sent ? null
    : pending.some((e) => e.id === sent.id) ? (online ? 'sending' : 'offline')
      : failed.some((e) => e.id === sent.id) ? 'failed'
        : 'delivered';

  // Delivered: show the incident number dispatch is working.
  useEffect(() => {
    if (delivery !== 'delivered' || !sent || incidentNumber) return;
    void getSupabase().from('incidents').select('incident_number')
      .eq('client_ref', asUuid(sent.id)).maybeSingle()
      .then(({ data }) => { if (data?.incident_number) setIncidentNumber(data.incident_number); });
  }, [delivery, sent, incidentNumber]);

  const smsBody = () => {
    const when = new Date(sent?.at ?? Date.now()).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
    const where = sent?.coords
      ? `${sent.fix === 'last' ? 'Last known position' : 'Position'}: ${sent.coords.lat.toFixed(5)}, ${sent.coords.lng.toFixed(5)}`
        + `${sent.coords.accuracy ? ` (±${Math.round(sent.coords.accuracy)}m)` : ''}`
        + ` https://maps.google.com/?q=${sent.coords.lat.toFixed(5)},${sent.coords.lng.toFixed(5)}`
      : 'Position unknown.';
    return `SOS — ${fullName || 'Officer'} (${silo}) needs immediate assistance at ${when}. ${where}`;
  };
  const sendSms = () => {
    // iOS separates the body with "&", Android with "?".
    const sep = Platform.OS === 'ios' ? '&' : '?';
    void Linking.openURL(`sms:${CONTROL_ROOM}${sep}body=${encodeURIComponent(smsBody())}`).catch(() => {});
  };
  const callControlRoom = () => {
    if (CONTROL_ROOM) void Linking.openURL(`tel:${CONTROL_ROOM}`).catch(() => {});
  };

  if (!session || !panicOn) return null;

  return (
    <>
      <Pressable
        onPressIn={startHold}
        onPressOut={cancelHold}
        accessibilityRole="button"
        accessibilityLabel="Emergency — hold to call for assistance"
        accessibilityHint="Press and hold for two and a half seconds to alert your department and the control room"
        style={[styles.anchor, { bottom: tabBar + space.lg }]}
      >
        <Animated.View
          style={[
            styles.button,
            holding && styles.buttonArming,
            {
              transform: [{
                scale: holding
                  ? 1.06
                  : pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] }),
              }],
            },
          ]}
        >
          <Animated.View
            style={[
              styles.fill,
              { width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
            ]}
          />
          <Ionicons name="warning" size={20} color="#fff" />
          <Text style={styles.buttonText}>{holding ? 'HOLD…' : 'SOS'}</Text>
        </Animated.View>
      </Pressable>

      <Modal visible={Boolean(sent)} transparent animationType="fade" onRequestClose={() => setSent(null)}>
        <View style={styles.scrim}>
          <View style={styles.card}>
            <View style={[styles.cardIcon, delivery === 'delivered' && { backgroundColor: colors.low }]}>
              {delivery === 'sending'
                ? <ActivityIndicator color="#fff" />
                : <Ionicons name={delivery === 'delivered' ? 'checkmark' : delivery === 'offline' ? 'cloud-offline' : 'megaphone'} size={26} color="#fff" />}
            </View>
            <Text style={styles.cardTitle}>
              {delivery === 'sending' ? 'Sending SOS…'
                : delivery === 'delivered' ? 'SOS delivered'
                  : delivery === 'offline' ? 'No signal — SOS saved'
                    : 'SOS could not be sent'}
            </Text>
            <Text style={styles.cardBody}>
              {delivery === 'sending' ? 'Reaching dispatch now.'
                : delivery === 'delivered'
                  ? `Dispatch and command have been alerted${incidentNumber ? ` (${incidentNumber})` : ''} and will send help. Stay on the radio.`
                  : delivery === 'offline'
                    ? 'It is held on this phone and sends automatically, ahead of everything else, the moment you have signal. Do not wait — SMS or call the control room now.'
                    : 'The server refused it. SMS or call the control room now.'}
            </Text>
            <View style={styles.fixRow}>
              <Ionicons name="location" size={13} color={sent?.fix === 'none' ? colors.medium : colors.textDim} />
              <Text style={[styles.fixText, sent?.fix === 'none' && { color: colors.medium }]}>
                {sent?.fix === 'live' ? `Live GPS position${sent.coords?.accuracy ? ` (±${Math.round(sent.coords.accuracy)}m)` : ''}`
                  : sent?.fix === 'last' ? 'Last known GPS position sent — say where you are on the radio'
                    : 'No position — say where you are on the radio'}
              </Text>
            </View>
            {delivery !== 'delivered' ? (
              <View style={styles.fallbacks}>
                <Pressable
                  onPress={sendSms}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.fallback, styles.fallbackPrimary, pressed && { opacity: 0.85 }]}
                >
                  <Ionicons name="chatbox-ellipses" size={18} color="#fff" />
                  <Text style={styles.fallbackText}>Send SOS by SMS</Text>
                </Pressable>
                {CONTROL_ROOM ? (
                  <Pressable
                    onPress={callControlRoom}
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.fallback, pressed && { opacity: 0.85 }]}
                  >
                    <Ionicons name="call" size={18} color={colors.text} />
                    <Text style={[styles.fallbackText, { color: colors.text }]}>Call control room</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            <Pressable
              onPress={() => setSent(null)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.cardButton, pressed && { opacity: 0.8 }]}
            >
              <Text style={styles.cardButtonText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  anchor: {
    position: 'absolute',
    right: space.lg,
    // Above the tab bar (bottom is set from its height), below the sync pill's lane.
    zIndex: 95,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minWidth: 92,
    height: 48,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: '#ffffff22',
    overflow: 'hidden',
    shadowColor: colors.primary,
    shadowOpacity: 0.55,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  buttonArming: { borderColor: '#ffffff88' },
  fill: {
    position: 'absolute',
    left: 0, top: 0, bottom: 0,
    backgroundColor: '#ffffff40',
  },
  buttonText: { color: '#fff', fontWeight: '800', fontSize: 13, letterSpacing: 1 },

  scrim: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center', justifyContent: 'center', padding: space.lg,
  },
  card: {
    width: '100%', maxWidth: 400,
    backgroundColor: colors.bgCard,
    borderWidth: 2, borderColor: colors.primary,
    borderRadius: radius.xl,
    padding: space.xl,
    alignItems: 'center',
  },
  cardIcon: {
    width: 56, height: 56, borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: space.lg,
  },
  cardTitle: { ...type.h1, color: colors.text, textAlign: 'center' },
  cardBody: {
    ...type.small, color: colors.textDim, textAlign: 'center',
    marginTop: space.sm, lineHeight: 20,
  },
  fixRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.md, paddingHorizontal: space.sm },
  fixText: { ...type.small, fontSize: 12, color: colors.textDim, textAlign: 'center', flexShrink: 1 },
  fallbacks: { alignSelf: 'stretch', gap: space.sm, marginTop: space.lg },
  fallback: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 50,
    borderRadius: radius.md, backgroundColor: colors.bgElevated, borderWidth: 1, borderColor: colors.borderStrong,
  },
  fallbackPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  fallbackText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  cardButton: {
    marginTop: space.xl, alignSelf: 'stretch', minHeight: 48,
    borderRadius: radius.md, backgroundColor: colors.bgElevated,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.borderStrong,
  },
  cardButtonText: { color: colors.text, fontWeight: '700', fontSize: 15 },
}));
