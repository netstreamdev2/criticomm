import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Animated, Modal, PanResponder, Pressable, StyleSheet, Text, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { subscribeIncidentUpdates } from '@criticom/api';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { BANNER_MS, useNotifications, type Banner } from '@/lib/notifications';
import { useSync } from '@/lib/sync';
import { useDuty } from '@/lib/duty';
import { confirmAccept } from '@/lib/accept';
import { departmentName } from '@criticom/db';
import { personTitle } from '@/lib/department';
import { colors, getThemeMode, radius, severityColor, space, type, makeStyles } from '@/lib/theme';
import { Button } from '@/components/ui';
import { useT } from '@/lib/i18n';

/** "INC-POL-0042" from a title such as "INC-POL-0042 · 10-57 Robbery", when it carries one. */
const incidentNumberOf = (title: string) => /\b[A-Z]{2,5}(?:-[A-Z0-9]+)+\b/.exec(title)?.[0] ?? null;

/**
 * The heads-up: a notification drops in from the top as a white frosted
 * bubble, the way a Samsung's does, says whom it was for, and lifts away by
 * itself. Swipe it up to dismiss; tap it to open. Below the status bar, so it
 * never covers the clock; never used for the full-screen alerts below.
 */
export function AlertBanners() {
  const { banners, dismissBanner } = useNotifications();
  const insets = useSafeAreaInsets();
  if (banners.length === 0) return null;
  return (
    <View pointerEvents="box-none" style={[bubbleStack, { top: insets.top + space.xs }]}>
      {[...banners].reverse().map((b) => <HeadsUp key={b.id} banner={b} onGone={dismissBanner} />)}
    </View>
  );
}

const bubbleStack = {
  position: 'absolute' as const, left: 0, right: 0,
  paddingHorizontal: space.sm, gap: space.sm, zIndex: 100,
};

const KIND_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  mail: 'mail', task: 'clipboard', broadcast: 'megaphone', dispatch: 'radio', assignment: 'radio',
  backup: 'people', reassigned: 'swap-horizontal', stand_down: 'hand-left',
};
const iconFor = (kind?: string): keyof typeof Ionicons.glyphMap =>
  (kind && KIND_ICON[kind]) || (kind && /^(shift_|leave_|swap)/.test(kind) ? 'calendar' : 'notifications');

