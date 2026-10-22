import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  listMyWorkedIncidents, openParts, partFor, partOpen, partWords, sortParts, subscribeIncidentUpdates, waitingParts,
  type DepartmentPart, type FieldIncident,
} from '@criticom/api';
import { DEPARTMENT_NAMES, dispositionLabel, dispositionsFor } from '@criticom/db';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useSync } from '@/lib/sync';
import { finishOf, finishRank, type Finish } from '@/lib/closing';
import { incidentHaystack, matchesQuery } from '@/lib/incident-search';
import { errorWords } from '@/lib/offline-cache-policy';
import { colors, radius, severityColor, space, timeAgo, type, makeStyles } from '@/lib/theme';
import { BottomSheet } from '@/components/bottom-sheet';
import { Banner, Button, EmptyState, SeverityPill } from '@/components/ui';
import { tx } from '@criticom/db/i18n';
import { useT } from '@/lib/i18n';
import { tNow } from '@/lib/translator';

type IconName = keyof typeof Ionicons.glyphMap;

type Row = {
  call: FieldIncident;
  finish: Finish;
  /** When it finished for me: closed, filed, stood down. */
  at: string;
  /** Other departments still on the call, by name. */
  waiting: string[];
  haystack: string;
};

/** Read at render time, so the tones follow the light/dark theme. */
const LOOK = (f: Finish): { label: string; tone: string; icon: IconName } => {
  switch (f.kind) {
    case 'to_close': return { label: tx('To close'), tone: colors.medium, icon: 'time-outline' };
    case 'closing': return { label: tx('Closing'), tone: colors.medium, icon: 'cloud-upload-outline' };
    case 'closed': return { label: tx('Closed'), tone: colors.low, icon: 'checkmark-circle' };
    case 'filed': return { label: tx('Report filed'), tone: colors.accent, icon: 'document-text-outline' };
    case 'not_needed': return { label: tx('Not needed'), tone: colors.muted, icon: 'remove-circle-outline' };
    case 'cancelled': return { label: tx('Cancelled'), tone: colors.muted, icon: 'close-circle-outline' };
    case 'case_closed': return { label: tx('Case closed'), tone: colors.low, icon: 'lock-closed-outline' };
  }
};

const MONTHS = [tx('Jan'), tx('Feb'), tx('Mar'), tx('Apr'), tx('May'), tx('Jun'), tx('Jul'), tx('Aug'), tx('Sep'), tx('Oct'), tx('Nov'), tx('Dec')];
const pad = (n: number) => String(n).padStart(2, '0');
/** "13 Oct · 14:32", on the phone's clock. */
function when(iso: string | null | undefined) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getDate()} ${tNow(MONTHS[d.getMonth()] ?? '')} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * The Closed tab: every call this officer worked that is finished for their
 * department, anything still to close first. Tapping one opens its drawer;
 * the lead closes from there (migration 0074). A Close pressed without
 * signal waits in the outbox like every other field action.
 */
