import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  addDays, dayLabel, getLeaveBalances, getMyMonth, getMyShiftNow, getRosterRange, getWhosOn, lineActive,
  listEndorsements, listSwapOptions, listSwaps, monthGrid, monthLabel, saDay, saTime, shiftMonth, shiftState, stateWords,
  type LeaveBalance, type MyMonth, type ScheduleLine, type SwapView, type WhosOnRow,
} from '@criticom/api';
import { RESPONDER_ROLES, canManageRoster, roleName, type Database } from '@criticom/db';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useSync } from '@/lib/sync';
import { useDept } from '@/lib/branding';
import { wordsFor } from '@/lib/department';
import { refreshShiftReminders } from '@/lib/shift-reminders';
import { DeptHeader } from '@/components/dept-badge';
import { BottomSheet } from '@/components/bottom-sheet';
import { colors, radius, space, type, makeStyles } from '@/lib/theme';
import { Banner, Card, Muted, SectionLabel, Title } from '@/components/ui';

type Endorsement = Database['public']['Tables']['endorsements']['Row'];

const STATUS_COLOUR = (): Record<string, string> => ({
  Approved: colors.low, Rejected: colors.critical, Pending: colors.medium, Cancelled: colors.muted,
});
const LEAVE_WORD: Record<string, string> = { Rejected: 'Not approved' };
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const SWAP_WORD: Record<string, string> = {
  Requested: 'Waiting for them', Accepted: 'Waiting for your supervisor', Approved: 'Approved',
  Declined: 'Declined', Refused: 'Not approved', Withdrawn: 'Withdrawn', Expired: 'Expired',
};