function HeadsUp({ banner: b, onGone }: { banner: Banner; onGone: (id: string) => void }) {
  const { t } = useT();
  const styles = useStyles();
  const router = useRouter();
  const enter = useRef(new Animated.Value(0)).current;
  const drag = useRef(new Animated.Value(0)).current;
  const gone = useRef(false);

  const leave = useCallback(() => {
    if (gone.current) return;
    gone.current = true;
    Animated.timing(enter, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => onGone(b.id));
  }, [enter, onGone, b.id]);

  useEffect(() => {
    Animated.spring(enter, { toValue: 1, useNativeDriver: true, friction: 8, tension: 80 }).start();
    const timer = setTimeout(leave, BANNER_MS);
    return () => clearTimeout(timer);
  }, [enter, leave]);

  // Swipe up to dismiss; a small drag springs back.
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 6,
    onPanResponderMove: (_e, g) => drag.setValue(Math.min(0, g.dy)),
    onPanResponderRelease: (_e, g) => {
      if (g.dy < -30 || g.vy < -0.6) leave();
      else Animated.spring(drag, { toValue: 0, useNativeDriver: true }).start();
    },
    onPanResponderTerminate: () => Animated.spring(drag, { toValue: 0, useNativeDriver: true }).start(),
  }), [drag, leave]);

  const open = () => {
    leave();
    if (b.incidentId) router.push(`/incident/${b.incidentId}`);
    else if (b.kind && /^(shift_|leave_|swap)/.test(b.kind)) router.push('/(tabs)/schedule');
    else router.push('/alerts');
  };

  const accent = b.accent ?? colors.accent;
  const urgent = b.severity === 'High' || b.severity === 'Critical';
  return (
    <Animated.View
      {...pan.panHandlers}
      style={{
        opacity: enter,
        transform: [
          { translateY: Animated.add(enter.interpolate({ inputRange: [0, 1], outputRange: [-90, 0] }), drag) },
          { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
        ],
      }}
    >
      <Pressable onPress={open} style={styles.bubble} accessibilityRole="button" accessibilityLabel={b.title}>
        <View style={[styles.bubbleIcon, { backgroundColor: `${accent}2e` }]}>
          <Ionicons name={iconFor(b.kind)} size={17} color={accent} />
          {urgent ? <View style={[styles.bubbleDot, { backgroundColor: severityColor(b.severity) }]} /> : null}
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.bubbleTop}>
            <Text style={styles.bubbleApp}>HikTech</Text>
            {b.audience ? (
              <>
                <Text style={styles.bubbleSep}>·</Text>
                <Text style={[styles.bubbleAudience, { color: accent }]} numberOfLines={1}>{b.audience}</Text>
              </>
            ) : null}
            <Text style={styles.bubbleSep}>·</Text>
            <Text style={styles.bubbleSep}>{t('now')}</Text>
          </View>
          <Text style={styles.bubbleTitle} numberOfLines={2}>{b.title}</Text>
          {b.body ? <Text style={styles.bubbleBody} numberOfLines={2}>{b.body}</Text> : null}
          {b.from ? <Text style={styles.bubbleFrom} numberOfLines={1}>{t('From {name}', { name: b.from })}</Text> : null}
        </View>
        <Pressable onPress={leave} hitSlop={12} accessibilityLabel={t('Dismiss')}>
          <Ionicons name="close" size={16} color={styles.bubbleSep.color} />
        </Pressable>
      </Pressable>
      <View style={styles.bubbleGrip} />
    </Animated.View>
  );
}

/**
 * Full-screen interrupt for a call sent out to this officer (an open
 * dispatch: first to respond leads) or assigned to them. Deliberately hard
 * to dismiss by accident: no backdrop tap, no swipe — the responder has to
 * press a button, which is recorded against the alert.
 */
