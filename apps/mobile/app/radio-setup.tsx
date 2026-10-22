import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { deptChannel } from '@criticom/api';
import { useAuth } from '@/lib/auth';
import { useDuty } from '@/lib/duty';
import { presenceSentAt, reportPresence, useRadioId } from '@/lib/presence';
import { cameraStandby, checkCamera } from '@/lib/radio-camera';
import {
  askToIgnoreBatterySaving, chooseOpenOnBoot, currentKeyMap, hasButtonLearning, ignoresBatterySaving, isRadioDevice, loadKeyMap,
  onAnyButton, openOnBootChoice, saveKeyMap,
} from '@/lib/radio-keys';
import { startTalkWatch, stopTalkWatch } from '@/lib/radio-talk';
import { liveKitNative } from '@/lib/talk-native';
import { sendRoute, startRoute, useRouteStatus } from '@/lib/tracker';
import { bookThisDevice } from '@/lib/kit';
import { Banner, Button, Card, Muted, SectionLabel, Title } from '@/components/ui';
import { colors, radius, space, makeStyles } from '@/lib/theme';
import { useT } from '@/lib/i18n';

type Heard = { at: number; text: string };

/**
 * The radio's or hard hat's own setup: is it connected (one button puts
 * everything back), is it left out of battery saving, does it open by itself
 * when switched on, and which buttons are the talk and SOS buttons. The last
 * buttons pressed are listed, for setting up a new kind of device.
 */
