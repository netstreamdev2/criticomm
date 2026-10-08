import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { checkFinesOwing } from '@criticom/api';
import { rand, STAGE_INFO, type OwingCheck } from '@criticom/db/fines';
import { getSupabase } from '@/lib/supabase';
import { useSync } from '@/lib/sync';
import { colors, radius, space, makeStyles } from '@/lib/theme';

/**
 * What a person or vehicle owes on the register, at the roadside (0058).
 *
 * A summary only — fine numbers, offences, amounts and where each stands —
 * from every officer's fines, never their names or addresses. Each look-up
 * is audited and limited, so results are kept for the session and a number
 * is checked once, not on every keystroke.
 */

const cache = new Map<string, { at: number; result: OwingCheck }>();
const FRESH_MS = 5 * 60_000;

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'offline' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; result: OwingCheck };

export function OwingPanel({ idNumber, vehicleReg, compact }: { idNumber?: string; vehicleReg?: string; compact?: boolean }) {
  const styles = useStyles();
  const { online } = useSync();
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [open, setOpen] = useState(!compact);
  const key = `${idNumber ?? ''}|${vehicleReg ?? ''}`;
  const latest = useRef(key);

  useEffect(() => {
    latest.current = key;
    if (!idNumber && !vehicleReg) { setState({ kind: 'idle' }); return; }
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < FRESH_MS) { setState({ kind: 'done', result: hit.result }); return; }
    if (!online) { setState({ kind: 'offline' }); return; }
    setState({ kind: 'loading' });
    // A short pause so a number still being corrected is not looked up.
    const timer = setTimeout(() => {
      checkFinesOwing(getSupabase(), { idNumber, vehicleReg })
        .then((result) => {
          cache.set(key, { at: Date.now(), result });
          if (latest.current === key) setState({ kind: 'done', result });
        })
        .catch((e: { message?: string }) => {
          if (latest.current === key) setState({ kind: 'error', message: e?.message ?? 'The check did not work.' });
        });
    }, 600);
    return () => clearTimeout(timer);
  }, [key, idNumber, vehicleReg, online]);

  if (state.kind === 'idle') return null;
  if (state.kind === 'loading') {
    return (
      <View style={[styles.box, styles.neutral]}>
        <ActivityIndicator size="small" color={colors.accent} />
        <Text style={styles.neutralText}>Checking the register…</Text>
      </View>
    );
  }
  if (state.kind === 'offline') {
    return (
      <View style={[styles.box, styles.neutral]}>
        <Ionicons name="cloud-offline-outline" size={16} color={colors.muted} />
        <Text style={styles.neutralText}>No signal: what is owed can be checked when the phone has signal.</Text>
      </View>
    );
  }
  if (state.kind === 'error') {
    return (
      <View style={[styles.box, styles.neutral]}>
        <Ionicons name="alert-circle-outline" size={16} color={colors.medium} />
        <Text style={styles.neutralText}>{state.message}</Text>
      </View>
    );
  }

  const r = state.result;
  const who = r.id_checked && r.reg_checked ? 'this person or vehicle' : r.id_checked ? 'this ID number' : 'this vehicle';
  if (r.open_count === 0) {
    return (
      <View style={[styles.box, styles.clear]}>
        <Ionicons name="checkmark-circle" size={18} color={colors.low} />
        <Text style={[styles.title, { color: colors.low }]}>No unpaid fines for {who}.</Text>
      </View>
    );
  }

  const bad = r.overdue_count > 0;
  const tone = bad ? colors.critical : colors.medium;
  return (
    <View style={[styles.box, { borderColor: `${tone}66`, backgroundColor: `${tone}14`, flexDirection: 'column', alignItems: 'stretch' }]}>
      <Pressable onPress={() => setOpen((o) => !o)} style={styles.head} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <Ionicons name={bad ? 'warning' : 'alert-circle'} size={18} color={tone} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: tone }]}>
            Owes {rand(r.total_owing)} on {r.open_count} unpaid fine{r.open_count === 1 ? '' : 's'}
          </Text>
          <Text style={styles.sub}>
            {[
              r.overdue_count ? `${r.overdue_count} overdue (${rand(r.overdue_owing)})` : null,
              r.disputed_count ? `${r.disputed_count} disputed` : null,
              r.oldest_issued ? `oldest ${new Date(r.oldest_issued).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })}` : null,
            ].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.muted} />
      </Pressable>
      {open ? r.fines.slice(-8).reverse().map((f) => (
        <View key={f.fine_number} style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{f.fine_number} · {f.offence}</Text>
            <Text style={[styles.rowMeta, f.overdue && { color: colors.critical, fontWeight: '800' }]}>
              {f.stage}{f.matched_on === 'reg' && r.id_checked ? ' · same vehicle' : ''}{f.vehicle_reg ? ` · ${f.vehicle_reg}` : ''}
            </Text>
            <Text style={styles.rowHint} numberOfLines={2}>{STAGE_INFO[f.stage]?.means}</Text>
          </View>
          <Text style={styles.rowAmount}>{rand(f.owing)}</Text>
        </View>
      )) : null}
      {open && r.fines.length > 8 ? <Text style={styles.more}>and {r.fines.length - 8} more on the register</Text> : null}
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  box: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, marginTop: space.sm,
    borderRadius: radius.md, borderWidth: 1,
  },
  neutral: { borderColor: colors.border, backgroundColor: colors.bgElevated },
  neutralText: { color: colors.textDim, fontSize: 12, flex: 1 },
  clear: { borderColor: `${colors.low}55`, backgroundColor: colors.lowSoft },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { fontSize: 14, fontWeight: '900' },
  sub: { color: colors.textDim, fontSize: 11, marginTop: 2 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingTop: space.sm, marginTop: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider,
  },
  rowTitle: { color: colors.text, fontSize: 12, fontWeight: '800' },
  rowMeta: { color: colors.textDim, fontSize: 11, marginTop: 1 },
  rowHint: { color: colors.muted, fontSize: 10, marginTop: 1 },
  rowAmount: { color: colors.text, fontSize: 13, fontWeight: '900', fontVariant: ['tabular-nums'] },
  more: { color: colors.muted, fontSize: 11, marginTop: space.sm },
}));