export function AssignmentAlert() {
  const { t } = useT();
  const styles = useStyles();
  const { assignments, clearAssignment } = useNotifications();
  const { session } = useAuth();
  const router = useRouter();
  const pulse = useRef(new Animated.Value(0)).current;
  const { enqueue } = useSync();
  const { onDuty } = useDuty();
  const [accepting, setAccepting] = useState(false);
  const current = assignments[0];
  const open = current?.kind === 'dispatch';
  // A colleague's SOS: raised (to command, kind 'sos') or dispatched to me
  // (the server leads the title with "SOS", migration 0043).
  const sos = current?.kind === 'sos' || Boolean(current?.title.startsWith('SOS'));
  // Whose SOS it is: the SOS incident is logged under the department of the
  // person who pressed it, so the heading names them (a paramedic, a firefighter).
  const [sosSilo, setSosSilo] = useState<{ incidentId: string; silo: string } | null>(null);
  const sosIncident = sos ? current?.incident_id ?? null : null;
  useEffect(() => {
    if (!sosIncident) return;
    let live = true;
    void getSupabase().from('incidents').select('silo').eq('id', sosIncident).maybeSingle()
      .then(({ data }) => { if (live && data?.silo) setSosSilo({ incidentId: sosIncident, silo: data.silo }); });
    return () => { live = false; };
  }, [sosIncident]);

  // An open call another officer has already taken is no longer this
  // officer's to answer: take it off their screen.
  const waiting = assignments.filter((a) => a.kind === 'dispatch' && a.incident_id).map((a) => a.incident_id).join(',');
  useEffect(() => {
    if (!waiting || !session) return;
    const ids = new Set(waiting.split(','));
    return subscribeIncidentUpdates(getSupabase(), 'all', (incident) => {
      if (!ids.has(incident.id)) return;
      if (incident.accepted_by && incident.accepted_by !== session.user.id) {
        for (const a of assignments) {
          if (a.incident_id === incident.id) clearAssignment(a.id);
        }
      }
    });
  }, [waiting, session, assignments, clearAssignment]);

  useEffect(() => {
    if (!current) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [current, pulse]);

  if (!current) return null;

  const tone = severityColor(current.severity);

  const acknowledge = (thenOpen: boolean) => {
    // Queued, so an acknowledgement in a dead zone still reaches dispatch, and
    // a responder is never trapped behind a failed write.
    void enqueue({ kind: 'alert_read', alertId: current.id, acknowledged: true, title: current.title }).catch(() => {});
    clearAssignment(current.id);
    if (!thenOpen || !current.incident_id) return;
    // Command's copy of a raised SOS is not theirs to respond to: open it in full.
    if (current.kind === 'sos') router.push(`/incident/${current.incident_id}`);
    else router.push({ pathname: '/(tabs)/incidents', params: { open: current.incident_id } });
  };

  /**
   * Accept: asked once, then the officer is en route and dispatch sees it.
   * Queued like every status, so a dead zone does not lose it.
   */
  const accept = async () => {
    const incidentId = current.incident_id;
    if (!incidentId) return;
    if (onDuty === false) {
      Alert.alert(t('You are off duty'), t('Go on duty to accept incidents.'));
      return;
    }
    if (!(await confirmAccept(incidentNumberOf(current.title)))) return;
    setAccepting(true);
    try {
      await enqueue({ kind: 'incident_status', incidentId, status: 'En Route', incidentNumber: incidentNumberOf(current.title) ?? undefined });
      acknowledge(true);
    } catch (e) {
      Alert.alert(t('Not accepted'), (e as Error).message);
    } finally {
      setAccepting(false);
    }
  };

  /** Acknowledge, and show the way to the scene on the in-app route map. */
  const navigate = () => {
    const incidentId = current.incident_id;
    acknowledge(false);
    if (incidentId) router.push(`/route/${incidentId}`);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => acknowledge(false)}>
      <View style={styles.scrim}>
        <View style={[styles.card, { borderColor: tone }]}>
          <View style={[styles.cardHeader, { backgroundColor: tone }]}>
            <Animated.View style={{ opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.35] }) }}>
              <Ionicons name="warning" size={26} color="#fff" />
            </Animated.View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardKicker}>
                {current.severity.toUpperCase()} · {departmentName(current.silo)}
              </Text>
              <Text style={styles.cardHeading}>
                {sos
                  ? (sosSilo && sosSilo.incidentId === current.incident_id ? t('{personTitle} SOS', { personTitle: personTitle(sosSilo.silo).toUpperCase() }) : t('SOS'))
                  : open ? t('New incident') : t('Incident assigned')}
              </Text>
            </View>
          </View>

          <View style={styles.cardBody}>
            <Text style={styles.title}>{current.title}</Text>
            {current.body ? (
              <View style={styles.metaRow}>
                <Ionicons name="location-outline" size={15} color={colors.muted} />
                <Text style={styles.metaText}>{current.body}</Text>
              </View>
            ) : null}
            {current.created_by_name ? (
              <View style={styles.metaRow}>
                <Ionicons name="radio-outline" size={15} color={colors.muted} />
                <Text style={styles.metaText}>{t('Dispatched by {created_by_name}', { created_by_name: current.created_by_name })}</Text>
              </View>
            ) : null}
            <View style={styles.metaRow}>
              <Ionicons name="time-outline" size={15} color={colors.muted} />
              <Text style={styles.metaText}>
                {new Date(current.created_at).toLocaleTimeString('en-ZA', {
                  hour: '2-digit', minute: '2-digit', second: '2-digit',
                })}
              </Text>
            </View>

            {open ? (
              <Text style={styles.open}>
                {t('Sent to everyone on duty. The first to respond leads; others can join as backup.')}
              </Text>
            ) : null}

            {assignments.length > 1 ? (
              <Text style={styles.queued}>{t('+{n} more waiting', { n: assignments.length - 1 })}</Text>
            ) : null}

            <View style={{ gap: space.sm, marginTop: space.xl }}>
              {current.incident_id && current.kind !== 'sos' ? (
                <>
                  <Button label={t('Accept incident')} icon="checkmark-circle" size="lg" busy={accepting} onPress={() => void accept()} />
                  <Button label={t('Acknowledge')} icon="eye-outline" variant="outline" size="lg" onPress={() => acknowledge(true)} />
                  <Button label={t('Navigate')} icon="navigate" variant="outline" size="lg" onPress={navigate} />
                </>
              ) : (
                <>
                  {current.incident_id ? (
                    <Button label={t('View incident')} icon="arrow-forward-circle" size="lg" onPress={() => acknowledge(true)} />
                  ) : null}
                  <Button label={t('Acknowledge')} variant="outline" onPress={() => acknowledge(false)} />
                </>
              )}
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/**
 * The bubble's milky white: on the dark theme the card colour lifted toward
 * white, on the light one nearly white glass. (The phone has no live blur,
 * so the frost is in the colour.)
 */
