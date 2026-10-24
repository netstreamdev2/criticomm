import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { distanceWords, etaMinutes, metresApart, progressAlong, vehicleFor } from '@criticom/api';
import { colors, radius, space, makeStyles } from '@/lib/theme';
import { Button } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { useFeatures } from '@/lib/features';
import { tx } from '@criticom/db/i18n';
import { ResponseVehicle } from './response-vehicle';

/**
 * On the way to the scene (0099): the officer's own progress, as a ride app
 * shows it. Their vehicle on a strip from where they set off to the scene,
 * how far and how long, and the light bar flashing. On scene is marked by
 * the phone reaching the scene; "I'm on scene" is there for a dead GPS or a
 * pin in the wrong place, with a reason, and dispatch sees how it was marked.
 */

const REASONS = [tx('GPS is not working'), tx('The pin is in the wrong place'), tx('I am at the scene')] as const;
const LIGHTS: Record<string, [string, string]> = {
  MetroPolice: ['#3b82f6', '#60a5fa'], Ethekwini: ['#3b82f6', '#60a5fa'],
  Medical: ['#ef4444', '#ffffff'], MetroFire: ['#ef4444', '#fbbf24'], EthekwiniDisaster: ['#facc15', '#f59e0b'],
};

export function ArrivalStrip({ scene, silo, startDistanceM, busy, onMark }: {
  /** The call's map position; null when it has none (then marking by hand is all there is). */
  scene: { lat: number; lng: number } | null;
  silo: string;
  /** How far from the scene they set off (from the server, 0099). */
  startDistanceM: number | null | undefined;
  busy: boolean;
  /** Mark on scene by hand, with why. */
  onMark: (reason: string) => void;
}) {
  const { t } = useT();
  const styles = useStyles();
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  // A location-faking app on the phone (0100): its positions count for nothing.
  const [faked, setFaked] = useState(false);
  const [asking, setAsking] = useState(false);
  const testing = useFeatures().enabled('mobile.testOnScene');
  const v = vehicleFor(silo);
  const [lightA, lightB] = LIGHTS[silo] ?? LIGHTS.MetroPolice!;

  // The phone's position while this is on screen; the route recorder keeps sending it either way.
  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    let alive = true;
    void (async () => {
      const { granted } = await Location.getForegroundPermissionsAsync().catch(() => ({ granted: false }));
      if (!granted || !alive) return;
      const last = await Location.getLastKnownPositionAsync().catch(() => null);
      if (last && alive) setHere({ lat: last.coords.latitude, lng: last.coords.longitude });
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 15, timeInterval: 5000 },
        (p) => { setHere({ lat: p.coords.latitude, lng: p.coords.longitude }); setFaked(p.mocked === true); },
      ).catch(() => null);
      if (!alive) sub?.remove();
    })();
    return () => { alive = false; sub?.remove(); };
  }, []);

  // The light bar: two lights flashing in turn.
  const flash = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(flash, { toValue: 1, duration: 450, useNativeDriver: true }),
      Animated.timing(flash, { toValue: 0, duration: 450, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [flash]);

  const left = scene && here ? metresApart(here, scene) : null;
  const progress = progressAlong(startDistanceM ?? null, left) ?? 0.05;
  const minutes = etaMinutes(left);
  const close = left !== null && left < 200;

  return (
    <View style={[styles.box, { borderColor: `${v.tone}66` }]}>
      <View style={styles.head}>
        <View style={styles.heading}>
          <View style={[styles.statusDot, { backgroundColor: v.tone }]} />
          <Text style={styles.label}>{close ? t('ARRIVING') : t('HEADING TO THE SCENE')}</Text>
        </View>
        {scene ? (
          <View style={styles.etaCard}>
            <Text style={styles.eta}>{minutes !== null ? t('{n} min', { n: minutes }) : '—'}</Text>
            <Text style={styles.sub}>{left !== null ? distanceWords(left) : t('Finding your position…')}</Text>
          </View>
        ) : null}
      </View>

      {scene ? (
        <View style={styles.track}>
          <View style={styles.rail} />
          <View style={[styles.fill, { width: `${progress * 100}%`, backgroundColor: v.tone }]} />
          <View style={[styles.origin, { backgroundColor: v.tone }]} />
          <View style={styles.flag}><Ionicons name="flag" size={13} color={colors.text} /></View>
          <View style={[styles.vehicle, { left: `${progress * 100}%` }]} pointerEvents="none">
            <ResponseVehicle silo={silo} />
            <View style={styles.lights}>
              <Animated.View style={[styles.light, { backgroundColor: lightA, opacity: flash }]} />
              <Animated.View style={[styles.light, { backgroundColor: lightB, opacity: Animated.subtract(1, flash) }]} />
            </View>
          </View>
        </View>
      ) : null}

      {faked ? (
        <Text style={styles.warn}>{t('A fake location app is on. Turn it off: your position cannot be used and your supervisor is told.')}</Text>
      ) : null}

      {/* Testing (feature mobile.testOnScene): one tap beside the automatic arrival. */}
      {scene && testing ? (
        <Button label={t('Mark On Scene')} icon="flag" size="lg" busy={busy} onPress={() => onMark('Marked on scene (testing)')} />
      ) : null}

      <Text style={styles.note}>
        {scene
          ? t('On scene is marked by itself when you get there.')
          : t('This call has no map position. Mark On Scene when you get there.')}
      </Text>

      {!scene ? (
        <Button label={t('Mark On Scene')} icon="flag" size="lg" busy={busy} onPress={() => onMark('The call has no map position')} />
      ) : asking ? (
        <View style={{ gap: space.sm }}>
          <Text style={styles.warn}>{t('Marking it yourself is checked against where your phone is. Away from the scene, dispatch is told and must confirm it before you can file the report.')}</Text>
          {REASONS.map((r) => (
            <Button key={r} label={t(r)} variant="outline" busy={busy} onPress={() => { setAsking(false); onMark(r); }} />
          ))}
          <Pressable onPress={() => setAsking(false)} accessibilityRole="button" style={styles.cancel}>
            <Text style={styles.cancelText}>{t('Cancel')}</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable onPress={() => setAsking(true)} accessibilityRole="button" style={styles.manual}>
          <Text style={styles.manualText}>{t("I'm on scene — it has not changed")}</Text>
        </Pressable>
      )}
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  box: { borderWidth: 1, borderRadius: 22, padding: space.md, gap: space.sm, backgroundColor: colors.panel },
  head: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  label: { color: colors.text, fontSize: 11, fontWeight: '800', letterSpacing: 0.8, flexShrink: 1 },
  etaCard: { alignItems: 'flex-end', borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgSoft, paddingHorizontal: 12, paddingVertical: 8 },
  eta: { color: colors.text, fontSize: 27, fontWeight: '800', letterSpacing: -1, fontVariant: ['tabular-nums'] },
  sub: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  track: { height: 60, justifyContent: 'center', marginHorizontal: 24, marginTop: 14, marginBottom: 0 },
  rail: { position: 'absolute', left: 0, right: 0, height: 4, borderRadius: 2, backgroundColor: colors.border },
  fill: { position: 'absolute', left: 0, height: 4, borderRadius: 2 },
  origin: { position: 'absolute', left: -4, width: 8, height: 8, borderRadius: 4, borderWidth: 2, borderColor: colors.bgCard },
  flag: { position: 'absolute', right: -10, width: 22, height: 22, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border },
  vehicle: {
    position: 'absolute', width: 76, height: 46, marginLeft: -38,
    alignItems: 'center', justifyContent: 'center', transform: [{ translateY: -17 }],
  },
  lights: { position: 'absolute', top: 8, flexDirection: 'row', gap: 2 },
  light: { width: 7, height: 3, borderRadius: 2 },
  note: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
  warn: { color: colors.medium, fontSize: 13 },
  manual: { alignSelf: 'stretch', paddingVertical: 12, paddingHorizontal: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  manualText: { color: colors.accentInk, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  cancel: { alignSelf: 'center', padding: 8 },
  cancelText: { color: colors.muted, fontSize: 14, fontWeight: '700' },
}));
