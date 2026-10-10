import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import {
  composeReportType, getIncident, getMyBodycam, listIncidentAttachments, POLICE_REPORT_FORMS, rowCount, rowLabel, rowsKey,
  sectionFields, splitReportAnswers, suggestFormsFor, validateReportAnswers, type ReportField, type ReportSection,
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
const CHECK = ['OK', 'Fault', 'NIL'] as const;
const draftKey = (id: string) => `hiktech.report-draft.${id}`;

/**
 * The officer's case report — the step that closes a police call.
 *
 * The case report (response, outcome, evidence, narrative) plus the DMPS
 * forms the call needs: the call type suggests one, and the officer adds or
 * removes forms to match what happened. Answers are kept as a draft on the
 * phone until filed, so a crash or a dead battery does not lose a narrative.
 * Filing goes through the outbox like every other field action; the server
 * resolves the call and tells dispatch and command.
 */
export default function IncidentReportScreen() {
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session } = useAuth();
  const { enqueue, pending, online } = useSync();
  const [incident, setIncident] = useState<Incident | null>(null);
  const [loading, setLoading] = useState(true);
  // The DMPS forms in this report; null until the incident has loaded.
  const [forms, setForms] = useState<string[] | null>(null);
  const reportType = useMemo(() => (forms ? composeReportType(forms) : null), [forms]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [evidence, setEvidence] = useState({ photos: 0, voice: 0 });
  const [problems, setProblems] = useState<string[]>([]);
  // Set once File is pressed: from then on missing answers glow red until fixed.
  const [tried, setTried] = useState(false);
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
    let saved: { forms?: string[]; answers?: Record<string, string> } = {};
    try { saved = draft ? JSON.parse(draft) : {}; } catch { saved = {}; }
    const known = (saved.forms ?? []).filter((f) => POLICE_REPORT_FORMS.some((x) => x.id === f));
    setForms(known.length ? known : inc ? suggestFormsFor(inc) : []);
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
    if (!id || !draftLoaded.current || !forms) return;
    const t = setTimeout(() => {
      void AsyncStorage.setItem(draftKey(id), JSON.stringify({ forms, answers })).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [id, forms, answers]);

  const set = (key: string, value: string) => setAnswers((cur) => ({ ...cur, [key]: value }));
  const toggleForm = (formId: string) => setForms((cur) => {
    const list = cur ?? [];
    return list.includes(formId) ? list.filter((f) => f !== formId) : [...list, formId];
  });
  /** Add a row to a repeated section, or take the last one off (its answers go with it). */
  const addRow = (section: ReportSection) => set(rowsKey(section), String(rowCount(section, answers) + 1));
  const removeRow = (section: ReportSection) => setAnswers((cur) => {
    const n = rowCount(section, cur);
    const next = { ...cur, [rowsKey(section)]: String(n - 1) };
    for (const { key, row } of sectionFields(section, cur)) if (row === n) delete next[key];
    return next;
  });

  /** The officer's status as they last set it, delivered or not. */
  const status = useMemo(() => {
    const queued = pending.find((e) => e.op.kind === 'incident_status' && e.op.incidentId === id);
    return queued?.op.kind === 'incident_status' ? queued.op.status : incident?.status;
  }, [pending, id, incident]);
  const alreadyQueued = pending.some((e) => e.op.kind === 'incident_report' && e.op.incidentId === id);

  /** The fields validateReportAnswers() objects to, to mark them in red. */
  const invalid = useMemo(() => {
    const out = new Set<string>();
    if (!tried || !reportType) return out;
    for (const section of reportType.sections) {
      for (const { key, field: f, row } of sectionFields(section, answers)) {
        const v = (answers[key] ?? '').trim();
        if ((f.required && !row && !v)
          || (f.kind === 'number' && v && !/^\d+(\.\d+)?$/.test(v))
          || (f.kind === 'date' && v && !/^\d{4}-\d{2}-\d{2}$/.test(v))
          || (f.kind === 'time' && v && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v))) out.add(key);
      }
    }
    const narrative = (answers.officer_narrative ?? '').trim();
    if (narrative && narrative.length < 20) out.add('officer_narrative');
    return out;
  }, [tried, reportType, answers]);

  // Once fixed, a problem leaves the list by itself.
  useEffect(() => {
    if (tried && reportType) setProblems(validateReportAnswers(reportType, answers));
  }, [tried, reportType, answers]);

  const file = () => {
    if (!incident || !reportType) return;
    setTried(true);
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
        online ? `${incident.incident_number} is resolved.` : `Saved. It sends when you have signal.`,
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
            : 'This incident is resolved and the report is on record.'}
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
              {evidence.photos} photo{evidence.photos === 1 ? '' : 's'} · {evidence.voice} voice note{evidence.voice === 1 ? '' : 's'} on file
            </Text>
          </View>
        </Card>

        {!onScene ? (
          <Banner tone="info">Mark yourself On Scene before filing — the report can be drafted now.</Banner>
        ) : null}

        <SectionLabel>Forms</SectionLabel>
        <Muted style={{ marginBottom: space.sm }}>Select every form this incident needs.</Muted>
        <View style={styles.formGrid}>
          {POLICE_REPORT_FORMS.map((f) => {
            const active = forms?.includes(f.id) ?? false;
            return (
              <Pressable
                key={f.id}
                onPress={() => toggleForm(f.id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: active }}
                accessibilityLabel={`${f.label}, ${f.code}`}
                style={({ pressed }) => [styles.formTile, active && styles.formTileActive, pressed && { opacity: 0.8 }]}
              >
                <View style={styles.formTileHead}>
                  <Text style={[styles.formCode, active && { color: colors.accent }]}>{f.code}</Text>
                  <Ionicons name={active ? 'checkbox' : 'square-outline'} size={18} color={active ? colors.accent : colors.muted} />
                </View>
                <Text style={styles.formLabel}>{f.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {reportType.sections.map((section) => {
          const rows = section.repeat ? rowCount(section, answers) : 1;
          return (
            <View key={section.key ?? section.title}>
              <SectionLabel>{section.title}</SectionLabel>
              {Array.from({ length: rows }, (_, r) => r + 1).map((row) => (
                <Card key={`${section.key ?? section.title}-${row}`}>
                  {section.repeat ? (
                    <View style={styles.rowHead}>
                      <Text style={styles.rowTitle}>{rowLabel(section, row)}</Text>
                      {row === rows && rows > section.repeat.min ? (
                        <Pressable onPress={() => removeRow(section)} accessibilityRole="button" hitSlop={8}>
                          <Text style={styles.rowRemove}>Remove</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}
                  {sectionFields(section, answers).filter((x) => (section.repeat ? x.row === row : true)).map(({ key, field }, i) => {
                    // A missing or wrong answer after File was pressed glows red until it is fixed.
                    const bad = invalid.has(key);
                    return (
                      <View key={key} style={[i > 0 ? { marginTop: space.md } : undefined, bad && styles.fieldBad]}>
                        {bad ? <Text style={styles.badHint}>{field.required ? 'Required — fill this in' : 'Check this answer'}</Text> : null}
                        <Field field={field} value={answers[key] ?? ''} onChange={(v) => set(key, v)} />
                      </View>
                    );
                  })}
                </Card>
              ))}
              {section.repeat && rows < section.repeat.max ? (
                <Button
                  label={`Add ${section.repeat.noun.toLowerCase()}`}
                  icon="add-circle-outline"
                  variant="outline"
                  onPress={() => addRow(section)}
                />
              ) : null}
            </View>
          );
        })}

        {problems.length > 0 ? (
          <Banner tone="error" onDismiss={() => setProblems([])}>
            {`${problems.length === 1 ? 'One thing is' : `${problems.length} things are`} missing — marked in red above:\n• ${problems.join('\n• ')}`}
          </Banner>
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
  if (field.kind === 'check') {
    return (
      <View>
        <Text style={styles.fieldLabel}>{label.toUpperCase()}</Text>
        <Segmented options={CHECK} value={(CHECK as readonly string[]).includes(value) ? (value as (typeof CHECK)[number]) : null} onChange={onChange} />
      </View>
    );
  }
  if (field.kind === 'multi') {
    const chosen = value ? value.split('; ').filter(Boolean) : [];
    return (
      <View>
        <Text style={styles.fieldLabel}>{label.toUpperCase()}</Text>
        <View style={styles.chips}>
          {(field.options ?? []).map((opt) => {
            const active = chosen.includes(opt);
            return (
              <Pressable
                key={opt}
                onPress={() => onChange((active ? chosen.filter((c) => c !== opt) : [...chosen, opt]).join('; '))}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: active }}
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
      placeholder={field.placeholder ?? (field.kind === 'date' ? 'YYYY-MM-DD' : field.kind === 'time' ? 'HH:MM' : undefined)}
      keyboardType={field.kind === 'number' ? 'decimal-pad' : field.kind === 'date' || field.kind === 'time' ? 'numbers-and-punctuation' : 'default'}
      autoCapitalize={/plate|vin|reg/.test(field.key) ? 'characters' : field.kind === 'date' || field.kind === 'time' ? 'none' : 'sentences'}
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
  formGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.md },
  formTile: {
    width: '48%', flexGrow: 1, padding: space.md, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard,
  },
  formTileActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  formTileHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  formCode: { ...type.mono, fontSize: 12, color: colors.muted, fontWeight: '800' },
  formLabel: { ...type.bodyStrong, color: colors.text, marginTop: 4 },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.sm },
  rowTitle: { ...type.bodyStrong, color: colors.accent },
  rowRemove: { color: colors.critical, fontWeight: '700', fontSize: 13 },
  multiline: { minHeight: 110, textAlignVertical: 'top', paddingTop: 12 },
  // The red glow on a missing answer.
  fieldBad: {
    padding: space.sm, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.critical,
    backgroundColor: colors.criticalSoft,
    shadowColor: colors.critical, shadowOpacity: 0.7, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 6,
  },
  badHint: { color: colors.critical, fontSize: 11, fontWeight: '800', marginBottom: 4 },
}));
