import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  assignVehicle, cleanupOnLogout, getEmsShiftState, listAvailableVehicles, submitEmsShiftCheck,
  submitMentalCheck, toggleDuty, type EmsAmbulance, type EmsShiftCheck,
} from '@criticom/api';
import {
  EMS_CHECK_COUNT, EMS_CONSUMABLES, EMS_EQUIPMENT, EMS_FUEL_LEVELS, EMS_STOCK, EMS_VEHICLE_CHECKS,
  emsChecklistError, emsFailedVehicle, emsOutcome, emsResumeStep, emsShortStock, emsVehicleError,
  type EmsFuelLevel, type EmsShiftStep, type EmsStock, type EmsStockKey, type EmsVehicleAnswers, type EmsVehicleKey,
} from '@criticom/db/ems-shift';
import { useAuth } from '@/lib/auth';
import { useDuty } from '@/lib/duty';
import { getSupabase } from '@/lib/supabase';
import { errorWords } from '@/lib/offline-cache-policy';
import { READINESS_ITEMS } from '@/lib/inspection-187c';
import { newEntryId } from '@/lib/outbox-policy';
import { colors, makeStyles, radius, space } from '@/lib/theme';
import { Banner, Input, KeyValue, Stepper } from './ui';
import { HikTechLogo } from './hiktech-logo';
import { FireButton, FireCheck } from './fire-ui';

/**
 * EMS start of shift — the V4 flow (readiness → ambulance → vehicle checklist
 * → inventory check → "does the vehicle require cleaning?") in the shared
 * look. Paramedics carry phones and tablets, so the questions, ambulances and
 * the two stock columns sit side by side on a wide screen and stack on a phone.
 */
const STEPS = ['Welcome', 'Readiness', 'Ambulance', 'Vehicle', 'Stock'];
const STEP_NUMBER: Record<EmsShiftStep, number> = {
  intro: 0, readiness: 1, stood_down: 1, ambulance: 2, vehicle: 3, stock: 4, off_road: 4, stock_short: 4, complete: 4,
};
type ReadinessKey = (typeof READINESS_ITEMS)[number][0];
type EmsState = Awaited<ReturnType<typeof getEmsShiftState>>;
const errorText = (error: unknown) => errorWords(error, 'Unable to connect. Check your connection and retry.');
const WIDE = 700;

const vehicleOf = (c: EmsShiftCheck): EmsVehicleAnswers =>
  Object.fromEntries(EMS_VEHICLE_CHECKS.map(([key]) => [key, c[key]])) as EmsVehicleAnswers;
const stockOf = (c: EmsShiftCheck): EmsStock =>
  Object.fromEntries(EMS_STOCK.map(([key]) => [key, c[key] === true])) as EmsStock;
const outcomeOf = (c: EmsShiftCheck) => emsOutcome(vehicleOf(c), stockOf(c), c.requires_cleaning === true);

