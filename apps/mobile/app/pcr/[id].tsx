import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { forDepartment, getIncident, getMyPersonnel, listIncidentAttachments } from '@criticom/api';
import {
  PCR_SECTIONS, PCR_SIGNATURES, TRIAGE, gcsTotal, pcrFieldShown, pcrPayload, pcrProblems, pcrSignatureRequired, pcrTransported,
  type PcrField, type SecondaryPatient,
} from '@criticom/db/pcr';
import type { Database } from '@criticom/db/types';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useSync } from '@/lib/sync';
import { leadsOnPhone, mediaOnPhone, statusOnPhone } from '@/lib/outbox';
import { setReportingFor } from '@/lib/open-call';
import { colors, radius, space, makeStyles } from '@/lib/theme';
import { Banner, Button, Card, EmptyState, Input, KeyValue, Muted, Segmented, SeverityPill } from '@/components/ui';
import { SignaturePad } from '@/components/signature-pad';

type Incident = Database['public']['Tables']['incidents']['Row'];
type Draft = { answers: Record<string, string>; casualties: SecondaryPatient[] };

const YES_NO = ['Yes', 'No'] as const;
const draftKey = (id: string) => `hiktech.pcr-draft.${id}`;
const sast = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('en-ZA', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
const nowHHMM = () => sast(new Date().toISOString());
const OPEN_FIRST = ['patient', 'scene', 'crew', 'handover'];
const blankCasualty = (): SecondaryPatient => ({ name: '', age: '', gender: '', triage: '', injuries: '' });
/** SVG strokes from the pad as an image the console and the PDF can show. */
const svgImage = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

/**
 * The ePCR — the patient care report that closes an EMS call (0063). Its
 * sections are V4's. What dispatch already knows is filled in; the draft is
 * kept on the phone until filed; filing goes through the outbox.
 */
export default function PcrScreen() {
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
  const [open, setOpen] = useState<Set<string>>(new Set(OPEN_FIRST));
  const [problems, setProblems] = useState<string[]>([]);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [signing, setSigning] = useState(false);
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
    const t = setTimeout(() => {
      void AsyncStorage.setItem(draftKey(id), JSON.stringify({ answers, casualties } satisfies Draft)).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [id, answers, casualties]);

  const set = (key: string, value: string) => setAnswers((cur) => ({ ...cur, [key]: value }));
  const toggle = (sid: string) => setOpen((cur) => {
    const next = new Set(cur);
    if (next.has(sid)) next.delete(sid); else next.add(sid);
    return next;
  });

  /** The officer's status as they last set it, delivered or not. */
  const status = useMemo(() => statusOnPhone(pending, id ?? '', incident?.status), [pending, id, incident]);
  const alreadyQueued = pending.some((e) => e.op.kind === 'pcr' && e.op.incidentId === id);
  // Photos and voice notes still waiting to send count as taken.
  const media = useMemo(() => {
    const waiting = mediaOnPhone(pending, id ?? '');
    return { photos: mediaOnFile.photos + waiting.photos, voice: mediaOnFile.voice + waiting.voice };
  }, [pending, id, mediaOnFile]);

  const missing = useMemo(() => pcrProblems(answers), [answers]);
  const invalid = useMemo(() => new Set(tried ? missing.flatMap((p) => p.keys) : []), [tried, missing]);
  useEffect(() => { if (tried) setProblems(missing.map((p) => p.message)); }, [tried, missing]);

  const submit = async (requiresCleaning: boolean) => {
    if (!incident) return;
    setBusy(true);
    try {
      const fields = pcrPayload(answers, casualties, requiresCleaning);
      await enqueue({ kind: 'pcr', incidentId: incident.id, incidentNumber: incident.incident_number, fields });
      await AsyncStorage.removeItem(draftKey(incident.id)).catch(() => {});
      Alert.alert(
        'Patient report filed',
        !online
          ? 'Saved. It sends when you have signal.'
          : requiresCleaning
            ? `Your report for ${incident.incident_number} is on record. The ambulance is off road for cleaning.`
            : `Your report for ${incident.incident_number} is on record.`,
      );
      router.replace('/(tabs)/incidents');
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
    if (found.length) {
      // Open every section holding a problem, so it can be seen.
      const keys = new Set(missing.flatMap((p) => p.keys));
      setOpen((cur) => new Set([
        ...cur, ...PCR_SECTIONS.filter((s) => s.fields.some((f) => keys.has(f.key))).map((s) => s.id),
        ...(PCR_SIGNATURES.some((sig) => keys.has(sig.key)) ? ['signoff'] : []),
      ]));
      return;
    }
    Alert.alert('Post-Incident Vehicle Status', 'Does the vehicle require cleaning?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Yes - mark as off road', style: 'destructive', onPress: () => void submit(true) },
      { text: 'No - ready for next call', onPress: () => void submit(false) },
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
        <EmptyState icon="alert-circle-outline" title="Incident not available" body="It may have been reassigned." />
      </View>
    );
  }
  if (incident.report_filed_at || alreadyQueued) {
    return (
      <View style={[styles.center, { paddingHorizontal: space.lg }]}>
        <EmptyState
          icon="lock-closed-outline"
          title="Patient report already filed"
          body={alreadyQueued ? 'It sends when you have signal.' : 'Your patient report is on record.'}
        />
      </View>
    );
  }
  if (!leadsOnPhone(incident, session?.user.id, pending, incident.id)) {
    return (
      <View style={[styles.center, { paddingHorizontal: space.lg }]}>
        <EmptyState icon="person-outline" title="Not your incident" body="Only the paramedic leading this incident files its patient report." />
      </View>
    );
  }

  const onScene = status === 'Arrived' || status === 'On Scene' || status === 'Transporting';
  const gcs = gcsTotal(answers);

  const renderField = (f: PcrField) => {
    if (!pcrFieldShown(f, answers)) return null;
    const value = answers[f.key] ?? '';
    const label = `${f.label}${f.required ? ' *' : ''}`;
    const bad = invalid.has(f.key);
    const heading = f.group ? <Text key={`${f.key}-g`} style={styles.group}>{f.group}</Text> : null;
    let body: React.ReactNode;
    if (f.kind === 'select') {
      body = (
        <View style={[styles.field, bad && styles.fieldBad]}>
          <Text style={[styles.label, bad && styles.labelBad]}>{label.toUpperCase()}</Text>
          <View style={styles.chips}>
            {(f.options ?? []).map((o) => {
              const on = value === o;
              return (
                <Pressable
                  key={o}
                  onPress={() => set(f.key, on ? '' : o)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && { opacity: 0.75 }]}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{o}</Text>
                </Pressable>
              );
            })}
          </View>
          {f.key === 'gcs_motor' ? <Text style={styles.gcs}>GCS total: {gcs ?? '—'}{gcs !== null ? ' / 15' : ''}</Text> : null}
        </View>
      );
    } else if (f.kind === 'yesno') {
      body = (
        <View style={styles.field}>
          <Text style={styles.label}>{label.toUpperCase()}</Text>
          <Segmented options={YES_NO} value={(value || 'No') as (typeof YES_NO)[number]} onChange={(v) => set(f.key, v)} />
        </View>
      );
    } else if (f.kind === 'flag') {
      const on = value === 'true';
      body = (
        <Pressable
          onPress={() => set(f.key, on ? 'false' : 'true')}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: on }}
          style={({ pressed }) => [styles.flag, pressed && { opacity: 0.75 }]}
        >
          <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? colors.accent : colors.muted} />
          <Text style={styles.flagText}>{f.label}</Text>
        </Pressable>
      );
    } else {
      const keyboard = f.kind === 'count' ? 'number-pad' : f.kind === 'time' || f.kind === 'date' ? 'numbers-and-punctuation' : 'default';
      body = (
        <View style={[styles.field, bad && styles.fieldBad]}>
          <View style={f.kind === 'time' ? styles.timeRow : undefined}>
            <View style={{ flex: 1 }}>
              <Input
                label={label}
                value={value}
                onChangeText={(v) => set(f.key, f.kind === 'count' ? v.replace(/[^0-9]/g, '') : v)}
                placeholder={f.placeholder ?? (f.kind === 'time' ? 'HH:MM' : f.kind === 'date' ? 'YYYY-MM-DD' : undefined)}
                keyboardType={keyboard}
                multiline={f.kind === 'multiline'}
                style={f.kind === 'multiline' ? { minHeight: 96, textAlignVertical: 'top' } : undefined}
              />
            </View>
            {f.kind === 'time' ? (
              <Pressable onPress={() => set(f.key, nowHHMM())} style={styles.nowBtn} accessibilityRole="button" accessibilityLabel={`${f.label}: now`}>
                <Text style={styles.nowText}>Now</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      );
    }
    return <View key={f.key}>{heading}{body}</View>;
  };

  const sectionHead = (sid: string, title: string, icon: string, count?: number) => (
    <Pressable
      onPress={() => toggle(sid)}
      accessibilityRole="button"
      accessibilityState={{ expanded: open.has(sid) }}
      style={styles.sectionHead}
    >
      <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={16} color={colors.accent} />
      <Text style={styles.sectionTitle}>{title}</Text>
      {count ? <Text style={styles.count}>{count}</Text> : null}
      <Ionicons name={open.has(sid) ? 'chevron-up' : 'chevron-down'} size={16} color={colors.muted} />
    </Pressable>
  );

  const setCasualty = (i: number, patch: Partial<SecondaryPatient>) =>
    setCasualties((cur) => cur.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={{ backgroundColor: colors.bg }}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={!signing}
      >
        <Card accent={colors.accent}>
          <View style={styles.rowBetween}>
            <View style={styles.titleRow}>
              <Ionicons name="medkit" size={18} color={colors.accent} />
              <Text style={styles.number}>{incident.incident_number}</Text>
            </View>
            <SeverityPill severity={incident.incident_severity} />
          </View>
          <Text style={styles.type}>ePCR: Medical Incident Report</Text>
          <Muted>{incident.incident_type} · {incident.location_address}</Muted>
        </Card>

        {!onScene ? <Banner tone="info">Mark yourself on scene before filing. The draft is kept.</Banner> : null}

        {PCR_SECTIONS.map((section, idx) => (
          <View key={section.id}>
            {/* The handover only applies when the patient is taken to hospital. */}
            {section.fields.some((f) => pcrFieldShown(f, answers)) ? (
              <>
                {sectionHead(section.id, section.title, section.icon)}
                {open.has(section.id) ? (
                  <Card>
                    {section.id === 'scene' ? (
                      <View style={{ marginBottom: space.md }}>
                        <KeyValue label="Time on Scene" value={sast(incident.arrived_timestamp)} />
                      </View>
                    ) : null}
                    {section.id === 'handover' ? (
                      <View style={{ marginBottom: space.md }}>
                        <KeyValue label="Receiving Hospital" value={answers.destination_hospital || '—'} />
                      </View>
                    ) : null}
                    {section.fields.map(renderField)}
                  </Card>
                ) : null}
              </>
            ) : null}

            {/* V4 asks about further patients after the crew. */}
            {PCR_SECTIONS[idx]?.id === 'crew' ? (
              <>
                {sectionHead('casualties', 'Multiple Casualties?', 'people-circle-outline', casualties.length)}
                {open.has('casualties') ? (
                  <Card>
                    {casualties.map((c, i) => (
                      <View key={`cas-${i}`} style={styles.casualty}>
                        <View style={styles.rowBetween}>
                          <Text style={styles.casualtyTitle}>Patient {i + 2}</Text>
                          <Pressable onPress={() => setCasualties((cur) => cur.filter((_, j) => j !== i))} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove patient ${i + 2}`}>
                            <Ionicons name="close-circle" size={20} color={colors.critical} />
                          </Pressable>
                        </View>
                        <Input label="Name / Identifier" value={c.name} onChangeText={(v) => setCasualty(i, { name: v })} placeholder="John Doe or 'Driver'" />
                        <View style={styles.timeRow}>
                          <View style={{ flex: 1 }}>
                            <Input label="Age" value={c.age} onChangeText={(v) => setCasualty(i, { age: v.replace(/[^0-9]/g, '') })} keyboardType="number-pad" placeholder="Yrs" />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.label}>SEX</Text>
                            <View style={styles.chips}>
                              {(['Male', 'Female'] as const).map((g) => (
                                <Pressable key={g} onPress={() => setCasualty(i, { gender: c.gender === g ? '' : g })} style={[styles.chip, c.gender === g && styles.chipOn]}>
                                  <Text style={[styles.chipText, c.gender === g && styles.chipTextOn]}>{g === 'Male' ? 'M' : 'F'}</Text>
                                </Pressable>
                              ))}
                            </View>
                          </View>
                        </View>
                        <Text style={styles.label}>TRIAGE PRIORITY</Text>
                        <View style={[styles.chips, { marginBottom: space.sm }]}>
                          {TRIAGE.map((t) => (
                            <Pressable key={t} onPress={() => setCasualty(i, { triage: c.triage === t ? '' : t })} style={[styles.chip, c.triage === t && styles.chipOn]}>
                              <Text style={[styles.chipText, c.triage === t && styles.chipTextOn]}>{t}</Text>
                            </Pressable>
                          ))}
                        </View>
                        <Input label="Primary Injuries / Treatment" value={c.injuries} onChangeText={(v) => setCasualty(i, { injuries: v })} />
                      </View>
                    ))}
                    <Button label="Add patient" icon="add-circle-outline" variant="outline" onPress={() => setCasualties((cur) => [...cur, blankCasualty()])} />
                  </Card>
                ) : null}
              </>
            ) : null}
          </View>
        ))}

        {sectionHead('signoff', 'Sign Off & Handover', 'create-outline')}
        {open.has('signoff') || invalid.has('responder_signature_image_base64') || invalid.has('doctor_signature_image_base64') ? (
          <Card>
            {PCR_SIGNATURES.map((s) => {
              const bad = invalid.has(s.key);
              const signed = Boolean(answers[s.key]);
              const required = pcrSignatureRequired(s.key, answers);
              const label = s.handover && pcrTransported(answers) ? 'Receiving Doctor Signature' : s.label;
              return (
                <View key={s.key} style={[styles.field, bad && styles.fieldBad]}>
                  <Text style={[styles.label, bad && styles.labelBad]}>
                    {`${label}${required ? ' *' : ''}`.toUpperCase()}{signed ? '  ✓' : ''}
                  </Text>
                  <SignaturePad
                    onChange={(svg) => set(s.key, svg ? svgImage(svg) : '')}
                    onDrawingChange={setSigning}
                  />
                </View>
              );
            })}
          </Card>
        ) : null}

        {sectionHead('media', 'Site Media & Audio Log', 'camera-outline')}
        {open.has('media') ? (
          <Card>
            <Muted>
              {`${media.photos} photo${media.photos === 1 ? '' : 's'} · ${media.voice} voice note${media.voice === 1 ? '' : 's'} on file`}
            </Muted>
            <View style={{ marginTop: space.md }}>
              <Button label="Add photos or a voice note" icon="open-outline" variant="outline" onPress={() => router.push(`/incident/${incident.id}`)} />
            </View>
          </Card>
        ) : null}

        <View style={{ marginTop: space.lg }}>
          {problems.length ? (
            <View style={{ marginBottom: space.sm }}>
              <Banner tone="error" onDismiss={() => setProblems([])}>
                {`• ${problems.join('\n• ')}`}
              </Banner>
            </View>
          ) : null}
          <Button
            label="Submit final ePCR report"
            icon="document-text"
            variant="success"
            size="lg"
            busy={busy}
            disabled={!onScene}
            onPress={file}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  container: { padding: space.lg, paddingBottom: space['3xl'] },
  center: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center', gap: space.sm },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  number: { color: colors.text, fontSize: 16, fontWeight: '900', fontFamily: 'monospace' },
  type: { color: colors.text, fontSize: 18, fontWeight: '800', marginTop: space.sm },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: space.md, marginBottom: space.sm, minHeight: 32 },
  sectionTitle: { color: colors.text, fontSize: 15, fontWeight: '800', flex: 1 },
  count: { color: colors.accent, fontSize: 13, fontWeight: '800' },
  group: { color: colors.accent, fontSize: 12, fontWeight: '800', letterSpacing: 0.6, marginTop: space.sm, marginBottom: space.sm, textTransform: 'uppercase' },
  field: { marginBottom: space.md },
  fieldBad: {
    padding: space.sm, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.critical,
    backgroundColor: colors.criticalSoft,
  },
  label: { color: colors.muted, fontSize: 11, fontWeight: '800', letterSpacing: 0.8, marginBottom: 6 },
  labelBad: { color: colors.critical },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 12, minHeight: 36, justifyContent: 'center', borderRadius: 18,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgElevated,
  },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.textDim, fontSize: 13, fontWeight: '700' },
  chipTextOn: { color: '#fff' },
  gcs: { color: colors.text, fontSize: 14, fontWeight: '800', marginTop: space.sm },
  flag: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 8 },
  flagText: { color: colors.text, fontSize: 14, flex: 1 },
  timeRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  nowBtn: {
    height: 44, paddingHorizontal: 14, justifyContent: 'center', borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.accent, marginBottom: 2,
  },
  nowText: { color: colors.accent, fontWeight: '800' },
  casualty: {
    gap: space.sm, padding: space.md, marginBottom: space.md, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgElevated,
  },
  casualtyTitle: { color: colors.text, fontWeight: '800' },
}));
