import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import {
  getIncident, getMyBodycam, listIncidentAttachments, POLICE_REPORT_TYPES, reportTypeFor, splitReportAnswers,
  validateReportAnswers, type PoliceReportType, type ReportField,
} from '@criticom/api';
import type { Database } from '@criticom/db/types';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useSync } from '@/lib/sync';
import { setReportingFor } from '@/lib/open-call';
import { colors, radius, space, type, makeStyles } from '@/lib/theme';
import {
  Banner, Button, Card, EmptyState, Input, Muted, Segmented, SectionLabel, SeverityPill, Title,
} from '@/components/ui';

type Incident = Database['public']['Tables']['incidents']['Row'];

const YES_NO = ['Yes', 'No'] as const;
const draftKey = (id: string) => `hiktech.report-draft.${id}`;

/**
 * The officer's case report — the step that closes a police call.
 *
 * The form is chosen from what the call-taker recorded (a hijacking asks
 * about the vehicle and tracker, a crash about the road) and the officer can
 * switch it if the call turned out to be something else. Answers are kept as
 * a draft on the phone until filed, so a crash or a dead battery does not
 * lose a narrative. Filing goes through the outbox like every other field
 * action; the server resolves the call and tells dispatch and command.
 */
export default function IncidentReportScreen() {
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session } = useAuth();
  const { enqueue, pending } = useSync();
  const [incident, setIncident] = useState<Incident | null>(null);
  const [loading, setLoading] = useState(true);
  const [reportType, setReportType] = useState<PoliceReportType | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [evidence, setEvidence] = useState({ photos: 0, voice: 0 });
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const draftLoaded = useRef(false);

  const load = useCallback(async () => {
    if (!id) return;
    const sb = getSupabase();
    const [inc, files, draft] = await Promise.all([
      getIncident(sb, id).catch(() => null),
      listIncidentAttachments(sb, id).catch(() => []),
      AsyncStorage.getItem(draftKey(id)).catch(() => null),
    ]);
    setIncident(inc);
    setEvidence({
      photos: files.filter((a) => a.kind === 'image').length,
      voice: files.filter((a) => a.kind === 'audio').length,
    });
    let saved: { type?: string; answers?: Record<string, string> } = {};
    try { saved = draft ? JSON.parse(draft) : {}; } catch { saved = {}; }
    const auto = inc ? reportTypeFor(inc) : null;
    setReportType(POLICE_REPORT_TYPES.find((t) => t.id === saved.type) ?? auto);
    const initial = { ...(saved.answers ?? {}) };
    // A bodycam booked out this shift (0054) was on; the officer can still change it.
    if (!('bodycam_active' in initial)) {
      const cam = await getMyBodycam(sb).catch(() => null);
      initial.bodycam_active = cam ? 'Yes' : 'No';
    }
    setAnswers(initial);
    draftLoaded.current = true;
    setLoading(false);
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  // Home shows "Filing report" while this screen is open.
  useEffect(() => {
    setReportingFor(id ?? null);
    return () => setReportingFor(null);
  }, [id]);

  // Keep the draft on the phone as the officer types.
  useEffect(() => {
    if (!id || !draftLoaded.current || !reportType) return;
    const t = setTimeout(() => {
      void AsyncStorage.setItem(draftKey(id), JSON.stringify({ type: reportType.id, answers })).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [id, reportType, answers]);

  const set = (key: string, value: string) => setAnswers((cur) => ({ ...cur, [key]: value }));

  /** The officer's status as they last set it, delivered or not. */
  const status = useMemo(() => {
    const queued = pending.find((e) => e.op.kind === 'incident_status' && e.op.incidentId === id);
    return queued?.op.kind === 'incident_status' ? queued.op.status : incident?.status;
  }, [pending, id, incident]);
  const alreadyQueued = pending.some((e) => e.op.kind === 'incident_report' && e.op.incidentId === id);

  const file = () => {
    if (!incident || !reportType) return;
    const found = validateReportAnswers(reportType, answers);
    setProblems(found);
    if (found.length) return;

    Alert.alert(
      'File this report?',
      `It closes ${incident.incident_number} and becomes a permanent record — it cannot be edited or deleted afterwards.`,
      [
        { text: 'Keep editing', style: 'cancel' },
        {
          text: 'File report',
          style: 'destructive',
          onPress: () => void submit(),
        },
      ],
    );
  };

  const submit = async () => {
    if (!incident || !reportType) return;
    setBusy(true);
    try {
      const { fields, details } = splitReportAnswers(reportType, answers);
      await enqueue({
        kind: 'incident_report',
        incidentId: incident.id,
        incidentNumber: incident.incident_number,
        reportType: reportType.id,
        fields,
        details,
      });
      await AsyncStorage.removeItem(draftKey(incident.id)).catch(() => {});
      Alert.alert(
        'Report filed',
        `${incident.incident_number} is closed and on record. Dispatch and command are notified the moment it reaches the server — straight away with signal, automatically once you have it.`,
      );
      router.replace('/(tabs)/incidents');
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
        <Muted>Preparing the report…</Muted>
      </View>
    );
  }

  if (!incident || !reportType) {
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
          title="Report already filed"
          body={alreadyQueued
            ? 'It is waiting for signal and sends automatically.'
            : 'This incident is closed and the report is on record.'}
        />
      </View>
    );
  }

  if (incident.accepted_by !== session?.user.id) {
    return (
      <View style={[styles.center, { paddingHorizontal: space.lg }]}>
        <EmptyState
          icon="person-outline"
          title="Not your incident"
          body="Only the lead officer on this incident can file its report."
        />
      </View>
    );
  }

  const onScene = status === 'Arrived' || status === 'On Scene' || status === 'Transporting';

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={{ backgroundColor: colors.bg }}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Card>
          <View style={styles.rowBetween}>
            <Text style={styles.number}>{incident.incident_number}</Text>
            <SeverityPill severity={incident.incident_severity} />
          </View>
          <Title>{incident.incident_type}</Title>
          <View style={styles.metaRow}>
            <Ionicons name="location-outline" size={13} color={colors.muted} />
            <Text style={styles.metaText}>{incident.location_address}</Text>
          </View>
          <View style={styles.metaRow}>
            <Ionicons name="attach-outline" size={13} color={colors.muted} />
            <Text style={styles.metaText}>
              {evidence.photos} photo{evidence.photos === 1 ? '' : 's'} · {evidence.voice} voice note{evidence.voice === 1 ? '' : 's'} on file — attached automatically
            </Text>
          </View>
        </Card>

        {!onScene ? (
          <Banner tone="info">Mark yourself On Scene before filing — the report can be drafted now.</Banner>
        ) : null}

        <SectionLabel>Report type</SectionLabel>
        <Muted style={{ marginBottom: space.sm }}>
          Chosen from the incident: {reportType.summary} Change it if the incident turned out differently.
        </Muted>
        <View style={styles.chips}>
          {POLICE_REPORT_TYPES.map((t) => {
            const active = t.id === reportType.id;
            return (
              <Pressable
                key={t.id}
                onPress={() => setReportType(t)}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && { opacity: 0.75 }]}
              >
                <Text style={[styles.chipText, active && { color: '#fff' }]}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {reportType.sections.map((section) => (
          <View key={section.title}>
            <SectionLabel>{section.title}</SectionLabel>
            <Card>
              {section.fields.map((field, i) => (
                <View key={field.key} style={i > 0 ? { marginTop: space.md } : undefined}>
                  <Field field={field} value={answers[field.key] ?? ''} onChange={(v) => set(field.key, v)} />
                </View>
              ))}
            </Card>
          </View>
        ))}

        {problems.length > 0 ? (
          <Banner tone="error" onDismiss={() => setProblems([])}>{problems.join('\n')}</Banner>
        ) : null}

        <Button
          label="File report & close incident"
          icon="lock-closed"
          variant="success"
          size="lg"
          busy={busy}
          disabled={!onScene}
          onPress={file}
        />
        <Muted style={{ marginTop: space.sm, textAlign: 'center' }}>
          Filed reports are permanent and visible to dispatch and command.
        </Muted>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ field, value, onChange }: {
  field: ReportField; value: string; onChange: (v: string) => void;
}) {
  const styles = useStyles();
  const label = `${field.label}${field.required ? ' *' : ''}`;
  if (field.kind === 'yesno') {
    return (
      <View>
        <Text style={styles.fieldLabel}>{label.toUpperCase()}</Text>
        <Segmented
          options={YES_NO}
          value={value === 'Yes' || value === 'No' ? value : null}
          onChange={onChange}
        />
      </View>
    );
  }
  if (field.kind === 'choice') {
    return (
      <View>
        <Text style={styles.fieldLabel}>{label.toUpperCase()}</Text>
        <View style={styles.chips}>
          {(field.options ?? []).map((opt) => {
            const active = opt === value;
            return (
              <Pressable
                key={opt}
                onPress={() => onChange(active ? '' : opt)}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && { opacity: 0.75 }]}
              >
                <Text style={[styles.chipText, active && { color: '#fff' }]}>{opt}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  }
  return (
    <Input
      label={label}
      value={value}
      onChangeText={onChange}
      placeholder={field.placeholder}
      keyboardType={field.kind === 'number' ? 'decimal-pad' : 'default'}
      autoCapitalize={field.key === 'license_plate' || field.key === 'vin_number' ? 'characters' : 'sentences'}
      multiline={field.kind === 'multiline'}
      style={field.kind === 'multiline' ? styles.multiline : undefined}
    />
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  container: { padding: space.lg, paddingBottom: space['3xl'] },
  center: {
    flex: 1, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center', gap: space.md,
  },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  number: { ...type.mono, color: colors.accent, marginBottom: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5 },
  metaText: { ...type.small, color: colors.muted, flexShrink: 1 },
  fieldLabel: { ...type.label, fontSize: 11, color: colors.muted, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.sm },
  chip: {
    paddingHorizontal: space.md, paddingVertical: 8,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgSoft,
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.textDim },
  multiline: { minHeight: 110, textAlignVertical: 'top', paddingTop: 12 },
}));
