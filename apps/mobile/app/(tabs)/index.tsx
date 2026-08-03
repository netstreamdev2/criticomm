import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  getMyPersonnel, listMyAssignedIncidents, subscribeIncidentUpdates, subscribeNewIncidents,
} from '@criticom/api';
import type { Database, IncidentStatus } from '@criticom/db/types';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useSync } from '@/lib/sync';
import { colors, radius, severityColor, severityTint, space, timeAgo, type } from '@/lib/theme';
import {
  Banner, Button, Card, EmptyState, Muted, SeverityPill, StatusBadge, Title,
} from '@/components/ui';

type Incident = Database['public']['Tables']['incidents']['Row'];

const NEXT: Partial<Record<IncidentStatus, IncidentStatus>> = {
  Dispatched: 'En Route',
  'En Route': 'Arrived',
  Arrived: 'On Scene',
  'On Scene': 'Transporting',
  Transporting: 'Resolved',
};

/** Highest severity first, then newest — the order a crew triages in. */
const SEVERITY_RANK: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };

export default function MyIncidentsScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const { enqueue, pending } = useSync();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    setError(null);
    try {
      const sb = getSupabase();
      const me = await getMyPersonnel(sb, session.user.id);
      const rows = await listMyAssignedIncidents(sb, me?.assigned_apparatus_id ?? null);
      setIncidents(rows);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void load();
    const sb = getSupabase();
    const offNew = subscribeNewIncidents(sb, 'all', () => void load());
    const offUpd = subscribeIncidentUpdates(sb, 'all', () => void load());
    return () => { offNew(); offUpd(); };
  }, [load]);

  const sorted = useMemo(
    () => [...incidents].sort((a, b) =>
      (SEVERITY_RANK[a.incident_severity] ?? 9) - (SEVERITY_RANK[b.incident_severity] ?? 9)
      || new Date(b.incident_created_at).getTime() - new Date(a.incident_created_at).getTime()),
    [incidents],
  );

  const urgent = sorted.filter((i) => i.incident_severity === 'Critical' || i.incident_severity === 'High').length;

  /**
   * Statuses the crew has set but that have not reached the server yet.
   *
   * The list is refetched whenever anything changes, so without this the card
   * would snap back to the server's status a moment after the tap — telling a
   * responder standing on scene that they are still En Route. Reading the
   * pending queue instead means the screen shows what was asked for until the
   * server confirms it, offline or not, with no separate optimistic state to
   * get out of step.
   */
  const queuedStatus = useMemo(() => {
    const map = new Map<string, IncidentStatus>();
    for (const entry of pending) {
      if (entry.op.kind === 'incident_status') {
        map.set(entry.op.incidentId, entry.op.status as IncidentStatus);
      }
    }
    return map;
  }, [pending]);

  const advance = async (incident: Incident) => {
    const current = queuedStatus.get(incident.id) ?? incident.status;
    const next = NEXT[current];
    if (!next) return;
    setBusyId(incident.id);
    try {
      // Queued, not sent: this returns as soon as it is on disk, so the crew is
      // never left holding a spinner in a dead zone.
      await enqueue({
        kind: 'incident_status',
        incidentId: incident.id,
        status: next,
        incidentNumber: incident.incident_number,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={[styles.list, sorted.length === 0 && { flexGrow: 1 }]}
      data={sorted}
      keyExtractor={(i) => i.id}
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
          {sorted.length > 0 ? (
            <View style={styles.summary}>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryNum}>{sorted.length}</Text>
                <Text style={styles.summaryLabel}>ASSIGNED</Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryItem}>
                <Text style={[styles.summaryNum, urgent > 0 && { color: colors.critical }]}>{urgent}</Text>
                <Text style={styles.summaryLabel}>URGENT</Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={[styles.summaryItem, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>Live</Text>
              </View>
            </View>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        loading ? null : (
          <EmptyState
            icon="radio-outline"
            title="No incidents assigned"
            body="You'll get a live update here the moment dispatch assigns your unit. Complete your start-of-shift checks under the Shift tab."
            action={<Button label="Go to Shift" icon="clipboard-outline" variant="outline" onPress={() => router.push('/shift')} />}
          />
        )
      }
      renderItem={({ item }) => {
        const queued = queuedStatus.get(item.id);
        const status = queued ?? item.status;
        const next = NEXT[status];
        const sev = severityColor(item.incident_severity);
        return (
          <Pressable
            onPress={() => router.push(`/incident/${item.id}`)}
            accessibilityRole="button"
            accessibilityLabel={`Incident ${item.incident_number}, ${item.incident_type}`}
            style={({ pressed }) => pressed && { opacity: 0.85 }}
          >
            <Card accent={sev}>
              <View style={styles.rowBetween}>
                <Text style={styles.number}>{item.incident_number}</Text>
                <SeverityPill severity={item.incident_severity} />
              </View>

              <Title>{item.incident_type}</Title>

              <View style={styles.metaRow}>
                <Ionicons name="location-outline" size={13} color={colors.muted} />
                <Text style={styles.metaText} numberOfLines={1}>{item.location_address}</Text>
              </View>
              <View style={styles.metaRow}>
                <Ionicons name="time-outline" size={13} color={colors.muted} />
                <Text style={styles.metaText}>{timeAgo(item.incident_created_at)}</Text>
              </View>

              {item.call_description ? (
                <Text style={styles.desc} numberOfLines={3}>{item.call_description}</Text>
              ) : null}

              <View style={styles.statusRow}>
                <StatusBadge status={status} />
                {queued ? (
                  <View style={styles.queuedChip}>
                    <Ionicons name="time-outline" size={11} color={colors.medium} />
                    <Text style={styles.queuedText}>Waiting to send</Text>
                  </View>
                ) : null}
              </View>

              <View style={styles.actions}>
                {next ? (
                  <View style={{ flex: 1 }}>
                    <Button
                      label={`Mark ${next}`}
                      icon="arrow-forward-circle-outline"
                      busy={busyId === item.id}
                      onPress={() => void advance(item)}
                    />
                  </View>
                ) : null}
                <View style={{ flex: 1 }}>
                  <Button
                    label="Details"
                    icon="document-text-outline"
                    variant="outline"
                    onPress={() => router.push(`/incident/${item.id}`)}
                  />
                </View>
              </View>

              {item.incident_severity === 'Critical' ? (
                <View style={[styles.urgentStrip, { backgroundColor: severityTint(item.incident_severity) }]}>
                  <Ionicons name="warning" size={13} color={sev} />
                  <Text style={[styles.urgentText, { color: sev }]}>Priority 1 — respond immediately</Text>
                </View>
              ) : null}
            </Card>
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: space.lg, paddingBottom: space['3xl'] },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  number: { ...type.mono, color: colors.accent, marginBottom: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5 },
  metaText: { ...type.small, color: colors.muted, flexShrink: 1 },
  desc: { color: colors.textDim, marginTop: space.md, lineHeight: 20, fontSize: 14 },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.md },

  statusRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md },
  queuedChip: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  queuedText: { ...type.small, fontSize: 11, color: colors.medium, fontWeight: '700' },

  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingVertical: space.md,
    marginBottom: space.md,
  },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', backgroundColor: colors.border },
  summaryNum: { fontSize: 22, fontWeight: '800', color: colors.text },
  summaryLabel: { ...type.label, fontSize: 10, color: colors.muted, marginTop: 2 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.low },
  liveText: { ...type.small, color: colors.low, fontWeight: '700' },

  urgentStrip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: space.md, marginHorizontal: -space.lg, marginBottom: -space.lg,
    paddingHorizontal: space.lg, paddingVertical: space.sm,
  },
  urgentText: { fontSize: 12, fontWeight: '700' },
});