export function EmsShift({ gated = false }: { gated?: boolean }) {
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE;
  const { session, fullName } = useAuth();
  const { refresh: refreshDuty } = useDuty();
  const scroll = useRef<ScrollView>(null);
  const working = useRef(false);
  // The id of the record this form files; a retry after a lost response finds it instead of filing twice.
  const attempt = useRef(newEntryId());
  const [step, setStep] = useState<EmsShiftStep | null>(null);
  const [state, setState] = useState<EmsState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [mental, setMental] = useState<Partial<Record<ReadinessKey, boolean>>>({});
  const [comments, setComments] = useState('');
  const [ambulances, setAmbulances] = useState<EmsAmbulance[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [answers, setAnswers] = useState<EmsVehicleAnswers>({});
  const [fuel, setFuel] = useState<EmsFuelLevel | null>(null);
  const [stock, setStock] = useState<EmsStock>({});
  const [notes, setNotes] = useState('');
  const [declared, setDeclared] = useState(false);
  const [asking, setAsking] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [record, setRecord] = useState<EmsShiftCheck | null>(null);
  const [restored, setRestored] = useState<string | null>(null);

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const keyFor = (id: string) => `ems-shift:v1:${session?.user.app_metadata?.tenant_id ?? ''}:${session?.user.id}:${today}:${id}`;
  const draftKey = state?.ambulance ? keyFor(state.ambulance.id) : null;
  const go = (next: EmsShiftStep) => {
    setStep(next); setError(null); setInvalid(false);
    scroll.current?.scrollTo({ y: 0, animated: false });
  };

  const load = useCallback(async () => {
    setError(null);
    try {
      const current = await getEmsShiftState(getSupabase());
      setState(current); setRecord(current.check);
      let next = emsResumeStep({ readiness: current.readiness, vehicle: current.vehicle, hasReadinessRecord: !!current.mental, hasAmbulance: !!current.ambulance });
      if (next === 'ambulance') setAmbulances(await listAvailableVehicles(getSupabase(), 'Medical'));
      if (next === 'vehicle' && current.ambulance) {
        setAnswers({}); setFuel(null); setStock({}); setNotes(''); setDeclared(false); setRestored(null);
        attempt.current = newEntryId();
        const last = current.check?.apparatus_id === current.ambulance.id ? current.check : null;
        if (last && outcomeOf(last) === 'stock_short') {
          // Already checked today and short of stock: keep what was filed and go straight back to the stock.
          setAnswers(vehicleOf(last)); setFuel(EMS_FUEL_LEVELS.includes(last.fuel_level as EmsFuelLevel) ? last.fuel_level as EmsFuelLevel : null);
          setStock(stockOf(last));
          setRestored(`Your last check (${last.inspection_ref}) found stock short: ${emsShortStock(stockOf(last)).join(', ')}. Restock, tick what is now on board and file again.`);
          next = 'stock';
        } else {
          try {
            const draft = JSON.parse(await AsyncStorage.getItem(keyFor(current.ambulance.id)) ?? 'null');
            if (draft && typeof draft === 'object') {
              const saved: EmsVehicleAnswers = {};
              for (const [key] of EMS_VEHICLE_CHECKS) if (typeof draft.answers?.[key] === 'boolean') saved[key] = draft.answers[key];
              const ticked: EmsStock = {};
              for (const [key] of EMS_STOCK) if (draft.stock?.[key] === true) ticked[key] = true;
              setAnswers(saved); setStock(ticked);
              if (EMS_FUEL_LEVELS.includes(draft.fuel)) setFuel(draft.fuel);
              if (typeof draft.notes === 'string') setNotes(draft.notes.slice(0, 4000));
              if (Object.keys(saved).length || Object.keys(ticked).length) setRestored('Your saved draft has been restored. Verify every answer before filing.');
            }
          } catch { /* A draft is convenience only; server clearance never uses it. */ }
        }
      }
      setStep(next);
    } catch (e) { setError(errorText(e)); }
  }, [session?.user.id, session?.user.app_metadata?.tenant_id, today]);

  useEffect(() => { if (gated) void load(); }, [gated, load]);
  // A validation message goes as soon as the paramedic changes an answer.
  useEffect(() => { setError(null); }, [mental, comments, answers, fuel, stock, notes, declared]);
  useFocusEffect(useCallback(() => { if (!gated) void load(); }, [gated, load]));
  useEffect(() => {
    if (!draftKey || (step !== 'vehicle' && step !== 'stock')) return;
    const timer = setTimeout(() => { void AsyncStorage.setItem(draftKey, JSON.stringify({ answers, fuel, stock, notes })).catch(() => {}); }, 200);
    return () => clearTimeout(timer);
  }, [draftKey, answers, fuel, stock, notes, step]);

  const run = async (action: () => Promise<void>) => {
    if (working.current) return;
    working.current = true; setBusy(true); setError(null);
    try { await action(); } catch (e) { setError(errorText(e)); }
    finally { working.current = false; setBusy(false); }
  };
  const signOut = () => void run(async () => {
    await cleanupOnLogout(getSupabase());
    await getSupabase().auth.signOut();
    router.replace('/login');
  });
  const submitReadiness = () => {
    if (READINESS_ITEMS.some(([key]) => typeof mental[key] !== 'boolean')) {
      setInvalid(true); setError('Answer all six readiness questions.'); return;
    }
    if (READINESS_ITEMS.some(([key]) => !mental[key]) && !comments.trim()) {
      setInvalid(true); setError('Add a note about the readiness concern for your shift supervisor.'); return;
    }
    void run(async () => {
      const { passed } = await submitMentalCheck(getSupabase(), {
        silo: 'Medical', ...(mental as Record<ReadinessKey, boolean>), comments: comments.trim(),
      });
      if (!passed) { go('stood_down'); return; }
      // Re-read after saving, so a failed list request can be retried without repeating the declaration.
      await load();
    });
  };
  const confirmAmbulance = () => {
    if (!picked) return;
    void run(async () => {
      await assignVehicle(getSupabase(), picked);
      setPicked(null); await load();
    });
  };
  const toStock = () => {
    const problem = emsVehicleError(answers, fuel);
    if (problem) { setInvalid(true); setError(problem); return; }
    go('stock');
  };
  const confirmStock = () => {
    const problem = emsChecklistError(answers, fuel, stock, notes, declared);
    if (problem) { setInvalid(true); setError(problem); return; }
    setModalError(null); setAsking(true);
  };
  const file = (requiresCleaning: boolean) => {
    const ambulance = state?.ambulance;
    if (!ambulance || !fuel) return;
    void (async () => {
      if (working.current) return;
      working.current = true; setBusy(true); setModalError(null);
      try {
        // If a previous response was lost, pick up the record that was filed instead of filing twice.
        const current = await getEmsShiftState(getSupabase());
        const filed = current.check?.id === attempt.current ? current.check : null;
        const saved = filed ?? await submitEmsShiftCheck(getSupabase(), {
          id: attempt.current,
          ...(answers as Record<EmsVehicleKey, boolean>),
          ...(Object.fromEntries(EMS_STOCK.map(([key]) => [key, stock[key] === true])) as Record<EmsStockKey, boolean>),
          apparatus_id: ambulance.id, fuel_level: fuel, requires_cleaning: requiresCleaning,
          fault_remarks: notes.trim(), declaration_accepted: declared,
        });
        setRecord(saved); setAsking(false);
        if (draftKey) await AsyncStorage.removeItem(draftKey).catch(() => {});
        const outcome = outcomeOf(saved);
        go(outcome === 'cleared' ? 'complete' : outcome);
      } catch (e) { setModalError(errorText(e)); }
      finally { working.current = false; setBusy(false); }
    })();
  };
  const recheck = () => {
    setDeclared(false); setRestored(null); attempt.current = newEntryId();
    go('stock');
  };
  const goOnDuty = () => void run(async () => {
    await toggleDuty(getSupabase(), { onDuty: true });
    const cleared = await refreshDuty();
    if (!cleared) throw new Error('Your checks are saved, but clearance could not be verified. Reconnect and retry.');
    router.replace('/');
  });

  const failed = emsFailedVehicle(answers);
  const short = emsShortStock(stock);
  const answered = EMS_VEHICLE_CHECKS.filter(([key]) => typeof answers[key] === 'boolean').length;
  const ticked = EMS_STOCK.length - short.length;
  const officerName = state?.personnel ? [state.personnel.rank, state.personnel.first_name, state.personnel.last_name].filter(Boolean).join(' ') : fullName;
  const index = step ? STEP_NUMBER[step] : 0;
  const unit = state?.ambulance?.unit_number ?? 'the ambulance';
  const cell = wide ? styles.half : null;

  const stockColumn = (title: string, icon: keyof typeof Ionicons.glyphMap, items: readonly (readonly [EmsStockKey, string])[]) => (
    <View style={[styles.stockColumn, cell]}>
      <View style={styles.columnHead}><Ionicons name={icon} size={18} color={colors.accent} /><Text style={styles.sectionTitle}>{title}</Text></View>
      {items.map(([key, label]) => {
        const on = stock[key] === true;
        return (
          <Pressable key={key} accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked: on, disabled: busy }}
            aria-checked={on} disabled={busy} onPress={() => setStock((s) => ({ ...s, [key]: !on }))}
            style={[styles.tile, on && styles.tileOn, invalid && !on && !notes.trim() && styles.tileWarn]}>
            <Text style={styles.tileText}>{label}</Text>
            <Ionicons name={on ? 'checkbox' : 'square-outline'} size={24} color={on ? colors.low : colors.muted} />
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <View style={styles.screen}>
      <ScrollView ref={scroll} keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.container, gated && { paddingTop: insets.top + space.lg }, { paddingBottom: Math.max(insets.bottom, 16) + 32 }]}>
        <View style={styles.topbar}>
          <HikTechLogo height={15} />
          {gated ? <Pressable accessibilityRole="button" onPress={signOut} disabled={busy} hitSlop={8} style={styles.headerAction}><Text style={styles.headerActionText}>Sign out</Text><Ionicons name="log-out-outline" size={16} color={colors.textDim} /></Pressable>
            : <Pressable accessibilityRole="button" onPress={() => router.replace('/')} hitSlop={8} style={styles.headerAction}><Ionicons name="arrow-back" size={16} color={colors.textDim} /><Text style={styles.headerActionText}>Dashboard</Text></Pressable>}
        </View>
        <View style={styles.identity}><Ionicons name="pulse" size={18} color={colors.accent} /><Text style={styles.identityText}>EMERGENCY MEDICAL SERVICES</Text></View>
        {step && step !== 'intro' ? <View style={styles.progress} accessible accessibilityLabel={`Step ${index + 1} of 5: ${STEPS[index]}`}>
          <Stepper steps={STEPS} current={index} />
        </View> : null}

        {!step ? <View style={styles.panel}>
          {error ? <><Banner tone="error">{error}</Banner><FireButton label="Retry shift status" onPress={() => void run(load)} busy={busy} icon="refresh" /></> : <><ActivityIndicator color={colors.accent} /><Text style={styles.body}>Checking your EMS shift…</Text></>}
        </View> : null}

        {step === 'intro' ? <View style={styles.panel}>
          <View style={styles.introIcon}><Ionicons name="fitness-outline" size={34} color={colors.accent} /></View>
          <Text style={styles.eyebrow}>STEP 1 OF 5 · START OF SHIFT</Text>
          <Text style={styles.title}>Ready to respond.</Text>
          <Text style={styles.body}>Begin your shift with a readiness assessment, sign onto an ambulance, then check the vehicle and its stock.</Text>
          <View style={[styles.introList, wide && styles.introListWide]}>{([['person-outline', 'Personal readiness'], ['medkit-outline', 'Ambulance & vehicle checks'], ['clipboard-outline', 'Stock & sanitisation']] as const).map(([icon, label]) => <View key={label} style={styles.introItem}><Ionicons name={icon} size={20} color={colors.accent} /><Text style={styles.introLabel}>{label}</Text></View>)}</View>
          <Text style={styles.caption}>You go on duty once your checks are complete.</Text>
          <FireButton label="Begin shift checks" onPress={() => go('readiness')} icon="play-circle-outline" />
        </View> : null}

        {step === 'readiness' ? <View style={styles.panel}>
          <Text style={styles.eyebrow}>STEP 2 OF 5 · YOU</Text><Text style={styles.title}>Readiness assessment</Text>
          <Text style={styles.body}>Take a moment to check in. Answer each question honestly before starting operational duty.</Text>
          <View style={styles.grid}>
            {READINESS_ITEMS.map(([key, label]) => <View key={key} style={[styles.full, cell]}><FireCheck label={label} value={mental[key]} onChange={(value) => setMental((m) => ({ ...m, [key]: value }))} disabled={busy} invalid={invalid} /></View>)}
          </View>
          <Input label="Readiness notes" accessibilityLabel="Readiness notes" hint="Required if you answer No. Your declaration is recorded for command review." multiline maxLength={4000} value={comments} onChangeText={setComments} editable={!busy} />
          <FireButton label="Confirm readiness" onPress={submitReadiness} busy={busy} />
        </View> : null}

        {step === 'stood_down' ? <View style={styles.panel}>
          <Ionicons name="heart-outline" size={40} color={colors.medium} /><Text style={styles.title}>Readiness needs attention</Text>
          <Text style={styles.body}>Your readiness declaration is on record. You are not cleared to go on duty. Contact your shift supervisor before continuing.</Text>
          <FireButton label="Check clearance again" secondary onPress={() => void run(load)} busy={busy} icon="refresh" />
        </View> : null}

        {step === 'ambulance' ? <View style={styles.panel}>
          <Text style={styles.eyebrow}>STEP 3 OF 5 · YOUR UNIT</Text><Text style={styles.title}>Select ambulance</Text><Text style={styles.body}>Choose the available ambulance you are signing onto for this shift.</Text>
          {ambulances.length === 0 ? <View style={styles.empty}><Ionicons name="medkit-outline" size={34} color={colors.muted} /><Text style={styles.body}>No ambulances are available. Ask your shift supervisor to release or register one.</Text></View> : <View style={styles.grid}>{ambulances.map((a) => <Pressable key={a.id} disabled={busy} accessibilityRole="radio" accessibilityLabel={`${a.unit_number} — ${a.name}`} accessibilityState={{ checked: picked === a.id }} aria-checked={picked === a.id} onPress={() => setPicked(a.id)} style={[styles.unit, styles.full, cell, picked === a.id && styles.selected]}>
            <View style={styles.unitIcon}><Ionicons name="medkit-outline" size={28} color={colors.accent} /></View><View style={{ flex: 1 }}><Text style={styles.unitNumber}>{a.unit_number}</Text><Text style={styles.unitName}>{a.name}</Text><Text style={styles.caption}>{[a.type, a.license_plate, a.station_number].filter(Boolean).join(' · ')}</Text></View><Ionicons name={picked === a.id ? 'checkmark-circle' : 'ellipse-outline'} size={23} color={picked === a.id ? colors.accent : colors.muted} />
          </Pressable>)}</View>}
          <FireButton label="Confirm ambulance" onPress={confirmAmbulance} disabled={!picked} busy={busy} />
          <FireButton label="Refresh available ambulances" secondary icon="refresh" onPress={() => void run(load)} busy={busy} />
        </View> : null}

        {step === 'vehicle' ? <View style={styles.panel}>
          <Text style={styles.eyebrow}>STEP 4 OF 5 · {unit}</Text><Text style={styles.title}>Vehicle checks</Text><Text style={styles.body}>{state?.ambulance?.name} · {answered} of {EMS_VEHICLE_CHECKS.length} checks answered</Text>
          {restored ? <Text style={styles.caption}>{restored}</Text> : null}
          <Text style={styles.sectionTitle}>Fuel level</Text>
          <View style={styles.fuelRow}>{EMS_FUEL_LEVELS.map((level) => <Pressable key={level} accessibilityRole="radio" accessibilityLabel={`Fuel ${level}`} accessibilityState={{ checked: fuel === level }} aria-checked={fuel === level} disabled={busy} onPress={() => setFuel(level)} style={[styles.fuel, fuel === level && styles.selected, invalid && !fuel && { borderColor: colors.critical }]}><Ionicons name="speedometer-outline" size={17} color={fuel === level ? colors.accent : colors.muted} /><Text style={styles.unitName}>{level}</Text></Pressable>)}</View>
          {fuel === '1/4' ? <Text style={styles.warning}>Low fuel recorded. Refuel before your first incident.</Text> : null}
          <Text style={styles.sectionTitle}>Vehicle</Text>
          <View style={styles.grid}>
            {EMS_VEHICLE_CHECKS.map(([key, label]) => <View key={key} style={[styles.full, cell]}><FireCheck label={label} value={answers[key]} onChange={(value) => setAnswers((a) => ({ ...a, [key]: value }))} disabled={busy} invalid={invalid} /></View>)}
          </View>
          {failed.length ? <Text style={styles.warning}>A failed vehicle check takes the ambulance off the road when you file. Carry on to the stock check and describe the fault there.</Text> : null}
          <FireButton label="Next: stock check" onPress={toStock} busy={busy} />
        </View> : null}

        {step === 'stock' ? <View style={styles.panel}>
          <Text style={styles.eyebrow}>STEP 5 OF 5 · {unit}</Text><Text style={styles.title}>Inventory check</Text>
          <Text style={styles.body}>Verify the ambulance stock before going on duty. Tick each item that is on board and ready · {ticked} of {EMS_STOCK.length} confirmed</Text>
          {restored ? <View style={styles.noticeBox}><Ionicons name="information-circle-outline" size={18} color={colors.accent} /><Text style={[styles.body, { flex: 1 }]}>{restored}</Text></View> : null}
          <View style={styles.columns}>
            {stockColumn('Equipment', 'pulse-outline', EMS_EQUIPMENT)}
            {stockColumn('Consumables', 'bandage-outline', EMS_CONSUMABLES)}
          </View>
          {short.length || failed.length ? <View style={styles.failureBox}>
            <Text style={styles.warning}>{failed.length ? 'The ambulance will go off the road' : 'You will not be cleared until this is restocked'}</Text>
            {[...failed, ...short.map((s) => `${s} — not confirmed`)].map((label) => <Text key={label} style={styles.body}>• {label}</Text>)}
          </View> : null}
          <Input label={failed.length || short.length ? 'What failed or is missing — required' : 'Notes'} accessibilityLabel="Notes" multiline maxLength={4000} value={notes} onChangeText={setNotes} editable={!busy} placeholder="Describe any fault or missing stock" />
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: declared }} aria-checked={declared} disabled={busy} onPress={() => setDeclared((d) => !d)} style={styles.declaration}>
            <Ionicons name={declared ? 'checkbox' : 'square-outline'} size={25} color={declared ? colors.accent : invalid ? colors.critical : colors.muted} /><Text style={styles.declarationText}>I checked this ambulance and its stock myself, and the answers above are accurate.</Text>
          </Pressable>
          <FireButton label="Confirm stock & finish" icon="checkmark-done" onPress={confirmStock} busy={busy} />
          <FireButton label="Back to vehicle checks" secondary icon="arrow-back" onPress={() => go('vehicle')} disabled={busy} />
        </View> : null}

        {step === 'off_road' ? <View style={styles.panel}>
          <Ionicons name="warning-outline" size={42} color={colors.critical} /><Text style={styles.title}>Ambulance off the road</Text>
          <Text style={styles.body}>
            Check {record?.inspection_ref} is filed. {record?.requires_cleaning ? `${unit} is marked off road for cleaning` : `${unit} failed a vehicle check and is out of service`}
            {record?.requires_cleaning && record && emsFailedVehicle(vehicleOf(record)).length ? ', with vehicle faults reported' : ''}. Command has been told and you remain off duty.
          </Text>
          <Text style={styles.body}>{record?.requires_cleaning ? 'Once it has been cleaned, fleet control returns it to service.' : 'Speak to your shift supervisor about the fault.'} Choose another available ambulance to continue.</Text>
          <FireButton label="Choose another ambulance" icon="medkit-outline" onPress={() => void run(load)} busy={busy} />
        </View> : null}

        {step === 'stock_short' ? <View style={styles.panel}>
          <Ionicons name="cube-outline" size={42} color={colors.medium} /><Text style={styles.title}>Restock before duty</Text>
          <Text style={styles.body}>Check {record?.inspection_ref} is filed and command has been told. {unit} stays with you, but you are not cleared until its stock is complete.</Text>
          <View style={styles.failureBox}>{(record ? emsShortStock(stockOf(record)) : short).map((label) => <Text key={label} style={styles.body}>• {label}</Text>)}</View>
          <FireButton label="I've restocked — check again" icon="refresh" onPress={recheck} busy={busy} />
        </View> : null}

        {step === 'complete' ? <View style={styles.panel}>
          <View style={styles.completeIcon}><Ionicons name="shield-checkmark" size={36} color={colors.low} /></View>
          <Text style={styles.eyebrow}>START OF SHIFT · FILED</Text><Text style={styles.title}>Your checks are complete.</Text>
          <Text style={styles.body}>Your readiness assessment and the ambulance and stock check are on record. The ambulance is clean and ready.</Text>
          <View style={wide ? styles.kvWide : null}>
            <KeyValue label="Reference" value={record?.inspection_ref ?? '—'} /><KeyValue label="Paramedic" value={record?.inspector_name ?? officerName} /><KeyValue label="Ambulance" value={state?.ambulance?.unit_number ?? '—'} /><KeyValue label="Fuel" value={record?.fuel_level ?? '—'} />
            {record ? <KeyValue label="Filed (SAST)" value={new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(record.checked_at))} /> : null}
          </View>
          <Text style={styles.success}>6 readiness checks · {EMS_CHECK_COUNT} vehicle & stock checks · sanitisation</Text>
          <FireButton label={state?.personnel.is_on_duty ? 'Go to dashboard' : 'Go on duty & open dashboard'} icon="pulse" onPress={goOnDuty} busy={busy} />
        </View> : null}
        {step && error ? <View style={{ gap: 10 }}><Banner tone="error">{error}</Banner>{step === 'readiness' || step === 'vehicle' || step === 'stock' ? null : <FireButton label="Reload saved shift progress" secondary icon="refresh" onPress={() => void run(load)} busy={busy} />}</View> : null}
        <Text style={styles.footer}>EMERGENCY MEDICAL SERVICES · START OF SHIFT</Text>
      </ScrollView>

      {/* V4's last question, asked before the record is filed. Unmounted rather
          than hidden, so it goes at once instead of fading over the result. */}
      {asking ? <Modal visible transparent animationType="fade" onRequestClose={() => { if (!busy) setAsking(false); }}>
        <View style={styles.backdrop}>
          <View style={styles.modal} accessibilityViewIsModal>
            <View style={styles.modalHead}>
              <Ionicons name="water" size={20} color={colors.medium} />
              <Text style={styles.modalTitle}>Sanitisation check</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={10} disabled={busy} onPress={() => setAsking(false)}><Ionicons name="close" size={22} color={colors.textDim} /></Pressable>
            </View>
            <Text style={styles.question}>Does the ambulance require cleaning?</Text>
            <Text style={[styles.body, { textAlign: 'center' }]}>Make sure the ambulance interior is sterile before accepting new incidents.</Text>
            {modalError ? <Banner tone="error">{modalError}</Banner> : null}
            <Pressable accessibilityRole="button" accessibilityLabel="Yes, mark off road for cleaning" disabled={busy} onPress={() => file(true)} style={({ pressed }) => [styles.offRoad, (pressed || busy) && { opacity: 0.55 }]}>
              <Ionicons name="trash-outline" size={18} color={colors.critical} /><Text style={styles.offRoadText}>Yes — mark off road for cleaning</Text>
            </Pressable>
            <FireButton label="No — ready for duty" icon="checkmark-circle" onPress={() => file(false)} busy={busy} />
          </View>
        </View>
      </Modal> : null}
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, overflow: 'hidden' },
  container: { padding: space.lg, width: '100%', maxWidth: 880, alignSelf: 'center', flexGrow: 1 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 25 },
  headerAction: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 7 },
  headerActionText: { color: colors.textDim, fontWeight: '600', fontSize: 12 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 18 },
  identityText: { fontSize: 11, fontWeight: '800', letterSpacing: 1.8, color: colors.text },
  progress: { marginBottom: space.md },
  panel: { backgroundColor: colors.bgCard, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.panelBorder, padding: space.lg, gap: 14, marginBottom: space.lg, overflow: 'hidden' },
  introIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  title: { color: colors.text, fontSize: 28, lineHeight: 34, fontWeight: '800', letterSpacing: -0.6 },
  body: { color: colors.textDim, fontSize: 14, lineHeight: 22 },
  caption: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  introList: { gap: 16, paddingVertical: 12 },
  introListWide: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 28 },
  introItem: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  introLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },

  // Two columns on a tablet, one on a phone.
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.lg, rowGap: 10 },
  full: { width: '100%' },
  half: { width: '48%', flexGrow: 1 },
  columns: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.lg, rowGap: space.lg },

  empty: { alignItems: 'center', padding: 20, gap: 10, borderRadius: radius.md, borderStyle: 'dashed', borderWidth: 1, borderColor: colors.borderStrong },
  unit: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.lg, backgroundColor: colors.bgElevated },
  selected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  unitIcon: { width: 45, height: 48, alignItems: 'center', justifyContent: 'center' },
  unitNumber: { color: colors.text, fontSize: 17, fontWeight: '800', marginBottom: 3 },
  unitName: { color: colors.textDim, fontSize: 13, lineHeight: 20 },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  fuelRow: { flexDirection: 'row', gap: 8 },
  fuel: { flex: 1, alignItems: 'center', paddingVertical: 12, gap: 5, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.bgElevated },

  stockColumn: { width: '100%', gap: 10 },
  columnHead: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingBottom: 8, borderBottomWidth: 1, borderColor: colors.border },
  tile: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.bgElevated },
  tileOn: { borderColor: colors.low, backgroundColor: colors.lowSoft },
  tileWarn: { borderColor: colors.critical },
  tileText: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '700', lineHeight: 21 },

  noticeBox: { flexDirection: 'row', gap: 8, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.accentSoft },
  warning: { color: colors.high, fontSize: 13, lineHeight: 21, fontWeight: '600' },
  success: { color: colors.low, fontSize: 13, lineHeight: 21, fontWeight: '600' },
  failureBox: { padding: 14, borderWidth: 1, borderColor: `${colors.critical}55`, backgroundColor: colors.criticalSoft, borderRadius: radius.md, gap: 6 },
  declaration: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10 },
  declarationText: { flex: 1, color: colors.textDim, fontSize: 13, lineHeight: 21 },
  completeIcon: { width: 68, height: 68, borderRadius: 34, backgroundColor: colors.lowSoft, justifyContent: 'center', alignItems: 'center' },
  kvWide: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.xl },
  footer: { color: colors.muted, fontSize: 9, fontWeight: '700', letterSpacing: 1.4, textAlign: 'center', marginTop: 10 },

  backdrop: { flex: 1, backgroundColor: 'rgba(5,5,16,0.72)', alignItems: 'center', justifyContent: 'center', padding: space.lg },
  modal: { width: '100%', maxWidth: 480, backgroundColor: colors.bgCard, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.panelBorder, padding: space.lg, gap: 14 },
  modalHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modalTitle: { flex: 1, color: colors.text, fontSize: 17, fontWeight: '800' },
  question: { color: colors.text, fontSize: 21, lineHeight: 28, fontWeight: '800', textAlign: 'center', marginTop: 6 },
  offRoad: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: space.md },
  offRoadText: { color: colors.critical, fontSize: 14, fontWeight: '800', textAlign: 'center', flexShrink: 1 },
}));
