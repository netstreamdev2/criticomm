import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
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
import { callView, type CallView, reportPathFor } from '@/lib/response';
import { colors, radius, severityColor, space, timeAgo, type, makeStyles } from '@/lib/theme';
import { Banner, EmptyState, Segmented } from '@/components/ui';
import { formatDistance, incidentHaystack, matchesQuery } from '@/lib/incident-search';
import { confirmAccept } from '@/lib/accept';
import { IncidentSheet } from '@/components/incident-sheet';
import { ClosedIncidents } from '@/components/closed-incidents';
import { tx, type Translate } from '@criticom/db/i18n';
import { useT } from '@/lib/i18n';

/** Highest severity first, then newest — the order a crew triages in. */
const SEVERITY_RANK: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };

/** List order. Newest is the default every time the tab opens. */
const SORTS = [tx('Newest'), tx('Severity'), tx('Nearest')] as const;
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

type Row = { call: FieldIncident; view: CallView; status: IncidentStatus; queued: boolean; km: number | null; haystack: string };

/** The right-hand tag on a row: where this officer stands on the call. */
function holder(v: CallView, t: Translate): { text: string; tone: string; strong: boolean } | null {
  if (v.ownSos) return { text: t('YOUR SOS'), tone: colors.critical, strong: true };
  if (v.role === 'lead') return { text: t('YOU · LEAD'), tone: colors.accent, strong: true };
  if (v.role === 'backup') return { text: t('YOU · BACKUP'), tone: colors.accent, strong: true };
  if (v.assignment.kind === 'you') return { text: t('ASSIGNED TO YOU'), tone: colors.accent, strong: true };
  if (v.assignment.kind === 'other') return { text: v.assignment.name, tone: colors.muted, strong: false };
  return null;
}

/** "My incidents" filters on the officer's own place on each incident. */
const MINE_STATES = [tx('All'), tx('Waiting'), tx('En route'), tx('On scene')] as const;

/**
 * Incidents — every live incident sent to this officer's department or assigned to
 * them, whoever holds it. One slim row per call, coloured by severity, with a
 * search box and the live distance from the officer; tapping a row opens a
 * swipe-up drawer with the details and the one thing to do next. An officer
 * may hold several calls at once.
 */