export const bubbleTone = () => (getThemeMode() === 'light'
  ? { fill: 'rgba(255,255,255,0.97)', edge: 'rgba(15,23,42,0.08)', ink: '#0f172a', dim: '#5f6b7e' }
  : { fill: 'rgba(52,53,82,0.97)', edge: 'rgba(255,255,255,0.16)', ink: '#ffffff', dim: '#b8bdd0' });

const useStyles = makeStyles(() => {
  const tone = bubbleTone();
  return StyleSheet.create({
  bubble: {
    flexDirection: 'row', alignItems: 'flex-start', gap: space.md,
    backgroundColor: tone.fill,
    borderWidth: 1, borderColor: tone.edge,
    borderRadius: 22,
    paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.lg,
    shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 }, elevation: 10,
  },
  bubbleIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  bubbleDot: { position: 'absolute', top: -1, right: -1, width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: tone.fill },
  bubbleTop: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  bubbleApp: { fontSize: 11, fontWeight: '700', color: tone.ink, opacity: 0.8 },
  bubbleAudience: { fontSize: 11, fontWeight: '700', flexShrink: 1 },
  bubbleSep: { fontSize: 11, color: tone.dim },
  bubbleTitle: { color: tone.ink, fontSize: 14, fontWeight: '700', lineHeight: 19, marginTop: 2 },
  bubbleBody: { fontSize: 13, color: tone.dim, marginTop: 1, lineHeight: 18 },
  bubbleFrom: { fontSize: 11, color: tone.dim, marginTop: 4 },
  bubbleGrip: { position: 'absolute', bottom: 6, alignSelf: 'center', width: 34, height: 4, borderRadius: 2, backgroundColor: tone.dim, opacity: 0.35 },

  scrim: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center', justifyContent: 'center', padding: space.lg,
  },
  card: {
    width: '100%', maxWidth: 440,
    backgroundColor: colors.bgCard,
    borderWidth: 2, borderRadius: radius.xl, overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingHorizontal: space.xl, paddingVertical: space.lg,
  },
  cardKicker: {
    ...type.label, fontSize: 10,
    color: 'rgba(255,255,255,0.85)',
  },
  cardHeading: { color: '#fff', fontSize: 19, fontWeight: '800', marginTop: 2 },
  cardBody: { padding: space.xl },

  title: { color: colors.text, fontSize: 17, fontWeight: '700', lineHeight: 23 },
  metaRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, marginTop: space.md },
  metaText: { ...type.small, color: colors.muted, flex: 1, lineHeight: 19 },
  open: { ...type.small, color: colors.text, fontWeight: '700', marginTop: space.lg, lineHeight: 19 },
  queued: {
    ...type.small, color: colors.medium, fontWeight: '700',
    marginTop: space.lg,
  },
  });
});