export function ClosedIncidents({ header, query, liveCalls, openId, onOpened }: {
  /** Search box and tabs, above the list. */
  header: React.ReactElement;
  query: string;
  /** The live list, so a call whose report is still on this phone shows here too. */
  liveCalls: readonly FieldIncident[];
  /** Open this call's drawer once it is in the list (just filed). */
  openId?: string | null;
  onOpened?: () => void;
}) {
  const { t } = useT();
  const styles = useStyles();
  const router = useRouter();
  const { session, silo, fullName } = useAuth();
  const { pending, enqueue, online } = useSync();
  const [worked, setWorked] = useState<FieldIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const userId = session?.user.id ?? '';

  const load = useCallback(async () => {
    if (!session) return;
    try {
      setWorked(await listMyWorkedIncidents(getSupabase(), session.user.id, silo));
      setError(null);
    } catch (e) {
      setError(errorWords(e));
    } finally {
      setLoading(false);
    }
  }, [session, silo]);

  // On every visit, and live: another department closing changes what we wait on.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useFocusEffect(useCallback(() => {
    void load();
    const soon = () => {
      if (timer.current) return;
      timer.current = setTimeout(() => { timer.current = null; void load(); }, 400);
    };
    const off = subscribeIncidentUpdates(getSupabase(), 'all', soon);
    return () => {
      off();
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [load]));

  /** Reports and closes still on this phone. */
  const queued = useMemo(() => {
    const report = new Set<string>();
    const close = new Set<string>();
    for (const e of pending) {
      const op = e.op;
      if (op.kind === 'incident_report' || op.kind === 'fire_report' || op.kind === 'pcr' || op.kind === 'post_mortem') report.add(op.incidentId);
      if (op.kind === 'close_part') close.add(op.incidentId);
    }
    return { report, close };
  }, [pending]);

  // Once a report or a close reaches the server, read the list again.
  const queuedKey = [...queued.report, '|', ...queued.close].join(',');
  const firstKey = useRef(queuedKey);
  useEffect(() => {
    if (firstKey.current === queuedKey) return;
    firstKey.current = queuedKey;
    void load();
  }, [queuedKey, load]);

  const rows = useMemo<Row[]>(() => {
    const me = { userId, silo };
    const byId = new Map<string, FieldIncident>();
    for (const c of liveCalls) byId.set(c.id, c);
    for (const c of worked) byId.set(c.id, c);
    const out: Row[] = [];
    for (const call of byId.values()) {
      const finish = finishOf(call, me, { report: queued.report.has(call.id), close: queued.close.has(call.id) });
      if (!finish) continue;
      const part = partFor(call.departments, silo);
      const at = (finish.kind === 'closed' ? finish.at : null)
        ?? part?.report_filed_at ?? part?.finished_at ?? call.closed_at ?? call.updated_at;
      const done = finish.kind === 'not_needed' || finish.kind === 'cancelled' || finish.kind === 'case_closed';
      const waiting = done ? [] : waitingParts(call.departments, silo).map((p) => DEPARTMENT_NAMES[p.silo]);
      out.push({ call, finish, at, waiting, haystack: incidentHaystack({ ...call, status: LOOK(finish).label, at }) });
    }
    return out.sort((a, b) => finishRank(a.finish) - finishRank(b.finish) || b.at.localeCompare(a.at));
  }, [liveCalls, worked, queued, userId, silo]);

  const list = useMemo(
    () => (query.trim() ? rows.filter((r) => matchesQuery(r.haystack, query)) : rows),
    [rows, query],
  );
  const toClose = rows.filter((r) => r.finish.kind === 'to_close').length;

  // Opened from a report just filed: show its drawer as soon as it is listed.
  useEffect(() => {
    if (!openId) return;
    setSelectedId(openId);
    onOpened?.();
  }, [openId, onOpened]);

  const selected = rows.find((r) => r.call.id === selectedId) ?? null;

  const send = async (row: Row, disposition: string) => {
    setBusy(true);
    try {
      await enqueue({ kind: 'close_part', incidentId: row.call.id, incidentNumber: row.call.incident_number, disposition });
    } catch (e) {
      setError(errorWords(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmClose = (row: Row, disposition: string) => {
    Alert.alert(
      t('Close {incident_number}?', { incident_number: row.call.incident_number }),
      row.waiting.length
        ? t('Dispatch is told you have closed. Still on the call: {waiting}.', { waiting: row.waiting.join(', ') })
        : t('Dispatch is told you have closed.'),
      [
        { text: t('Cancel'), style: 'cancel' },
        { text: t('Close incident'), onPress: () => void send(row, disposition) },
      ],
    );
  };

  const renderRow = ({ item }: { item: Row }) => {
    const look = LOOK(item.finish);
    return (
      <Pressable
        onPress={() => setSelectedId(item.call.id)}
        accessibilityRole="button"
        accessibilityLabel={`${t(item.call.incident_type ?? '')}, ${item.call.incident_number}, ${t(look.label)}${item.waiting.length ? `, ${t('waiting on {list}', { list: item.waiting.join(', ') })}` : ''}`}
        style={({ pressed }) => [styles.row, item.finish.kind === 'to_close' && styles.rowToClose, pressed && { opacity: 0.8 }]}
      >
        <View style={[styles.sevBar, { backgroundColor: severityColor(item.call.incident_severity) }]} />
        <View style={styles.rowMain}>
          <View style={styles.rowLine}>
            <Text style={styles.rowTitle} numberOfLines={1}>{item.call.incident_type}</Text>
            <Text style={styles.rowTime}>{timeAgo(item.at)}</Text>
          </View>
          <View style={styles.rowLine}>
            <Text style={styles.rowNumber}>{item.call.incident_number}</Text>
            <Text style={styles.rowSub} numberOfLines={1}>{item.call.location_address}</Text>
          </View>
          <View style={styles.rowLine}>
            <View style={[styles.chip, { backgroundColor: `${look.tone}1f`, borderColor: `${look.tone}55` }]}>
              <Ionicons name={look.icon} size={11} color={look.tone} />
              <Text style={[styles.chipText, { color: look.tone }]}>{t(look.label).toUpperCase()}</Text>
            </View>
            {item.waiting.length ? (
              <Text style={styles.waiting} numberOfLines={1}>{t('Waiting on {waiting}', { waiting: item.waiting.join(', ') })}</Text>
            ) : null}
          </View>
        </View>
      </Pressable>
    );
  };

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
            {header}
            <Text style={styles.summary}>
              {list.length}
              {toClose ? <Text style={{ color: colors.medium }}>{' '}{t('· {toClose} to close', { toClose })}</Text> : null}
            </Text>
          </View>
        )}
        ListEmptyComponent={loading ? null : (
          <EmptyState
            icon="checkmark-done-outline"
            title={query.trim() ? t('No incidents match your search') : t('No closed incidents yet')}
            body={query.trim() ? undefined : t('Incidents you worked show here once your part is done.')}
          />
        )}
      />

      <ClosedSheet
        row={selected}
        silo={silo}
        userId={userId}
        myName={fullName}
        online={online}
        busy={busy}
        onClose={() => setSelectedId(null)}
        onCloseIncident={(disposition) => { if (selected) confirmClose(selected, disposition); }}
        onOpenFull={() => {
          const id = selectedId;
          setSelectedId(null);
          if (id) router.push(`/incident/${id}`);
        }}
      />
    </View>
  );
}