export function IncidentsList({ mineOnly = false }: { mineOnly?: boolean }) {
  const { t } = useT();
  const styles = useStyles();
  const router = useRouter();
  const params = useLocalSearchParams<{ open?: string; search?: string; closed?: string }>();
  const searchBox = useRef<TextInput>(null);
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
  // Closed is the officer's own finished calls (0074).
  const scopes: readonly string[] = useMemo(
    () => (mineOnly ? MINE_STATES
      : nearbyOn ? ([tx('All'), tx('Mine'), tx('Nearby'), tx('Closed')] as const) : ([tx('All'), tx('Mine'), tx('Closed')] as const)),
    [nearbyOn, mineOnly],
  );
  const [scope, setScope] = useState<string>('All');
  const [closedOpen, setClosedOpen] = useState<string | null>(null);

  // Back from filing a report: the Closed tab, with that call's drawer open.
  useEffect(() => {
    if (!params.closed || mineOnly) return;
    setScope('Closed');
    setClosedOpen(params.closed);
  }, [params.closed, mineOnly]);
  const closedOpened = useCallback(() => {
    setClosedOpen(null);
    router.setParams({ closed: undefined });
  }, [router]);
  const [sort, setSort] = useState<Sort>('Newest');
  // Back to newest whenever the tab is opened.
  useFocusEffect(useCallback(() => { setSort('Newest'); }, []));
  const [query, setQuery] = useState('');
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

  // Opened from the header search: the box is ready to type in.
  useEffect(() => {
    if (!params.search) return;
    const timer = setTimeout(() => searchBox.current?.focus(), 250);
    return () => clearTimeout(timer);
  }, [params.search]);

  // Live distance on every row: the phone's position is watched while the
  // list is open, so metres count down as the officer drives.
  const [locationDenied, setLocationDenied] = useState(false);
  useFocusEffect(useCallback(() => {
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    void (async () => {
      try {
        let { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') status = (await Location.requestForegroundPermissionsAsync()).status;
        if (cancelled) return;
        if (status !== 'granted') { setLocationDenied(true); return; }
        setLocationDenied(false);
        const watch = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, distanceInterval: 10, timeInterval: 3000 },
          (pos) => setHere({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        );
        if (cancelled) watch.remove(); else sub = watch;
      } catch {
        // No fix: rows simply show no distance.
      }
    })();
    return () => { cancelled = true; sub?.remove(); };
  }, []));

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
    const view = callView(call, me, queued, t);
    const status = (view.role === 'lead' && queued) ? queued : call.status;
    const km = here && (call.location_lat || call.location_lng)
      ? distanceKm(here, { lat: call.location_lat, lng: call.location_lng })
      : null;
    const haystack = incidentHaystack({ ...call, status, at: call.dispatch_time ?? call.incident_created_at });
    return { call, view, status, queued: queued !== null, km, haystack };
  }), [calls, queuedStatus, me, here]);

  // Scope first, then the search box.
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
    if (scope === 'Nearby') return here ? r.km !== null && r.km <= NEARBY_KM : true;
    return true;
  }), [rows, scope, here, mineOnly]);

  const list = useMemo(() => {
    const shown = query.trim() ? scoped.filter((r) => matchesQuery(r.haystack, query)) : scoped;
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
  }, [scoped, query, sort]);

  const selected = rows.find((r) => r.call.id === selectedId) ?? null;

  const act = async (row: Row, which: 'action' | 'secondary' = 'action') => {
    const action = which === 'secondary' ? row.view.secondary : row.view.action;
    if (!action || row.view.blocked) return;
    if (action.kind === 'report') {
      setSelectedId(null);
      router.push(reportPathFor(row.call.id, silo) as never);
      return;
    }
    if (action.kind === 'respond' && !(await confirmAccept(row.call.incident_number))) return;
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
    const tag = holder(item.view, t);
    const mine = item.view.role !== null || item.view.assignment.kind === 'you';
    // My department's part is filed while others still work the call: its drawer is on the Closed tab.
    const finishedForMe = !mineOnly && item.view.role !== null && item.status === 'Resolved';
    return (
      <Pressable
        onPress={() => {
          if (!finishedForMe) { setSelectedId(item.call.id); return; }
          setScope('Closed');
          setClosedOpen(item.call.id);
        }}
        accessibilityRole="button"
        accessibilityLabel={`${t(item.call.incident_severity)} ${t(item.call.incident_type ?? '')}, ${item.call.incident_number}${item.km !== null ? `, ${t('{distance} away', { distance: formatDistance(item.km) })}` : ''}${tag ? `, ${tag.text}` : ''}`}
        style={({ pressed }) => [styles.row, mine && styles.rowMine, pressed && { opacity: 0.8 }]}
      >
        <View style={[styles.sevBar, { backgroundColor: sev }]} />
        <View style={styles.rowMain}>
          <View style={styles.rowLine}>
            <Text style={styles.rowTitle} numberOfLines={1}>{item.call.incident_type}</Text>
            {item.km !== null ? <Text style={styles.rowKm}>{formatDistance(item.km)}</Text> : null}
          </View>
          <View style={styles.rowLine}>
            <Text style={[styles.rowStatus, { color: sev }]}>{item.status.toUpperCase()}</Text>
            {item.queued ? <Ionicons name="time-outline" size={11} color={colors.medium} /> : null}
            <Text style={styles.rowSub} numberOfLines={1}>{item.call.location_address}</Text>
            {tag?.strong ? (
              <Text style={[styles.rowTag, { color: tag.tone, borderColor: `${tag.tone}66`, backgroundColor: `${tag.tone}22` }]} numberOfLines={1}>
                {tag.text}
              </Text>
            ) : null}
            <Text style={styles.rowTime}>{timeAgo(item.call.dispatch_time ?? item.call.incident_created_at)}</Text>
          </View>
        </View>
      </Pressable>
    );
  };

  const urgent = scoped.filter((r) => r.call.incident_severity === 'Critical' || r.call.incident_severity === 'High').length;

  const searchAndTabs = (
    <>
      <View style={styles.search}>
        <Ionicons name="search" size={16} color={colors.muted} />
        <TextInput
          ref={searchBox}
          value={query}
          onChangeText={setQuery}
          placeholder={t('Search incident, address, severity or date')}
          placeholderTextColor={colors.muted}
          style={styles.searchInput}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="never"
          accessibilityLabel={t('Search incidents')}
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('Clear search')}>
            <Ionicons name="close-circle" size={17} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>

      <Segmented options={scopes} value={scope} onChange={setScope} />
    </>
  );

  if (scope === 'Closed') {
    return (
      <ClosedIncidents
        header={searchAndTabs}
        query={query}
        liveCalls={calls}
        openId={closedOpen}
        onOpened={closedOpened}
      />
    );
  }

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
                <Banner tone="info">{t('You are off duty — incidents are not sent to you. Tap to go on duty.')}</Banner>
              </Pressable>
            ) : null}

            {searchAndTabs}

            <View style={styles.sortRow} accessibilityRole="radiogroup" accessibilityLabel={t('Sort incidents')}>
              <Text style={styles.summaryText}>
                {list.length}
                {urgent ? <Text style={{ color: colors.critical }}> · {t('{n} urgent', { n: urgent })}</Text> : null}
              </Text>
              <View style={styles.liveDot} />
              <View style={{ flex: 1 }} />
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
                    <Text style={[styles.sortText, on && styles.sortTextOn]}>{t(s)}</Text>
                  </Pressable>
                );
              })}
            </View>

            {(scope === 'Nearby' || sort === 'Nearest') && !here ? (
              <Text style={styles.hint}>
                {locationDenied ? t('Allow location access to see distances.') : t('Finding your location…')}
              </Text>
            ) : null}
          </View>
        )}
        ListEmptyComponent={loading ? null : (
          <EmptyState
            icon={mineOnly || scope === 'Mine' ? 'person-outline' : 'radio-outline'}
            title={query.trim() ? t('No incidents match your search')
              : mineOnly && scope !== 'All' ? t('Nothing {scope}', { scope: t(scope).toLowerCase() })
              : mineOnly || scope === 'Mine' ? t('Nothing assigned to you') : t('No live incidents')}
            body={query.trim() ? t('Try an incident number, street, severity or a date such as 05-08-2026.')
              : mineOnly || scope === 'Mine'
              ? t('Incidents you respond to, or that dispatch assigns to you, show here.')
              : t('Incidents appear here the moment dispatch sends them to your department or assigns them to you.')}
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
        onSecondary={() => { if (selected) void act(selected, 'secondary'); }}
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

  search: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, height: 42, paddingHorizontal: space.md,
    marginBottom: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 14, paddingVertical: 0 },

  summaryText: { ...type.small, color: colors.muted, fontWeight: '700' },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.low },
  hint: { ...type.small, fontSize: 12, color: colors.muted, marginTop: 4 },

  sortRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.sm },
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
  rowMain: { flex: 1, minWidth: 0, paddingVertical: 7, gap: 2 },
  rowLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowTitle: { ...type.small, fontSize: 14, color: colors.text, fontWeight: '800', flex: 1 },
  rowTime: { ...type.small, fontSize: 11, color: colors.muted },
  rowSub: { ...type.small, fontSize: 12, color: colors.muted, flex: 1 },
  rowKm: { ...type.small, fontSize: 12, color: colors.accent, fontWeight: '800', fontVariant: ['tabular-nums'] },
  rowStatus: { fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },
  rowTag: {
    maxWidth: 110, fontSize: 9, fontWeight: '900', letterSpacing: 0.6,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 1, overflow: 'hidden',
  },
}));
