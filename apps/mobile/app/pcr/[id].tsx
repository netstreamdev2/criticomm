import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { SvgXml } from 'react-native-svg';
import { answeredCount, forDepartment, getIncident, getMyPersonnel, listIncidentAttachments, type ReportSection } from '@criticom/api';
import {
  PCR_SIGNATURES, TRIAGE, gcsTotal, pcrPayload, pcrProblems, pcrSignatureRequired, pcrTransported, type SecondaryPatient,
} from '@criticom/db/pcr';
import type { Database } from '@criticom/db/types';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useSync } from '@/lib/sync';
import { leadsOnPhone, mediaOnPhone, statusOnPhone } from '@/lib/outbox';
import { setReportingFor } from '@/lib/open-call';
import {
  PCR_CASUALTIES_STEP, PCR_SIGNOFF_STEP, PCR_STEP_ICONS, pcrAnswerPatch, pcrExtraKeys, pcrHeading, pcrStepCheck, pcrSteps,
  pcrWizardAnswers, problemsOn,
} from '@/lib/report-steps';
import { colors, radius, space, type, makeStyles } from '@/lib/theme';
import { OrgMark } from '@/components/org-mark';
import { ReportWizard, type WizardSpec } from '@/components/report-wizard';
import { ReportStartCard, StepTiles, type StepTile } from '@/components/report-steps-cover';
import { Banner, Button, Card, EmptyState, Input, KeyValue, Muted, SectionLabel, SeverityPill } from '@/components/ui';
import { SignaturePad } from '@/components/signature-pad';
import { useT } from '@/lib/i18n';

type Incident = Database['public']['Tables']['incidents']['Row'];
type Draft = { answers: Record<string, string>; casualties: SecondaryPatient[] };

