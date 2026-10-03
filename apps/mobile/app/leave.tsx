import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  createLeaveEntry, getLeaveBalances, inclusiveDays, listActiveConfig, listLeaveEntries,
} from '@criticom/api';
import type { Silo } from '@criticom/db/types';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { colors, radius, space, type, makeStyles } from '@/lib/theme';
import {
  Banner, Button, Card, Input, KeyValue, Muted, SectionLabel, Title,
} from '@/components/ui';

/**
 * Apply for leave from the phone.
 *
 * Shift workers are not at a desk, and the alternative is a paper form that
 * reaches HR days later. The form is deliberately the same shape as the
 * console's — same table, same Pending status, same approval trail — so a
 * request made here is indistinguishable downstream from one made at a
 * workstation.
 *
 * Balances are shown before the form, not after: someone about to request four
 * days needs to know they have three left while they can still change their
 * mind.
 */

type LeaveRow = Awaited<ReturnType<typeof listLeaveEntries>>[number];
type Balance = Awaited<ReturnType<typeof getLeaveBalances>>[number];

/** YYYY-MM-DD, which is what `leave_entries.eff_from/eff_to` store. */
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const VALID_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Read at render time, so it follows the light/dark theme. */
const STATUS_TONE = (): Record<string, string> => ({
  Approved: colors.low,
  Rejected: colors.critical,
  Pending: colors.medium,
});

