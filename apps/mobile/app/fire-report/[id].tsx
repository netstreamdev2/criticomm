import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { forDepartment, getIncident, getMyPersonnel, listIncidentAttachments } from '@criticom/api';
import {
  FIRE_REPORT_SECTIONS, fireFieldShown, fireReportPayload, fireReportProblems, formatDuration, type FireField,
} from '@criticom/db/fire-report';
import type { Database } from '@criticom/db/types';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useDept } from '@/lib/branding';
import { useSync } from '@/lib/sync';
import { leadsOnPhone, mediaOnPhone, statusOnPhone } from '@/lib/outbox';
import { setReportingFor } from '@/lib/open-call';
import { colors, radius, space, makeStyles } from '@/lib/theme';
import { OrgMark } from '@/components/org-mark';
import { Banner, Button, Card, EmptyState, Input, KeyValue, Muted, Segmented, SeverityPill } from '@/components/ui';

type Incident = Database['public']['Tables']['incidents']['Row'];

const YES_NO = ['Yes', 'No'] as const;
const draftKey = (id: string) => `hiktech.fire-report-draft.${id}`;
const sast = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('en-ZA', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit' }) : '—';

/**
 * The fire incident report — the step that closes a Fire incident (0059).
 *
 * Incident details and the response timeline come from the incident and are
 * shown, not typed; the firefighter writes what only they know. Answers are
 * kept on the phone until filed, so a dead battery or another call does not
 * lose them. Filing goes through the outbox; the server files the report,
 * resolves the incident and tells dispatch and command.
 */
export default function FireReportScreen() {
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session, silo } = useAuth();
  const dept = useDept();
  const { enqueue, pending, online } = useSync();
  // The call as this crew's department sees it (0073): its own lead, status and report.
  const [rawIncident, setIncident] = useState<Incident | null>(null);
  const incident = useMemo(() => (rawIncident ? forDepartment(rawIncident, silo) : null), [rawIncident, silo]);
  const [loading, setLoading] = useState(true);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [photosOnFile, setPhotos] = useState(0);
  const [problems, setProblems] = useState<string[]>([]);
  // Set once File is pressed: from then on missing answers glow red until fixed.
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
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
    setPhotos(files.filter((a) => a.kind === 'image').length);
    let saved: Record<string, string> = {};
    try { saved = draft ? JSON.parse(draft) : {}; } catch { saved = {}; }
    // What the incident and the officer's record already know, unless the draft says otherwise.
    const notes = [inc?.call_description, inc?.notes].filter(Boolean).join('\n');
    setAnswers({
      type_of_incident: '',
      location: inc?.location_address ?? '',
      fire_department_name: dept.official_name ?? '',
      station_number: (me as { station?: string | null } | null)?.station ?? '',
      initial_observations: notes ? `[Dispatch] ${notes}` : '',
      search_and_rescue_performed: 'No',
      medical_aid_provided: 'No',
      utilities_secured: 'No',
      fire_investigation_conducted: 'No',
      mutual_aid_used: 'No',
      ventilation_type: 'None',
      fire_cause: 'Under investigation',
      ...saved,
    });
    draftLoaded.current = true;
    setLoading(false);
  }, [id, session, dept.official_name]);

  useEffect(() => { void load(); }, [load]);

  // Home shows "Filing report" while this screen is open.
  useEffect(() => {
    setReportingFor(id ?? null);
    return () => setReportingFor(null);
  }, [id]);

  // Time on scene keeps counting while the report is written.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Keep the draft on the phone as the firefighter types.
  useEffect(() => {
    if (!id || !draftLoaded.current) return;
    const t = setTimeout(() => { void AsyncStorage.setItem(draftKey(id), JSON.stringify(answers)).catch(() => {}); }, 400);
    return () => clearTimeout(t);
  }, [id, answers]);

  const set = (key: string, value: string) => setAnswers((cur) => ({ ...cur, [key]: value }));

  /** The officer's status as they last set it, delivered or not. */
  const status = useMemo(() => statusOnPhone(pending, id ?? '', incident?.status), [pending, id, incident]);
  const alreadyQueued = pending.some((e) => e.op.kind === 'fire_report' && e.op.incidentId === id);
  // Photos still waiting to send count as taken.
  const photos = photosOnFile + mediaOnPhone(pending, id ?? '').photos;

  /** Everything still missing, with the fields to mark. */
  const missing = useMemo(() => {
    const found = fireReportProblems(answers);
    if (photos === 0 && !(answers.no_photo_reason ?? '').trim()) {
      found.push({ message: 'Add photos on the incident, or say why there are none.', keys: ['no_photo_reason'] });
    }
    return found;
  }, [answers, photos]);
  const invalid = useMemo(() => new Set(tried ? missing.flatMap((p) => p.keys) : []), [tried, missing]);

  // Once fixed, a problem leaves the list by itself.
  useEffect(() => {
    if (tried) setProblems(missing.map((p) => p.message));
  }, [tried, missing]);

  const file = () => {
    if (!incident) return;
    setTried(true);
    const found = missing.map((p) => p.message);
    setProblems(found);
    if (found.length) return;
    Alert.alert(
      'File this fire report?',
      `It resolves ${incident.incident_number} and becomes a permanent record — it cannot be edited or deleted afterwards.`,
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'File report', style: 'destructive', onPress: () => void submit() },
      ],
    );
  };

  const submit = async () => {
    if (!incident) return;
    setBusy(true);
    try {
      const fields = fireReportPayload(answers);
      if (photos === 0 && answers.no_photo_reason?.trim()) fields.no_photo_reason = answers.no_photo_reason.trim();
      await enqueue({ kind: 'fire_report', incidentId: incident.id, incidentNumber: incident.incident_number, fields });
      await AsyncStorage.removeItem(draftKey(incident.id)).catch(() => {});
      Alert.alert(
        'Fire report filed',
        online ? `Your report for ${incident.incident_number} is on record.` : 'Saved. It sends when you have signal.',
      );
      // The Closed tab, with this call's drawer open: Close is the next step (0074).
      router.replace({ pathname: '/(tabs)/incidents', params: { closed: incident.id } });
    } catch (e) {
      setProblems([(e as Error).message]);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
        <Muted>Preparing the fire report…</Muted>
      </View>
    );
  }
  if (!incident) {
    return (
      <View style={[styles.center, { paddingHorizontal: space.lg }]}>
        <EmptyState icon="alert-circle-outline" title="Incident not available" body="It may have been reassigned, or you no longer have access to it." />
      </View>
    );
  }
  if (incident.report_filed_at || alreadyQueued) {
    return (
      <View style={[styles.center, { paddingHorizontal: space.lg }]}>
        <EmptyState
          icon="lock-closed-outline"
          title="Fire report already filed"
          body={alreadyQueued ? 'It is waiting for signal and sends automatically.' : 'Your fire report is on record.'}
        />
      </View>
    );
  }
  if (!leadsOnPhone(incident, session?.user.id, pending, incident.id)) {
    return (
      <View style={[styles.center, { paddingHorizontal: space.lg }]}>
        <EmptyState icon="person-outline" title="Not your incident" body="Only the firefighter leading this incident files its fire report." />
      </View>
    );
  }

  const onScene = status === 'Arrived' || status === 'On Scene' || status === 'Transporting';
  const arrived = incident.arrived_timestamp ? new Date(incident.arrived_timestamp).getTime() : null;
  const sections = FIRE_REPORT_SECTIONS;

  const renderField = (f: FireField) => {
    if (!fireFieldShown(f, answers)) return null;
    const value = answers[f.key] ?? '';
    const label = `${f.label}${f.required ? ' *' : ''}`;
    // A missing answer after File was pressed: the field glows red until it is filled.
    const bad = invalid.has(f.key);
    const fieldStyle = [styles.field, bad && styles.fieldBad];
    if (f.kind === 'select') {
      return (
        <View key={f.key} style={fieldStyle}>
          <Text style={[styles.label, bad && styles.labelBad]}>{label.toUpperCase()}{bad ? ' — REQUIRED' : ''}</Text>
          <View style={styles.chips}>
            {(f.options ?? []).map((o) => {
              const on = value === o;
              return (
                <Pressable
                  key={o}
                  onPress={() => set(f.key, o)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && { opacity: 0.75 }]}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{o}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      );
    }
    if (f.kind === 'yesno') {
      return (
        <View key={f.key} style={fieldStyle}>
          <Text style={styles.label}>{label.toUpperCase()}</Text>
          <Segmented options={YES_NO} value={(value || 'No') as (typeof YES_NO)[number]} onChange={(v) => set(f.key, v)} />
        </View>
      );
    }
    return (
      <View key={f.key} style={fieldStyle}>
        {bad ? <Text style={styles.badHint}>Required — fill this in</Text> : null}
        <Input
          label={label}
          value={value}
          onChangeText={(v) => set(f.key, f.kind === 'count' ? v.replace(/[^0-9]/g, '') : f.kind === 'money' ? v.replace(/[^0-9.]/g, '') : v)}
          placeholder={f.placeholder ?? (f.kind === 'count' || f.kind === 'money' ? '0' : undefined)}
          keyboardType={f.kind === 'count' ? 'number-pad' : f.kind === 'money' ? 'decimal-pad' : 'default'}
          multiline={f.kind === 'multiline'}
          style={f.kind === 'multiline' ? { minHeight: 96, textAlignVertical: 'top' } : undefined}
        />
      </View>
    );
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Card accent={colors.accent}>
          <OrgMark style={{ marginBottom: space.md }} />
          <View style={styles.rowBetween}>
            <View style={styles.titleRow}>
              <Ionicons name="flame" size={18} color={colors.accent} />
              <Text style={styles.number}>{incident.incident_number}</Text>
            </View>
            <SeverityPill severity={incident.incident_severity} />
          </View>
          <Text style={styles.type}>{incident.incident_type}</Text>
          <Muted>{incident.location_address}</Muted>
        </Card>

        {!onScene ? <Banner tone="info">Mark yourself on scene before filing. You can start writing now; the draft is kept.</Banner> : null}

        {sections.map((section) => (
          <View key={section.id}>
            <View style={styles.sectionHead}>
              <Ionicons name={section.icon as keyof typeof Ionicons.glyphMap} size={16} color={colors.accent} />
              <Text style={styles.sectionTitle}>{section.title}</Text>
            </View>
            <Card>
              {section.id === 'incident' ? (
                <View style={{ marginBottom: space.md }}>
                  <KeyValue label="Report number" value={`FR-${incident.incident_number}`} />
                  <KeyValue label="Date" value={new Date(incident.call_timestamp ?? incident.incident_created_at).toLocaleDateString('en-ZA', { timeZone: 'Africa/Johannesburg' })} />
                  <KeyValue label="Time of call" value={sast(incident.call_timestamp ?? incident.incident_created_at)} />
                </View>
              ) : null}
              {section.fields.map(renderField)}
            </Card>

            {/* The response timeline, straight from the incident, after its details. */}
            {section.id === 'incident' ? (
              <>
                <View style={styles.sectionHead}>
                  <Ionicons name="time-outline" size={16} color={colors.accent} />
                  <Text style={styles.sectionTitle}>Response timeline</Text>
                </View>
                <Card>
                  <View style={styles.synced}>
                    <Ionicons name="lock-closed" size={12} color={colors.cyan} />
                    <Text style={styles.syncedText}>Timestamps auto-synced from the incident</Text>
                  </View>
                  <KeyValue label="Dispatched" value={sast(incident.dispatch_time)} />
                  <KeyValue label="Responding" value={sast(incident.accepted_at)} />
                  <KeyValue label="Arrived on scene" value={sast(incident.arrived_timestamp)} />
                  <View style={styles.total}>
                    <Text style={styles.totalLabel}>TOTAL TIME ON SCENE</Text>
                    <Text style={styles.totalValue}>{arrived ? formatDuration((now - arrived) / 1000) : '—'}</Text>
                  </View>
                </Card>
              </>
            ) : null}
          </View>
        ))}

        <View style={styles.sectionHead}>
          <Ionicons name="camera-outline" size={16} color={colors.accent} />
          <Text style={styles.sectionTitle}>Photos</Text>
        </View>
        <Card>
          <Muted>
            {photos
              ? `${photos} photo${photos === 1 ? '' : 's'} on the incident are filed with this report.`
              : 'No photos on the incident yet. Add them from the incident screen, or say why there are none.'}
          </Muted>
          {photos === 0 ? (
            <View style={[{ marginTop: space.md }, invalid.has('no_photo_reason') && styles.fieldBad]}>
              {invalid.has('no_photo_reason') ? <Text style={styles.badHint}>Required — fill this in</Text> : null}
              <Input label="Why no photos *" value={answers.no_photo_reason ?? ''} onChangeText={(v) => set('no_photo_reason', v)} placeholder="e.g. Night, no safe vantage point" />
            </View>
          ) : null}
          <View style={{ marginTop: space.md }}>
            <Button label="Open the incident" icon="open-outline" variant="outline" onPress={() => router.push(`/incident/${incident.id}`)} />
          </View>
        </Card>

        <View style={{ marginTop: space.lg }}>
          {/* Why it will not file, right where the button is pressed. */}
          {problems.length ? (
            <View style={{ marginBottom: space.sm }}>
              <Banner tone="error" onDismiss={() => setProblems([])}>
                {`${problems.length === 1 ? 'One thing is' : `${problems.length} things are`} missing — marked in red above:\n• ${problems.join('\n• ')}`}
              </Banner>
            </View>
          ) : null}
          <Button
            label="File fire report"
            icon="document-text"
            variant="success"
            size="lg"
            busy={busy}
            disabled={!onScene}
            onPress={file}
          />
          <Muted style={{ textAlign: 'center', marginTop: space.sm }}>
            Filing resolves the incident. The report is permanent and visible to command and case managers.
          </Muted>
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
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: space.md, marginBottom: space.sm },
  sectionTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  field: { marginBottom: space.md },
  // The red glow on a missing answer.
  fieldBad: {
    padding: space.sm, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.critical,
    backgroundColor: colors.criticalSoft,
    shadowColor: colors.critical, shadowOpacity: 0.7, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 6,
  },
  label: { color: colors.muted, fontSize: 11, fontWeight: '800', letterSpacing: 0.8, marginBottom: 6 },
  labelBad: { color: colors.critical },
  badHint: { color: colors.critical, fontSize: 11, fontWeight: '800', marginBottom: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 12, minHeight: 36, justifyContent: 'center', borderRadius: 18,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgElevated,
  },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.textDim, fontSize: 13, fontWeight: '700' },
  chipTextOn: { color: '#fff' },
  synced: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginBottom: space.md,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.md, borderWidth: 1, borderColor: `${colors.cyan}55`,
  },
  syncedText: { color: colors.cyan, fontSize: 12, fontWeight: '700' },
  total: {
    marginTop: space.md, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: `${colors.cyan}66`,
    alignItems: 'center',
  },
  totalLabel: { color: colors.cyan, fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  totalValue: { color: colors.text, fontSize: 24, fontWeight: '900', marginTop: 2, fontVariant: ['tabular-nums'] },
}));
