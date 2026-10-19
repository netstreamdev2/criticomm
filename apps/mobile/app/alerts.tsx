import { useCallback, useEffect, useState, useMemo } from 'react';
import {
  FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  AUDIENCE_TONE, audienceGroup, audienceLabel, listMyAlerts, subscribeAlerts, type AudienceGroup,
} from '@criticom/api';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useSync } from '@/lib/sync';
import { clearBadge } from '@/lib/push';
import { colors, getThemeMode, radius, severityColor, space, timeAgo, type, makeStyles } from '@/lib/theme';
import { Banner, Button, EmptyState, Muted } from '@/components/ui';
import { useT } from '@/lib/i18n';

type AlertRow = Awaited<ReturnType<typeof listMyAlerts>>[number];
type Tab = 'all' | 'unread' | AudienceGroup;

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'mine', label: 'Just me' },
  { key: 'shared', label: 'Shared' },
  { key: 'department', label: 'My department' },
  { key: 'everyone', label: 'Everyone' },
];

const KIND_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  mail: 'mail-outline', task: 'clipboard-outline', broadcast: 'megaphone-outline',
  dispatch: 'radio-outline', assignment: 'radio-outline', sos: 'warning-outline',
  backup: 'people-outline', reassigned: 'swap-horizontal', stand_down: 'hand-left-outline',
};
const iconFor = (kind: string): keyof typeof Ionicons.glyphMap =>
  KIND_ICON[kind] ?? (/^(shift_|leave_|swap)/.test(kind) ? 'calendar-outline' : 'notifications-outline');

/**
 * The notification inbox.
 *
 * The heads-up and the full-screen alert are for the moment one arrives.
 * This is for every moment after: what came in during the call you were on,
 * what you acknowledged, what is still waiting. Each bubble says whom it was
 * for (0084): just you, a few of you, your role, your department, everyone.
 */
