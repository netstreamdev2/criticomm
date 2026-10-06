import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { assignVehicle, cleanupOnLogout, getFireShiftState, listAvailableVehicles, submitFireInspection, submitMentalCheck, toggleDuty, type FireAppliance, type FireInspection } from '@criticom/api';
import { FIRE_CHECKS, FIRE_EQUIPMENT, FIRE_ESSENTIALS, FIRE_FUEL_LEVELS, fireChecklistError, fireChecksPassed, fireFailedChecks, fireResumeStep, type FireAnswers, type FireCheckKey, type FireFuelLevel, type FireShiftStep } from '@criticom/db/fire-shift';
import { useAuth } from '@/lib/auth';
import { useDuty } from '@/lib/duty';
import { getSupabase } from '@/lib/supabase';
import { READINESS_ITEMS } from '@/lib/inspection-187c';
import { colors, makeStyles, radius, space } from '@/lib/theme';
import { Banner, Input, KeyValue } from './ui';
import { HikTechLogo } from './hiktech-logo';
import { SignaturePad } from './signature-pad';
import { FireBackdrop, FireButton, FireCheck, FIRE_ORANGE, FIRE_PHOTO } from './fire-ui';

const STEPS = ['Welcome', 'Readiness', 'Appliance', 'Checks', 'Sign on'];
const STEP_NUMBER: Record<FireShiftStep, number> = { intro: 0, readiness: 1, stood_down: 1, appliance: 2, checks: 3, sign: 4, appliance_failed: 3, complete: 4 };
type ReadinessKey = (typeof READINESS_ITEMS)[number][0];
type FireState = Awaited<ReturnType<typeof getFireShiftState>>;
const errorText = (error: unknown) => (error as { message?: string })?.message ?? 'Unable to connect. Check your connection and retry.';