export default function RadioSetupScreen() {
  const { t } = useT();
  const styles = useStyles();
  const { session, silo } = useAuth();
  const { onDuty } = useDuty();
  const route = useRouteStatus();
  const radio = useRadioId();
  const [now, setNow] = useState(Date.now());
  const [battery, setBattery] = useState(ignoresBatterySaving());
  const [boot, setBoot] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [learning, setLearning] = useState<'ptt' | 'sos' | null>(null);
  const [map, setMap] = useState(currentKeyMap());
  const [heard, setHeard] = useState<Heard[]>([]);
  const learningRef = useRef(learning);
  learningRef.current = learning;

  // The clock for "heard 20 s ago", and battery saving re-read when coming back from the system's question.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    const app = AppState.addEventListener('change', (s) => { if (s === 'active') setBattery(ignoresBatterySaving()); });
    void loadKeyMap().then(setMap);
    void openOnBootChoice().then(setBoot);
    return () => { clearInterval(timer); app.remove(); };
  }, []);

  // Every button pressed while this is open; the next one learned when asked.
  useEffect(() => onAnyButton((e) => {
    const text = e.kind === 'key'
      ? `${e.key.pressed ? '▼' : '▲'} ${e.key.name} (${e.key.code})`
      : `${e.radio.pressed ? '▼' : '▲'} ${e.radio.key === 'ptt' ? t('Talk button') : t('SOS button')} · ${e.radio.action ?? ''}`;
    setHeard((h) => [{ at: Date.now(), text }, ...h].slice(0, 10));
    const want = learningRef.current;
    if (!want || e.kind !== 'key' || !e.key.pressed) return;
    const next = { ...currentKeyMap() };
    next[want] = [e.key.code];
    // One button, one job.
    const other = want === 'ptt' ? 'sos' : 'ptt';
    next[other] = next[other].filter((c) => c !== e.key.code);
    void saveKeyMap(next).then(() => setMap(currentKeyMap()));
    setLearning(null);
    setDone(want === 'ptt' ? t('Talk button learned: {name}', { name: e.key.name }) : t('SOS button learned: {name}', { name: e.key.name }));
  }), [t]);

  const reconnect = useCallback(async () => {
    if (!session) return;
    setBusy(true);
    setDone(null);
    try {
      if (onDuty) {
        await startRoute(session.user.id);
        await cameraStandby(true);
        await stopTalkWatch();
        startTalkWatch(deptChannel(silo));
        void bookThisDevice(session.user.id, { force: true }).catch(() => null);
      }
      await loadKeyMap();
      await reportPresence();
      void sendRoute({ force: true });
      void checkCamera();
      setDone(presenceSentAt() > Date.now() - 15_000 ? t('Connected. Dispatch can see this radio.') : t('Tried again. No answer from the server yet: check the signal.'));
    } finally {
      setBusy(false);
      setNow(Date.now());
    }
  }, [session, onDuty, silo, t]);

  const toggleBoot = (on: boolean) => {
    setBoot(on);
    void chooseOpenOnBoot(on);
  };

  const sent = presenceSentAt();
  const ago = sent ? Math.max(0, Math.round((now - sent) / 1000)) : null;
  const rows: Array<{ ok: boolean; label: string; detail: string }> = [
    { ok: Boolean(session), label: t('Signed in'), detail: radio ?? '' },
    { ok: onDuty === true, label: t('On duty'), detail: onDuty ? '' : t('Start your shift to connect') },
    { ok: ago !== null && ago < 90, label: t('Dispatch can see it'), detail: ago === null ? t('Not yet') : t('{n} s ago', { n: ago }) },
    {
      ok: route.mode === 'background', label: t('Position'),
      detail: route.mode === 'background' ? t('Recording, screen off too') : route.mode === 'foreground' ? t('Only while the app is open') : route.mode === 'denied' ? t('Location not allowed') : t('Off'),
    },
    { ok: Boolean(liveKitNative()), label: t('Talk'), detail: liveKitNative() ? '' : t('Needs the latest app') },
    { ok: battery, label: t('Keeps running'), detail: battery ? '' : t('Battery saving may stop it') },
  ];

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.container}>
      <SectionLabel>{t('Connection')}</SectionLabel>
      <Card>
        {rows.map((r) => (
          <View key={r.label} style={styles.row}>
            <Ionicons name={r.ok ? 'checkmark-circle' : 'alert-circle'} size={22} color={r.ok ? colors.low : colors.medium} />
            <Text style={styles.rowLabel}>{r.label}</Text>
            <Text style={styles.rowDetail} numberOfLines={1}>{r.detail}</Text>
          </View>
        ))}
        <View style={{ marginTop: space.md, gap: space.sm }}>
          <Button label={t('Reconnect')} icon="refresh" size="lg" busy={busy} onPress={() => void reconnect()} />
          {!battery ? (
            <Button label={t('Keep running in the background')} icon="battery-charging-outline" variant="outline" onPress={() => { askToIgnoreBatterySaving(); }} />
          ) : null}
        </View>
        {done ? <Banner tone="info" onDismiss={() => setDone(null)}>{done}</Banner> : null}
      </Card>

      {isRadioDevice() ? (
        <Card>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Title>{t('Open when switched on')}</Title>
              <Muted>{t('The app opens by itself when this radio starts, and connects.')}</Muted>
            </View>
            <Switch value={boot} onValueChange={toggleBoot} />
          </View>
        </Card>
      ) : null}

      <SectionLabel>{t('Buttons')}</SectionLabel>
      <Card>
        {!hasButtonLearning() ? (
          <Muted>{t('This needs the latest app. Install it, then come back here.')}</Muted>
        ) : (
          <>
            <Muted>{t('The talk button talks on your team’s group; the SOS button raises an SOS. Most radios work without setting up. If a button does nothing, teach it here.')}</Muted>
            <View style={{ marginTop: space.md, gap: space.sm }}>
              <Button
                label={learning === 'ptt' ? t('Press the talk button now…') : map.ptt.length ? t('Talk button: set. Teach again') : t('Teach the talk button')}
                icon="mic-outline" variant={learning === 'ptt' ? 'success' : 'outline'} onPress={() => setLearning(learning === 'ptt' ? null : 'ptt')}
              />
              <Button
                label={learning === 'sos' ? t('Press the SOS button now…') : map.sos.length ? t('SOS button: set. Teach again') : t('Teach the SOS button')}
                icon="alert-circle-outline" variant={learning === 'sos' ? 'success' : 'outline'} onPress={() => setLearning(learning === 'sos' ? null : 'sos')}
              />
              {map.ptt.length || map.sos.length ? (
                <Pressable onPress={() => { void saveKeyMap({ ptt: [], sos: [] }).then(() => setMap(currentKeyMap())); }} hitSlop={8}>
                  <Text style={styles.link}>{t('Forget the taught buttons')}</Text>
                </Pressable>
              ) : null}
            </View>
          </>
        )}
      </Card>

      {heard.length ? (
        <>
          <SectionLabel>{t('Last buttons pressed')}</SectionLabel>
          <Card>
            {heard.map((h) => (
              <Text key={`${h.at}-${h.text}`} style={styles.log}>{h.text}</Text>
            ))}
          </Card>
        </>
      ) : null}
    </ScrollView>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  container: { padding: space.lg, gap: space.md, paddingBottom: space.xl * 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 8 },
  rowLabel: { color: colors.text, fontSize: 16, fontWeight: '700' },
  rowDetail: { flex: 1, textAlign: 'right', color: colors.textDim, fontSize: 13 },
  link: { color: colors.accent, fontWeight: '700', textAlign: 'center', paddingVertical: space.sm },
  log: { color: colors.text, fontFamily: 'monospace', fontSize: 13, paddingVertical: 2, borderRadius: radius.sm },
}));
