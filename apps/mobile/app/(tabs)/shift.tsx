import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  assignVehicle, bookOutBodycam, cleanupOnLogout, declareShiftNoBodycam, getLastShiftFirearm, getLastVehicleInspection,
  getShiftGateProgress, getShiftInspectionFolder, getTodayShiftStartRecord, issueShiftFirearm, listAvailableVehicles,
  listShiftBodycams, listShiftFirearms, submitMentalCheck, submitVehicleInspection187c, toggleDuty, declareShiftNoFirearm,
  type BodycamRow, type ShiftFirearm, type ShiftStartRecord,
} from '@criticom/api';
import type { Database } from '@criticom/db/types';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useDept } from '@/lib/branding';
import { useDuty } from '@/lib/duty';
import { colors, radius, space, type, makeStyles } from '@/lib/theme';
import {
  ESSENTIALS, FIREARM_CHECKS, READINESS_ITEMS, SHIFT_TYPES, TABS,
  countItems, inspectionRef, saShortDate, type ReportContext,
} from '@/lib/inspection-187c';
import { exportShiftCsv, exportShiftPdf, printShiftReport, uploadShiftPhoto } from '@/lib/shift-files';
import { Banner, Button, Card, Input, Muted, Stepper, Title } from '@/components/ui';
import { HikTechLogo } from '@/components/hiktech-logo';
import { CrestHeader, PaperButton, Sheet, paper } from '@/components/shift-form';
import {
  InspectionSheet, emptyInspection, inspectionTabError, type InspectionForm,
} from '@/components/shift-inspection';
import { ReportPreview } from '@/components/shift-report';
import { FirearmSheet, emptyFirearm, firearmFormError, type FirearmForm } from '@/components/shift-firearm';
import { BODYCAM_CHECKS, BodycamSheet, bodycamFormError, emptyBodycam, type BodycamForm } from '@/components/shift-bodycam';
import { FireShift } from '@/components/fire-shift';

type Vehicle = Database['public']['Tables']['apparatus']['Row'];
type VehicleChecklist = Database['public']['Tables']['vehicle_checklists']['Row'];
type FirearmChecklist = Database['public']['Tables']['firearm_checklists']['Row'];

/**
 * Start of shift — the V4 flow, step for step:
 *
 *   intro → readiness → select unit → 187(c) inspection (8 tabs) → report
 *   → submitted → firearm & loadout (police) → bodycam (police, 0054)
 *   → complete (export) → dashboard
 *
 * Every step is saved to the server as it is finished, so a reload resumes at
 * the first step the server does not yet count as passed. The duty gate is
 * only released from the complete page, after the officer has had the chance
 * to export the signed record.
 */
type Step =
  | 'intro' | 'mental' | 'failed' | 'vehicle' | 'inspection' | 'report' | 'vehicle_failed'
  | 'submitted' | 'firearm' | 'firearm_failed' | 'bodycam' | 'bodycam_failed' | 'complete';

const STEP_INDEX: Record<Step, number> = {
  intro: 0, mental: 0, failed: 0, vehicle: 1, inspection: 2, report: 2, vehicle_failed: 2,
  submitted: 3, firearm: 3, firearm_failed: 3, bodycam: 3, bodycam_failed: 3, complete: 4,
};

/** Steps whose errors belong next to the action button, not at the top. */
const FORM_STEPS: Step[] = ['mental', 'inspection', 'report', 'firearm', 'bodycam'];

function errorText(e: unknown) {
  return (e as { message?: string })?.message ?? String(e);
}

function saTodayStartIso() {
  const saDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  return new Date(`${saDate}T00:00:00+02:00`).toISOString();
}

export default function ShiftScreen({ gated = false }: { gated?: boolean }) {
  const { silo } = useAuth();
  return silo === 'MetroFire' ? <FireShift gated={gated} /> : <StandardShiftScreen gated={gated} />;
}