/** The drawer for one finished call: where it stands, the times, the departments, and Close. */
function ClosedSheet({ row, silo, userId, myName, online, busy, onClose, onCloseIncident, onOpenFull }: {
  row: Row | null;
  silo: string;
  userId: string;
  myName: string;
  online: boolean;
  busy: boolean;
  onClose: () => void;
  /** With how the call ended, from this department's list (0098). */
  onCloseIncident: (disposition: string) => void;
  onOpenFull: () => void;
}) {
  const { t } = useT();
  const styles = useStyles();
  const [outcome, setOutcome] = useState<string | null>(null);
  // A new call in the sheet starts with nothing chosen.
  const rowId = row?.call.id;
  useEffect(() => { setOutcome(null); }, [rowId]);
  if (!row) return <BottomSheet visible={false} onClose={onClose}>{null}</BottomSheet>;

  const { call, finish, waiting } = row;
  const look = LOOK(finish);
  const part = partFor(call.departments, silo);
  const parts = sortParts(call.departments);
  const mine = call.responders.find((r) => r.user_id === userId);
  const allDone = parts.length > 0 && openParts(parts).length === 0;

  const headline = (() => {
    switch (finish.kind) {
      case 'to_close': return finish.reportSending ? t('Report saved. It sends first.') : t('Report filed. Close when you leave the scene.');
      case 'closing': return online ? t('Closing…') : t('Closing. Sends when you have signal.');
      case 'closed': {
        const at = when(finish.at) ?? '';
        return finish.by && finish.by !== myName ? t('Closed {when} by {name}', { when: at, name: finish.by }) : t('Closed {when}', { when: at });
      }
      case 'filed': return mine?.role === 'backup' ? t('The lead filed the report.') : t('Report filed.');
      case 'not_needed': return `${t('Your department was stood down.')}${part?.finish_reason ? ` ${part.finish_reason}` : ''}`;
      case 'cancelled': return `${t('Cancelled.')}${call.close_reason ? ` ${call.close_reason}` : ''}`;
      case 'case_closed': return t('Case closed.');
    }
  })();

  const caseLine = call.close_kind === 'Reviewed'
    ? call.closed_by_name ? t('Case closed after review by {name}', { name: call.closed_by_name }) : t('Case closed after review')
    : call.close_kind === 'Cancelled' ? null
      : allDone ? t('Waiting for case review') : null;

  const times: [string, string | null][] = [
    [t('Dispatched'), when(part?.dispatched_at ?? call.dispatch_time)],
    [t('On scene'), when(part?.arrived_at ?? call.arrived_timestamp)],
    [t('Report filed'), when(part?.report_filed_at ?? call.report_filed_at)],
    [t('Closed'), when(part?.closed_at)],
  ];

  return (
    <BottomSheet
      visible
      onClose={onClose}
      header={(
        <View style={styles.header}>
          <View style={[styles.headerBar, { backgroundColor: severityColor(call.incident_severity) }]} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={styles.rowBetween}>
              <Text style={styles.number}>{call.incident_number}</Text>
              <SeverityPill severity={call.incident_severity} />
            </View>
            <Text style={styles.title} numberOfLines={2}>{call.incident_type}</Text>
            <View style={[styles.chip, styles.chipLg, { backgroundColor: `${look.tone}1f`, borderColor: `${look.tone}55` }]}>
              <Ionicons name={look.icon} size={13} color={look.tone} />
              <Text style={[styles.chipText, styles.chipTextLg, { color: look.tone }]}>{t(look.label).toUpperCase()}</Text>
            </View>
          </View>
        </View>
      )}
      footer={(
        <View style={{ gap: space.sm }}>
          {finish.kind === 'to_close' ? (
            <>
              <Text style={styles.section}>{t('HOW DID IT END?')}</Text>
              <View style={styles.outcomes}>
                {dispositionsFor(silo).map((d) => {
                  const on = outcome === d.code;
                  return (
                    <Pressable
                      key={d.code}
                      onPress={() => setOutcome(d.code)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                      style={[styles.outcome, on && styles.outcomeOn]}
                    >
                      <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={18} color={on ? colors.low : colors.muted} />
                      <Text style={[styles.outcomeText, on && { color: colors.text }]} numberOfLines={2}>{t(d.label)}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Button
                label={outcome ? t('Close incident') : t('Choose how it ended')}
                icon="checkmark-done"
                variant="success"
                size="lg"
                busy={busy}
                disabled={!outcome}
                onPress={() => { if (outcome) onCloseIncident(outcome); }}
              />
            </>
          ) : null}
          <Button label={t('Full details')} icon="open-outline" variant="outline" onPress={onOpenFull} />
        </View>
      )}
    >
      <View style={styles.content}>
        <View style={[styles.state, { borderColor: `${look.tone}55` }]}>
          <Ionicons name={look.icon} size={18} color={look.tone} />
          <Text style={styles.stateText}>{headline}</Text>
        </View>
        {part?.disposition ? (
          <View style={styles.meta}>
            <Ionicons name="flag-outline" size={15} color={colors.muted} />
            <Text style={styles.metaText}>{t('Outcome: {outcome}', { outcome: t(dispositionLabel(part.disposition) ?? '') })}</Text>
          </View>
        ) : null}
        {waiting.length ? (
          <View style={styles.waitingBox}>
            <Ionicons name="hourglass-outline" size={14} color={colors.medium} />
            <Text style={styles.waitingText}>{t('Waiting on {waiting}', { waiting: waiting.join(', ') })}</Text>
          </View>
        ) : null}

        <View style={styles.meta}>
          <Ionicons name="location-outline" size={15} color={colors.muted} />
          <Text style={styles.metaText}>{call.location_address}</Text>
        </View>
        {mine ? (
          <View style={styles.meta}>
            <Ionicons name={mine.role === 'lead' ? 'star-outline' : 'people-outline'} size={15} color={colors.muted} />
            <Text style={styles.metaText}>{mine.role === 'lead' ? t('You led') : t('You were backup')}</Text>
          </View>
        ) : null}

        <Text style={styles.section}>{t('YOUR PART')}</Text>
        {times.filter(([, value]) => value).map(([label, value]) => (
          <View key={label} style={styles.timeRow}>
            <Text style={styles.timeLabel}>{label}</Text>
            <Text style={styles.timeValue}>{value}</Text>
          </View>
        ))}

        {parts.length > 1 ? (
          <>
            <Text style={styles.section}>{t('DEPARTMENTS')}</Text>
            {parts.map((p) => <PartLine key={p.silo} part={p} />)}
          </>
        ) : null}

        {caseLine ? (
          <>
            <Text style={styles.section}>{t('CASE')}</Text>
            <Text style={styles.caseText}>{caseLine}</Text>
          </>
        ) : null}
      </View>
    </BottomSheet>
  );
}

function PartLine({ part }: { part: DepartmentPart }) {
  const styles = useStyles();
  const closed = Boolean(part.closed_at);
  const done = closed || part.status === 'Not needed' || part.status === 'Cancelled';
  const live = partOpen(part.status);
  const tone = closed ? colors.low : live ? colors.medium : done ? colors.muted : colors.accent;
  const words = closed && part.closed_by_name ? `${partWords(part)} · ${part.closed_by_name}` : partWords(part);
  return (
    <View style={styles.partRow}>
      <Ionicons name={closed ? 'checkmark-circle' : live ? 'ellipse' : done ? 'remove-circle-outline' : 'document-text-outline'} size={14} color={tone} />
      <Text style={styles.partName}>{DEPARTMENT_NAMES[part.silo]}</Text>
      <Text style={[styles.partWords, { color: tone }]} numberOfLines={1}>{words}</Text>
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  outcomes: { gap: 6, marginBottom: space.sm },
  outcome: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44, paddingHorizontal: space.md,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgSoft,
  },
  outcomeOn: { borderColor: colors.low, backgroundColor: colors.lowSoft },
  outcomeText: { flex: 1, color: colors.textDim, fontSize: 15, fontWeight: '700' },
  list: { padding: space.lg, paddingBottom: space['3xl'] },
  summary: { ...type.small, color: colors.muted, fontWeight: '700', marginTop: space.sm },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, overflow: 'hidden',
    backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingRight: space.sm,
  },
  rowToClose: { borderColor: `${colors.medium}88` },
  sevBar: { width: 5, alignSelf: 'stretch' },
  rowMain: { flex: 1, minWidth: 0, paddingVertical: 8, gap: 3 },
  rowLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowTitle: { ...type.small, fontSize: 14, color: colors.text, fontWeight: '800', flex: 1 },
  rowTime: { ...type.small, fontSize: 11, color: colors.muted },
  rowNumber: { color: colors.accent, fontSize: 11, fontFamily: 'monospace', fontWeight: '700' },
  rowSub: { ...type.small, fontSize: 12, color: colors.muted, flex: 1 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.pill, borderWidth: 1,
  },
  chipLg: { marginTop: space.sm, paddingHorizontal: 9, paddingVertical: 3 },
  chipText: { fontSize: 9, fontWeight: '900', letterSpacing: 0.6 },
  chipTextLg: { fontSize: 11 },
  waiting: { ...type.small, fontSize: 11, color: colors.medium, fontWeight: '700', flex: 1 },

  header: { flexDirection: 'row', gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.sm },
  headerBar: { width: 4, borderRadius: 2 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  number: { ...type.mono, color: colors.accent },
  title: { ...type.h1, color: colors.text, marginTop: 4 },

  content: { paddingHorizontal: space.lg, paddingTop: space.sm },
  state: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderRadius: radius.md,
    paddingHorizontal: space.md, paddingVertical: space.md, backgroundColor: colors.bgCard,
  },
  stateText: { ...type.bodyStrong, color: colors.text, flex: 1 },
  waitingBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.sm,
    paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.md, backgroundColor: colors.mediumSoft,
  },
  waitingText: { ...type.small, color: colors.text, fontWeight: '700', flex: 1 },
  meta: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: space.md },
  metaText: { ...type.small, color: colors.textDim, flex: 1 },
  section: { ...type.label, fontSize: 10, color: colors.muted, marginTop: space.lg, marginBottom: 6 },
  timeRow: {
    flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  timeLabel: { ...type.small, color: colors.muted },
  timeValue: { ...type.small, color: colors.text, fontWeight: '700', fontVariant: ['tabular-nums'] },
  partRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  partName: { ...type.small, color: colors.text, fontWeight: '700', width: 130 },
  partWords: { ...type.small, fontWeight: '700', flex: 1, textAlign: 'right' },
  caseText: { ...type.small, color: colors.textDim },
}));
