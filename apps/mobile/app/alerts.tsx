import { useCallback, useEffect, useState, useMemo } from 'react';
import {
  FlatList, Pressable, RefreshControl, StyleSheet, Text, View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  listMyAlerts, subscribeAlerts,
} from '@criticom/api';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useSync } from '@/lib/sync';
import { clearBadge } from '@/lib/push';
import { colors, radius, severityColor, space, timeAgo, type, makeStyles } from '@/lib/theme';
import { Banner, Button, EmptyState, Muted } from '@/components/ui';
import { useT } from '@/lib/i18n';

type AlertRow = Awaited<ReturnType<typeof listMyAlerts>>[number];

/**
 * The alert inbox.
 *
 * Banners and full-screen interrupts are for the moment an alert arrives. This
 * is for every moment after: what came in during the call you were on, what you
 * acknowledged, what is still outstanding. Without it the only record a crew
 * has of a broadcast is whether they happened to be looking at the phone.
 *
 * Alerts that demanded acknowledgement keep showing that they did, and whether
 * it was given — a crew coming back to the app should be able to see at a
 * glance that something is still waiting on them.
 */
export default function AlertsScreen() {
  const { t } = useT();
  const styles = useStyles();
  const router = useRouter();
  const { session, silo } = useAuth();
  const { enqueue, pending } = useSync();
  const [serverAlerts, setAlerts] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    try {
      setAlerts(await listMyAlerts(getSupabase(), { limit: 60 }));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void load();
    if (!session) return;
    const off = subscribeAlerts(getSupabase(), { silo }, () => void load());
    return off;
  }, [load, session, silo]);

  // Opening the inbox is the moment the app-icon badge stops being true.
  useFocusEffect(useCallback(() => { void clearBadge(); }, []));

  const open = async (alert: AlertRow) => {
    if (!alert.read) {
      // Acknowledge here as well as read: a modal alert the responder never saw
      // because the app was closed is still outstanding, and tapping it in the
      // inbox is them dealing with it.
      // Queued, so it counts with no signal and sends when there is.
      void enqueue({ kind: 'alert_read', alertId: alert.id, acknowledged: alert.requires_ack, title: alert.title })
        .catch(() => {});
    }
    if (alert.incident_id) router.push(`/incident/${alert.incident_id}`);
    // Shifts, leave and swaps (0072) open the schedule.
    else if (/^(shift_|leave_|swap)/.test(alert.kind)) router.push('/(tabs)/schedule');
  };

  // Read and acknowledged on this phone count before the server has them.
  const alerts = useMemo(() => {
    const read = new Set<string>();
    const acked = new Set<string>();
    for (const e of pending) {
      if (e.op.kind !== 'alert_read') continue;
      read.add(e.op.alertId);
      if (e.op.acknowledged) acked.add(e.op.alertId);
    }
    if (read.size === 0) return serverAlerts;
    return serverAlerts.map((a) => (read.has(a.id)
      ? { ...a, read: true, acknowledged: a.acknowledged || acked.has(a.id) }
      : a));
  }, [serverAlerts, pending]);

  const unread = alerts.filter((a) => !a.read).length;
  const awaitingAck = alerts.filter((a) => a.requires_ack && !a.acknowledged).length;

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={[styles.list, alerts.length === 0 && { flexGrow: 1 }]}
      data={alerts}
      keyExtractor={(a) => a.id}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={colors.accent}
          colors={[colors.accent]}
          progressBackgroundColor={colors.bgCard}
          onRefresh={() => {
            setRefreshing(true);
            void load().finally(() => setRefreshing(false));
          }}
        />
      }
      ListHeaderComponent={
        <View>
          {error ? <Banner tone="error" onDismiss={() => setError(null)}>{error}</Banner> : null}
          {awaitingAck > 0 ? (
            <Banner tone="error">
              {awaitingAck === 1 ? t('1 alert still waiting on your acknowledgement.') : t('{n} alerts still waiting on your acknowledgement.', { n: awaitingAck })}
            </Banner>
          ) : null}
          {alerts.length > 0 ? (
            <View style={styles.head}>
              <Muted>
                {unread > 0 ? t('{unread} unread of {length}', { unread, length: alerts.length }) : `${alerts.length} alerts`}
              </Muted>
              {unread > 0 ? (
                <Button
                  label={t('Mark all read')}
                  variant="subtle"
                  size="sm"
                  onPress={() => {
                    void (async () => {
                      for (const a of alerts) {
                        if (!a.read) await enqueue({ kind: 'alert_read', alertId: a.id, acknowledged: false, title: a.title });
                      }
                    })().catch(() => {});
                  }}
                />
              ) : null}
            </View>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        loading ? null : (
          <EmptyState
            icon="notifications-outline"
            title={t('No alerts')}
            body={t('Dispatch assignments and department broadcasts land here. High and Critical incidents also open a full-screen alert you have to acknowledge.')}
          />
        )
      }
      renderItem={({ item }) => {
        const tone = severityColor(item.severity);
        const needsAck = item.requires_ack && !item.acknowledged;
        return (
          <Pressable
            onPress={() => void open(item)}
            accessibilityRole="button"
            accessibilityLabel={t('Alert: {title}', { title: item.title })}
            style={({ pressed }) => [
              styles.row,
              { borderLeftColor: tone },
              !item.read && styles.rowUnread,
              pressed && { opacity: 0.85 },
            ]}
          >
            <View style={styles.rowHead}>
              <Ionicons
                name={needsAck ? 'warning' : item.read ? 'mail-open-outline' : 'mail'}
                size={15}
                color={needsAck ? tone : item.read ? colors.muted : colors.accent}
              />
              <Text style={[styles.title, !item.read && { color: colors.text }]} numberOfLines={2}>
                {item.title}
              </Text>
              {!item.read ? <View style={styles.dot} /> : null}
            </View>

            {item.body ? <Text style={styles.body} numberOfLines={3}>{item.body}</Text> : null}

            <View style={styles.metaRow}>
              <View style={[styles.sevChip, { backgroundColor: `${tone}22`, borderColor: `${tone}66` }]}>
                <Text style={[styles.sevText, { color: tone }]}>{item.severity}</Text>
              </View>
              <Text style={styles.meta}>
                {item.created_by_name ? `${item.created_by_name} · ` : ''}{timeAgo(item.created_at)}
              </Text>
              {needsAck ? <Text style={styles.ackPending}>{t('Acknowledgement needed')}</Text> : null}
              {item.acknowledged ? (
                <View style={styles.ackDone}>
                  <Ionicons name="checkmark-circle" size={12} color={colors.low} />
                  <Text style={styles.ackDoneText}>{t('Acknowledged')}</Text>
                </View>
              ) : null}
            </View>
          </Pressable>
        );
      }}
    />
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  list: { padding: space.lg, paddingBottom: space['3xl'] },
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: space.md,
  },

  row: {
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 3,
    borderRadius: radius.md,
    padding: space.md,
    marginBottom: space.sm,
  },
  rowUnread: { backgroundColor: colors.bgElevated, borderColor: colors.borderStrong },
  rowHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  title: { flex: 1, color: colors.textDim, fontSize: 14, fontWeight: '700', lineHeight: 19 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent, marginTop: 5 },
  body: { ...type.small, color: colors.muted, marginTop: 5, lineHeight: 18 },

  metaRow: {
    flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap',
    gap: space.sm, marginTop: space.md,
  },
  sevChip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2 },
  sevText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  meta: { ...type.small, fontSize: 12, color: colors.muted },
  ackPending: { ...type.small, fontSize: 12, color: colors.critical, fontWeight: '700' },
  ackDone: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ackDoneText: { ...type.small, fontSize: 12, color: colors.low, fontWeight: '600' },
}));