const draftKey = (id: string) => `hiktech.pcr-draft.${id}`;
const sast = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('en-ZA', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
const blankCasualty = (): SecondaryPatient => ({ name: '', age: '', gender: '', triage: '', injuries: '' });
const SVG_PREFIX = 'data:image/svg+xml;utf8,';
/** SVG strokes from the pad as an image the console and the PDF can show. */
const svgImage = (svg: string) => `${SVG_PREFIX}${encodeURIComponent(svg)}`;
/** A signature already given, drawn back from what is kept. */
const svgOf = (image: string) => {
  if (!image.startsWith(SVG_PREFIX)) return null;
  try { return decodeURIComponent(image.slice(SVG_PREFIX.length)); } catch { return null; }
};
const noop = () => {};

/**
 * The ePCR — the patient care report that closes an EMS call (0063). Its
 * sections are V4's, filled in as a step-by-step wizard like the police
 * forms: one section per step, further patients after the crew, the
 * sign-off last. What dispatch already knows is filled in; the draft is
 * kept on the phone until filed; filing goes through the outbox.
 */
export default function PcrScreen() {
  const { t } = useT();
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session, silo } = useAuth();
  const { enqueue, pending, online } = useSync();
  // The call as this crew's department sees it (0073): its own lead, status and report.
  const [rawIncident, setIncident] = useState<Incident | null>(null);
  const incident = useMemo(() => (rawIncident ? forDepartment(rawIncident, silo) : null), [rawIncident, silo]);
  const [loading, setLoading] = useState(true);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [casualties, setCasualties] = useState<SecondaryPatient[]>([]);
  const [mediaOnFile, setMedia] = useState({ photos: 0, voice: 0 });
  const [problems, setProblems] = useState<string[]>([]);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [signing, setSigning] = useState(false);
  /** The wizard's step while it is open. */
  const [openAt, setOpenAt] = useState<number | null>(null);
  const draftLoaded = useRef(false);

  const load = useCallback(async () => {
    if (!id || !session) return;
    const sb = getSupabase();
    const [inc, files, draft, me] = await Promise.all([
      getIncident(sb, id).catch(() => null),
      listIncidentAttachments(sb, id).catch(() => []),
      AsyncStorage.getItem(draftKey(id)).catch(() => null),
      getMyPersonnel(sb, session.user.id).catch(() => null),
    ]);
    setIncident(inc);
    setMedia({ photos: files.filter((a) => a.kind === 'image').length, voice: files.filter((a) => a.kind === 'audio').length });
    let saved: Partial<Draft> = {};
    try { saved = draft ? JSON.parse(draft) : {}; } catch { saved = {}; }
    const person = me as { first_name?: string | null; last_name?: string | null } | null;
    const myName = [person?.first_name, person?.last_name].filter(Boolean).join(' ');
    // What dispatch already knows, as V4 filled it in.
    const scene = inc ? [
      `[Dispatch Alert]: ${inc.call_description ?? ''}`,
      `[Severity]: ${inc.incident_severity}`,
      inc.number_of_victims != null ? `[Reported Casualties]: ${inc.number_of_victims}` : null,
      inc.notes ? `[Dispatcher Notes]: ${inc.notes}` : null,
    ].filter(Boolean).join('\n') : '';
    setAnswers({
      patient_name: inc?.is_caller_patient ? (inc.caller_name ?? '') : (inc?.patient_name ?? ''),
      incident_location: inc ? [inc.location_address, inc.suburb, inc.city].filter(Boolean).join(', ') : '',
      mechanism_of_injury: inc?.incident_type ?? '',
      scene_assessment: scene,
      paramedic_names: myName,
      has_insurance: 'No',
      ...(saved.answers ?? {}),
    });
    setCasualties(saved.casualties ?? []);
    draftLoaded.current = true;
    setLoading(false);
  }, [id, session]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    setReportingFor(id ?? null);
    return () => setReportingFor(null);
  }, [id]);

  // Keep the draft on the phone as the crew types.
  useEffect(() => {
    if (!id || !draftLoaded.current) return;
    const timer = setTimeout(() => {
      void AsyncStorage.setItem(draftKey(id), JSON.stringify({ answers, casualties } satisfies Draft)).catch(() => {});
    }, 400);
    return () => clearTimeout(timer);
  }, [id, answers, casualties]);

  // A run of tick boxes is one question in the wizard; each box is still kept as true/false.
  const set = (key: string, value: string) => setAnswers((cur) => ({ ...cur, ...pcrAnswerPatch(key, value) }));

  /** The officer's status as they last set it, delivered or not. */
  const status = useMemo(() => statusOnPhone(pending, id ?? '', incident?.status), [pending, id, incident]);
  const alreadyQueued = pending.some((e) => e.op.kind === 'pcr' && e.op.incidentId === id);
  // Photos and voice notes still waiting to send count as taken.
  const media = useMemo(() => {
    const waiting = mediaOnPhone(pending, id ?? '');
    return { photos: mediaOnFile.photos + waiting.photos, voice: mediaOnFile.voice + waiting.voice };
  }, [pending, id, mediaOnFile]);

  /** The steps, with only the questions that apply to the answers so far. */
  const steps = useMemo(() => pcrSteps(answers), [answers]);
  const asked = useMemo(() => pcrWizardAnswers(answers), [answers]);
  const missing = useMemo(() => pcrProblems(answers), [answers]);
  useEffect(() => { if (tried) setProblems(missing.map((p) => p.message)); }, [tried, missing]);

  const submit = async (requiresCleaning: boolean) => {
    if (!incident) return;
    setBusy(true);
    try {
      const fields = pcrPayload(answers, casualties, requiresCleaning);
      await enqueue({ kind: 'pcr', incidentId: incident.id, incidentNumber: incident.incident_number, fields });
      await AsyncStorage.removeItem(draftKey(incident.id)).catch(() => {});
      Alert.alert(
        t('Patient report filed'),
        !online
          ? t('Saved. It sends when you have signal.')
          : requiresCleaning
            ? t('Your report for {incident_number} is on record. The ambulance is off road for cleaning.', { incident_number: incident.incident_number })
            : t('Your report for {incident_number} is on record.', { incident_number: incident.incident_number }),
      );
      // The Closed tab, with this call's drawer open: Close is the next step (0074).
      router.replace({ pathname: '/(tabs)/incidents', params: { closed: incident.id } });
    } catch (e) {
      setProblems([(e as Error).message]);
    } finally {
      setBusy(false);
    }
  };

  const file = () => {
    if (!incident) return;
    setTried(true);
    const found = missing.map((p) => p.message);
    setProblems(found);
    if (found.length) return;
    Alert.alert(t('Post-Incident Vehicle Status'), t('Does the vehicle require cleaning?'), [
      { text: t('Cancel'), style: 'cancel' },
      { text: t('Yes - mark as off road'), style: 'destructive', onPress: () => void submit(true) },
      { text: t('No - ready for next call'), onPress: () => void submit(false) },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  if (!incident) {
    return (
      <View style={[styles.center, { paddingHorizontal: space.lg }]}>
        <EmptyState icon="alert-circle-outline" title={t('Incident not available')} body={t('It may have been reassigned.')} />
      </View>
    );
  }
  if (incident.report_filed_at || alreadyQueued) {
    return (
      <View style={[styles.center, { paddingHorizontal: space.lg }]}>
        <EmptyState
          icon="lock-closed-outline"
          title={t('Patient report already filed')}
          body={alreadyQueued ? t('It sends when you have signal.') : t('Your patient report is on record.')}
        />
      </View>
    );
  }
  if (!leadsOnPhone(incident, session?.user.id, pending, incident.id)) {
    return (
      <View style={[styles.center, { paddingHorizontal: space.lg }]}>
        <EmptyState icon="person-outline" title={t('Not your incident')} body={t('Only the paramedic leading this incident files its patient report.')} />
      </View>
    );
  }

  const onScene = status === 'Arrived' || status === 'On Scene' || status === 'Transporting';
  const gcs = gcsTotal(answers);
  const tone = colors.accent;
  const ready = missing.length === 0;
  const overall = answeredCount(steps, asked);
  const leadSigned = Boolean(answers.responder_signature_image_base64);

  const tiles: StepTile[] = steps.map((s) => {
    const toFix = problemsOn(missing, [s], pcrExtraKeys).length;
    const { answered, total } = answeredCount([s], asked);
    let state: string;
    let done = !toFix && answered > 0;
    if (tried && toFix) state = toFix === 1 ? t('1 to fix') : t('{n} to fix', { n: toFix });
    else if (s.key === PCR_CASUALTIES_STEP) {
      state = casualties.length ? (casualties.length === 1 ? t('1 more patient') : t('{n} more patients', { n: casualties.length })) : t('Only one patient');
      done = true;
    } else if (s.key === PCR_SIGNOFF_STEP) {
      state = leadSigned ? t('Signed') : t('Lead signature needed');
      done = !toFix && leadSigned;
    } else state = t('{answered} of {total} answered', { answered, total });
    return { key: s.key ?? s.title, title: s.title, icon: PCR_STEP_ICONS[s.key ?? ''] ?? 'document-outline', state, done, toFix: tried && toFix > 0 };
  });

  /** The first step with something to fix, else the first. */
  const firstToFix = Math.max(0, steps.findIndex((s) => problemsOn(missing, [s], pcrExtraKeys).length > 0));

  const spec: WizardSpec | null = openAt === null ? null : {
    code: 'ePCR',
    title: 'ePCR: Medical Incident Report',
    tone,
    icon: 'medkit',
    sections: steps,
  };

  const setCasualty = (i: number, patch: Partial<SecondaryPatient>) =>
    setCasualties((cur) => cur.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  /** What a step shows beside its questions: times from the incident, further patients, the signatures. */
  const extra = (s: ReportSection, bad: ReadonlySet<string>) => {
    if (s.key === 'scene') {
      return <Card><KeyValue label={t('Time on Scene')} value={sast(incident.arrived_timestamp)} /></Card>;
    }
    if (s.key === 'handover') {
      return <Card><KeyValue label={t('Receiving Hospital')} value={answers.destination_hospital || '—'} /></Card>;
    }
    if (s.key === PCR_CASUALTIES_STEP) {
      return (
        <View style={{ gap: space.md }}>
          <Muted>{t('Add anyone else treated on this call. Leave it empty if there was only one patient.')}</Muted>
          {casualties.map((c, i) => (
            <View key={`cas-${i}`} style={styles.casualty}>
              <View style={styles.rowBetween}>
                <Text style={[styles.casualtyTitle, { color: tone }]}>{t('Patient {n}', { n: i + 2 })}</Text>
                <Pressable onPress={() => setCasualties((cur) => cur.filter((_, j) => j !== i))} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('Remove patient {n}', { n: i + 2 })}>
                  <Ionicons name="close-circle" size={20} color={colors.critical} />
                </Pressable>
              </View>
              <Input label={t('Name / Identifier')} value={c.name} onChangeText={(v) => setCasualty(i, { name: v })} placeholder={t('John Doe or \'Driver\'')} />
              <View style={styles.pair}>
                <View style={{ flex: 1 }}>
                  <Input label={t('Age')} value={c.age} onChangeText={(v) => setCasualty(i, { age: v.replace(/[^0-9]/g, '') })} keyboardType="number-pad" placeholder={t('Yrs')} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>{t('SEX')}</Text>
                  <View style={styles.chips}>
                    {(['Male', 'Female'] as const).map((g) => (
                      <Pressable
                        key={g}
                        onPress={() => setCasualty(i, { gender: c.gender === g ? '' : g })}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: c.gender === g }}
                        style={[styles.chip, c.gender === g && { backgroundColor: tone, borderColor: tone }]}
                      >
                        <Text style={[styles.chipText, c.gender === g && styles.chipTextOn]}>{g === 'Male' ? t('M') : t('F')}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              </View>
              <Text style={styles.label}>{t('TRIAGE PRIORITY')}</Text>
              <View style={styles.chips}>
                {TRIAGE.map((item) => (
                  <Pressable
                    key={item}
                    onPress={() => setCasualty(i, { triage: c.triage === item ? '' : item })}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: c.triage === item }}
                    style={[styles.chip, c.triage === item && { backgroundColor: tone, borderColor: tone }]}
                  >
                    <Text style={[styles.chipText, c.triage === item && styles.chipTextOn]}>{t(item)}</Text>
                  </Pressable>
                ))}
              </View>
              <Input label={t('Primary Injuries / Treatment')} value={c.injuries} onChangeText={(v) => setCasualty(i, { injuries: v })} />
            </View>
          ))}
          <Button label={t('Add patient')} icon="add-circle-outline" variant="outline" onPress={() => setCasualties((cur) => [...cur, blankCasualty()])} />
        </View>
      );
    }
    if (s.key === PCR_SIGNOFF_STEP) {
      return (
        <View style={{ gap: space.md }}>
          {PCR_SIGNATURES.map((sig) => {
            const isBad = bad.has(sig.key);
            const kept = answers[sig.key] ?? '';
            const svg = kept ? svgOf(kept) : null;
            const required = pcrSignatureRequired(sig.key, answers);
            const label = sig.handover && pcrTransported(answers) ? t('Receiving Doctor Signature') : t(sig.label);
            return (
              <View key={sig.key} style={[styles.sign, isBad && styles.signBad]}>
                {isBad ? <Text style={styles.badHint}>{t('Required — fill this in')}</Text> : null}
                <Text style={[styles.label, isBad && { color: colors.critical }]}>
                  {`${label}${required ? ' *' : ''}`.toUpperCase()}{kept ? '  ✓' : ''}
                </Text>
                {kept ? (
                  <View>
                    <View style={styles.signed}>
                      {svg ? <SvgXml xml={svg} width="100%" height={110} /> : <Text style={styles.signedText}>{t('Signed')}</Text>}
                    </View>
                    <Text onPress={() => set(sig.key, '')} style={[styles.again, { color: tone }]} accessibilityRole="button">{t('Sign again')}</Text>
                  </View>
                ) : (
                  <SignaturePad onChange={(drawn) => set(sig.key, drawn ? svgImage(drawn) : '')} onDrawingChange={setSigning} />
                )}
              </View>
            );
          })}
        </View>
      );
    }
    return null;
  };

  const noteFor = (key: string) =>
    key === 'gcs_motor' ? `${t('GCS total:')} ${gcs ?? '—'}${gcs !== null ? ' / 15' : ''}` : undefined;

  // Done: back to the report and straight on to filing, when on scene.
  const done = () => {
    setOpenAt(null);
    setSigning(false);
    if (onScene) setTimeout(file, 350);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={styles.container}>
        <Card accent={tone}>
          <OrgMark style={styles.letterhead} />
          <View style={styles.rowBetween}>
            <View style={styles.titleRow}>
              <Ionicons name="medkit" size={18} color={tone} />
              <Text style={styles.number}>{incident.incident_number}</Text>
            </View>
            <SeverityPill severity={incident.incident_severity} />
          </View>
          <Text style={styles.type}>{t('ePCR: Medical Incident Report')}</Text>
          <Muted>{incident.incident_type} · {incident.location_address}</Muted>
          <View style={styles.metaRow}>
            <Ionicons name="attach-outline" size={13} color={colors.muted} />
            <Text style={styles.metaText}>
              {`${media.photos === 1 ? t('1 photo') : t('{n} photos', { n: media.photos })} · ${media.voice === 1 ? t('1 voice note on file') : t('{n} voice notes on file', { n: media.voice })}`}
            </Text>
          </View>
          <Text style={styles.link} onPress={() => router.push(`/incident/${incident.id}`)} accessibilityRole="link">{t('Add photos or a voice note')}</Text>
        </Card>

        {!onScene ? <Banner tone="info">{t('Mark yourself on scene before filing. The draft is kept.')}</Banner> : null}

        <ReportStartCard
          title={t('Patient care report')}
          sub={ready ? t('Ready to file') : t('Step by step · {answered} of {total} answered', { answered: overall.answered, total: overall.total })}
          icon="medkit"
          tone={tone}
          ready={ready}
          onPress={() => setOpenAt(ready ? 0 : firstToFix)}
        />

        <SectionLabel>{t('Steps')}</SectionLabel>
        <StepTiles tiles={tiles} tone={tone} onOpen={setOpenAt} />

        {problems.length ? (
          <View style={{ marginBottom: space.sm }}>
            <Banner tone="error" onDismiss={() => setProblems([])}>
              {`${problems.length === 1 ? t('One thing is missing:') : t('{n} things are missing:', { n: problems.length })}\n• ${problems.map((p) => t(p)).join('\n• ')}`}
            </Banner>
          </View>
        ) : null}
        <Button
          label={t('Submit final ePCR report')}
          icon="document-text"
          variant="success"
          size="lg"
          busy={busy}
          disabled={!onScene}
          onPress={file}
        />
      </ScrollView>

      <ReportWizard
        spec={spec}
        answers={asked}
        set={set}
        addRow={noop}
        removeRow={noop}
        onDone={done}
        onClose={() => { setOpenAt(null); setSigning(false); }}
        check={pcrStepCheck}
        extra={extra}
        extraKeys={pcrExtraKeys}
        headingFor={pcrHeading}
        noteFor={noteFor}
        startStep={openAt ?? 0}
        scrollLocked={signing}
      />
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  container: { padding: space.lg, paddingBottom: space['3xl'] },
  center: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center', gap: space.sm },
  letterhead: {
    marginBottom: space.md, paddingBottom: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  number: { ...type.mono, color: colors.text },
  type: { color: colors.text, fontSize: 18, fontWeight: '800', marginTop: space.sm },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5 },
  metaText: { ...type.small, color: colors.muted, flexShrink: 1 },
  link: { ...type.small, color: colors.accent, fontWeight: '800', marginTop: space.sm },
  label: { color: colors.muted, fontSize: 11, fontWeight: '800', letterSpacing: 0.8, marginBottom: 6 },
  badHint: { fontSize: 11, fontWeight: '800', color: colors.critical, marginBottom: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 12, minHeight: 36, justifyContent: 'center', borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard,
  },
  chipText: { color: colors.text, fontSize: 13, fontWeight: '700' },
  chipTextOn: { color: '#fff' },
  pair: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  casualty: {
    gap: space.sm, padding: space.md, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard,
  },
  casualtyTitle: { fontSize: 13, fontWeight: '900', letterSpacing: 0.5 },
  sign: { padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard },
  signBad: { borderColor: colors.critical, backgroundColor: colors.criticalSoft },
  signed: { borderRadius: radius.md, backgroundColor: '#fff', padding: space.sm, minHeight: 80, justifyContent: 'center' },
  signedText: { color: '#1e293b', fontWeight: '800', textAlign: 'center' },
  again: { fontSize: 13, fontWeight: '800', marginTop: space.sm, alignSelf: 'flex-start', padding: 4 },
}));