function StandardShiftScreen({ gated = false }: { gated?: boolean }) {
  const styles = useStyles();
  const { session, silo, fullName } = useAuth();
  const dept = useDept();
  const { refresh: refreshDuty } = useDuty();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const scroller = useRef<ScrollView>(null);
  const userId = session?.user.id ?? null;

  const [step, setStep] = useState<Step | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState<'pdf' | 'csv' | 'print' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [drawing, setDrawing] = useState(false);

  const [officer, setOfficer] = useState({ name: fullName, onDuty: false, apparatusId: null as string | null });
  const [requiresFirearm, setRequiresFirearm] = useState(silo === 'MetroPolice' || silo === 'Ethekwini');
  const [requiresBodycam, setRequiresBodycam] = useState(silo === 'MetroPolice' || silo === 'Ethekwini');

  // Readiness
  const [mental, setMental] = useState<Record<string, boolean | undefined>>({});
  const [comments, setComments] = useState('');

  // Unit
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);

  // 187(c)
  const [form, setForm] = useState<InspectionForm>(() => emptyInspection());
  const [tab, setTab] = useState(0);
  const [reached, setReached] = useState(0);
  const [lastInspection, setLastInspection] = useState<VehicleChecklist | null>(null);

  // Firearm
  const [firearms, setFirearms] = useState<ShiftFirearm[]>([]);
  const [firearmForm, setFirearmForm] = useState<FirearmForm>(emptyFirearm);
  const [lastLoadout, setLastLoadout] = useState<FirearmChecklist | null>(null);
  const [failedFirearm, setFailedFirearm] = useState<FirearmChecklist | null>(null);

  // Bodycam (0054)
  const [bodycams, setBodycams] = useState<BodycamRow[]>([]);
  const [bodycamForm, setBodycamForm] = useState<BodycamForm>(emptyBodycam);
  const [failedBodycam, setFailedBodycam] = useState<{ serial: string; failed: string } | null>(null);

  // Filed record, for export
  const [record, setRecord] = useState<ShiftStartRecord | null>(null);

  const patchForm = useCallback((p: Partial<InspectionForm>) => setForm((f) => ({ ...f, ...p })), []);
  const patchFirearm = useCallback((p: Partial<FirearmForm>) => setFirearmForm((f) => ({ ...f, ...p })), []);
  const patchBodycam = useCallback((p: Partial<BodycamForm>) => setBodycamForm((f) => ({ ...f, ...p })), []);
  const scrollTop = () => scroller.current?.scrollTo({ y: 0, animated: false });

  const go = (next: Step) => {
    setInvalid(false);
    setError(null);
    setStep(next);
    scrollTop();
  };

  /* ── Loaders ─────────────────────────────────────────────────────── */

  const openVehicles = async () => {
    const sb = getSupabase();
    setVehicles(await listAvailableVehicles(sb, silo === 'Ethekwini' ? 'MetroPolice' : silo));
    setPicked(null);
    go('vehicle');
  };

  const openInspection = async (apparatusId: string) => {
    const sb = getSupabase();
    const [{ data: v, error: vErr }, last] = await Promise.all([
      sb.from('apparatus').select('*').eq('id', apparatusId).maybeSingle(),
      getLastVehicleInspection(sb, apparatusId).catch(() => null),
    ]);
    if (vErr) throw vErr;
    setVehicle(v);
    setLastInspection(last);
    setForm(emptyInspection(v));
    setTab(0);
    setReached(0);
    go('inspection');
  };

  const openFirearm = async () => {
    const sb = getSupabase();
    const [list, last] = await Promise.all([
      listShiftFirearms(sb),
      getLastShiftFirearm(sb).catch(() => null),
    ]);
    setFirearms(list);
    setLastLoadout(last);
    const mine = list.find((f) => f.status === 'Issued' && f.issued_to === userId);
    setFirearmForm({ ...emptyFirearm(), firearmId: mine?.id ?? null });
    go('firearm');
  };

  const openBodycam = async () => {
    const list = await listShiftBodycams(getSupabase());
    setBodycams(list);
    const mine = list.find((c) => c.status === 'Booked out' && c.booked_to === userId);
    setBodycamForm({ ...emptyBodycam(), bodycamId: mine?.id ?? null });
    go('bodycam');
  };

  const openComplete = async () => {
    setRecord(await getTodayShiftStartRecord(getSupabase()));
    go('complete');
  };

  /** After the firearm: the bodycam step where it applies, then the record. */
  const afterFirearm = async () => {
    if (requiresBodycam) await openBodycam();
    else await openComplete();
  };

  const init = useCallback(async () => {
    if (!session) { setStep('intro'); return; }
    try {
      const sb = getSupabase();
      const [gate, officerRes] = await Promise.all([
        getShiftGateProgress(sb),
        sb.from('personnel')
          .select('rank, first_name, last_name, assigned_apparatus_id, is_on_duty')
          .eq('user_id', session.user.id)
          .maybeSingle(),
      ]);
      if (officerRes.error) throw officerRes.error;
      const o = officerRes.data;
      const name = o ? `${o.rank} ${o.first_name} ${o.last_name}`.trim() : '';
      setOfficer({ name: name || fullName, onDuty: Boolean(o?.is_on_duty), apparatusId: o?.assigned_apparatus_id ?? null });
      setRequiresFirearm(gate.requiresFirearm);
      setRequiresBodycam(gate.requiresBodycam);
      const firearmDone = !gate.requiresFirearm || gate.firearm;
      const bodycamDone = !gate.requiresBodycam || gate.bodycam;

      if (gate.readiness && gate.vehicle && firearmDone && bodycamDone) {
        await openComplete();
        return;
      }
      if (!gate.readiness) {
        // A check today that did not pass means the officer was stood down.
        const { data: today } = await sb.from('mental_checks').select('id')
          .eq('user_id', session.user.id).gte('timestamp', saTodayStartIso())
          .limit(1).maybeSingle();
        setStep(today ? 'failed' : 'intro');
        return;
      }
      if (gate.vehicle) {
        if (!firearmDone) await openFirearm();
        else await openBodycam();
        return;
      }
      if (o?.assigned_apparatus_id) { await openInspection(o.assigned_apparatus_id); return; }
      await openVehicles();
    } catch (e) {
      setError(errorText(e));
      setStep('intro');
    }
    // The loaders read state setters only; re-running on their identity would loop.
  }, [session, fullName]);

  useEffect(() => { void init(); }, [init]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  /* ── Readiness ───────────────────────────────────────────────────── */

  const answered = READINESS_ITEMS.filter(([k]) => mental[k] !== undefined).length;

  const submitMental = () => {
    if (answered !== READINESS_ITEMS.length) {
      setInvalid(true);
      setError('Answer Yes or No for every readiness question.');
      return;
    }
    void run(async () => {
      const { passed } = await submitMentalCheck(getSupabase(), {
        silo,
        memory_recall: Boolean(mental.memory_recall),
        judgment: Boolean(mental.judgment),
        situational_awareness: Boolean(mental.situational_awareness),
        not_under_influence: Boolean(mental.not_under_influence),
        anger_check: Boolean(mental.anger_check),
        reflexes: Boolean(mental.reflexes),
        comments,
      });
      if (!passed) { go('failed'); return; }
      if (officer.apparatusId) await openInspection(officer.apparatusId);
      else await openVehicles();
    });
  };

  /* ── Unit ────────────────────────────────────────────────────────── */

  const confirmVehicle = () => {
    if (!picked) return;
    void run(async () => {
      await assignVehicle(getSupabase(), picked);
      setOfficer((o) => ({ ...o, apparatusId: picked }));
      await openInspection(picked);
    });
  };

  /* ── 187(c) ──────────────────────────────────────────────────────── */

  const goTab = (i: number) => {
    setTab(i);
    setInvalid(false);
    setError(null);
    scrollTop();
  };

  const nextTab = () => {
    const err = inspectionTabError(form, tab);
    if (err) { setInvalid(true); setError(err); return; }
    if (tab < TABS.length - 1) {
      const n = tab + 1;
      setReached((r) => Math.max(r, n));
      goTab(n);
      return;
    }
    // Generate Report: the whole sheet must hold, not just this tab — the
    // officer may have gone back and cleared something.
    const broken = TABS.findIndex((_, i) => inspectionTabError(form, i));
    if (broken >= 0) {
      setTab(broken);
      setInvalid(true);
      setError(inspectionTabError(form, broken));
      scrollTop();
      return;
    }
    go('report');
  };

  const essentialsPassed = ESSENTIALS.every(([k]) => form.essentials[k] === true);
  const draftRef = inspectionRef(form.ndm);
  const unitLabel = vehicle ? `${vehicle.unit_number} — ${vehicle.name}` : '—';

  const submitInspection = () => {
    if (!vehicle || !form.fuel || !form.shiftType || !form.signature) return;
    const { fuel, shiftType, signature } = form;
    void run(async () => {
      const sb = getSupabase();
      let photoPaths: string[] = [];
      let licenceDisk: string | null = null;
      let licencePhoto: string | null = null;
      if (form.photos.length || form.licenceDisk || form.licencePhoto) {
        const folder = await getShiftInspectionFolder(sb, `${draftRef}-${Date.now()}`);
        photoPaths = await Promise.all(form.photos.map((uri, i) => uploadShiftPhoto(sb, folder, uri, `photo-${i + 1}`)));
        if (form.licenceDisk) licenceDisk = await uploadShiftPhoto(sb, folder, form.licenceDisk, 'licence-disk');
        if (form.licencePhoto) licencePhoto = await uploadShiftPhoto(sb, folder, form.licencePhoto, 'licence-photo');
      }

      await submitVehicleInspection187c(sb, {
        silo,
        apparatus_id: vehicle.id,
        fuel_level: fuel,
        lights_functional: form.essentials.lights_functional === true,
        tires_condition_ok: form.essentials.tires_condition_ok === true,
        equipment_stocked: form.essentials.equipment_stocked === true,
        comms_working: form.essentials.comms_working === true,
        brakes_responsive: form.essentials.brakes_responsive === true,
        inspection_ref: draftRef,
        ndm_number: form.ndm.trim().toUpperCase(),
        mileage_km: Number(form.mileage),
        shift_type: shiftType,
        items: form.items,
        fault_remarks: form.faultRemarks.trim() || null,
        inspector_name: officer.name,
        signature_svg: signature,
        photo_paths: photoPaths,
        licence_disk_path: licenceDisk,
        licence_photo_path: licencePhoto,
        declaration_accepted: form.declaration,
      });

      if (!essentialsPassed) { go('vehicle_failed'); return; }
      setRecord(await getTodayShiftStartRecord(sb));
      if (requiresFirearm) go('submitted');
      else if (requiresBodycam) await openBodycam();
      else go('complete');
    });
  };

  /* ── Firearm ─────────────────────────────────────────────────────── */

  const submitFirearm = () => {
    const err = firearmFormError(firearmForm);
    if (err) { setInvalid(true); setError(err); return; }
    const f = firearmForm;

    if (f.noFirearm) {
      void run(async () => {
        await declareShiftNoFirearm(getSupabase(), f.noFirearmReason.trim() || null);
        await afterFirearm();
      });
      return;
    }

    const allChecks = FIREARM_CHECKS.every(([k]) => f.checks[k]);

    const send = () => void run(async () => {
      const sb = getSupabase();
      const row = await issueShiftFirearm(sb, {
        firearm_id: f.firearmId as string,
        rounds_issued: Number(f.rounds),
        magazines: Number(f.magazines),
        chamber_status: f.chamber as NonNullable<FirearmForm['chamber']>,
        condition: f.condition as NonNullable<FirearmForm['condition']>,
        serial_verified: Boolean(f.checks.serial_verified),
        barrel_clear: Boolean(f.checks.barrel_clear),
        action_functional: Boolean(f.checks.action_functional),
        safety_functional: Boolean(f.checks.safety_functional),
        sights_secure: Boolean(f.checks.sights_secure),
        notes: f.notes.trim() || null,
      });
      if (!row.passed || row.condition === 'damaged') {
        setFailedFirearm(row);
        go('firearm_failed');
        return;
      }
      await afterFirearm();
    });

    if (!allChecks || f.condition === 'damaged') {
      Alert.alert(
        'This firearm will not be issued',
        'A failed safety check or damage sends the firearm to the armourer. You will need to select another one.',
        [{ text: 'Cancel', style: 'cancel' }, { text: 'Submit anyway', style: 'destructive', onPress: send }],
      );
    } else {
      send();
    }
  };

  /* ── Bodycam ──────────────────────────────────────────────────────── */

  const submitBodycam = () => {
    const err = bodycamFormError(bodycamForm);
    if (err) { setInvalid(true); setError(err); return; }
    const f = bodycamForm;

    if (f.none) {
      void run(async () => {
        await declareShiftNoBodycam(getSupabase(), f.noneReason.trim());
        await openComplete();
      });
      return;
    }

    const allChecks = BODYCAM_CHECKS.every(([k]) => f.checks[k]);
    const send = () => void run(async () => {
      const res = await bookOutBodycam(getSupabase(), {
        bodycamId: f.bodycamId as string,
        batteryOk: Boolean(f.checks.battery),
        recordingOk: Boolean(f.checks.recording),
        mountedOk: Boolean(f.checks.mounted),
        notes: f.notes.trim() || null,
      });
      if (!res.booked) {
        setFailedBodycam({ serial: res.serial_number, failed: res.failed });
        go('bodycam_failed');
        return;
      }
      await openComplete();
    });

    if (!allChecks) {
      Alert.alert(
        'This bodycam will not be issued',
        'A failed check sends the bodycam for repair. You will need to choose another one, or say why you have none.',
        [{ text: 'Cancel', style: 'cancel' }, { text: 'Submit anyway', style: 'destructive', onPress: send }],
      );
    } else {
      send();
    }
  };

  /* ── Complete ────────────────────────────────────────────────────── */

  const reportContext = (): ReportContext | null => (record ? {
    record,
    officialName: dept.official_name,
    shortName: dept.short_name,
    logoUrl: dept.logoUrl,
    officerName: officer.name,
  } : null);

  const doExport = async (kind: 'pdf' | 'csv' | 'print') => {
    const ctx = reportContext();
    if (!ctx) return;
    setExporting(kind);
    setError(null);
    try {
      if (kind === 'pdf') await exportShiftPdf(ctx);
      else if (kind === 'csv') await exportShiftCsv(ctx);
      else await printShiftReport(ctx);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setExporting(null);
    }
  };

  const goDashboard = () => void run(async () => {
    if (!officer.onDuty) {
      await toggleDuty(getSupabase(), { onDuty: true });
      setOfficer((o) => ({ ...o, onDuty: true }));
    }
    if (gated) {
      // Release the start-of-duty gate so the crew can reach incidents.
      const cleared = await refreshDuty();
      if (!cleared) throw new Error('Your shift record is saved, but clearance could not be verified. Reconnect and retry.');
      router.replace('/');
    } else {
      router.push('/');
    }
  });

  const signOut = () => void run(async () => {
    const sb = getSupabase();
    await cleanupOnLogout(sb).catch(() => {});
    await sb.auth.signOut();
    router.replace('/login');
  });

  /* ── Render ──────────────────────────────────────────────────────── */

  if (step === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
        <Muted>Checking today&apos;s shift status…</Muted>
      </View>
    );
  }

  // The last stage holds the firearm and the bodycam, where each applies.
  const kitStep = requiresFirearm && requiresBodycam ? 'Loadout' : requiresFirearm ? 'Firearm' : requiresBodycam ? 'Bodycam' : null;
  const wizardSteps = kitStep ? ['Readiness', 'Unit', 'Inspection', kitStep] : ['Readiness', 'Unit', 'Inspection'];
  const filedParts = [
    'readiness assessment', 'vehicle inspection',
    record?.firearm ? 'firearm book-out' : record?.noFirearm ? 'no-firearm declaration' : null,
    record?.bodycam ? 'bodycam book-out' : record?.noBodycam ? 'no-bodycam reason' : null,
  ].filter(Boolean) as string[];
  const filedList = `${filedParts.slice(0, -1).join(', ')} and ${filedParts[filedParts.length - 1]}`;
  const errorBanner = error ? <Banner tone="error" onDismiss={() => setError(null)}>{error}</Banner> : null;
  const errorBelow = FORM_STEPS.includes(step);
  const record187 = record?.inspection ?? null;

  return (
    <View style={styles.screen}>
    {step === 'vehicle' ? (
      <Image
        source={require('../../assets/shift-earth-network-portrait.png')}
        resizeMode="cover"
        style={StyleSheet.absoluteFillObject}
        accessibilityIgnoresInvertColors
      />
    ) : null}
    <ScrollView
      ref={scroller}
      style={{ backgroundColor: step === 'vehicle' ? 'transparent' : colors.bg }}
      contentContainerStyle={[styles.container, gated && {
        paddingTop: insets.top + space.md,
        paddingBottom: insets.bottom + space['3xl'],
      }]}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      scrollEnabled={!drawing}
    >
      {gated ? (
        <View style={styles.gateHeader}>
          <View style={{ gap: 4 }}>
            <HikTechLogo height={14} />
            <Text style={styles.gateEyebrow}>START OF SHIFT</Text>
          </View>
          <Button label="Sign out" variant="subtle" size="sm" disabled={busy} onPress={signOut} />
        </View>
      ) : null}

      {!errorBelow ? errorBanner : null}

      {step !== 'intro' && step !== 'complete' ? (
        <Stepper steps={wizardSteps} current={Math.min(STEP_INDEX[step], wizardSteps.length - 1)} />
      ) : null}

      {step === 'intro' ? (
        <View style={styles.introCard}>
          <Text style={styles.introEyebrow}>
            {dept.short_name.toUpperCase()} · STEP 1 OF {wizardSteps.length}
          </Text>
          <Ionicons name="shield-half" size={40} color={paper.blue} style={{ marginVertical: space.md }} />
          <Text style={styles.introTitle}>Start of Shift</Text>
          <Text style={styles.introBody}>Begin your start-of-shift readiness checks to go on duty.</Text>
          <PaperButton
            label="Go on Duty — Begin Checks"
            icon="play-circle-outline"
            tone="success"
            onPress={() => go('mental')}
            style={{ alignSelf: 'stretch', marginTop: space.xl, minHeight: 56 }}
          />
        </View>
      ) : null}

      {step === 'mental' ? (
        <Card>
          <Text style={styles.cognitiveTitle}>
            Cognitive Testing for {dept.short_name}
          </Text>
          <View style={styles.assessmentHeading}>
            <Ionicons name="person-circle-outline" size={26} color={colors.accent} />
            <Title>Readiness Assessment</Title>
          </View>
          <Muted>
            Answer every question honestly. Your answers and submission time are recorded for supervisor review.
            Questions marked <Text style={{ color: colors.critical }}>*</Text> are required.
          </Muted>
          <View style={{ marginTop: space.md }}>
            {READINESS_ITEMS.map(([key, label]) => (
              <View key={key} style={styles.question}>
                <Text style={[styles.questionLabel, invalid && mental[key] === undefined && { color: colors.critical }]}>
                  {label}<Text style={{ color: colors.critical }}> *</Text>
                </Text>
                <View style={styles.answerRow}>
                  {([true, false] as const).map((answer) => {
                    const active = mental[key] === answer;
                    const tone = answer ? colors.low : colors.critical;
                    return (
                      <Pressable
                        key={String(answer)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={`${label}: ${answer ? 'Yes' : 'No'}`}
                        onPress={() => setMental((m) => ({ ...m, [key]: answer }))}
                        style={[
                          styles.answer,
                          invalid && mental[key] === undefined && { borderColor: colors.critical },
                          active && { backgroundColor: tone, borderColor: tone },
                        ]}
                        hitSlop={4}
                      >
                        <Ionicons name={answer ? 'checkmark' : 'close'} size={17} color={active ? '#fff' : tone} />
                        <Text style={[styles.answerText, active && { color: '#fff' }]}>{answer ? 'Yes' : 'No'}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
            <View style={{ marginTop: space.md, marginBottom: space.lg }}>
              <Input
                label="Comments"
                placeholder="Anything your supervisor should know (optional)"
                value={comments}
                onChangeText={setComments}
                multiline
              />
            </View>
            <Button
              label="Submit Readiness Check"
              icon="checkmark-done"
              size="lg"
              busy={busy}
              onPress={submitMental}
            />
          </View>
        </Card>
      ) : null}

      {step === 'failed' ? (
        <Card accent={colors.critical}>
          <View style={[styles.doneIcon, { backgroundColor: colors.criticalSoft }]}>
            <Ionicons name="alert-circle" size={26} color={colors.critical} />
          </View>
          <Title>Readiness check not passed</Title>
          <Muted>
            You have not been placed on duty. Your answers were saved for supervisor review.
            Speak to your supervisor, then retake the check when your situation changes.
          </Muted>
          <View style={{ marginTop: space.lg }}>
            <Button label="Retake check" icon="refresh" variant="outline" onPress={() => { setMental({}); go('mental'); }} />
          </View>
        </Card>
      ) : null}

      {step === 'vehicle' ? (
        <Card style={styles.unitPanel}>
          <View style={styles.unitHeading}>
            <Ionicons name="bus-outline" size={26} color={colors.text} />
            <Text style={styles.unitTitle}>Select Your Unit</Text>
          </View>
          <Muted style={{ textAlign: 'center' }}>
            Please select the apparatus you will be operating for this shift.
          </Muted>
          {vehicles.length === 0 ? (
            <View style={styles.noVehicles}>
              <Ionicons name="car-outline" size={22} color={colors.muted} />
              <Muted>No vehicles available — contact fleet control.</Muted>
            </View>
          ) : (
            <View style={styles.unitGrid}>
              {vehicles.map((v) => {
                const active = picked === v.id;
                return (
                  <Pressable
                    key={v.id}
                    onPress={() => setPicked(v.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`${v.unit_number} ${v.name}`}
                    style={[styles.unitCard, active && styles.unitCardActive]}
                  >
                    <Ionicons name="shield-half" size={34} color={active ? colors.accent : colors.text} />
                    <Text style={styles.unitNumber}>{v.unit_number}</Text>
                    <Text style={styles.unitName} numberOfLines={1}>{v.name}</Text>
                    {v.make || v.model ? (
                      <Text style={styles.unitModel} numberOfLines={1}>
                        {[v.make, v.model].filter(Boolean).join(' ')}{v.year ? ` (${v.year})` : ''}
                      </Text>
                    ) : null}
                    {v.license_plate ? <Text style={styles.unitPlate}>{v.license_plate}</Text> : null}
                    <View style={styles.unitType}>
                      <Text style={styles.unitTypeText} numberOfLines={1}>{v.type.toUpperCase()}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
          <Button
            label="Confirm Assignment"
            icon="checkmark-circle-outline"
            variant="success"
            size="lg"
            busy={busy}
            disabled={!picked}
            onPress={confirmVehicle}
          />
        </Card>
      ) : null}

      {step === 'inspection' ? (
        <InspectionSheet
          dept={dept}
          form={form}
          patch={patchForm}
          tab={tab}
          reached={reached}
          onTab={goTab}
          onNext={nextTab}
          onBack={tab > 0 ? () => goTab(tab - 1) : undefined}
          invalid={invalid}
          vehicle={vehicle}
          lastInspection={lastInspection}
          inspectorName={officer.name}
          busy={busy}
          onDrawingChange={setDrawing}
        />
      ) : null}

      {step === 'report' ? (
        <ReportPreview
          inspectionRef={draftRef}
          ndm={form.ndm.trim().toUpperCase()}
          mileage={form.mileage}
          shift={form.shiftType ?? '—'}
          date={saShortDate()}
          inspector={officer.name}
          unit={unitLabel}
          items={form.items}
          passed={essentialsPassed && form.declaration}
          faultRemarks={form.faultRemarks}
          onBack={() => { goTab(TABS.length - 1); setStep('inspection'); }}
          onSubmit={submitInspection}
          busy={busy}
        />
      ) : null}

      {step === 'vehicle_failed' ? (
        <Card accent={colors.critical}>
          <View style={[styles.doneIcon, { backgroundColor: colors.criticalSoft }]}>
            <Ionicons name="car-outline" size={26} color={colors.critical} />
          </View>
          <Title>Vehicle not cleared for duty</Title>
          <Muted>
            The inspection was filed. One or more essential checks failed, so {vehicle?.unit_number ?? 'the vehicle'} is
            off the road and your supervisor has been told. Choose another vehicle; this one comes back once fleet
            control returns it to service.
          </Muted>
          <View style={{ marginTop: space.lg, gap: space.sm }}>
            <Button
              label="Choose another vehicle"
              icon="car-outline"
              busy={busy}
              onPress={() => void run(async () => {
                setOfficer((o) => ({ ...o, apparatusId: null }));
                await openVehicles();
              })}
            />
          </View>
        </Card>
      ) : null}

      {step === 'submitted' ? (
        <Sheet>
          <CrestHeader dept={dept} subtitle="Vehicle Inspection 187(c)" />
          <View style={styles.doneBody}>
            <View style={styles.bigCheck}><Ionicons name="checkmark" size={40} color="#fff" /></View>
            <Text style={styles.doneTitle}>Inspection Submitted</Text>
            <Text style={styles.doneSub}>The electronic vehicle inspection report has been finalised.</Text>
            <SummaryBox record={record} officerName={officer.name} />
            <View style={styles.doneActions}>
              <PaperButton label="View Report" icon="document-text-outline" tone="teal" busy={exporting === 'print'} onPress={() => void doExport('print')} style={styles.halfBtn} />
              <PaperButton label="Export PDF" icon="download-outline" tone="teal" busy={exporting === 'pdf'} onPress={() => void doExport('pdf')} style={styles.halfBtn} />
            </View>
            <PaperButton
              label="Continue to Firearm Checklist →"
              onPress={() => void run(openFirearm)}
              busy={busy}
              style={{ alignSelf: 'stretch', marginTop: space.sm }}
            />
          </View>
        </Sheet>
      ) : null}

      {step === 'firearm' ? (
        <FirearmSheet
          firearms={firearms}
          form={firearmForm}
          patch={patchFirearm}
          invalid={invalid}
          lastLoadout={lastLoadout}
          onSubmit={submitFirearm}
          busy={busy}
          userId={userId}
        />
      ) : null}

      {step === 'firearm_failed' ? (
        <Card accent={colors.critical}>
          <View style={[styles.doneIcon, { backgroundColor: colors.criticalSoft }]}>
            <Ionicons name="warning-outline" size={26} color={colors.critical} />
          </View>
          <Title>Firearm sent to the armourer</Title>
          <Muted>
            {failedFirearm ? `${failedFirearm.make_model ?? 'The firearm'} (S/N ${failedFirearm.serial_number}) ` : 'The firearm '}
            did not pass its inspection and has been marked for maintenance. Your inspection is on record.
            Select another firearm, or tick No firearm, to complete your start of shift.
          </Muted>
          <View style={{ marginTop: space.lg }}>
            <Button label="Back to firearm checklist" icon="refresh" variant="outline" busy={busy} onPress={() => void run(openFirearm)} />
          </View>
        </Card>
      ) : null}

      {step === 'bodycam' ? (
        <BodycamSheet
          bodycams={bodycams}
          form={bodycamForm}
          patch={patchBodycam}
          invalid={invalid}
          onSubmit={submitBodycam}
          busy={busy}
          userId={userId}
        />
      ) : null}

      {step === 'bodycam_failed' ? (
        <Card accent={colors.critical}>
          <View style={[styles.doneIcon, { backgroundColor: colors.criticalSoft }]}>
            <Ionicons name="videocam-off-outline" size={26} color={colors.critical} />
          </View>
          <Title>Bodycam sent for repair</Title>
          <Muted>
            {failedBodycam ? `Bodycam ${failedBodycam.serial} failed its check (${failedBodycam.failed}) ` : 'The bodycam failed its check '}
            and your supervisor has been told. Choose another one, or tick No bodycam today, to complete your start of shift.
          </Muted>
          <View style={{ marginTop: space.lg }}>
            <Button label="Back to bodycams" icon="refresh" variant="outline" busy={busy} onPress={() => void run(openBodycam)} />
          </View>
        </Card>
      ) : null}

      {step === 'complete' ? (
        <Sheet>
          <CrestHeader dept={dept} subtitle="Start of shift record" />
          <View style={styles.doneBody}>
            <View style={styles.bigCheck}><Ionicons name="shield-checkmark" size={36} color="#fff" /></View>
            <Text style={styles.doneTitle}>Shift Start Complete</Text>
            <Text style={styles.doneSub}>
              Your {filedList} are signed and filed for today. Export a copy for your records, then continue to your
              dashboard.
            </Text>
            <SummaryBox record={record} officerName={officer.name} />
            <View style={styles.doneActions}>
              <PaperButton label="Export PDF" icon="document-outline" tone="teal" busy={exporting === 'pdf'} disabled={!record187} onPress={() => void doExport('pdf')} style={styles.halfBtn} />
              <PaperButton label="Export CSV" icon="grid-outline" tone="outline" busy={exporting === 'csv'} disabled={!record187} onPress={() => void doExport('csv')} style={styles.halfBtn} />
            </View>
            <PaperButton
              label="Print / Preview"
              icon="print-outline"
              tone="outline"
              busy={exporting === 'print'}
              disabled={!record187}
              onPress={() => void doExport('print')}
              style={{ alignSelf: 'stretch', marginTop: space.sm }}
            />
            <PaperButton
              label={gated ? 'Go to Dashboard →' : 'View my incidents →'}
              tone="primary"
              busy={busy}
              onPress={goDashboard}
              style={{ alignSelf: 'stretch', marginTop: space.sm, minHeight: 56 }}
            />
          </View>
        </Sheet>
      ) : null}

      {errorBelow ? errorBanner : null}
    </ScrollView>
    </View>
  );
}

function SummaryBox({ record, officerName }: { record: ShiftStartRecord | null; officerName: string }) {
  const styles = useStyles();
  const v = record?.inspection;
  const f = record?.firearm;
  if (!v) return null;
  const faults = countItems((v.items ?? {}) as Parameters<typeof countItems>[0]).fault;
  const shift = SHIFT_TYPES.find(([k]) => k === v.shift_type)?.[0] ?? '—';
  return (
    <View style={styles.summary}>
      <SummaryLine parts={[['NDM', v.ndm_number ?? '—'], ['Mileage', v.mileage_km != null ? String(v.mileage_km) : '—'], ['Shift', shift]]} />
      <SummaryLine parts={[['Date', saShortDate(v.checked_at)], ['Unit', v.apparatus?.unit_number ?? '—']]} />
      <SummaryLine parts={[['Inspector', v.inspector_name ?? officerName], ['Faults', String(faults)]]} faults={faults} />
      <SummaryLine parts={[['Ref', v.inspection_ref ?? '—']]} />
      {f ? (
        <SummaryLine parts={[['Firearm', `${f.make_model ?? ''} · ${f.serial_number}`], ['Rounds', String(f.rounds_issued)]]} />
      ) : record?.noFirearm ? (
        <SummaryLine parts={[['Firearm', `None drawn${record.noFirearm.reason ? ` — ${record.noFirearm.reason}` : ''}`]]} />
      ) : null}
      {record?.bodycam ? (
        <SummaryLine parts={[['Bodycam', record.bodycam.serial_number]]} />
      ) : record?.noBodycam ? (
        <SummaryLine parts={[['Bodycam', `None — ${record.noBodycam.reason}`]]} />
      ) : null}
    </View>
  );
}

function SummaryLine({ parts, faults }: { parts: [string, string][]; faults?: number }) {
  const styles = useStyles();
  return (
    <Text style={styles.summaryLine}>
      {parts.map(([k, val], i) => (
        <Text key={k}>
          {i > 0 ? <Text style={styles.summaryKey}>{'  |  '}</Text> : null}
          <Text style={styles.summaryKey}>{k}: </Text>
          <Text style={[styles.summaryVal, k === 'Faults' && { color: faults ? paper.red : paper.green }]}>{val}</Text>
        </Text>
      ))}
    </Text>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  container: { padding: space.lg, paddingBottom: space['3xl'] },
  center: {
    flex: 1, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center', gap: space.md,
  },
  gateHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.lg,
  },
  gateEyebrow: { ...type.label, color: colors.accent },

  introCard: {
    backgroundColor: paper.sheet, borderRadius: 18, padding: space['2xl'], alignItems: 'center', marginTop: space.xl,
    borderWidth: 1, borderColor: paper.line,
  },
  introEyebrow: { color: paper.blue, fontWeight: '800', fontSize: 12, letterSpacing: 1.5, textAlign: 'center' },
  introTitle: { color: paper.ink, fontSize: 28, fontWeight: '800' },
  introBody: { color: paper.inkDim, fontSize: 16, textAlign: 'center', marginTop: space.sm, lineHeight: 23 },

  cognitiveTitle: { color: colors.text, fontSize: 24, fontWeight: '800', marginBottom: space.lg },
  assessmentHeading: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    borderBottomWidth: 1.5, borderBottomColor: colors.accent,
    paddingBottom: space.sm, marginBottom: space.md,
  },
  question: { paddingVertical: space.md },
  questionLabel: { ...type.bodyStrong, color: colors.text, marginBottom: space.sm, lineHeight: 21 },
  answerRow: { flexDirection: 'row', gap: space.sm },
  answer: {
    flex: 1, minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderRadius: radius.md, borderWidth: 1, borderColor: paper.lineStrong, backgroundColor: paper.raised,
  },
  answerText: { color: colors.textDim, fontSize: 16, fontWeight: '700' },

  doneIcon: {
    width: 48, height: 48, borderRadius: radius.pill,
    backgroundColor: colors.lowSoft,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: space.md,
  },

  unitPanel: { backgroundColor: colors.bgCard, borderColor: colors.borderStrong },
  unitHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, marginBottom: space.sm },
  unitTitle: { color: colors.text, fontSize: 24, fontWeight: '800' },
  unitGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginVertical: space.lg },
  unitCard: {
    width: '47%', flexGrow: 1, alignItems: 'center', gap: 3, paddingVertical: space.lg, paddingHorizontal: space.sm,
    borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.borderStrong, backgroundColor: colors.bgElevated,
  },
  unitCardActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  unitNumber: { color: colors.text, fontWeight: '800', fontSize: 16, marginTop: space.sm },
  unitName: { color: colors.muted, fontSize: 14 },
  unitModel: { color: colors.text, fontWeight: '700', fontSize: 13 },
  unitPlate: { color: colors.muted, fontSize: 13 },
  unitType: { backgroundColor: '#1e88e5', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 2, marginTop: 4 },
  unitTypeText: { color: '#fff', fontWeight: '800', fontSize: 10, letterSpacing: 0.5 },
  noVehicles: {
    alignItems: 'center', gap: space.sm, paddingVertical: space.xl, marginVertical: space.lg,
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, borderRadius: radius.md,
  },

  doneBody: { padding: space.lg, alignItems: 'center' },
  bigCheck: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: '#10b981',
    alignItems: 'center', justifyContent: 'center', marginTop: space.lg,
    shadowColor: '#10b981', shadowOpacity: 0.4, shadowRadius: 16, elevation: 6,
  },
  doneTitle: { color: '#10b981', fontSize: 24, fontWeight: '800', marginTop: space.lg },
  doneSub: { color: paper.muted, fontSize: 14, textAlign: 'center', marginTop: space.sm, lineHeight: 20 },
  doneActions: { flexDirection: 'row', gap: space.sm, alignSelf: 'stretch', marginTop: space.lg },
  halfBtn: { flex: 1, paddingHorizontal: 8 },

  summary: {
    alignSelf: 'stretch', backgroundColor: paper.field, borderRadius: 12, borderWidth: 1, borderColor: paper.line,
    padding: space.lg, marginTop: space.lg, gap: 8,
  },
  summaryLine: { fontFamily: 'monospace', fontSize: 12, lineHeight: 18 },
  summaryKey: { color: paper.faint },
  summaryVal: { color: paper.ink },
}));
