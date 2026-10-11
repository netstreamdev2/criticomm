import { useEffect, useRef, useState } from 'react';
import {
  Alert, Animated, Modal, Pressable, StyleSheet, Text, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { subscribeIncidentUpdates } from '@criticom/api';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useNotifications } from '@/lib/notifications';
import { useSync } from '@/lib/sync';
import { useDuty } from '@/lib/duty';
import { confirmAccept } from '@/lib/accept';
import { departmentName } from '@criticom/db';
import { personTitle } from '@/lib/department';
import { colors, radius, severityColor, space, type, makeStyles } from '@/lib/theme';
import { Button } from '@/components/ui';

/** "INC-POL-0042" from a title such as "INC-POL-0042 · 10-57 Robbery", when it carries one. */
const incidentNumberOf = (title: string) => /\b[A-Z]{2,5}(?:-[A-Z0-9]+)+\b/.exec(title)?.[0] ?? null;

/**
 * Corner banners for routine alerts. Sit below the header so they never cover
 * the back button, and slide away on their own.
 */
export function AlertBanners() {
  const styles = useStyles();
  const { banners, dismissBanner } = useNotifications();
  const router = useRouter();

  if (banners.length === 0) return null;

  return (
    <View pointerEvents="box-none" style={styles.bannerStack}>
      {banners.map((b) => (
        <SlideIn key={b.id}>
          <Pressable
            onPress={() => {
              dismissBanner(b.id);
              if (b.incidentId) router.push(`/incident/${b.incidentId}`);
            }}
            style={[styles.banner, { borderLeftColor: severityColor(b.severity) }]}
          >
            <Ionicons name="notifications" size={16} color={severityColor(b.severity)} />
            <View style={{ flex: 1 }}>
              <Text style={styles.bannerTitle} numberOfLines={2}>{b.title}</Text>
              {b.body ? (
                <Text style={styles.bannerBody} numberOfLines={2}>{b.body}</Text>
              ) : null}
            </View>
            <Pressable onPress={() => dismissBanner(b.id)} hitSlop={12}>
              <Ionicons name="close" size={16} color={colors.muted} />
            </Pressable>
          </Pressable>
        </SlideIn>
      ))}
    </View>
  );
}

function SlideIn({ children }: { children: React.ReactNode }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(anim, { toValue: 1, useNativeDriver: true, friction: 9, tension: 70 }).start();
  }, [anim]);
  return (
    <Animated.View
      style={{
        opacity: anim,
        transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) }],
      }}
    >
      {children}
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
      Alert.alert('You are off duty', 'Go on duty to accept incidents.');
      return;
    }
    if (!(await confirmAccept(incidentNumberOf(current.title)))) return;
    setAccepting(true);
    try {
      await enqueue({ kind: 'incident_status', incidentId, status: 'En Route', incidentNumber: incidentNumberOf(current.title) ?? undefined });
      acknowledge(true);
    } catch (e) {
      Alert.alert('Not accepted', (e as Error).message);
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
                  ? (sosSilo && sosSilo.incidentId === current.incident_id ? `${personTitle(sosSilo.silo).toUpperCase()} SOS` : 'SOS')
                  : open ? 'New incident' : 'Incident assigned'}
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
                <Text style={styles.metaText}>Dispatched by {current.created_by_name}</Text>
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
                Sent to everyone on duty. The first to respond leads; others can join as backup.
              </Text>
            ) : null}

            {assignments.length > 1 ? (
              <Text style={styles.queued}>+{assignments.length - 1} more waiting</Text>
            ) : null}

            <View style={{ gap: space.sm, marginTop: space.xl }}>
              {current.incident_id && current.kind !== 'sos' ? (
                <>
                  <Button label="Accept incident" icon="checkmark-circle" size="lg" busy={accepting} onPress={() => void accept()} />
                  <Button label="Acknowledge" icon="eye-outline" variant="outline" size="lg" onPress={() => acknowledge(true)} />
                  <Button label="Navigate" icon="navigate" variant="outline" size="lg" onPress={navigate} />
                </>
              ) : (
                <>
                  {current.incident_id ? (
                    <Button label="View incident" icon="arrow-forward-circle" size="lg" onPress={() => acknowledge(true)} />
                  ) : null}
                  <Button label="Acknowledge" variant="outline" onPress={() => acknowledge(false)} />
                </>
              )}
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  bannerStack: {
    position: 'absolute', top: 0, left: 0, right: 0,
    padding: space.md, gap: space.sm, zIndex: 100,
  },
  banner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: space.md,
    backgroundColor: colors.bgCard,
    borderWidth: 1, borderColor: colors.border,
    borderLeftWidth: 3,
    borderRadius: radius.md,
    padding: space.md,
    shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 }, elevation: 8,
  },
  bannerTitle: { color: colors.text, fontSize: 14, fontWeight: '700', lineHeight: 19 },
  bannerBody: { ...type.small, color: colors.muted, marginTop: 2, lineHeight: 18 },

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
}));
