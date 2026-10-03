import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import {
  listFieldIncidents, subscribeIncidentUpdates, subscribeNewIncidents, type FieldIncident,
} from '@criticom/api';
import type { IncidentStatus } from '@criticom/db/types';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useDuty } from '@/lib/duty';
import { useSync } from '@/lib/sync';
import { useFeature } from '@/lib/features';
import { callView, type CallView } from '@/lib/response';
import { colors, radius, severityColor, space, timeAgo, type, makeStyles } from '@/lib/theme';
import { Banner, EmptyState, Segmented } from '@/components/ui';
import { IncidentSheet } from '@/components/incident-sheet';

const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'] as const;
type Severity = (typeof SEVERITIES)[number];

/** Highest severity first, then newest — the order a crew triages in. */
const SEVERITY_RANK: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };

/** List order. Newest is the default every time the tab opens. */
const SORTS = ['Newest', 'Severity', 'Nearest'] as const;
type Sort = (typeof SORTS)[number];

/** "Nearby" is within this straight-line radius of the officer. */
const NEARBY_KM = 10;

/** Great-circle distance in km — triage ("on top of me or across town?"), not an ETA. */
function distanceKm(from: { lat: number; lng: number }, to: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = ((to.lat - from.lat) * Math.PI) / 180;
  const dLng = ((to.lng - from.lng) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos((from.lat * Math.PI) / 180) * Math.cos((to.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const formatDistance = (km: number) =>
  km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 1 : 0)} km`;

type Row = { call: FieldIncident; view: CallView; status: IncidentStatus; queued: boolean; km: number | null };

/** The right-hand tag on a row: where this officer stands on the call. */
function holder(v: CallView): { text: string; tone: string; strong: boolean } {
  if (v.ownSos) return { text: 'YOUR SOS', tone: colors.critical, strong: true };
  if (v.role === 'lead') return { text: 'YOU · LEAD', tone: colors.accent, strong: true };
  if (v.role === 'backup') return { text: 'YOU · BACKUP', tone: colors.accent, strong: true };
  if (v.assignment.kind === 'you') return { text: 'ASSIGNED TO YOU', tone: colors.accent, strong: true };
  if (v.assignment.kind === 'other') return { text: v.assignment.name, tone: colors.muted, strong: false };
  return { text: 'OPEN', tone: colors.low, strong: false };
}

/** "My incidents" filters on the officer's own place on each incident. */
const MINE_STATES = ['All', 'Waiting', 'En route', 'On scene'] as const;

/**
 * Incidents — every live incident sent to this officer's department or assigned to
 * them, whoever holds it (migration 0042). One slim row per call, coloured by
 * severity and filterable; tapping a row opens a swipe-up drawer with the
 * details and the one thing to do next: Responding (lead or backup), then the
 * ladder. An officer may hold several calls at once.
 */
export function IncidentsList({ mineOnly = false }: { mineOnly?: boolean }) {
  const styles = useStyles();
  const router = useRouter();
  const params = useLocalSearchParams<{ open?: string }>();
  const { session, silo } = useAuth();
  const { onDuty } = useDuty();
  const { enqueue, pending } = useSync();
  const nearbyOn = useFeature('mobile.nearby');

  const [calls, setCalls] = useState<FieldIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // The tab scopes by who holds an incident; My incidents by where I am on it.
  const scopes: readonly string[] = useMemo(
    () => (mineOnly ? MINE_STATES
      : nearbyOn ? (['All', 'Mine', 'Open', 'Nearby'] as const) : (['All', 'Mine', 'Open'] as const)),
    [nearbyOn, mineOnly],
  );
  const [scope, setScope] = useState<string>('All');
  const [sort, setSort] = useState<Sort>('Newest');
  // Back to newest whenever the tab is opened.
  useFocusEffect(useCallback(() => { setSort('Newest'); }, []));
  const [severities, setSeverities] = useState<Set<Severity>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    try {
      setCalls(await listFieldIncidents(getSupabase(), silo, session.user.id));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [session, silo]);

  // Live, and one reload for a burst of changes.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    void load();
    const soon = () => {
      if (timer.current) return;
      timer.current = setTimeout(() => { timer.current = null; void load(); }, 300);
    };
    const sb = getSupabase();
    const offNew = subscribeNewIncidents(sb, 'all', soon);
    const offUpd = subscribeIncidentUpdates(sb, 'all', soon);
    return () => {
      offNew();
      offUpd();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  // Opened from a dispatch alert: show that call's drawer.
  useEffect(() => {
    if (params.open) setSelectedId(params.open);
  }, [params.open]);

  // Distances on every row when a fix is available; asked for once, quietly.
  useEffect(() => {
    void (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        const granted = status === 'granted'
          || ((scope === 'Nearby' || sort === 'Nearest')
            && (await Location.requestForegroundPermissionsAsync()).status === 'granted');
        if (!granted) return;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setHere({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      } catch {
        // No fix: rows simply show no distance.
      }
    })();
  }, [scope, sort]);

  /** Statuses set on this phone that have not reached the server yet. */
  const queuedStatus = useMemo(() => {
    const map = new Map<string, IncidentStatus>();
    for (const e of pending) {
      if (e.op.kind === 'incident_status') map.set(e.op.incidentId, e.op.status as IncidentStatus);
    }
    return map;
  }, [pending]);

  const me = useMemo(
    () => ({ userId: session?.user.id ?? '', silo, onDuty }),
    [session, silo, onDuty],
  );

  const rows = useMemo<Row[]>(() => calls.map((call) => {
    const queued = queuedStatus.get(call.id) ?? null;
    const view = callView(call, me, queued);
    const status = (view.role === 'lead' && queued) ? queued : call.status;
    const km = here && (call.location_lat || call.location_lng)
      ? distanceKm(here, { lat: call.location_lat, lng: call.location_lng })
      : null;
    return { call, view, status, queued: queued !== null, km };
  }), [calls, queuedStatus, me, here]);

  // Scope first, so the severity chips count what the scope shows.
  const scoped = useMemo(() => rows.filter((r) => {
    const mine = r.view.role !== null || r.view.assignment.kind === 'you';
    if (mineOnly) {
      if (!mine) return false;
      if (scope === 'Waiting') return r.view.role === null;
      if (scope === 'En route') return r.view.myStatus === 'En Route';
      if (scope === 'On scene') {
        return r.view.myStatus === 'Arrived' || r.view.myStatus === 'On Scene' || r.view.myStatus === 'Transporting';
      }
      return true;
    }
    if (scope === 'Mine') return mine;
    if (scope === 'Open') return r.view.assignment.kind === 'open';
    if (scope === 'Nearby') return here ? r.km !== null && r.km <= NEARBY_KM : true;
    return true;
  }), [rows, scope, here, mineOnly]);

  const sevCount = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of scoped) c[r.call.incident_severity] = (c[r.call.incident_severity] ?? 0) + 1;
    return c;
  }, [scoped]);

  const list = useMemo(() => {
    const shown = severities.size
      ? scoped.filter((r) => severities.has(r.call.incident_severity as Severity))
      : scoped;
    const sent = (r: Row) => new Date(r.call.dispatch_time ?? r.call.incident_created_at).getTime();
    // Ties always fall back to newest first.
    return [...shown].sort((a, b) => {
      if (sort === 'Nearest') {
        return (a.km ?? Number.POSITIVE_INFINITY) - (b.km ?? Number.POSITIVE_INFINITY) || sent(b) - sent(a);
      }
      if (sort === 'Severity') {
        return (SEVERITY_RANK[a.call.incident_severity] ?? 9) - (SEVERITY_RANK[b.call.incident_severity] ?? 9)
          || sent(b) - sent(a);
      }
      return sent(b) - sent(a);
    });
  }, [scoped, severities, sort]);

  const toggleSeverity = (s: Severity) => {
    setSeverities((cur) => {
      const next = new Set(cur);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  };

  const selected = rows.find((r) => r.call.id === selectedId) ?? null;

  const act = async (row: Row) => {
    const action = row.view.action;
    if (!action || row.view.blocked) return;
    if (action.kind === 'report') {
      setSelectedId(null);
      router.push(`/report/${row.call.id}`);
      return;
    }
    setBusyId(row.call.id);
    try {
      // Queued, not sent: returns once it is on disk, so a dead zone never
      // leaves the officer holding a spinner. The server decides lead or
      // backup and tells dispatch.
      await enqueue({
        kind: 'incident_status',
        incidentId: row.call.id,
        status: action.kind === 'respond' ? 'En Route' : action.status,
        incidentNumber: row.call.incident_number,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const renderRow = ({ item }: { item: Row }) => {
    const sev = severityColor(item.call.incident_severity);
    const tag = holder(item.view);
    const mine = item.view.role !== null || item.view.assignment.kind === 'you';
    const backups = item.view.backups.length;
    return (
      <Pressable
        onPress={() => setSelectedId(item.call.id)}
        accessibilityRole="button"
        accessibilityLabel={`${item.call.incident_severity} ${item.call.incident_type}, ${item.call.incident_number}, ${tag.text}`}
        style={({ pressed }) => [styles.row, mine && styles.rowMine, pressed && { opacity: 0.8 }]}
      >
        <View style={[styles.sevBar, { backgroundColor: sev }]} />
        <View style={styles.rowMain}>
          <View style={styles.rowLine}>
            <Text style={styles.rowTitle} numberOfLines={1}>{item.call.incident_type}</Text>
            <Text style={styles.rowTime}>{timeAgo(item.call.dispatch_time ?? item.call.incident_created_at)}</Text>
          </View>
          <View style={styles.rowLine}>
            <Text style={styles.rowSub} numberOfLines={1}>
              <Text style={styles.rowNumber}>{item.call.incident_number}</Text>
              {'  '}{item.call.location_address}
            </Text>
            {item.km !== null ? <Text style={styles.rowKm}>{formatDistance(item.km)}</Text> : null}
          </View>
          <View style={styles.rowLine}>
            <Text style={[styles.rowStatus, { color: sev }]}>{item.status.toUpperCase()}</Text>
            {item.queued ? <Ionicons name="time-outline" size={11} color={colors.medium} /> : null}
            <View style={{ flex: 1 }} />
            {backups > 0 ? <Text style={styles.rowBackup}>+{backups} backup</Text> : null}
            <Text
              style={[styles.rowTag, { color: tag.tone, borderColor: `${tag.tone}66` }, tag.strong && { backgroundColor: `${tag.tone}22` }]}
              numberOfLines={1}
            >
              {tag.text}
            </Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.muted} />
      </Pressable>
    );
  };

  const urgent = scoped.filter((r) => r.call.incident_severity === 'Critical' || r.call.incident_severity === 'High').length;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        contentContainerStyle={[styles.list, list.length === 0 && { flexGrow: 1 }]}
        data={list}
        keyExtractor={(r) => r.call.id}
        renderItem={renderRow}
        ItemSeparatorComponent={() => <View style={{ height: 6 }} />}
        refreshControl={(
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
        )}
        ListHeaderComponent={(
          <View style={{ marginBottom: space.sm }}>
            {error ? <Banner tone="error" onDismiss={() => setError(null)}>{error}</Banner> : null}
            {onDuty === false ? (
              <Pressable onPress={() => router.push('/(tabs)/profile')} accessibilityRole="button">
                <Banner tone="info">You are off duty — incidents are not sent to you. Tap to go on duty.</Banner>
              </Pressable>
            ) : null}

            <Segmented options={scopes} value={scope} onChange={setScope} />

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {SEVERITIES.map((s) => {
                const on = severities.has(s);
                const tone = severityColor(s);
                return (
                  <Pressable
                    key={s}
                    onPress={() => toggleSeverity(s)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={`${s} severity`}
                    style={[styles.chip, { borderColor: on ? tone : colors.border }, on && { backgroundColor: `${tone}26` }]}
                  >
                    <View style={[styles.chipDot, { backgroundColor: tone }]} />
                    <Text style={[styles.chipText, on && { color: colors.text }]}>{s}</Text>
                    <Text style={styles.chipCount}>{sevCount[s] ?? 0}</Text>
                  </Pressable>
                );
              })}
              {severities.size ? (
                <Pressable onPress={() => setSeverities(new Set())} style={styles.clear} accessibilityRole="button">
                  <Text style={styles.clearText}>Clear</Text>
                </Pressable>
              ) : null}
            </ScrollView>

            <View style={styles.summary}>
              <Text style={styles.summaryText}>
                {list.length} incident{list.length === 1 ? '' : 's'}
                {urgent ? <Text style={{ color: colors.critical }}> · {urgent} urgent</Text> : null}
              </Text>
              <View style={styles.live}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>Live</Text>
              </View>
            </View>

            <View style={styles.sortRow} accessibilityRole="radiogroup" accessibilityLabel="Sort incidents">
              <Ionicons name="swap-vertical" size={13} color={colors.muted} />
              <Text style={styles.sortLabel}>Sort</Text>
              {SORTS.map((s) => {
                const on = sort === s;
                return (
                  <Pressable
                    key={s}
                    onPress={() => setSort(s)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    hitSlop={6}
                    style={[styles.sortPill, on && styles.sortPillOn]}
                  >
                    <Text style={[styles.sortText, on && styles.sortTextOn]}>{s}</Text>
                  </Pressable>
                );
              })}
            </View>

            {scope === 'Nearby' && !here ? (
              <Text style={styles.hint}>Allow location access to see incidents within {NEARBY_KM} km. Showing all meanwhile.</Text>
            ) : sort === 'Nearest' && !here ? (
              <Text style={styles.hint}>Allow location access to sort by distance. Showing newest meanwhile.</Text>
            ) : null}
          </View>
        )}
        ListEmptyComponent={loading ? null : (
          <EmptyState
            icon={mineOnly || scope === 'Mine' ? 'person-outline' : 'radio-outline'}
            title={mineOnly && scope !== 'All' ? `Nothing ${scope.toLowerCase()}`
              : mineOnly || scope === 'Mine' ? 'Nothing assigned to you' : 'No live incidents'}
            body={mineOnly || scope === 'Mine'
              ? 'Incidents you respond to, or that dispatch assigns to you, show here.'
              : 'Incidents appear here the moment dispatch sends them to your department or assigns them to you.'}
          />
        )}
      />

      <IncidentSheet
        incident={selected?.call ?? null}
        view={selected?.view ?? null}
        status={selected?.status ?? 'Dispatched'}
        queued={selected?.queued ?? false}
        km={selected?.km ?? null}
        busy={busyId === selectedId}
        onClose={() => {
          setSelectedId(null);
          if (params.open) router.setParams({ open: undefined });
        }}
        onAction={() => { if (selected) void act(selected); }}
        onOpenFull={() => {
          const id = selectedId;
          setSelectedId(null);
          if (id) router.push(`/incident/${id}`);
        }}
      />
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  list: { padding: space.lg, paddingBottom: space['3xl'] },

  chips: { gap: space.sm, paddingVertical: space.md },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 10,
    borderRadius: radius.pill, borderWidth: 1, backgroundColor: colors.bgCard,
  },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  chipText: { ...type.small, fontSize: 12, color: colors.textDim, fontWeight: '700' },
  chipCount: { ...type.small, fontSize: 11, color: colors.muted, fontWeight: '700' },
  clear: { height: 32, justifyContent: 'center', paddingHorizontal: 6 },
  clearText: { ...type.small, fontSize: 12, color: colors.accent, fontWeight: '700' },

  summary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  summaryText: { ...type.small, color: colors.muted, fontWeight: '700' },
  live: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.low },
  liveText: { ...type.small, fontSize: 12, color: colors.low, fontWeight: '700' },
  hint: { ...type.small, fontSize: 12, color: colors.muted, marginTop: 4 },

  sortRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.sm },
  sortLabel: { ...type.small, fontSize: 12, color: colors.muted, fontWeight: '700', marginRight: 2 },
  sortPill: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard,
  },
  sortPillOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  sortText: { ...type.small, fontSize: 12, color: colors.textDim, fontWeight: '700' },
  sortTextOn: { color: colors.text },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, overflow: 'hidden',
    backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingRight: space.sm,
  },
  rowMine: { borderColor: `${colors.accent}88` },
  sevBar: { width: 5, alignSelf: 'stretch' },
  rowMain: { flex: 1, minWidth: 0, paddingVertical: 8, gap: 2 },
  rowLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowTitle: { ...type.small, fontSize: 14, color: colors.text, fontWeight: '800', flex: 1 },
  rowTime: { ...type.small, fontSize: 11, color: colors.muted },
  rowSub: { ...type.small, fontSize: 12, color: colors.muted, flex: 1 },
  rowNumber: { ...type.mono, fontSize: 11, color: colors.accent },
  rowKm: { ...type.small, fontSize: 11, color: colors.accent, fontWeight: '800' },
  rowStatus: { fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },
  rowBackup: { fontSize: 10, color: colors.muted, fontWeight: '700' },
  rowTag: {
    maxWidth: 150, fontSize: 9, fontWeight: '900', letterSpacing: 0.6,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 1, overflow: 'hidden',
  },
}));