export function FireShift({ gated = false }: { gated?: boolean }) {
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, fullName } = useAuth();
  const { refresh: refreshDuty } = useDuty();
  const scroll = useRef<ScrollView>(null);
  const working = useRef(false);
  const [step, setStep] = useState<FireShiftStep | null>(null);
  const [state, setState] = useState<FireState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [mental, setMental] = useState<Partial<Record<ReadinessKey, boolean>>>({});
  const [comments, setComments] = useState('');
  const [appliances, setAppliances] = useState<FireAppliance[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [answers, setAnswers] = useState<FireAnswers>({});
  const [fuel, setFuel] = useState<FireFuelLevel | null>(null);
  const [notes, setNotes] = useState('');
  const [declared, setDeclared] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [record, setRecord] = useState<FireInspection | null>(null);
  const [restored, setRestored] = useState(false);

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const keyFor = (id: string) => `fire-shift:v1:${session?.user.app_metadata?.tenant_id ?? ''}:${session?.user.id}:${today}:${id}`;
  const draftKey = state?.appliance ? keyFor(state.appliance.id) : null;
  const go = (next: FireShiftStep) => {
    setStep(next); setError(null); setInvalid(false);
    scroll.current?.scrollTo({ y: 0, animated: false });
  };

  const load = useCallback(async () => {
    setError(null);
    try {
      const current = await getFireShiftState(getSupabase());
      setState(current); setRecord(current.inspection);
      const next = fireResumeStep({ readiness: current.readiness, vehicle: current.vehicle, hasReadinessRecord: !!current.mental, hasAppliance: !!current.appliance });
      if (next === 'appliance') setAppliances(await listAvailableVehicles(getSupabase(), 'MetroFire'));
      if (next === 'checks' && current.appliance) {
        setAnswers({}); setFuel(null); setNotes(''); setSignature(null); setDeclared(false); setRestored(false);
        try {
          const draft = JSON.parse(await AsyncStorage.getItem(keyFor(current.appliance.id)) ?? 'null');
          if (draft && typeof draft === 'object') {
            const saved: FireAnswers = {};
            for (const [key] of FIRE_CHECKS) if (typeof draft.answers?.[key] === 'boolean') saved[key] = draft.answers[key];
            setAnswers(saved);
            if (FIRE_FUEL_LEVELS.includes(draft.fuel)) setFuel(draft.fuel);
            if (typeof draft.notes === 'string') setNotes(draft.notes.slice(0, 4000));
            setRestored(Object.keys(saved).length > 0);
          }
        } catch { /* A draft is convenience only; server clearance never uses it. */ }
      }
      setStep(next);
    } catch (e) { setError(errorText(e)); }
  }, [session?.user.id, session?.user.app_metadata?.tenant_id, today]);

  useEffect(() => { if (gated) void load(); }, [gated, load]);
  useFocusEffect(useCallback(() => { if (!gated) void load(); }, [gated, load]));
  useEffect(() => {
    if (!draftKey || (step !== 'checks' && step !== 'sign')) return;
    const timer = setTimeout(() => { void AsyncStorage.setItem(draftKey, JSON.stringify({ answers, fuel, notes })).catch(() => {}); }, 200);
    return () => clearTimeout(timer);
  }, [draftKey, answers, fuel, notes, step]);

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
      setInvalid(true); setError('Add a note about the readiness concern for your station officer.'); return;
    }
    void run(async () => {
      const { passed } = await submitMentalCheck(getSupabase(), {
        silo: 'MetroFire', ...(mental as Record<ReadinessKey, boolean>), comments: comments.trim(),
      });
      if (!passed) { go('stood_down'); return; }
      // Re-read after saving, so a failed list request can be retried without repeating the declaration.
      await load();
    });
  };
  const confirmAppliance = () => {
    if (!picked) return;
    void run(async () => {
      await assignVehicle(getSupabase(), picked);
      setPicked(null); await load();
    });
  };
  const review = () => {
    const problem = fireChecklistError(answers, fuel, notes);
    if (problem) { setInvalid(true); setError(problem); return; }
    setSignature(null); setDeclared(false); go('sign');
  };
  const fileInspection = () => {
    if (!state?.appliance || !fuel) return;
    const problem = fireChecklistError(answers, fuel, notes);
    if (problem) { setError(problem); return; }
    if (!declared || !signature) { setError('Confirm your declaration and add your signature.'); return; }
    void run(async () => {
      // If a previous response was lost, resume the existing signed record before submitting again.
      const current = await getFireShiftState(getSupabase());
      if (current.vehicle && current.inspection?.apparatus_id === state.appliance?.id) {
        setRecord(current.inspection); setState(current); go('complete'); return;
      }
      const saved = await submitFireInspection(getSupabase(), {
        ...(answers as Record<FireCheckKey, boolean>), apparatus_id: state.appliance!.id,
        fuel_level: fuel, fault_remarks: notes.trim(), declaration_accepted: declared, signature_svg: signature,
      });
      setRecord(saved);
      go(fireChecksPassed(answers) ? 'complete' : 'appliance_failed');
      if (draftKey) await AsyncStorage.removeItem(draftKey).catch(() => {});
    });
  };
  const goOnDuty = () => void run(async () => {
    await toggleDuty(getSupabase(), { onDuty: true });
    const cleared = await refreshDuty();
    if (!cleared) throw new Error('Your checks are saved, but clearance could not be verified. Reconnect and retry.');
    router.replace('/');
  });

  const failed = fireFailedChecks(answers);
  const completed = FIRE_CHECKS.filter(([key]) => typeof answers[key] === 'boolean').length;
  const officerName = state?.personnel ? [state.personnel.rank, state.personnel.first_name, state.personnel.last_name].filter(Boolean).join(' ') : fullName;
  const index = step ? STEP_NUMBER[step] : 0;

  return (
    <View style={styles.screen}>
      <FireBackdrop />
      <ScrollView ref={scroll} scrollEnabled={!drawing} keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.container, gated && { paddingTop: insets.top + space.lg }, { paddingBottom: Math.max(insets.bottom, 16) + 32 }]}>
        <View style={styles.topbar}>
          <HikTechLogo height={15} />
          {gated ? <Pressable accessibilityRole="button" onPress={signOut} disabled={busy} hitSlop={8} style={styles.headerAction}><Text style={styles.headerActionText}>Sign out</Text><Ionicons name="log-out-outline" size={16} color={colors.textDim} /></Pressable>
            : <Pressable accessibilityRole="button" onPress={() => router.replace('/')} hitSlop={8} style={styles.headerAction}><Ionicons name="arrow-back" size={16} color={colors.textDim} /><Text style={styles.headerActionText}>Dashboard</Text></Pressable>}
        </View>
        <View style={styles.identity}><Ionicons name="flame" size={18} color={FIRE_ORANGE} /><Text style={styles.identityText}>METRO FIRE & RESCUE</Text></View>
        {step && step !== 'intro' ? <View style={styles.progress} accessibilityLabel={`Step ${index + 1} of 5: ${STEPS[index]}`}>
          {STEPS.map((label, n) => <View key={label} style={styles.progressItem}>
            <View style={[styles.progressTrack, n <= index && { backgroundColor: FIRE_ORANGE }]} />
            <Text style={[styles.progressText, n === index && { color: colors.text }]}>{label}</Text>
          </View>)}
        </View> : null}

        {!step ? <View style={styles.panel}>
          {error ? <><Banner tone="error">{error}</Banner><FireButton label="Retry shift status" onPress={() => void run(load)} busy={busy} icon="refresh" /></> : <><ActivityIndicator color={FIRE_ORANGE} /><Text style={styles.body}>Checking your Fire shift…</Text></>}
        </View> : null}

        {step === 'intro' ? <View style={styles.panel}>
          <View style={styles.introPhoto}><Image source={FIRE_PHOTO} resizeMode="cover" style={[StyleSheet.absoluteFillObject, { width: '100%', height: '100%' }]} /><View style={styles.photoShade} /><View style={styles.photoCaption}><Ionicons name="flame" size={24} color="#fdba74" /><Text style={styles.photoText}>Your crew. Your appliance. Ready.</Text></View></View>
          <Text style={styles.eyebrow}>STEP 1 OF 5 · START OF SHIFT</Text>
          <Text style={styles.title}>Ready to respond.</Text>
          <Text style={styles.body}>Begin your shift with a readiness assessment, sign onto an appliance, and check your fire equipment.</Text>
          <View style={styles.introList}>{[['person-outline', 'Personal readiness'], ['bus-outline', 'Appliance & equipment'], ['create-outline', 'Confirm & sign on']].map(([icon, label]) => <View key={label} style={styles.introItem}><Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={20} color={FIRE_ORANGE} /><Text style={styles.introLabel}>{label}</Text></View>)}</View>
          <Text style={styles.caption}>You go on duty once your checks are complete.</Text>
          <FireButton label="Begin shift checks" onPress={() => go('readiness')} icon="play-circle-outline" />
        </View> : null}

        {step === 'readiness' ? <View style={styles.panel}>
          <Text style={styles.eyebrow}>STEP 2 OF 5 · YOU</Text><Text style={styles.title}>Readiness assessment</Text>
          <Text style={styles.body}>Take a moment to check in. Answer each question honestly before starting operational duty.</Text>
          {READINESS_ITEMS.map(([key, label]) => <FireCheck key={key} label={label} value={mental[key]} onChange={(value) => setMental((m) => ({ ...m, [key]: value }))} disabled={busy} invalid={invalid} />)}
          <Input label="Readiness notes" accessibilityLabel="Readiness notes" hint="Required if you answer No. Your declaration is recorded for command review." multiline maxLength={4000} value={comments} onChangeText={setComments} editable={!busy} />
          <FireButton label="Confirm readiness" onPress={submitReadiness} busy={busy} />
        </View> : null}

        {step === 'stood_down' ? <View style={styles.panel}>
          <Ionicons name="heart-outline" size={40} color={colors.medium} /><Text style={styles.title}>Readiness needs attention</Text>
          <Text style={styles.body}>Your readiness declaration is on record. You are not cleared to go on duty. Contact your station officer or supervisor before continuing.</Text>
          <FireButton label="Check clearance again" secondary onPress={() => void run(load)} busy={busy} icon="refresh" />
        </View> : null}

        {step === 'appliance' ? <View style={styles.panel}>
          <Text style={styles.eyebrow}>STEP 3 OF 5 · YOUR UNIT</Text><Text style={styles.title}>Select appliance</Text><Text style={styles.body}>Choose the available Fire & Rescue appliance you are signing onto.</Text>
          {appliances.length === 0 ? <View style={styles.empty}><Ionicons name="bus-outline" size={34} color={colors.muted} /><Text style={styles.body}>No appliances are available. Ask your station officer to release or register an appliance.</Text></View> : appliances.map((a) => <Pressable key={a.id} disabled={busy} accessibilityRole="radio" accessibilityLabel={`${a.unit_number} — ${a.name}`} accessibilityState={{ checked: picked === a.id }} aria-checked={picked === a.id} onPress={() => setPicked(a.id)} style={[styles.unit, picked === a.id && styles.selectedUnit]}>
            <View style={styles.unitIcon}><Ionicons name="bus-outline" size={28} color={FIRE_ORANGE} /></View><View style={{ flex: 1 }}><Text style={styles.unitNumber}>{a.unit_number}</Text><Text style={styles.unitName}>{a.name}</Text><Text style={styles.caption}>{[a.type, a.license_plate, a.station_number].filter(Boolean).join(' · ')}</Text></View><Ionicons name={picked === a.id ? 'checkmark-circle' : 'ellipse-outline'} size={23} color={picked === a.id ? FIRE_ORANGE : colors.muted} />
          </Pressable>)}
          <FireButton label="Confirm appliance" onPress={confirmAppliance} disabled={!picked} busy={busy} />
          <FireButton label="Refresh available appliances" secondary icon="refresh" onPress={() => void run(load)} busy={busy} />
        </View> : null}

        {step === 'checks' ? <View style={styles.panel}>
          <Text style={styles.eyebrow}>STEP 4 OF 5 · {state?.appliance?.unit_number}</Text><Text style={styles.title}>Appliance & equipment</Text><Text style={styles.body}>{state?.appliance?.name} · {completed} of 11 checks answered</Text>
          {restored ? <Text style={styles.caption}>Your saved draft has been restored. Verify every answer before signing.</Text> : null}
          <Text style={styles.sectionTitle}>Fuel level</Text>
          <View style={styles.fuelRow}>{FIRE_FUEL_LEVELS.map((level) => <Pressable key={level} accessibilityRole="radio" accessibilityLabel={`Fuel ${level}`} accessibilityState={{ checked: fuel === level }} aria-checked={fuel === level} disabled={busy} onPress={() => setFuel(level)} style={[styles.fuel, fuel === level && styles.selectedUnit]}><Ionicons name="speedometer-outline" size={17} color={fuel === level ? FIRE_ORANGE : colors.muted} /><Text style={styles.unitName}>{level}</Text></Pressable>)}</View>
          {fuel === '1/4' ? <Text style={styles.warning}>Low fuel recorded. Arrange refuelling with your station officer.</Text> : null}
          <Text style={styles.sectionTitle}>Essential checks</Text>
          {FIRE_ESSENTIALS.map(([key, label]) => <FireCheck key={key} label={label} value={answers[key]} onChange={(value) => setAnswers((a) => ({ ...a, [key]: value }))} disabled={busy} invalid={invalid} />)}
          <View style={styles.equipmentTitle}><Ionicons name="flame" size={22} color={FIRE_ORANGE} /><Text style={styles.sectionTitle}>Fire equipment</Text></View>
          {FIRE_EQUIPMENT.map(([key, label, hint]) => <FireCheck key={key} label={label} hint={hint} value={answers[key]} onChange={(value) => setAnswers((a) => ({ ...a, [key]: value }))} disabled={busy} invalid={invalid} />)}
          <Input label={failed.length ? 'Fault details — required' : 'Inspection notes'} accessibilityLabel="Inspection notes" multiline maxLength={4000} value={notes} onChangeText={setNotes} editable={!busy} placeholder="Describe any defects or equipment concerns" />
          {failed.length ? <Text style={styles.warning}>A failed check prevents sign-on. Filing this inspection will take the appliance out of service and notify command.</Text> : null}
          <FireButton label="Review & sign" onPress={review} busy={busy} />
        </View> : null}

        {step === 'sign' ? <View style={styles.panel}>
          <Text style={styles.eyebrow}>STEP 5 OF 5 · SIGN-OFF</Text><Text style={styles.title}>Confirm & sign on</Text>
          <Text style={styles.body}>Review the record before you sign. Your name and the filing time are recorded with these checks.</Text>
          <KeyValue label="Firefighter" value={officerName} /><KeyValue label="Appliance" value={state?.appliance?.unit_number} /><KeyValue label="Fuel" value={fuel} /><KeyValue label="Checks passed" value={`${11 - failed.length} / 11`} />
          {failed.length ? <View style={styles.failureBox}><Text style={styles.warning}>Appliance will not be cleared</Text>{failed.map((label) => <Text key={label} style={styles.body}>• {label}</Text>)}</View> : <Text style={styles.success}>All appliance and equipment checks passed.</Text>}
          {notes.trim() ? <Text style={styles.body}>{notes.trim()}</Text> : null}
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: declared }} aria-checked={declared} disabled={busy} onPress={() => setDeclared((d) => !d)} style={styles.declaration}>
            <Ionicons name={declared ? 'checkbox' : 'square-outline'} size={25} color={declared ? FIRE_ORANGE : colors.muted} /><Text style={styles.declarationText}>I personally completed these checks and confirm that the answers and any defects recorded are accurate.</Text>
          </Pressable>
          <SignaturePad onChange={setSignature} onDrawingChange={setDrawing} disabled={busy} />
          <FireButton label={failed.length ? 'Sign & report defects' : 'Sign & file shift checks'} icon="create-outline" onPress={fileInspection} busy={busy} />
          <FireButton label="Back to checks" secondary icon="arrow-back" onPress={() => { setSignature(null); go('checks'); }} disabled={busy} />
        </View> : null}

        {step === 'appliance_failed' ? <View style={styles.panel}>
          <Ionicons name="warning-outline" size={42} color={colors.critical} /><Text style={styles.title}>Appliance not cleared</Text>
          <Text style={styles.body}>Inspection {record?.inspection_ref} is filed. The appliance is out of service and command has been notified. You remain off duty.</Text>
          <Text style={styles.body}>Speak to your station officer about the reported defects, then choose another available appliance and repeat its checks.</Text>
          <FireButton label="Choose another appliance" icon="bus-outline" onPress={() => void run(load)} busy={busy} />
        </View> : null}

        {step === 'complete' ? <View style={styles.panel}>
          <View style={styles.completeIcon}><Ionicons name="shield-checkmark" size={36} color={colors.low} /></View>
          <Text style={styles.eyebrow}>START OF SHIFT · FILED</Text><Text style={styles.title}>Your checks are complete.</Text>
          <Text style={styles.body}>Your readiness assessment and signed Fire appliance inspection are on record.</Text>
          <KeyValue label="Reference" value={record?.inspection_ref ?? '—'} /><KeyValue label="Firefighter" value={record?.inspector_name ?? officerName} /><KeyValue label="Appliance" value={state?.appliance?.unit_number ?? '—'} /><KeyValue label="Fuel" value={record?.fuel_level ?? '—'} />
          {record ? <KeyValue label="Filed (SAST)" value={new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(record.checked_at))} /> : null}
          <Text style={styles.success}>6 readiness checks · 11 appliance & equipment checks</Text>
          <FireButton label={state?.personnel.is_on_duty ? 'Go to dashboard' : 'Go on duty & open dashboard'} icon="flame" onPress={goOnDuty} busy={busy} />
        </View> : null}
        {step && error ? <View style={{ gap: 10 }}><Banner tone="error">{error}</Banner><FireButton label="Reload saved shift progress" secondary icon="refresh" onPress={() => void run(load)} busy={busy} /></View> : null}
        <Text style={styles.footer}>METRO FIRE & RESCUE · START OF SHIFT</Text>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, overflow: 'hidden' },
  container: { padding: space.lg, width: '100%', maxWidth: 720, alignSelf: 'center', flexGrow: 1 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 25 },
  headerAction: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 7 },
  headerActionText: { color: colors.textDim, fontWeight: '600', fontSize: 12 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 18 },
  identityText: { fontSize: 11, fontWeight: '800', letterSpacing: 1.8, color: colors.text },
  progress: { flexDirection: 'row', gap: 6, marginBottom: 22 },
  progressItem: { flex: 1 },
  progressTrack: { height: 3, backgroundColor: colors.borderStrong, borderRadius: 2 },
  progressText: { color: colors.muted, fontSize: 10, fontWeight: '700', marginTop: 7 },
  panel: { backgroundColor: colors.panel, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.panelBorder, padding: space.lg, gap: 14, marginBottom: space.lg, overflow: 'hidden' },
  introPhoto: { height: 220, margin: -space.lg, marginBottom: 10, overflow: 'hidden' },
  photoShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(9,12,19,0.25)' },
  photoCaption: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(9,12,19,0.78)' },
  photoText: { fontSize: 13, fontWeight: '700', color: '#fff', flex: 1 },
  eyebrow: { color: FIRE_ORANGE, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  title: { color: colors.text, fontSize: 28, lineHeight: 34, fontWeight: '800', letterSpacing: -0.6 },
  body: { color: colors.textDim, fontSize: 14, lineHeight: 22 },
  caption: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  introList: { gap: 16, paddingVertical: 12 },
  introItem: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  introLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
  empty: { alignItems: 'center', padding: 20, gap: 10, borderRadius: radius.md, borderStyle: 'dashed', borderWidth: 1, borderColor: colors.borderStrong },
  unit: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.lg, backgroundColor: colors.bgElevated },
  selectedUnit: { borderColor: FIRE_ORANGE, backgroundColor: '#f9731618' },
  unitIcon: { width: 45, height: 48, alignItems: 'center', justifyContent: 'center' },
  unitNumber: { color: colors.text, fontSize: 17, fontWeight: '800', marginBottom: 3 },
  unitName: { color: colors.textDim, fontSize: 13, lineHeight: 20 },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  equipmentTitle: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingTop: 10 },
  fuelRow: { flexDirection: 'row', gap: 8 },
  fuel: { flex: 1, alignItems: 'center', paddingVertical: 12, gap: 5, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.bgElevated },
  warning: { color: colors.high, fontSize: 13, lineHeight: 21, fontWeight: '600' },
  success: { color: colors.low, fontSize: 13, lineHeight: 21, fontWeight: '600' },
  failureBox: { padding: 14, borderWidth: 1, borderColor: '#f9731655', backgroundColor: '#f9731610', borderRadius: radius.md, gap: 6 },
  declaration: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10 },
  declarationText: { flex: 1, color: colors.textDim, fontSize: 13, lineHeight: 21 },
  completeIcon: { width: 68, height: 68, borderRadius: 34, backgroundColor: colors.lowSoft, justifyContent: 'center', alignItems: 'center' },
  footer: { color: colors.muted, fontSize: 9, fontWeight: '700', letterSpacing: 1.4, textAlign: 'center', marginTop: 10 },
}));
