import { useEffect, useRef } from 'react';
import {
  Animated, Modal, Pressable, StyleSheet, Text, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { markAlertRead } from '@criticom/api';
import { getSupabase } from '@/lib/supabase';
import { useNotifications } from '@/lib/notifications';
import { colors, radius, severityColor, space, type } from '@/lib/theme';
import { Button } from '@/components/ui';

const SILO_LABELS: Record<string, string> = {
  Ethekwini: 'Control Room',
  MetroPolice: 'Metro Police',
  MetroFire: 'Fire & Rescue',
  Medical: 'EMS / Medical',
  EthekwiniDisaster: 'Disaster Mgmt',
};

/**
 * Corner banners for routine alerts. Sit below the header so they never cover
 * the back button, and slide away on their own.
 */
export function AlertBanners() {
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
 * Full-screen interrupt for a High or Critical call routed to this crew's
 * department. Deliberately hard to dismiss by accident: no backdrop tap, no
 * swipe — the responder has to acknowledge, which is recorded against the alert.
 */
export function AssignmentAlert() {
  const { assignments, clearAssignment } = useNotifications();
  const router = useRouter();
  const pulse = useRef(new Animated.Value(0)).current;
  const current = assignments[0];

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
    // Best-effort: never trap a responder behind a failed write.
    void markAlertRead(getSupabase(), current.id, { acknowledged: true }).catch(() => {});
    clearAssignment(current.id);
    if (thenOpen && current.incident_id) router.push(`/incident/${current.incident_id}`);
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
                {current.severity.toUpperCase()} · {SILO_LABELS[current.silo] ?? current.silo}
              </Text>
              <Text style={styles.cardHeading}>Incident assigned</Text>
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

            {assignments.length > 1 ? (
              <Text style={styles.queued}>+{assignments.length - 1} more waiting</Text>
            ) : null}

            <View style={{ gap: space.sm, marginTop: space.xl }}>
              {current.incident_id ? (
                <Button
                  label="Acknowledge & open"
                  icon="arrow-forward-circle"
                  size="lg"
                  onPress={() => acknowledge(true)}
                />
              ) : null}
              <Button
                label="Acknowledge"
                variant="outline"
                onPress={() => acknowledge(false)}
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
  queued: {
    ...type.small, color: colors.medium, fontWeight: '700',
    marginTop: space.lg,
  },
});
