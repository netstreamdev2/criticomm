import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated, Easing, Modal, Pressable, StyleSheet, Text, View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/lib/auth';
import { useSync } from '@/lib/sync';
import { colors, radius, space, type } from '@/lib/theme';

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
 *     the emergency cannot wait that long. We race a short timeout and send
 *     without coordinates if we have to — dispatch would rather have "officer
 *     down, position unknown" now than a precise position later.
 */

const HOLD_MS = 2500;
/** Beyond this, sending late beats sending accurately. */
const GPS_TIMEOUT_MS = 4000;

export function PanicButton() {
  const { session, silo, fullName } = useAuth();
  const { enqueue } = useSync();
  const [holding, setHolding] = useState(false);
  const [sent, setSent] = useState<null | { at: string; located: boolean }>(null);
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
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status === 'granted') {
        coords = await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
            .then((p) => p.coords),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), GPS_TIMEOUT_MS)),
        ]);
      }
    } catch {
      coords = null;
    }

    await enqueue(
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

    setSent({ at: occurredAt, located: Boolean(coords) });
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

  if (!session) return null;

  return (
    <>
      <Pressable
        onPressIn={startHold}
        onPressOut={cancelHold}
        accessibilityRole="button"
        accessibilityLabel="Emergency — hold to call for assistance"
        accessibilityHint="Press and hold for two and a half seconds to alert your department and the control room"
        style={styles.anchor}
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
            <View style={styles.cardIcon}>
              <Ionicons name="megaphone" size={26} color="#fff" />
            </View>
            <Text style={styles.cardTitle}>Assistance requested</Text>
            <Text style={styles.cardBody}>
              Your department and the control room have been alerted
              {sent?.located
                ? ' with your position.'
                : '. Your position could not be fixed — say where you are on the radio if you can.'}
            </Text>
            <Text style={styles.cardMeta}>
              If you have no signal this is held on the phone and sends the moment you do — ahead of
              everything else in the queue.
            </Text>
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

const styles = StyleSheet.create({
  anchor: {
    position: 'absolute',
    right: space.lg,
    // Above the tab bar, below the sync pill's lane.
    bottom: 88,
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
  cardMeta: {
    ...type.small, fontSize: 12, color: colors.muted, textAlign: 'center',
    marginTop: space.md, lineHeight: 18,
  },
  cardButton: {
    marginTop: space.xl, alignSelf: 'stretch', minHeight: 48,
    borderRadius: radius.md, backgroundColor: colors.bgElevated,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.borderStrong,
  },
  cardButtonText: { color: colors.text, fontWeight: '700', fontSize: 15 },
});
