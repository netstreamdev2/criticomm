import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getFine, listFinesByRef, listNoticeCharges, paidByFine, type Fine } from '@criticom/api';
import { amountDue, fineStage, maskId, noticeInfo, rand, STAGE_INFO } from '@criticom/db/fines';
import { buildFineSlipHtml, slipFromFines, type SlipData } from '@criticom/db/fine-slip';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useSync } from '@/lib/sync';
import { printSlip, provisionalRef, shareSlipPdf, slipFromQueued, statusTone, type IssueFineOp } from '@/lib/fines';
import type { OutboxEntry } from '@/lib/outbox';
import { colors, radius, space, makeStyles } from '@/lib/theme';
import { Banner, Button, Card, EmptyState, KeyValue, Muted, SectionLabel } from '@/components/ui';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One notice and its slip. `id` is either a fine's id or the outbox entry id
 * the notice was queued under (which is also its client reference), so the
 * screen the officer lands on after Issue keeps working as the phone
 * delivers it: provisional slip first, the register's numbers once sent.
 */
export default function FineScreen() {
  const styles = useStyles();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { fullName } = useAuth();
  const { pending, failed, online, retryAll } = useSync();

  const [rows, setRows] = useState<Fine[] | null>(null);
  const [paid, setPaid] = useState(0);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ tone: 'error' | 'success' | 'info'; text: string } | null>(null);
  const [working, setWorking] = useState<'print' | 'pdf' | null>(null);

  const queued = useMemo(
    () => [...pending, ...failed].find((e): e is OutboxEntry & { op: IssueFineOp } => e.id === id && e.op.kind === 'issue_fine') ?? null,
    [pending, failed, id],
  );

  const load = useCallback(async () => {
    if (!id || !UUID.test(id)) { setLoading(false); return; }
    try {
      const sb = getSupabase();
      // A queued notice's id is its client reference once it lands…
      let found = await listFinesByRef(sb, id.toLowerCase());
      // …and a fine's own id when opened from the list.
      if (!found.length) {
        const one = await getFine(sb, id);
        if (one) found = await listNoticeCharges(sb, one);
      }
      if (found.length) {
        setRows(found);
        const map = await paidByFine(sb, found.map((f) => f.id)).catch(() => new Map<string, number>());
        setPaid([...map.values()].reduce((s, v) => s + v, 0));
      }
    } catch {
      /* offline: the queued copy is shown */
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));
  // The outbox delivered it: fetch the register's copy.
  useEffect(() => { if (!queued) void load(); }, [queued, load]);

  const slip: SlipData | null = useMemo(() => {
    if (rows?.length) return slipFromFines(rows);
    if (queued) return slipFromQueued(queued, fullName || 'Officer');
    return null;
  }, [rows, queued, fullName]);

  const run = async (kind: 'print' | 'pdf') => {
    if (!slip) return;
    setWorking(kind);
    setMessage(null);
    try {
      const html = buildFineSlipHtml(slip);
      const name = rows?.length ? rows.map((r) => r.fine_number).join('_') : provisionalRef(id ?? 'slip');
      if (kind === 'print') await printSlip(html);
      else await shareSlipPdf(html, name);
    } catch (e) {
      setMessage({ tone: 'error', text: (e as Error).message ?? 'Could not prepare the slip.' });
    } finally {
      setWorking(null);
    }
  };

  if (loading && !queued) {
    return <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>;
  }
  if (!slip) {
    return (
      <View style={styles.center}>
        <EmptyState icon="receipt-outline" title="Fine not found" body="It may belong to another officer, or the link is out of date." />
      </View>
    );
  }

  const info = noticeInfo(slip.noticeType);
  const first = rows?.[0];
  const status = first?.status ?? null;
  const due = rows?.length
    ? Math.max(0, rows.filter((r) => r.status !== 'Cancelled').reduce((s, r) => s + amountDue(r), 0) - paid)
    : slip.charges.reduce((s, c) => s + c.amount - c.discount, 0);
  const total = slip.charges.reduce((s, c) => s + c.amount, 0);
  const tone = status ? statusTone(status, colors) : colors.medium;

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.container}>
      {message ? <Banner tone={message.tone} onDismiss={() => setMessage(null)}>{message.text}</Banner> : null}

      {queued?.status === 'failed' ? (
        <Banner tone="error">
          {`The register refused this notice: ${queued.lastError ?? 'unknown reason'}. Fix it by issuing a corrected notice; this one stays in the sync tray until you discard it.`}
        </Banner>
      ) : queued ? (
        <Banner tone="info">
          {online
            ? 'Sending to the register… The slip below is ready to print now.'
            : 'No signal. The notice is safe on this phone and sends itself when there is signal. Print the provisional slip now.'}
        </Banner>
      ) : null}

      {/* The ticket */}
      <View style={styles.ticket}>
        <View style={styles.band}>
          <View style={{ flex: 1 }}>
            <Text style={styles.authority}>{slip.issuingAuthority.toUpperCase()}</Text>
            <Text style={styles.noticeTitle}>{info.label}</Text>
          </View>
          <View style={[styles.status, { borderColor: `${tone}88`, backgroundColor: `${tone}22` }]}>
            <Text style={[styles.statusText, { color: tone }]}>{status ?? (queued?.status === 'failed' ? 'REFUSED' : 'QUEUED')}</Text>
          </View>
        </View>
        <View style={styles.refs}>
          {slip.charges.map((c) => (
            <Text key={c.ref} style={styles.ref}>{c.ref}{c.noticeNumber ? `  ·  No. ${c.noticeNumber}` : ''}</Text>
          ))}
          <Text style={styles.served}>
            Served {new Date(slip.issuedAt).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}
          </Text>
        </View>

        <View style={styles.perf} />

        <View style={styles.amountBox}>
          <Text style={styles.amountLabel}>
            {status === 'Paid' ? 'Paid in full' : status === 'Cancelled' ? 'Cancelled' : slip.noticeType === 'Section 56' ? 'Admission of guilt' : 'Amount due now'}
          </Text>
          <Text style={[styles.amount, status === 'Cancelled' && styles.struck]}>{rand(status === 'Paid' ? total : due)}</Text>
          <Text style={styles.amountNote}>
            {slip.noticeType === 'Section 56'
              ? `Or appear at ${slip.courtName ?? 'court'} on ${slip.courtDate ?? '—'}`
              : slip.noticeType === 'AARTO 01'
                ? `Discounted until ${slip.payBy ?? '—'} · full amount ${rand(total)}`
                : `Pay by ${slip.payBy ?? '—'}`}
          </Text>
        </View>
      </View>

      {first && fineStage(first) !== 'Cancelled' ? (() => {
        const stage = fineStage(first);
        const t = STAGE_INFO[stage].tone;
        const c = t === 'bad' ? colors.critical : t === 'warn' ? colors.medium : t === 'done' ? colors.low : colors.accent;
        return (
          <View style={[styles.stageBox, { borderColor: `${c}66`, backgroundColor: `${c}14` }]}>
            <Text style={[styles.stageTitle, { color: c }]}>{stage}</Text>
            <Text style={styles.stageText}>{STAGE_INFO[stage].means}</Text>
          </View>
        );
      })() : null}

      {first?.status === 'Cancelled' && first.cancel_reason ? (
        <Banner tone="error">{`Cancelled by ${first.cancelled_by_name ?? 'command'}: ${first.cancel_reason}`}</Banner>
      ) : null}

      <View style={styles.actions}>
        <View style={{ flex: 1 }}>
          <Button label="Print slip" icon="print-outline" busy={working === 'print'} onPress={() => void run('print')} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Share PDF" icon="share-outline" variant="subtle" busy={working === 'pdf'} onPress={() => void run('pdf')} />
        </View>
      </View>
      {queued?.status === 'failed' ? (
        <Button label="Try sending again" icon="refresh" variant="outline" onPress={() => void retryAll()} />
      ) : null}

      <SectionLabel>{info.personPresent ? 'Infringer' : 'Owner'}</SectionLabel>
      <Card>
        <KeyValue label="Name" value={slip.infringer.name} />
        {info.personPresent ? <KeyValue label={slip.infringer.idType ?? 'ID'} value={maskId(slip.infringer.idNumber)} /> : null}
        {slip.infringer.licenceCode ? <KeyValue label="Licence code" value={slip.infringer.licenceCode} /> : null}
      </Card>

      <SectionLabel>Vehicle and place</SectionLabel>
      <Card>
        <KeyValue label="Registration" value={slip.vehicle.reg ?? '—'} />
        {slip.vehicle.makeModel ? <KeyValue label="Make / model" value={[slip.vehicle.makeModel, slip.vehicle.colour].filter(Boolean).join(' · ')} /> : null}
        <KeyValue label="Where" value={[slip.place.street, slip.place.suburb].filter(Boolean).join(', ') || slip.place.description || '—'} />
        {slip.place.lat ? (
          <View style={styles.gps}>
            <Ionicons name="location" size={12} color={colors.cyan} />
            <Text style={styles.gpsText}>{`${Number(slip.place.lat).toFixed(5)}, ${Number(slip.place.lng).toFixed(5)}`}</Text>
          </View>
        ) : null}
      </Card>

      <SectionLabel>{slip.charges.length > 1 ? `Charges (${slip.charges.length})` : 'Charge'}</SectionLabel>
      {slip.charges.map((c) => (
        <Card key={c.ref} tight>
          <View style={styles.chargeRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.chargeTitle}>{c.description}</Text>
              <Text style={styles.chargeMeta}>{[c.ref, c.code ? `Code ${c.code}` : null, c.legalRef].filter(Boolean).join(' · ')}</Text>
            </View>
            <Text style={styles.chargeAmount}>{rand(c.amount)}</Text>
          </View>
        </Card>
      ))}

      {first?.amount_source === 'officer' ? (
        <Muted>The amount was entered by the officer: the charge book had none for this offence.</Muted>
      ) : null}

      <View style={{ marginTop: space.lg }}>
        <Button label="Issue another fine" icon="add" variant="outline" onPress={() => router.replace('/fines/new')} />
      </View>
    </ScrollView>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  container: { padding: space.lg, paddingBottom: space['3xl'] },
  center: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' },

  ticket: {
    borderRadius: radius.lg, overflow: 'hidden', marginBottom: space.md,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard,
  },
  band: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, backgroundColor: colors.primary },
  authority: { color: 'rgba(255,255,255,0.85)', fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  noticeTitle: { color: '#fff', fontSize: 17, fontWeight: '900', marginTop: 2 },
  status: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, backgroundColor: '#fff' },
  statusText: { fontSize: 10, fontWeight: '900', letterSpacing: 0.6, textTransform: 'uppercase' },
  refs: { padding: space.md, gap: 2 },
  ref: { color: colors.text, fontSize: 15, fontWeight: '900', fontFamily: 'monospace' },
  served: { color: colors.muted, fontSize: 12, marginTop: 4 },
  perf: { borderTopWidth: 2, borderStyle: 'dashed', borderTopColor: colors.border, marginHorizontal: space.md },
  amountBox: { alignItems: 'center', padding: space.lg },
  amountLabel: { color: colors.muted, fontSize: 11, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },
  amount: { color: colors.text, fontSize: 36, fontWeight: '900', fontVariant: ['tabular-nums'], marginTop: 2 },
  struck: { textDecorationLine: 'line-through', color: colors.muted },
  amountNote: { color: colors.textDim, fontSize: 12, marginTop: 4, textAlign: 'center' },

  actions: { flexDirection: 'row', gap: space.sm, marginBottom: space.sm },
  stageBox: { borderWidth: 1, borderRadius: radius.md, padding: space.md, marginBottom: space.md },
  stageTitle: { fontSize: 13, fontWeight: '900' },
  stageText: { color: colors.textDim, fontSize: 12, marginTop: 2 },

  gps: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  gpsText: { color: colors.cyan, fontSize: 11, fontFamily: 'monospace' },

  chargeRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  chargeTitle: { color: colors.text, fontSize: 14, fontWeight: '800' },
  chargeMeta: { color: colors.muted, fontSize: 11, marginTop: 2 },
  chargeAmount: { color: colors.text, fontSize: 15, fontWeight: '900', fontVariant: ['tabular-nums'] },
}));