function countdown(ms: number): string {
  const mins = Math.round(Math.abs(ms) / 60_000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return m ? `${h} h ${m} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'}`;
}

/** "When am I working?": the shift now or next, the month, who is on, leave and swaps. */
export default function ScheduleScreen() {
  const styles = useStyles();
  const router = useRouter();
  const { session, silo, fullName, role } = useAuth();
  const unitIcon = wordsFor(silo).unitIcon;
  const dept = useDept();
  const { enqueue, pending } = useSync();
  const userId = session?.user.id ?? '';
  const today = saDay();

  const [month, setMonth] = useState(today.slice(0, 7));
  const [data, setData] = useState<MyMonth | null>(null);
  const [now, setNow] = useState<ScheduleLine | null>(null);
  const [whosOn, setWhosOn] = useState<WhosOnRow[]>([]);
  const [team, setTeam] = useState<ScheduleLine[]>([]);
  const [swaps, setSwaps] = useState<SwapView[]>([]);
  const [options, setOptions] = useState<WhosOnRow[]>([]);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [endorsements, setEndorsements] = useState<Endorsement[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [offering, setOffering] = useState<ScheduleLine | null>(null);
  const [, tick] = useState(0);
  const oversees = canManageRoster(role, silo);

  // The countdown moves without a reload.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    if (!userId) return;
    setError(null);
    const sb = getSupabase();
    try {
      const [m, current, on, sw, opts, bal, end, mine] = await Promise.all([
        getMyMonth(sb, { userId, silo, month }),
        getMyShiftNow(sb, userId).catch(() => null),
        getWhosOn(sb, { silo, day: today }).catch(() => []),
        listSwaps(sb).catch(() => []),
        listSwapOptions(sb, { silo, userId, from: today, to: addDays(today, 45) }).catch(() => []),
        getLeaveBalances(sb, { userId }).catch(() => []),
        listEndorsements(sb, { userId }).catch(() => []),
        oversees ? getRosterRange(sb, { silo, from: addDays(today, -1), to: today }).catch(() => []) : Promise.resolve([]),
      ]);
      setData(m);
      setNow(current);
      setWhosOn(on);
      setSwaps(sw.filter((s) => s.requester_id === userId || s.partner_id === userId));
      setOptions(opts);
      setBalances(bal.filter((b) => b.entitlement > 0));
      setEndorsements(end);
      setTeam(mine);
      // The phone's own reminders follow what was just read.
      refreshShiftReminders();
    } catch (e) {
      setError((e as Error).message);
    }
  }, [userId, silo, month, today, oversees]);

  useEffect(() => { void load(); }, [load]);

  const tpl = useMemo(() => new Map((data?.templates ?? []).map((t) => [t.id, t])), [data]);
  const nameOf = (l: { template_id: string | null; activity_type?: string | null }) =>
    (l.template_id ? tpl.get(l.template_id)?.name : null) ?? l.activity_type ?? 'Shift';

  // What this phone did that the server has not heard yet.
  const confirmedHere = new Set(pending.flatMap((e) => (e.op.kind === 'allocation_ack' ? [e.op.rosterId] : [])));
  const cancelledHere = new Set(pending.flatMap((e) => (e.op.kind === 'leave_cancel' ? [e.op.leaveId] : [])));
  const answeredHere = new Map(pending.flatMap((e) => (e.op.kind === 'swap_respond' ? [[e.op.swapId, e.op.accept] as const] : [])));
  const withdrawnHere = new Set(pending.flatMap((e) => (e.op.kind === 'swap_withdraw' ? [e.op.swapId] : [])));
  const askedHere = pending.filter((e) => e.op.kind === 'swap_request');

  const confirm = async (l: ScheduleLine) => {
    await enqueue({ kind: 'allocation_ack', rosterId: l.id, label: `${dayLabel(l.duty_date ?? today)} · ${nameOf(l)}` });
  };

  const settings = data?.settings ?? { grace: 10, noshow: 60 };
  const nowState = now?.start_at && now.end_at
    ? shiftState({ start_at: now.start_at, end_at: now.end_at, status: now.status, cancelled_at: now.cancelled_at }, now.attendance, settings)
    : null;
  const startsIn = now?.start_at ? Date.parse(now.start_at) - Date.now() : 0;
  const field = RESPONDER_ROLES.includes(role);

  const byDay = useMemo(() => {
    const m = new Map<string, ScheduleLine[]>();
    for (const l of data?.lines ?? []) {
      if (!l.duty_date || l.cancelled_at) continue;
      m.set(l.duty_date, [...(m.get(l.duty_date) ?? []), l]);
    }
    return m;
  }, [data]);
  const holiday = new Map((data?.holidays ?? []).map((h) => [h.day, h.name]));
  const leaveOn = (d: string) => (data?.leave ?? []).find((l) => l.eff_from <= d && l.eff_to >= d && !cancelledHere.has(l.id));
  const monthShifts = (data?.lines ?? []).filter((l) => l.duty_date?.startsWith(month) && lineActive(l.status, l.cancelled_at));

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} tintColor={colors.accent} colors={[colors.accent]} progressBackgroundColor={colors.bgCard}
          onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} />
      }
    >
      {error ? <Banner tone="error" onDismiss={() => setError(null)}>{error}</Banner> : null}

      <Card style={{ borderLeftWidth: 3, borderLeftColor: dept.primary_color }}>
        <DeptHeader dept={dept} />
        <View style={styles.identity}>
          <Text style={styles.name}>{fullName}</Text>
          <Muted>{roleName(role)}</Muted>
        </View>
      </Card>

      {/* The shift now, or next */}
      <SectionLabel>{now && startsIn <= 0 ? 'Your shift now' : 'Your next shift'}</SectionLabel>
      {now && now.start_at && now.end_at ? (
        <Card accent={nowState === 'late' || nowState === 'not_started' ? colors.critical : nowState === 'started' || nowState === 'started_late' ? colors.low : colors.accent}>
          <Title>{nameOf(now)}</Title>
          <Muted>{dayLabel(now.duty_date ?? today)} · {saTime(now.start_at)}–{saTime(now.end_at)}{now.station ? ` · ${now.station}` : ''}</Muted>
          <View style={styles.chips}>
            {now.post ? <Chip icon="flag-outline" text={now.post} /> : null}
            {now.call_sign ? <Chip icon="id-card-outline" text={now.call_sign} /> : null}
            {now.vehicle ? <Chip icon={unitIcon} text={now.vehicle} /> : null}
          </View>
          <Text style={[styles.state, { color: nowState === 'late' || nowState === 'not_started' ? colors.critical : colors.text }]}>
            {startsIn > 0 ? `Starts in ${countdown(startsIn)}` : nowState ? stateWords(nowState, now.attendance) : ''}
          </Text>
          {now.special_instructions ? <Text style={styles.instructions}>{now.special_instructions}</Text> : null}
          {!now.acknowledged_at && !confirmedHere.has(now.id) ? (
            <Pressable accessibilityRole="button" onPress={() => { void confirm(now); }} style={({ pressed }) => [styles.primary, { opacity: pressed ? 0.7 : 1 }]}>
              <Ionicons name="checkmark-circle-outline" size={16} color="#fff" />
              <Text style={styles.primaryText}>I have read this shift</Text>
            </Pressable>
          ) : null}
          {field && !now.attendance?.checked_in_at && startsIn < 3 * 3_600_000 ? (
            <Pressable accessibilityRole="button" onPress={() => router.push('/(tabs)/shift')} style={({ pressed }) => [styles.secondary, { opacity: pressed ? 0.7 : 1 }]}>
              <Ionicons name="play-circle-outline" size={16} color={colors.accent} />
              <Text style={styles.secondaryText}>Start your shift</Text>
            </Pressable>
          ) : null}
        </Card>
      ) : (
        <Card tight><Muted>Nothing on your roster in the next day.</Muted></Card>
      )}

      {/* The month */}
      <View style={styles.monthHead}>
        <Pressable onPress={() => setMonth((m) => shiftMonth(m, -1))} hitSlop={12} accessibilityLabel="Previous month">
          <Ionicons name="chevron-back" size={20} color={colors.text} />
        </Pressable>
        <Text style={styles.monthTitle}>{monthLabel(month)}</Text>
        <Pressable onPress={() => setMonth((m) => shiftMonth(m, 1))} hitSlop={12} accessibilityLabel="Next month">
          <Ionicons name="chevron-forward" size={20} color={colors.text} />
        </Pressable>
      </View>
      <Card tight>
        <Muted>{monthShifts.length} shift{monthShifts.length === 1 ? '' : 's'} this month</Muted>
        <View style={styles.weekRow}>
          {WEEKDAYS.map((w, i) => <Text key={i} style={styles.weekday}>{w}</Text>)}
        </View>
        {monthGrid(month).map((week) => (
          <View key={week[0]!.day} style={styles.weekRow}>
            {week.map(({ day: d, inMonth }) => {
              const lines = byDay.get(d) ?? [];
              const work = lines.find((l) => lineActive(l.status, l.cancelled_at));
              const t = work?.template_id ? tpl.get(work.template_id) : undefined;
              const leave = lines.some((l) => l.status === 'Leave') || leaveOn(d);
              return (
                <Pressable key={d} onPress={() => setDay(d)} accessibilityLabel={dayLabel(d)}
                  style={[styles.dayCell, !inMonth && { opacity: 0.35 }, d === today && styles.today, holiday.has(d) && styles.holiday]}>
                  <Text style={styles.dayNum}>{Number(d.slice(8))}</Text>
                  {work ? (
                    <Text style={[styles.dayCode, { color: t?.colour ?? colors.accent, backgroundColor: `${t?.colour ?? colors.accent}33` }]}>{t?.code ?? '•'}</Text>
                  ) : leave ? <Text style={styles.dayLeave}>L</Text> : null}
                </Pressable>
              );
            })}
          </View>
        ))}
      </Card>

      {/* Who's on */}
      <SectionLabel>Who&apos;s on today</SectionLabel>
      <Card tight>
        {whosOn.length === 0 ? <Muted>Nobody is on the issued roster today.</Muted> : null}
        {whosOn.filter((r) => lineActive(r.status, r.cancelled_at)).map((r) => {
          const on = Date.parse(r.start_at!) <= Date.now() && Date.parse(r.end_at!) > Date.now();
          return (
            <View key={r.id} style={styles.personRow}>
              <View style={[styles.dot, { backgroundColor: on ? colors.low : colors.muted }]} />
              <Text style={[styles.personName, r.user_id === userId && { fontWeight: '800' }]} numberOfLines={1}>{r.user_name}</Text>
              <Text style={styles.personMeta} numberOfLines={1}>{saTime(r.start_at!)}–{saTime(r.end_at!)}{r.post ? ` · ${r.post}` : ''}</Text>
            </View>
          );
        })}
        {whosOn.some((r) => r.status === 'Leave') ? (
          <Muted style={{ marginTop: space.sm }}>Off today: {whosOn.filter((r) => r.status === 'Leave').map((r) => r.user_name).join(', ')}</Muted>
        ) : null}
      </Card>

      {/* Those I oversee */}
      {oversees ? <TeamToday lines={team} settings={settings} nameOf={nameOf} /> : null}

      {/* Swaps */}
      <SectionLabel>Swaps</SectionLabel>
      <Card tight>
        {swaps.length === 0 && askedHere.length === 0 ? <Muted>No swaps. Open a day to offer one of your shifts.</Muted> : null}
        {askedHere.map((e) => <Muted key={e.id}>{e.op.kind === 'swap_request' ? e.op.label : ''} · waiting to send</Muted>)}
        {swaps.slice(0, 10).map((s) => {
          const mineSide = s.requester_id === userId ? s.mine : s.theirs;
          const other = s.requester_id === userId ? s.theirs : s.mine;
          const answered = answeredHere.get(s.id);
          const status = withdrawnHere.has(s.id) ? 'Withdrawn' : answered === undefined ? s.status : answered ? 'Accepted' : 'Declined';
          const label = `${mineSide ? `${nameOf(mineSide)} ${dayLabel(mineSide.duty_date ?? today)}` : 'Your shift'} for ${other?.user_name ?? 'a colleague'}'s ${other ? `${nameOf(other)} ${dayLabel(other.duty_date ?? today)}` : 'shift'}`;
          return (
            <View key={s.id} style={styles.swapRow}>
              <Text style={styles.personName}>{label}</Text>
              <Muted>{SWAP_WORD[status] ?? status}</Muted>
              <View style={styles.rowGap}>
                {s.partner_id === userId && status === 'Requested' ? (
                  <>
                    <SmallButton text="Accept" onPress={() => { void enqueue({ kind: 'swap_respond', swapId: s.id, accept: true, label }); }} />
                    <SmallButton text="Decline" subtle onPress={() => { void enqueue({ kind: 'swap_respond', swapId: s.id, accept: false, label }); }} />
                  </>
                ) : null}
                {s.requester_id === userId && (status === 'Requested' || status === 'Accepted') ? (
                  <SmallButton text="Withdraw" subtle onPress={() => { void enqueue({ kind: 'swap_withdraw', swapId: s.id, label }); }} />
                ) : null}
              </View>
            </View>
          );
        })}
      </Card>

      {/* Leave */}
      <View style={styles.monthHead}>
        <SectionLabel>My leave</SectionLabel>
        <Pressable onPress={() => router.push('/leave')} hitSlop={10}><Text style={styles.link}>Ask for leave</Text></Pressable>
      </View>
      {balances.length ? (
        <Card tight>
          {balances.map((b) => (
            <View key={b.type} style={styles.personRow}>
              <Text style={styles.personName}>{b.type}</Text>
              <Text style={styles.personMeta}>{b.remaining} of {b.entitlement} days left{b.pending ? ` · ${b.pending} pending` : ''}</Text>
            </View>
          ))}
        </Card>
      ) : null}
      {(data?.leave ?? []).length === 0 ? <Card tight><Muted>No leave this month.</Muted></Card> : null}
      {(data?.leave ?? []).map((l) => {
        const status = cancelledHere.has(l.id) ? 'Cancelled' : l.status;
        const canCancel = status === 'Pending' || (status === 'Approved' && l.eff_from > today);
        return (
          <Card key={l.id} tight accent={STATUS_COLOUR()[status] ?? colors.border}>
            <View style={styles.rowBetween}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.personName}>{l.absence ?? 'Leave'}</Text>
                <Muted>{l.eff_from} to {l.eff_to}{l.days != null ? ` · ${l.days} day${Number(l.days) === 1 ? '' : 's'}` : ''}</Muted>
                {l.review_comments ? <Muted>{l.review_comments}</Muted> : null}
              </View>
              <Text style={[styles.status, { color: STATUS_COLOUR()[status] ?? colors.muted }]}>
                {cancelledHere.has(l.id) ? 'Cancelling' : LEAVE_WORD[status] ?? status}
              </Text>
            </View>
            {canCancel && !cancelledHere.has(l.id) ? (
              <SmallButton text="Cancel leave" subtle onPress={() => Alert.alert('Cancel this leave?', `${l.absence ?? 'Leave'}, ${l.eff_from} to ${l.eff_to}.`, [
                { text: 'Keep it', style: 'cancel' },
                { text: 'Cancel leave', style: 'destructive', onPress: () => { void enqueue({ kind: 'leave_cancel', leaveId: l.id, label: `${l.absence ?? 'Leave'} · ${l.eff_from} to ${l.eff_to}` }); } },
              ])} />
            ) : null}
          </Card>
        );
      })}

      {endorsements.length ? (
        <>
          <SectionLabel>Court dates and endorsements</SectionLabel>
          {endorsements.map((e) => (
            <Card key={e.id} tight>
              <Text style={styles.personName}>{e.type}</Text>
              <Muted>{e.start_date}{e.end_date ? ` to ${e.end_date}` : ' onwards'}</Muted>
              {e.details ? <Text style={styles.instructions}>{e.details}</Text> : null}
            </Card>
          ))}
        </>
      ) : null}

      <DaySheet
        day={day}
        lines={day ? (byDay.get(day) ?? []) : []}
        holiday={day ? holiday.get(day) : undefined}
        leave={day ? leaveOn(day) : undefined}
        nameOf={nameOf}
        confirmedHere={confirmedHere}
        canOffer={options.length > 0}
        onConfirm={(l) => { void confirm(l); }}
        onOffer={(l) => { setDay(null); setOffering(l); }}
        onClose={() => setDay(null)}
      />
      <OfferSheet
        line={offering}
        options={options}
        nameOf={nameOf}
        onClose={() => setOffering(null)}
        onSend={(theirs, note) => {
          const mine = offering!;
          setOffering(null);
          void enqueue({
            kind: 'swap_request', myLine: mine.id, theirLine: theirs.id, note: note || null,
            label: `${nameOf(mine)} ${dayLabel(mine.duty_date ?? today)} for ${theirs.user_name}'s ${nameOf(theirs)} ${dayLabel(theirs.start_at!.slice(0, 10))}`,
          });
        }}
      />
    </ScrollView>
  );
}

