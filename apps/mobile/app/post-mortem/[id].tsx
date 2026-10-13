import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { forDepartment, getIncident, getIncidentUpdates, getMyPersonnel, noteText } from '@criticom/api';
import {
  POST_MORTEM_SECTIONS, durationHours, postMortemPayload, postMortemProblems, saStamp, type PostMortemField,
} from '@criticom/db/post-mortem';
import type { Database } from '@criticom/db/types';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useSync } from '@/lib/sync';
import { leadsOnPhone, statusOnPhone } from '@/lib/outbox';
import { setReportingFor } from '@/lib/open-call';
import { colors, radius, space, makeStyles } from '@/lib/theme';
import { Banner, Button, Card, EmptyState, Input, KeyValue, Muted, SeverityPill } from '@/components/ui';

type Incident = Database['public']['Tables']['incidents']['Row'];
type Update = { id: string; message: string; timestamp: string };

const draftKey = (id: string) => `hiktech.post-mortem-draft.${id}`;

/**
 * The Official After-Action Report — the post-mortem that closes a Disaster
 * incident (0065). V4's sections; the incident's own history goes with it.
 * The draft is kept on the phone; filing goes through the outbox.
 */
export default function PostMortemScreen() {
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session, fullName, silo } = useAuth();
  const { enqueue, pending, online } = useSync();
  // The call as this crew's department sees it (0073): its own lead, status and report.
  const [rawIncident, setIncident] = useState<Incident | null>(null);
  const incident = useMemo(() => (rawIncident ? forDepartment(rawIncident, silo) : null), [rawIncident, silo]);
  const [timeline, setTimeline] = useState<Update[]>([]);
  const [loading, setLoading] = useState(true);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [problems, setProblems] = useState<string[]>([]);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const draftLoaded = useRef(false);

  const load = useCallback(async () => {
    if (!id || !session) return;
    const sb = getSupabase();
    const [inc, updates, draft, me] = await Promise.all([
      getIncident(sb, id).catch(() => null),
      getIncidentUpdates(sb, id).catch(() => []),
      AsyncStorage.getItem(draftKey(id)).catch(() => null),
      getMyPersonnel(sb, session.user.id).catch(() => null),
    ]);
    setIncident(inc);
    setTimeline((updates as Update[]).slice().sort((a, b) => a.timestamp.localeCompare(b.timestamp)));
    let saved: Record<string, string> = {};
    try { saved = draft ? JSON.parse(draft) : {}; } catch { saved = {}; }
    const person = me as { first_name?: string | null; last_name?: string | null } | null;
    const myName = [person?.first_name, person?.last_name].filter(Boolean).join(' ') || fullName;
    setAnswers({
      start_time: inc ? saStamp(inc.call_timestamp ?? inc.incident_created_at) : '',
      end_time: '',
      injuries: '0', fatalities: '0', displaced_people: '0',
      reporting_officer: myName,
      ...saved,
    });
    draftLoaded.current = true;
    setLoading(false);
  }, [id, session, fullName]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    setReportingFor(id ?? null);
    return () => setReportingFor(null);
  }, [id]);

  useEffect(() => {
    if (!id || !draftLoaded.current) return;
    const t = setTimeout(() => { void AsyncStorage.setItem(draftKey(id), JSON.stringify(answers)).catch(() => {}); }, 400);
    return () => clearTimeout(t);
  }, [id, answers]);

  const set = (key: string, value: string) => setAnswers((cur) => ({ ...cur, [key]: value }));

  /** The officer's status as they last set it, delivered or not. */
  const status = useMemo(() => statusOnPhone(pending, id ?? '', incident?.status), [pending, id, incident]);
  const alreadyQueued = pending.some((e) => e.op.kind === 'post_mortem' && e.op.incidentId === id);

  const missing = useMemo(() => postMortemProblems(answers), [answers]);
  const invalid = useMemo(() => new Set(tried ? missing.flatMap((p) => p.keys) : []), [tried, missing]);
  useEffect(() => { if (tried) setProblems(missing.map((p) => p.message)); }, [tried, missing]);

  const submit = async () => {
    if (!incident) return;
    setBusy(true);
    try {
      await enqueue({ kind: 'post_mortem', incidentId: incident.id, incidentNumber: incident.incident_number, fields: postMortemPayload(answers) });
      await AsyncStorage.removeItem(draftKey(incident.id)).catch(() => {});
      Alert.alert('Post-mortem filed', online ? `Your post-mortem for ${incident.incident_number} is on record.` : 'Saved. It sends when you have signal.');
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
    if (found.length) return;
    Alert.alert('File Official Report?', `It resolves ${incident.incident_number}.`, [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'File report', onPress: () => void submit() },
    ]);
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>;
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
        <EmptyState icon="lock-closed-outline" title="Post-mortem already filed"
          body={alreadyQueued ? 'It sends when you have signal.' : 'Your post-mortem is on record.'} />
      </View>
    );
  }
  if (!leadsOnPhone(incident, session?.user.id, pending, incident.id)) {
    return (
      <View style={[styles.center, { paddingHorizontal: space.lg }]}>
        <EmptyState icon="person-outline" title="Not your incident" body="Only the officer leading this incident files its post-mortem." />
      </View>
    );
  }

  const onScene = status === 'Arrived' || status === 'On Scene' || status === 'Transporting';
  const hours = durationHours(answers.start_time ?? '', answers.end_time ?? '');

  const renderField = (f: PostMortemField) => {
    const bad = invalid.has(f.key);
    const label = `${f.label}${f.required ? ' *' : ''}`;
    const value = answers[f.key] ?? '';
    return (
      <View key={f.key} style={[styles.field, bad && styles.fieldBad]}>
        <View style={f.kind === 'datetime' ? styles.timeRow : undefined}>
          <View style={{ flex: 1 }}>
            <Input
              label={label}
              value={value}
              onChangeText={(v) => set(f.key, f.kind === 'count' ? v.replace(/[^0-9]/g, '') : v)}
              placeholder={f.placeholder ?? (f.kind === 'datetime' ? 'YYYY-MM-DD HH:MM' : f.kind === 'count' ? '0' : undefined)}
              keyboardType={f.kind === 'count' ? 'number-pad' : f.kind === 'datetime' ? 'numbers-and-punctuation' : 'default'}
              multiline={f.kind === 'multiline'}
              style={f.kind === 'multiline' ? { minHeight: 96, textAlignVertical: 'top' } : undefined}
            />
          </View>
          {f.kind === 'datetime' ? (
            <Pressable onPress={() => set(f.key, saStamp(new Date()))} style={styles.nowBtn} accessibilityRole="button" accessibilityLabel={`${f.label}: now`}>
              <Text style={styles.nowText}>Now</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Card accent={colors.accent}>
          <View style={styles.rowBetween}>
            <View style={styles.titleRow}>
              <Ionicons name="warning" size={18} color={colors.accent} />
              <Text style={styles.number}>{incident.incident_number}</Text>
            </View>
            <SeverityPill severity={incident.incident_severity} />
          </View>
          <Text style={styles.type}>Official After-Action Report</Text>
          <Muted>{incident.disaster_type || incident.incident_type} · {incident.location_address}</Muted>
        </Card>

        {!onScene ? <Banner tone="info">Mark yourself on scene before filing. The draft is kept.</Banner> : null}

        {POST_MORTEM_SECTIONS.map((section) => (
          <View key={section.id}>
            <View style={styles.sectionHead}>
              <Ionicons name={section.icon as keyof typeof Ionicons.glyphMap} size={16} color={colors.accent} />
              <Text style={styles.sectionTitle}>{section.title}</Text>
            </View>
            <Card>
              {section.id === 'overview' ? (
                <View style={{ marginBottom: space.md }}>
                  <KeyValue label="Type" value={incident.disaster_type || incident.incident_type} />
                  <KeyValue label="Location" value={incident.location_address} />
                </View>
              ) : null}
              {section.fields.map(renderField)}
              {section.id === 'overview' && hours !== null ? (
                <Text style={styles.duration}>Duration: {hours} hours</Text>
              ) : null}
            </Card>
          </View>
        ))}

        <View style={styles.sectionHead}>
          <Ionicons name="time-outline" size={16} color={colors.accent} />
          <Text style={styles.sectionTitle}>Timeline</Text>
        </View>
        <Card>
          {timeline.length ? timeline.map((u) => (
            <View key={u.id} style={styles.timelineRow}>
              <Text style={styles.timelineTime}>{saStamp(u.timestamp).slice(5)}</Text>
              <Text style={styles.timelineText}>{noteText(u.message)}</Text>
            </View>
          )) : <Muted>No updates yet.</Muted>}
        </Card>

        <View style={{ marginTop: space.lg }}>
          {problems.length ? (
            <View style={{ marginBottom: space.sm }}>
              <Banner tone="error" onDismiss={() => setProblems([])}>{`• ${problems.join('\n• ')}`}</Banner>
            </View>
          ) : null}
          <Button label="File Official Report" icon="document-text" variant="success" size="lg" busy={busy} disabled={!onScene} onPress={file} />
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
  fieldBad: { padding: space.sm, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.critical, backgroundColor: colors.criticalSoft },
  timeRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  nowBtn: { height: 44, paddingHorizontal: 14, justifyContent: 'center', borderRadius: radius.md, borderWidth: 1, borderColor: colors.accent, marginBottom: 2 },
  nowText: { color: colors.accent, fontWeight: '800' },
  duration: { color: colors.text, fontWeight: '800' },
  timelineRow: { flexDirection: 'row', gap: space.sm, paddingVertical: 4 },
  timelineTime: { color: colors.muted, fontSize: 12, width: 82, fontVariant: ['tabular-nums'] },
  timelineText: { color: colors.text, fontSize: 13, flex: 1 },
}));
