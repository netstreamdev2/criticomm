import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { listFirearmChecklists } from '@criticom/api';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useFeature } from '@/lib/features';
import { useSync } from '@/lib/sync';
import { colors, space, makeStyles } from '@/lib/theme';
import {
  Banner, Button, Card, CheckRow, EmptyState, Input, KeyValue, Muted, SectionLabel, Segmented, Title,
} from '@/components/ui';

/**
 * The armoury checklist — completed at the counter when a firearm is issued,
 * returned, or inspected on parade.
 *
 * Two properties matter more than anything on this form:
 *
 *   • **It queues through the outbox.** Armouries are in basements; the form
 *     must accept a checklist with zero signal and deliver it when the phone
 *     surfaces, timestamped from when the officer stood at the counter.
 *   • **Pass is computed, not claimed.** The server derives pass/fail from the
 *     five safety items; this screen shows the same derivation live, so the
 *     officer sees exactly what the record will say before submitting.
 */

const KINDS = ['Issue', 'Return', 'Inspection'] as const;

const SAFETY_CHECKS = [
  ['serialVerified', 'Serial number verified against the register'],
  ['barrelClear', 'Barrel clear — no obstruction'],
  ['actionFunctional', 'Action cycles correctly'],
  ['safetyFunctional', 'Safety catch functional'],
  ['sightsSecure', 'Sights present and secure'],
] as const;

type ChecklistRow = Awaited<ReturnType<typeof listFirearmChecklists>>[number];

const uuid = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