function TeamToday({ lines, settings, nameOf }: {
  lines: ScheduleLine[]; settings: { grace: number; noshow: number }; nameOf: (l: ScheduleLine) => string;
}) {
  const styles = useStyles();
  const now = Date.now();
  const current = lines
    .filter((l) => l.published && !l.cancelled_at && l.start_at && l.end_at && Date.parse(l.end_at) > now && Date.parse(l.start_at) - 3_600_000 <= now)
    .map((l) => ({ l, s: shiftState({ start_at: l.start_at!, end_at: l.end_at!, status: l.status, cancelled_at: l.cancelled_at }, l.attendance, settings, now) }))
    .filter((x) => x.s !== 'leave');
  if (!current.length) return null;
  const order = { not_started: 0, late: 1, due: 2, upcoming: 3, started_late: 4, started: 5, finished: 6, missed: 7, recorded: 8, cancelled: 9, leave: 10 } as const;
  return (
    <>
      <SectionLabel>My team today</SectionLabel>
      <Card tight>
        {current.sort((a, b) => order[a.s] - order[b.s]).map(({ l, s }) => {
          const bad = s === 'late' || s === 'not_started';
          return (
            <View key={l.id} style={styles.personRow}>
              <View style={[styles.dot, { backgroundColor: bad ? colors.critical : s === 'started' || s === 'started_late' ? colors.low : colors.muted }]} />
              <Text style={styles.personName} numberOfLines={1}>{l.user_name}</Text>
              <Text style={[styles.personMeta, bad && { color: colors.critical, fontWeight: '700' }]} numberOfLines={1}>
                {nameOf(l)} {saTime(l.start_at!)} · {stateWords(s, l.attendance)}
              </Text>
            </View>
          );
        })}
      </Card>
    </>
  );
}

