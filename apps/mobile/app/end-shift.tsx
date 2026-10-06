import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { endShift, getMyShiftKit, returnBodycam, returnShiftFirearm, roundsShort, type MyShiftKit } from '@criticom/api';
import { getSupabase } from '@/lib/supabase';
import { useDuty } from '@/lib/duty';
import { useOpenCall } from '@/lib/open-call';
import { useSignOut } from '@/lib/sign-out';
import { colors, radius, space, type, makeStyles } from '@/lib/theme';
import {
  Banner, Button, Card, CheckRow, Input, KeyValue, Muted, SectionLabel, Segmented, Stepper, Title,
} from '@/components/ui';

/**
 * The end of a shift (migrations 0051 and 0054), in the order it happens at
 * the station: hand the firearm back (rounds counted, unloaded, condition),
 * then the bodycam, then the vehicle (mileage, anything wrong with it), then
 * end. The server will not end a shift while a firearm or bodycam is still
 * booked out to the officer.
 */

type Step = 'loading' | 'firearm' | 'bodycam' | 'vehicle' | 'confirm' | 'done';
type CamCondition = 'In order' | 'Damaged' | 'Lost';
const CAM_CONDITIONS: readonly CamCondition[] = ['In order', 'Damaged', 'Lost'];
const CAM_CONDITION_VALUE = { 'In order': 'ok', Damaged: 'damaged', Lost: 'lost' } as const;
type Condition = 'Clean' | 'Needs cleaning' | 'Damaged';
const CONDITIONS: readonly Condition[] = ['Clean', 'Needs cleaning', 'Damaged'];
const CONDITION_VALUE = { Clean: 'clean', 'Needs cleaning': 'requires_cleaning', Damaged: 'damaged' } as const;

function errorText(e: unknown) {
  const err = e as { code?: string; message?: string };
  if (err?.code === 'PGRST202') {
    return 'Ending a shift in the app is not switched on for this server yet. Hand your kit in at the counter and tell your supervisor.';
  }
  return err?.message ?? String(e);
}

const digits = (s: string) => s.replace(/\D/g, '');
const saTime = (iso: string | null | undefined) => (iso
  ? new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
  : '—');