export default function LeaveScreen() {
  const styles = useStyles();
  const { session, silo } = useAuth();
  const [types, setTypes] = useState<string[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [history, setHistory] = useState<LeaveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [absence, setAbsence] = useState<string>('');
  const [from, setFrom] = useState(isoDate(new Date()));
  const [to, setTo] = useState(isoDate(new Date()));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<'error' | 'success'>('error');

  const load = useCallback(async () => {
    if (!session) return;
    const sb = getSupabase();
    const [configured, bal, rows] = await Promise.all([
      listActiveConfig(sb, 'LeaveType').catch(() => []),
      getLeaveBalances(sb, { userId: session.user.id }).catch(() => []),
      listLeaveEntries(sb, session.user.id).catch(() => []),
    ]);

    // Leave types are configuration, not code (Admin → Configuration). If the
    // table is unreachable the form must still work, so fall back to the set
    // every service has rather than rendering an empty picker.
    const names = configured
      .map((c) => c.name)
      .filter((n): n is string => Boolean(n));
    const options = names.length > 0 ? names : ['Annual', 'Sick', 'Family Responsibility', 'Unpaid'];
    setTypes(options);
    setAbsence((cur) => cur || (options[0] ?? ''));
    setBalances(bal);
    setHistory(rows);
    setLoading(false);
  }, [session]);

  useEffect(() => { void load(); }, [load]);

  const days = useMemo(
    () => (VALID_DATE.test(from) && VALID_DATE.test(to) ? inclusiveDays(from, to) : 0),
    [from, to],
  );

  const selectedBalance = balances.find((b) => b.type === absence);

  const submit = async () => {
    if (!session) return;
    if (!VALID_DATE.test(from) || !VALID_DATE.test(to)) {
      setTone('error');
      setMessage('Dates must be in YYYY-MM-DD format.');
      return;
    }
    if (days === 0) {
      setTone('error');
      setMessage('The end date must not be before the start date.');
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      await createLeaveEntry(getSupabase(), {
        // Leave belongs to an operational department. Someone carried under the
        // global Ethekwini silo has no leave register of their own, so their
        // request is filed against Metro Police — matching the console.
        silo: (silo === 'Ethekwini' ? 'MetroPolice' : silo) as Silo,
        user_id: session.user.id,
        eff_from: from,
        eff_to: to,
        absence,
        reason: reason.trim() || null,
        status: 'Pending',
      });
      setReason('');
      setTone('success');
      setMessage('Request submitted. Your supervisor sees it on the approvals board, and you get an alert when they decide.');
      await load();
    } catch (e) {
      setTone('error');
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
        <Muted>Loading your leave…</Muted>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      {message ? (
        <Banner tone={tone} onDismiss={() => setMessage(null)}>{message}</Banner>
      ) : null}

      <SectionLabel>Your balances</SectionLabel>
      <Card>
        {balances.length === 0 ? (
          <Muted>No entitlements are configured for your department yet.</Muted>
        ) : (
          balances.map((b) => (
            <KeyValue
              key={b.type}
              label={b.type}
              value={`${b.remaining} of ${b.entitlement} days left`}
            />
          ))
        )}
      </Card>

      <SectionLabel>Apply</SectionLabel>
      <Card>
        <Text style={styles.fieldLabel}>TYPE</Text>
        <View style={styles.chips}>
          {types.map((t) => {
            const active = t === absence;
            return (
              <Pressable
                key={t}
                onPress={() => setAbsence(t)}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                style={({ pressed }) => [
                  styles.chip,
                  active && styles.chipActive,
                  pressed && { opacity: 0.8 },
                ]}
              >
                <Text style={[styles.chipText, active && { color: '#fff' }]}>{t}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.dates}>
          <View style={{ flex: 1 }}>
            <Input
              label="From"
              value={from}
              onChangeText={setFrom}
              placeholder="YYYY-MM-DD"
              autoCapitalize="none"
              keyboardType={undefined}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Input
              label="To"
              value={to}
              onChangeText={setTo}
              placeholder="YYYY-MM-DD"
              autoCapitalize="none"
            />
          </View>
        </View>

        <View style={{ marginTop: space.md }}>
          <Input
            label="Reason"
            value={reason}
            onChangeText={setReason}
            placeholder="Optional — helps your supervisor decide"
            multiline
          />
        </View>

        {days > 0 ? (
          <View style={styles.summary}>
            <Ionicons
              name={selectedBalance && days > selectedBalance.remaining ? 'warning' : 'information-circle'}
              size={14}
              color={selectedBalance && days > selectedBalance.remaining ? colors.medium : colors.accent}
            />
            <Text style={styles.summaryText}>
              {days} day{days === 1 ? '' : 's'}
              {selectedBalance
                ? days > selectedBalance.remaining
                  ? ` — ${selectedBalance.remaining} remaining, so this exceeds your balance. It can still be submitted; your supervisor decides.`
                  : ` — ${selectedBalance.remaining - days} would remain.`
                : ''}
            </Text>
          </View>
        ) : null}

        <View style={{ marginTop: space.lg }}>
          <Button
            label="Submit request"
            icon="paper-plane-outline"
            size="lg"
            busy={busy}
            disabled={!absence || days === 0}
            onPress={() => void submit()}
          />
        </View>
      </Card>

      <SectionLabel>Your requests</SectionLabel>
      {history.length === 0 ? (
        <Card><Muted>You have not applied for leave yet.</Muted></Card>
      ) : (
        history.slice(0, 20).map((row) => {
          const statusTone = STATUS_TONE()[row.status] ?? colors.muted;
          return (
            <Card key={row.id} accent={statusTone} tight>
              <View style={styles.rowBetween}>
                <Title style={{ fontSize: 16 }}>{row.absence ?? 'Leave'}</Title>
                <View style={[styles.status, { borderColor: `${statusTone}66`, backgroundColor: `${statusTone}1f` }]}>
                  <Text style={[styles.statusText, { color: statusTone }]}>{row.status}</Text>
                </View>
              </View>
              <Muted>
                {row.eff_from} → {row.eff_to} · {inclusiveDays(row.eff_from, row.eff_to)} day
                {inclusiveDays(row.eff_from, row.eff_to) === 1 ? '' : 's'}
              </Muted>
              {row.reason ? <Muted>{row.reason}</Muted> : null}
              {row.approved_by ? (
                <Muted>Decided by {row.approved_by}</Muted>
              ) : null}
            </Card>
          );
        })
      )}
    </ScrollView>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  container: { padding: space.lg, paddingBottom: space['3xl'] },
  center: {
    flex: 1, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center', gap: space.md,
  },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },

  fieldLabel: { ...type.label, color: colors.muted, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill,
    paddingHorizontal: space.md, paddingVertical: 7,
    backgroundColor: colors.bgSoft,
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.textDim, fontSize: 13, fontWeight: '600' },

  dates: { flexDirection: 'row', gap: space.sm, marginTop: space.md },

  summary: {
    flexDirection: 'row', alignItems: 'flex-start', gap: space.sm,
    marginTop: space.md, paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
  },
  summaryText: { ...type.small, color: colors.textDim, flex: 1, lineHeight: 18 },

  status: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 3 },
  statusText: { fontSize: 12, fontWeight: '700' },
}));