function DaySheet({ day, lines, holiday, leave, nameOf, confirmedHere, canOffer, onConfirm, onOffer, onClose }: {
  day: string | null; lines: ScheduleLine[]; holiday?: string; leave?: { absence: string | null; status: string };
  nameOf: (l: ScheduleLine) => string; confirmedHere: Set<string>; canOffer: boolean;
  onConfirm: (l: ScheduleLine) => void; onOffer: (l: ScheduleLine) => void; onClose: () => void;
}) {
  const styles = useStyles();
  return (
    <BottomSheet visible={day !== null} onClose={onClose}
      header={<View style={{ paddingHorizontal: space.lg }}><Title>{day ? dayLabel(day) : ''}</Title>{holiday ? <Muted>{holiday}</Muted> : null}</View>}>
      <View style={{ padding: space.lg, gap: space.md }}>
        {lines.length === 0 ? <Muted>{leave ? `${leave.absence ?? 'Leave'} (${leave.status === 'Approved' ? 'approved' : 'asked for'})` : 'Not on the roster.'}</Muted> : null}
        {lines.map((l) => (
          <Card key={l.id} tight>
            <Text style={styles.personName}>{l.status === 'Leave' ? 'On leave' : nameOf(l)}</Text>
            <Muted>{saTime(l.start_at!)}–{saTime(l.end_at!)}{l.station ? ` · ${l.station}` : ''}</Muted>
            {[l.post, l.vehicle, l.call_sign].some(Boolean) ? <Muted>{[l.post, l.vehicle, l.call_sign].filter(Boolean).join(' · ')}</Muted> : null}
            {l.special_instructions ? <Text style={styles.instructions}>{l.special_instructions}</Text> : null}
            {lineActive(l.status, l.cancelled_at) && Date.parse(l.end_at!) > Date.now() ? (
              <View style={styles.rowGap}>
                {!l.acknowledged_at && !confirmedHere.has(l.id) ? <SmallButton text="I have read this shift" onPress={() => onConfirm(l)} /> : <Muted>Confirmed</Muted>}
                {canOffer && Date.parse(l.start_at!) > Date.now() + 3_600_000 ? <SmallButton text="Offer a swap" subtle onPress={() => onOffer(l)} /> : null}
              </View>
            ) : null}
          </Card>
        ))}
      </View>
    </BottomSheet>
  );
}