export default function AlertsScreen() {
  const { t } = useT();
  const styles = useStyles();
  const router = useRouter();
  const { session } = useAuth();
  const { enqueue, pending } = useSync();
  const [serverAlerts, setAlerts] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('all');

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
    const off = subscribeAlerts(getSupabase(), () => void load());
    return off;
  }, [load, session]);

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

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { all: alerts.length, unread: 0, mine: 0, shared: 0, department: 0, everyone: 0 };
    for (const a of alerts) {
      c[audienceGroup(a)] += 1;
      if (!a.read) c.unread += 1;
    }
    return c;
  }, [alerts]);

  const shown = alerts.filter((a) => (tab === 'all' ? true : tab === 'unread' ? !a.read : audienceGroup(a) === tab));
  const unread = counts.unread;
  const awaitingAck = alerts.filter((a) => a.requires_ack && !a.acknowledged).length;
  const me = session?.user.id;

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={[styles.list, shown.length === 0 && { flexGrow: 1 }]}
      data={shown}
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
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
            {TABS.map((x) => {
              const on = tab === x.key;
              return (
                <Pressable
                  key={x.key}
                  onPress={() => setTab(x.key)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                  style={[styles.tab, on && styles.tabOn]}
                >
                  <Text style={[styles.tabText, on && styles.tabTextOn]}>{t(x.label)}</Text>
                  {counts[x.key] > 0 ? (
                    <Text style={[styles.tabCount, on && styles.tabTextOn, x.key === 'unread' && !on && { color: colors.accent }]}>
                      {counts[x.key]}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
          {alerts.length > 0 ? (
            <View style={styles.head}>
              <Muted>
                {unread > 0 ? t('{unread} unread of {length}', { unread, length: alerts.length }) : t('{n} notifications', { n: alerts.length })}
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
            title={tab === 'unread' ? t('All caught up') : t('No notifications')}
            body={t('What is sent to you, your role, your department and everyone lands here. High and Critical incidents also open a full-screen alert you have to acknowledge.')}
          />
        )
      }
      renderItem={({ item }) => {
        const group = audienceGroup(item);
        const accent = AUDIENCE_TONE[group];
        const sev = severityColor(item.severity);
        const needsAck = item.requires_ack && !item.acknowledged;
        const from = item.created_by && item.created_by !== me ? item.created_by_name : item.created_by ? null : item.created_by_name;
        return (
          <Pressable
            onPress={() => void open(item)}
            accessibilityRole="button"
            accessibilityLabel={t('Alert: {title}', { title: item.title })}
            style={({ pressed }) => [styles.bubble, pressed && { opacity: 0.85, transform: [{ scale: 0.99 }] }]}
          >
            {!item.read ? <View style={styles.unreadBar} /> : null}
            <View style={[styles.icon, { backgroundColor: `${accent}26` }]}>
              <Ionicons name={needsAck ? 'warning' : iconFor(item.kind)} size={17} color={needsAck ? sev : accent} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.topRow}>
                <View style={[styles.chip, { backgroundColor: `${accent}22` }]}>
                  <Text style={[styles.chipText, { color: accent }]} numberOfLines={1}>{audienceLabel(item)}</Text>
                </View>
                <Text style={styles.meta}>{timeAgo(item.created_at)}</Text>
                {!item.read ? <View style={styles.dot} /> : null}
              </View>
              <Text style={[styles.title, item.read && { fontWeight: '600', color: styles.body.color }]} numberOfLines={2}>
                {item.title}
              </Text>
              {item.body ? <Text style={styles.body} numberOfLines={3}>{item.body}</Text> : null}
              <View style={styles.metaRow}>
                {from ? <Text style={styles.meta}>{t('From {name}', { name: from })}</Text> : null}
                {item.severity !== 'Low' ? (
                  <View style={[styles.sevChip, { backgroundColor: `${sev}22`, borderColor: `${sev}66` }]}>
                    <Text style={[styles.sevText, { color: sev }]}>{item.severity}</Text>
                  </View>
                ) : null}
                {needsAck ? <Text style={styles.ackPending}>{t('Acknowledgement needed')}</Text> : null}
                {item.acknowledged ? (
                  <View style={styles.ackDone}>
                    <Ionicons name="checkmark-circle" size={12} color={colors.low} />
                    <Text style={styles.ackDoneText}>{t('Acknowledged')}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          </Pressable>
        );
      }}
    />
  );
}

/** Milky white bubbles: a white haze on the dark theme, white cards on the light one. */
const useStyles = makeStyles(() => {
  const light = getThemeMode() === 'light';
  const fill = light ? 'rgba(255,255,255,0.96)' : 'rgba(255,255,255,0.075)';
  const edge = light ? 'rgba(15,23,42,0.07)' : 'rgba(255,255,255,0.13)';
  return StyleSheet.create({
    list: { padding: space.lg, paddingBottom: space['3xl'] },
    head: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      marginBottom: space.md,
    },
    tabs: { gap: space.sm, paddingBottom: space.md },
    tab: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      paddingHorizontal: space.md, height: 32, borderRadius: radius.pill,
      backgroundColor: fill, borderWidth: 1, borderColor: edge,
    },
    tabOn: { backgroundColor: light ? '#0f172a' : '#ffffff', borderColor: light ? '#0f172a' : '#ffffff' },
    tabText: { fontSize: 12, fontWeight: '700', color: colors.textDim },
    tabTextOn: { color: light ? '#ffffff' : '#0f172a' },
    tabCount: { fontSize: 11, fontWeight: '700', color: colors.muted },

    bubble: {
      flexDirection: 'row', alignItems: 'flex-start', gap: space.md,
      backgroundColor: fill, borderWidth: 1, borderColor: edge,
      borderRadius: 20, padding: space.md, paddingLeft: space.lg,
      marginBottom: space.sm, overflow: 'hidden',
      shadowColor: '#000', shadowOpacity: light ? 0.06 : 0, shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 }, elevation: light ? 1 : 0,
    },
    unreadBar: { position: 'absolute', left: 0, top: 12, bottom: 12, width: 3, borderTopRightRadius: 3, borderBottomRightRadius: 3, backgroundColor: colors.accent },
    icon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
    topRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    chip: { borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2, flexShrink: 1 },
    chipText: { fontSize: 11, fontWeight: '700' },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent, marginLeft: 'auto' },
    title: { color: colors.text, fontSize: 14, fontWeight: '700', lineHeight: 19, marginTop: 6 },
    body: { ...type.small, color: colors.muted, marginTop: 3, lineHeight: 18 },

    metaRow: {
      flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap',
      gap: space.sm, marginTop: space.sm,
    },
    sevChip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2 },
    sevText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
    meta: { ...type.small, fontSize: 12, color: colors.muted },
    ackPending: { ...type.small, fontSize: 12, color: colors.critical, fontWeight: '700' },
    ackDone: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    ackDoneText: { ...type.small, fontSize: 12, color: colors.low, fontWeight: '600' },
  });
});