export default function FirearmCheckScreen() {
  const styles = useStyles();
  const { session, fullName } = useAuth();
  const { enqueue, online } = useSync();
  const featureOn = useFeature('mobile.firearm_check');

  const [kind, setKind] = useState<(typeof KINDS)[number]>('Inspection');
  const [serial, setSerial] = useState('');
  const [makeModel, setMakeModel] = useState('');
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [cleaned, setCleaned] = useState(false);
  const [magazines, setMagazines] = useState('2');
  const [roundsIssued, setRoundsIssued] = useState('30');
  const [roundsReturned, setRoundsReturned] = useState('');
  const [defects, setDefects] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<'error' | 'success'>('success');
  const [history, setHistory] = useState<ChecklistRow[]>([]);

  const load = useCallback(async () => {
    if (!session) return;
    const rows = await listFirearmChecklists(getSupabase(), { limit: 10 }).catch(() => []);
    setHistory(rows);
  }, [session]);

  useEffect(() => { void load(); }, [load]);

  const passed = useMemo(
    () => SAFETY_CHECKS.every(([key]) => checks[key]),
    [checks],
  );

  const toggle = (key: string) =>
    setChecks((cur) => ({ ...cur, [key]: !cur[key] }));

  const submit = async () => {
    if (!serial.trim()) {
      setTone('error');
      setMessage('The firearm serial number is required.');
      return;
    }
    await enqueue({
      kind: 'firearm_check',
      rowId: uuid(),
      checkKind: kind,
      serialNumber: serial.trim().toUpperCase(),
      makeModel: makeModel.trim() || undefined,
      serialVerified: Boolean(checks.serialVerified),
      barrelClear: Boolean(checks.barrelClear),
      actionFunctional: Boolean(checks.actionFunctional),
      safetyFunctional: Boolean(checks.safetyFunctional),
      sightsSecure: Boolean(checks.sightsSecure),
      cleaned,
      magazines: Math.max(0, Number(magazines) || 0),
      roundsIssued: Math.max(0, Number(roundsIssued) || 0),
      roundsReturned: kind === 'Return' ? Math.max(0, Number(roundsReturned) || 0) : undefined,
      defects: defects.trim() || undefined,
      userName: fullName ?? 'Unknown officer',
    });

    setSerial(''); setMakeModel(''); setChecks({}); setCleaned(false); setDefects('');
    setRoundsReturned('');
    setTone('success');
    setMessage(online
      ? 'Checklist submitted. It is on the armoury register now.'
      : 'Checklist captured. No signal here — it delivers itself the moment the phone finds one.');
    // Give the outbox a beat to deliver before refreshing the register.
    setTimeout(() => { void load(); }, 1500);
  };

  if (!featureOn) {
    return (
      <View style={styles.center}>
        <EmptyState
          icon="shield-outline"
          title="Not enabled"
          body="The firearm checklist is not enabled for your organisation."
        />
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

      <SectionLabel>Checklist type</SectionLabel>
      <Segmented options={KINDS} value={kind} onChange={setKind} />

      <SectionLabel>Firearm</SectionLabel>
      <Card>
        <Input
          label="Serial number"
          value={serial}
          onChangeText={setSerial}
          placeholder="e.g. Z88-104477"
          autoCapitalize="characters"
          icon="barcode-outline"
        />
        <View style={{ marginTop: space.md }}>
          <Input
            label="Make / model"
            value={makeModel}
            onChangeText={setMakeModel}
            placeholder="e.g. Vektor Z88 9mm"
          />
        </View>
      </Card>

      <SectionLabel>Safety checks</SectionLabel>
      <Card>
        {SAFETY_CHECKS.map(([key, label]) => (
          <CheckRow
            key={key}
            label={label}
            checked={Boolean(checks[key])}
            onToggle={() => toggle(key)}
          />
        ))}
        <CheckRow
          label="Cleaned and lightly oiled"
          checked={cleaned}
          onToggle={() => setCleaned((c) => !c)}
        />
        <Muted>
          {passed
            ? 'All safety items ticked — this checklist will file as PASSED.'
            : 'This checklist will file as NOT PASSED until every safety item above is ticked. The record cannot claim otherwise.'}
        </Muted>
      </Card>

      <SectionLabel>Ammunition</SectionLabel>
      <Card>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Input label="Magazines" value={magazines} onChangeText={setMagazines} keyboardType="number-pad" />
          </View>
          <View style={{ flex: 1 }}>
            <Input
              label={kind === 'Return' ? 'Rounds issued' : 'Rounds'}
              value={roundsIssued} onChangeText={setRoundsIssued} keyboardType="number-pad"
            />
          </View>
          {kind === 'Return' ? (
            <View style={{ flex: 1 }}>
              <Input label="Rounds back" value={roundsReturned} onChangeText={setRoundsReturned} keyboardType="number-pad" />
            </View>
          ) : null}
        </View>
        <View style={{ marginTop: space.md }}>
          <Input
            label="Defects / remarks"
            value={defects}
            onChangeText={setDefects}
            placeholder="Anything the armourer must know"
            multiline
          />
        </View>
      </Card>

      <Button
        label={`Submit ${kind.toLowerCase()} checklist`}
        icon="shield-checkmark-outline"
        size="lg"
        onPress={() => void submit()}
      />

      <SectionLabel>Your recent checks</SectionLabel>
      {history.length === 0 ? (
        <Card><Muted>No checklists on the register yet.</Muted></Card>
      ) : (
        history.map((row) => (
          <Card key={row.id} accent={row.passed ? colors.low : colors.critical} tight>
            <View style={styles.rowBetween}>
              <Title style={{ fontSize: 15 }}>{row.serial_number}</Title>
              <Muted>{row.kind} · {row.passed ? 'Passed' : 'Not passed'}</Muted>
            </View>
            <KeyValue
              label={new Date(row.created_at).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}
              value={`${row.magazines} mag · ${row.rounds_issued} rounds${row.rounds_returned !== null ? ` · ${row.rounds_returned} back` : ''}`}
            />
            {row.defects ? <Muted>{row.defects}</Muted> : null}
          </Card>
        ))
      )}
    </ScrollView>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  container: { padding: space.lg, paddingBottom: space['3xl'], gap: space.xs },
  center: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center' },
  row: { flexDirection: 'row', gap: space.sm },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
}));