function OfferSheet({ line, options, nameOf, onClose, onSend }: {
  line: ScheduleLine | null; options: WhosOnRow[]; nameOf: (l: { template_id: string | null }) => string;
  onClose: () => void; onSend: (theirs: WhosOnRow, note: string) => void;
}) {
  const styles = useStyles();
  const [note, setNote] = useState('');
  const fit = line
    ? options.filter((o) => !(Date.parse(o.start_at!) < Date.parse(line.end_at!) && Date.parse(line.start_at!) < Date.parse(o.end_at!)))
    : [];
  return (
    <BottomSheet visible={line !== null} onClose={onClose}
      header={<View style={{ paddingHorizontal: space.lg }}><Title>Offer a swap</Title>{line ? <Muted>Your {nameOf(line)} on {dayLabel(line.duty_date ?? '')}</Muted> : null}</View>}>
      <View style={{ padding: space.lg, gap: space.sm }}>
        <TextInput value={note} onChangeText={setNote} placeholder="Note (optional)" placeholderTextColor={colors.muted} style={styles.input} />
        <Muted>Choose the colleague&apos;s shift you would take instead. They accept, then your supervisor approves.</Muted>
        {fit.length === 0 ? <Muted>No colleague&apos;s shift fits.</Muted> : null}
        {fit.slice(0, 60).map((o) => (
          <Pressable key={o.id} onPress={() => onSend(o, note)} style={({ pressed }) => [styles.option, { opacity: pressed ? 0.7 : 1 }]}>
            <Text style={styles.personName}>{o.user_name}</Text>
            <Muted>{nameOf(o)} · {dayLabel(o.start_at!.slice(0, 10))} · {saTime(o.start_at!)}–{saTime(o.end_at!)}</Muted>
          </Pressable>
        ))}
      </View>
    </BottomSheet>
  );
}