export default function EndShiftScreen() {
  const styles = useStyles();
  const router = useRouter();
  const { refresh: refreshDuty } = useDuty();
  const { refresh: refreshOpenCall } = useOpenCall();
  const signOut = useSignOut();
  const scroller = useRef<ScrollView>(null);

  const [step, setStep] = useState<Step>('loading');
  const [kit, setKit] = useState<MyShiftKit | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Firearm
  const [rounds, setRounds] = useState('');
  const [mags, setMags] = useState('');
  const [unloaded, setUnloaded] = useState(false);
  const [checksOk, setChecksOk] = useState(false);
  const [condition, setCondition] = useState<Condition | null>(null);
  const [firearmNotes, setFirearmNotes] = useState('');
  const [returned, setReturned] = useState<{ serial: string; status: string; short: number } | null>(null);

  // Bodycam
  const [camCondition, setCamCondition] = useState<CamCondition | null>(null);
  const [camNotes, setCamNotes] = useState('');
  const [camReturned, setCamReturned] = useState<{ serial: string; status: string } | null>(null);

  // Vehicle
  const [mileage, setMileage] = useState('');
  const [fault, setFault] = useState(false);
  const [faultNote, setFaultNote] = useState('');
  const [ended, setEnded] = useState<{ vehicle: string | null; vehicleStatus: string | null } | null>(null);

  const go = (next: Step) => { setError(null); setStep(next); scroller.current?.scrollTo({ y: 0, animated: false }); };

  const load = useCallback(async () => {
    setError(null);
    try {
      const k = await getMyShiftKit(getSupabase());
      setKit(k);
      setMags(k.firearm?.magazines != null ? String(k.firearm.magazines) : '');
      setStep(k.firearm ? 'firearm' : k.bodycam ? 'bodycam' : k.vehicle ? 'vehicle' : 'confirm');
    } catch (e) {
      setError(errorText(e));
      setStep('confirm');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  /* ── Firearm ─────────────────────────────────────────────────────── */

  const firearm = kit?.firearm ?? null;
  const issued = firearm?.rounds_issued ?? null;
  const r = rounds === '' ? null : Number(rounds);
  const short = r === null ? 0 : roundsShort(issued, r);
  const needsNotes = short > 0 || (condition !== null && condition !== 'Clean') || !checksOk;

  const firearmError = (): string | null => {
    if (r === null) return 'Count the rounds you are handing back.';
    if (issued !== null && r > issued) return `That is more than the ${issued} rounds issued. Count again.`;
    if (mags === '') return 'Enter how many magazines you are handing back.';
    if (!unloaded) return 'Unload the firearm and clear the chamber first.';
    if (!condition) return 'Choose the firearm’s condition.';
    if (needsNotes && firearmNotes.trim().length < 3) {
      return short > 0 ? `Say what happened to the ${short} missing ${short === 1 ? 'round' : 'rounds'}.` : 'Say what is wrong in the notes.';
    }
    return null;
  };

  const submitFirearm = () => {
    const err = firearmError();
    if (err || !firearm || !condition || r === null) { setError(err); return; }
    const send = () => void run(async () => {
      const res = await returnShiftFirearm(getSupabase(), {
        firearmId: firearm.id, roundsReturned: r, magazines: Number(mags), unloaded, checksOk,
        condition: CONDITION_VALUE[condition], notes: firearmNotes.trim() || null,
      });
      setReturned({ serial: firearm.serial_number, status: res.status, short: res.short });
      go(kit?.bodycam ? 'bodycam' : kit?.vehicle ? 'vehicle' : 'confirm');
    });
    if (short > 0) {
      Alert.alert(
        `${short} ${short === 1 ? 'round' : 'rounds'} short`,
        'Your supervisor is told straight away, with your note. Hand the firearm back now?',
        [{ text: 'Count again', style: 'cancel' }, { text: 'Hand it back', style: 'destructive', onPress: send }],
      );
      return;
    }
    send();
  };

  /* ── Bodycam ──────────────────────────────────────────────────────── */

  const bodycam = kit?.bodycam ?? null;
  const camNeedsNotes = camCondition !== null && camCondition !== 'In order';

  const submitBodycam = () => {
    if (!bodycam) return;
    if (!camCondition) { setError('Choose the bodycam’s condition.'); return; }
    if (camNeedsNotes && camNotes.trim().length < 5) { setError('Say what happened to the bodycam.'); return; }
    const send = () => void run(async () => {
      const res = await returnBodycam(getSupabase(), {
        bodycamId: bodycam.id, condition: CAM_CONDITION_VALUE[camCondition], notes: camNotes.trim() || null,
      });
      setCamReturned({ serial: bodycam.serial_number, status: res.status });
      go(kit?.vehicle ? 'vehicle' : 'confirm');
    });
    if (camCondition === 'Lost') {
      Alert.alert(
        'Report the bodycam lost?',
        'Your supervisor is told straight away, with your note.',
        [{ text: 'Cancel', style: 'cancel' }, { text: 'Report lost', style: 'destructive', onPress: send }],
      );
      return;
    }
    send();
  };

  /* ── Vehicle and end ─────────────────────────────────────────────── */

  const vehicle = kit?.vehicle ?? null;
  const km = mileage === '' ? null : Number(mileage);

  const vehicleError = (): string | null => {
    if (!vehicle) return null;
    if (km === null) return 'Enter the odometer reading.';
    if (km < (vehicle.mileage ?? 0)) return `The last reading was ${vehicle.mileage} km. Check the odometer.`;
    if (fault && faultNote.trim().length < 5) return 'Describe the fault so the workshop knows what to look at.';
    return null;
  };

  const toConfirm = () => {
    const err = vehicleError();
    if (err) { setError(err); return; }
    go('confirm');
  };

  const finish = () => void run(async () => {
    const open = await refreshOpenCall();
    if (open) {
      setError(`You are still on ${open.incident_number}. File its incident report before you end your shift.`);
      return;
    }
    const res = await endShift(getSupabase(), { mileageKm: vehicle ? km : null, vehicleNote: fault ? faultNote.trim() : null });
    setEnded({ vehicle: res.vehicle, vehicleStatus: res.vehicle_status });
    await refreshDuty().catch(() => false);
    go('done');
  });

  /* ── Render ──────────────────────────────────────────────────────── */

  const steps = [firearm ? 'Firearm' : null, bodycam ? 'Bodycam' : null, vehicle ? 'Vehicle' : null, 'End'].filter(Boolean) as string[];
  const stepName = { firearm: 'Firearm', bodycam: 'Bodycam', vehicle: 'Vehicle' } as const;
  const current = step === 'firearm' || step === 'bodycam' || step === 'vehicle'
    ? Math.max(0, steps.indexOf(stepName[step]))
    : steps.length - (step === 'done' ? 0 : 1);

  if (step === 'loading') {
    return <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>;
  }

  return (
    <ScrollView ref={scroller} style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      {step !== 'done' ? <Stepper steps={steps} current={current} /> : null}

      {step === 'firearm' && firearm ? (
        <>
          <Card accent={colors.medium}>
            <Title>Hand back your firearm</Title>
            <Muted>At the counter, with the armourer or the officer in charge. Count the rounds before you enter them.</Muted>
            <View style={{ marginTop: space.md }}>
              <KeyValue label="Firearm" value={`${firearm.make} ${firearm.model}`} />
              <KeyValue label="Serial" value={firearm.serial_number} />
              <KeyValue label="Booked out" value={saTime(firearm.issued_on)} />
              <KeyValue label="Issued" value={`${issued ?? '—'} rounds · ${firearm.magazines ?? '—'} magazines`} />
            </View>
          </Card>

          <SectionLabel>Rounds and magazines</SectionLabel>
          <Card>
            <View style={{ gap: space.md }}>
              <Input label="Rounds handed back" keyboardType="number-pad" value={rounds} onChangeText={(t) => setRounds(digits(t))} maxLength={3}
                hint={short > 0 ? `${short} short of the ${issued} issued: say why below.` : issued !== null ? `${issued} were issued.` : undefined} />
              <Input label="Magazines handed back" keyboardType="number-pad" value={mags} onChangeText={(t) => setMags(digits(t))} maxLength={2} />
            </View>
          </Card>

          <SectionLabel>Safety and condition</SectionLabel>
          <Card>
            <View style={{ gap: space.sm }}>
              <CheckRow label="Unloaded and chamber cleared" checked={unloaded} onToggle={() => setUnloaded((v) => !v)} />
              <CheckRow label="Serial checked; action, safety and sights work" checked={checksOk} onToggle={() => setChecksOk((v) => !v)} />
            </View>
            <Text style={styles.fieldLabel}>CONDITION</Text>
            <Segmented options={CONDITIONS} value={condition} onChange={setCondition} />
            {condition === 'Damaged' || (condition && !checksOk) ? (
              <Muted style={{ marginTop: space.sm, color: colors.medium }}>It goes to the armourer for repair instead of back into service.</Muted>
            ) : null}
            <View style={{ marginTop: space.md }}>
              <Input label={needsNotes ? 'Notes (required)' : 'Notes'} value={firearmNotes} onChangeText={setFirearmNotes} multiline maxLength={500}
                placeholder={short > 0 ? 'e.g. 2 rounds discharged at the scene, case CAS 123/10/2026' : 'Anything the armourer should know'}
                style={{ minHeight: 72, textAlignVertical: 'top' }} />
            </View>
          </Card>

          {error ? <Banner tone="error" onDismiss={() => setError(null)}>{error}</Banner> : null}
          <Button label="Hand back firearm" icon="shield-checkmark-outline" size="lg" busy={busy} onPress={submitFirearm} />
        </>
      ) : null}

      {step === 'bodycam' && bodycam ? (
        <>
          {returned ? <Returned returned={returned} /> : null}
          <Card accent={colors.medium}>
            <Title>Hand back your bodycam</Title>
            <Muted>Put it on its dock to charge and upload today’s footage.</Muted>
            <View style={{ marginTop: space.md }}>
              <KeyValue label="Bodycam" value={bodycam.serial_number} />
              <KeyValue label="Booked out" value={saTime(bodycam.booked_at)} />
            </View>
          </Card>
          <SectionLabel>Condition</SectionLabel>
          <Card>
            <Segmented options={CAM_CONDITIONS} value={camCondition} onChange={setCamCondition} />
            {camCondition === 'Damaged' ? (
              <Muted style={{ marginTop: space.sm, color: colors.medium }}>It goes for repair and your supervisor is told.</Muted>
            ) : camCondition === 'Lost' ? (
              <Muted style={{ marginTop: space.sm, color: colors.critical }}>Your supervisor is told straight away.</Muted>
            ) : null}
            <View style={{ marginTop: space.md }}>
              <Input label={camNeedsNotes ? 'What happened (required)' : 'Notes'} value={camNotes} onChangeText={setCamNotes} multiline maxLength={500}
                placeholder={camCondition === 'Lost' ? 'e.g. Lost during a foot chase on Smith Street, CAS 45/10/2026' : 'Anything the keeper should know'}
                style={{ minHeight: 72, textAlignVertical: 'top' }} />
            </View>
          </Card>
          {error ? <Banner tone="error" onDismiss={() => setError(null)}>{error}</Banner> : null}
          <Button label="Hand back bodycam" icon="videocam-outline" size="lg" busy={busy} onPress={submitBodycam} />
        </>
      ) : null}

      {step === 'vehicle' && vehicle ? (
        <>
          {returned && !bodycam ? <Returned returned={returned} /> : null}
          {camReturned ? <CamReturned returned={camReturned} /> : null}
          <Card accent={colors.accent}>
            <Title>Hand back {vehicle.unit_number}</Title>
            <Muted>{vehicle.name}. Read the odometer before you leave the vehicle.</Muted>
            <View style={{ marginTop: space.md, gap: space.md }}>
              <Input label="Odometer (km)" keyboardType="number-pad" value={mileage} onChangeText={(t) => setMileage(digits(t))} maxLength={7}
                hint={vehicle.mileage ? `Last reading ${vehicle.mileage} km.` : undefined} />
              <CheckRow label="Something is wrong with the vehicle" checked={fault} onToggle={() => setFault((v) => !v)} />
              {fault ? (
                <Input label="What is wrong" value={faultNote} onChangeText={setFaultNote} multiline maxLength={500}
                  placeholder="e.g. Left indicator out; brakes pulling right" style={{ minHeight: 72, textAlignVertical: 'top' }}
                  hint="The vehicle goes for maintenance and your supervisor is told." />
              ) : null}
            </View>
          </Card>
          {error ? <Banner tone="error" onDismiss={() => setError(null)}>{error}</Banner> : null}
          <Button label="Continue" icon="arrow-forward" size="lg" onPress={toConfirm} />
        </>
      ) : null}

      {step === 'confirm' ? (
        <>
          {returned && !vehicle && !bodycam ? <Returned returned={returned} /> : null}
          {camReturned && !vehicle ? <CamReturned returned={camReturned} /> : null}
          <Card accent={colors.low}>
            <Title>End your shift</Title>
            <Muted>
              You go off duty and stop receiving dispatches.
              {vehicle ? ` ${vehicle.unit_number} is handed back${fault ? ' for maintenance' : ''}${km !== null ? ` at ${km} km` : ''}.` : ''}
            </Muted>
            {!kit ? <Muted style={{ marginTop: space.sm }}>Your kit could not be checked. You can still try to end the shift.</Muted> : null}
          </Card>
          {error ? <Banner tone="error" onDismiss={() => setError(null)}>{error}</Banner> : null}
          <View style={{ gap: space.sm }}>
            <Button label="End shift" icon="moon-outline" variant="success" size="lg" busy={busy} onPress={finish} />
            {vehicle ? <Button label="Back" variant="outline" disabled={busy} onPress={() => go('vehicle')} /> : null}
            {error && !kit ? <Button label="Try again" variant="outline" onPress={() => { setStep('loading'); void load(); }} /> : null}
          </View>
        </>
      ) : null}

      {step === 'done' ? (
        <Card accent={colors.low}>
          <View style={styles.doneIcon}><Ionicons name="checkmark" size={32} color="#fff" /></View>
          <Title style={{ textAlign: 'center' }}>Shift ended</Title>
          <Muted style={{ textAlign: 'center' }}>
            You are off duty.
            {returned ? ` Firearm ${returned.serial} handed back.` : ''}
            {camReturned ? ` Bodycam ${camReturned.serial} handed back.` : ''}
            {ended?.vehicle ? ` ${ended.vehicle} ${ended.vehicleStatus === 'Maintenance' ? 'is booked for maintenance' : 'is back in the pool'}.` : ''}
            {' '}Go well.
          </Muted>
          <View style={{ marginTop: space.lg, gap: space.sm }}>
            <Button label="Done" onPress={() => router.replace('/(tabs)/profile')} />
            <Button label="Sign out of this phone" icon="log-out-outline" variant="outline" onPress={() => void signOut()} />
          </View>
        </Card>
      ) : null}
    </ScrollView>
  );
}

function Returned({ returned }: { returned: { serial: string; status: string; short: number } }) {
  return (
    <Banner tone={returned.short > 0 || returned.status !== 'Available' ? 'info' : 'success'}>
      {`Firearm ${returned.serial} handed back.`}
      {returned.status === 'Maintenance' ? ' It goes to the armourer.' : ''}
      {returned.short > 0 ? ` ${returned.short} rounds short: your supervisor has been told.` : ''}
    </Banner>
  );
}

function CamReturned({ returned }: { returned: { serial: string; status: string } }) {
  return (
    <Banner tone={returned.status === 'Available' ? 'success' : 'info'}>
      {`Bodycam ${returned.serial} handed back.`}
      {returned.status === 'In repair' ? ' It goes for repair.' : returned.status === 'Lost' ? ' Reported lost: your supervisor has been told.' : ''}
    </Banner>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  container: { padding: space.lg, paddingBottom: space['3xl'], gap: space.sm },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  fieldLabel: { ...type.label, color: colors.muted, marginTop: space.md, marginBottom: space.sm },
  doneIcon: {
    width: 60, height: 60, borderRadius: radius.pill, backgroundColor: colors.low,
    alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: space.md,
  },
}));