function SmallButton({ text, onPress, subtle }: { text: string; onPress: () => void; subtle?: boolean }) {
  const styles = useStyles();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [subtle ? styles.smallSubtle : styles.small, { opacity: pressed ? 0.7 : 1 }]}>
      <Text style={subtle ? styles.smallSubtleText : styles.smallText}>{text}</Text>
    </Pressable>
  );
}

function Chip({ icon, text }: { icon: React.ComponentProps<typeof Ionicons>['name']; text: string }) {
  const styles = useStyles();
  return (
    <View style={styles.chip}>
      <Ionicons name={icon} size={11} color={colors.muted} />
      <Text style={styles.chipText}>{text}</Text>
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  container: { padding: space.lg, paddingBottom: space['3xl'] },
  identity: { marginTop: space.md, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  name: { ...type.bodyStrong, color: colors.text },
  rowGap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, marginTop: space.sm },
  rowBetween: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.bgElevated, borderRadius: radius.sm, paddingHorizontal: space.sm, paddingVertical: 3,
  },
  chipText: { ...type.small, fontSize: 11, color: colors.textDim },
  state: { ...type.bodyStrong, marginTop: space.sm },
  instructions: { ...type.small, color: colors.medium, marginTop: space.sm, fontStyle: 'italic', lineHeight: 18 },
  // Full-width targets: tapped with gloves on, in a vehicle, in the dark.
  primary: {
    marginTop: space.md, minHeight: 44, borderRadius: radius.md, backgroundColor: colors.accent,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm,
  },
  primaryText: { ...type.small, color: '#ffffff', fontWeight: '700' },
  secondary: {
    marginTop: space.sm, minHeight: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.accent,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm,
  },
  secondaryText: { ...type.small, color: colors.accent, fontWeight: '700' },
  monthHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.lg, marginBottom: space.sm },
  monthTitle: { ...type.bodyStrong, color: colors.text },
  weekRow: { flexDirection: 'row', marginTop: 4 },
  weekday: { flex: 1, textAlign: 'center', ...type.label, fontSize: 10, color: colors.muted },
  dayCell: { flex: 1, aspectRatio: 0.9, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 4, borderRadius: radius.sm, margin: 1 },
  today: { borderWidth: 2, borderColor: colors.accent },
  holiday: { backgroundColor: colors.mediumSoft },
  dayNum: { ...type.small, fontSize: 11, color: colors.text },
  dayCode: { marginTop: 2, fontSize: 10, fontWeight: '800', borderRadius: 4, paddingHorizontal: 4, overflow: 'hidden' },
  dayLeave: { marginTop: 2, fontSize: 10, fontWeight: '800', color: colors.muted },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  personName: { ...type.bodyStrong, color: colors.text, flexShrink: 1 },
  personMeta: { ...type.small, color: colors.muted, marginLeft: 'auto', flexShrink: 1 },
  swapRow: { paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  status: { ...type.small, fontWeight: '700' },
  link: { ...type.small, color: colors.accent, fontWeight: '700' },
  small: { minHeight: 36, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  smallText: { ...type.small, color: '#ffffff', fontWeight: '700' },
  smallSubtle: { minHeight: 36, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  smallSubtleText: { ...type.small, color: colors.text, fontWeight: '700' },
  input: { minHeight: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: space.md, color: colors.text },
  option: { padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
}));
