import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { getFieldIncident, listDisasterAssessments, type DisasterAssessment, type FieldIncident } from '@criticom/api';
import {
  ASSESSMENT_HOMES, ASSESSMENT_PEOPLE, HAZARDS, NEEDS, RELIEF_ITEMS, SERVICES_HIT, assessmentPayload, assessmentProblems,
  assessmentTotals, hazardFor, type AssessmentDraft,
} from '@criticom/db/disaster';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useSync } from '@/lib/sync';
import { statusOnPhone } from '@/lib/outbox';
import { departmentOf } from '@/lib/department';
import { hereNow } from '@/lib/here';
import { colors, radius, space, makeStyles } from '@/lib/theme';
import { Banner, Button, Card, EmptyState, Input, Muted, SeverityPill } from '@/components/ui';
import { useT } from '@/lib/i18n';

const draftKey = (id: string) => `hiktech.assessment-draft.${id}`;
const ON_SITE = ['Arrived', 'On Scene', 'Transporting'];

/**
 * The initial and needs assessment, one place at a time (0107): a Disaster
 * Management officer on site records who and what is affected, what people
 * need, the relief handed out and the hall opened as a shelter. Each place is
 * its own record; the call's figures add them up. Kept on the phone until it
 * sends, so a flooded area with no signal is no problem.
 */
export default function AssessmentScreen() {
  const { t } = useT();
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session, silo } = useAuth();
  const { enqueue, pending, online } = useSync();
  const [incident, setIncident] = useState<FieldIncident | null>(null);
  const [filed, setFiled] = useState<DisasterAssessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<AssessmentDraft>({});
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const loaded = useRef(false);

  const load = useCallback(async () => {
    if (!id) return;
    const sb = getSupabase();
    const [inc, rows, saved] = await Promise.all([
      getFieldIncident(sb, id, silo).catch(() => null),
      listDisasterAssessments(sb, id).catch(() => []),
      AsyncStorage.getItem(draftKey(id)).catch(() => null),
    ]);
    setIncident(inc);
    setFiled(rows);
    let kept: AssessmentDraft = {};
    try { kept = saved ? JSON.parse(saved) : {}; } catch { kept = {}; }
    setDraft({ hazard: hazardFor(inc?.disaster_type || inc?.incident_type) ?? undefined, ...kept });
    loaded.current = true;
    setLoading(false);
  }, [id, silo]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!id || !loaded.current) return;
    const timer = setTimeout(() => { void AsyncStorage.setItem(draftKey(id), JSON.stringify(draft)).catch(() => {}); }, 400);
    return () => clearTimeout(timer);
  }, [id, draft]);

  const set = <K extends keyof AssessmentDraft>(key: K, value: AssessmentDraft[K]) => setDraft((cur) => ({ ...cur, [key]: value }));
  const setCount = (group: 'counts' | 'relief', key: string, value: string) =>
    setDraft((cur) => ({ ...cur, [group]: { ...(cur[group] ?? {}), [key]: value.replace(/[^0-9]/g, '').slice(0, 6) } }));
  const toggle = (key: 'services' | 'needs', value: string) =>
    setDraft((cur) => {
      const list = cur[key] ?? [];
      return { ...cur, [key]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value] };
    });

  // What is on the record, and what is still on this phone, for the figures so far.
  const queued = useMemo(() => pending.filter((e) => e.op.kind === 'disaster_assessment' && e.op.incidentId === id), [pending, id]);
  const totals = useMemo(
    () => assessmentTotals([
      ...filed,
      ...queued.map((e) => (e.op.kind === 'disaster_assessment' ? (e.op.fields as Record<string, unknown> & { relief?: Record<string, number> }) : {})),
    ]),
    [filed, queued],
  );

  const missing = useMemo(() => assessmentProblems(draft), [draft]);
  const bad = useMemo(() => new Set(tried ? missing.flatMap((p) => p.keys) : []), [tried, missing]);

  const mine = incident?.responders.find((r) => r.user_id === session?.user.id) ?? null;
  const status = statusOnPhone(pending, id ?? '', mine?.status ?? null);
  const onSite = Boolean(mine?.arrived_at) || ON_SITE.includes(status ?? '');

  const submit = async () => {
    if (!incident) return;
    setBusy(true);
    try {
      const here = await hereNow();
      const fields = assessmentPayload({ ...draft, lat: here?.lat ?? null, lng: here?.lng ?? null, accuracy: here?.accuracy ?? null });
      await enqueue({ kind: 'disaster_assessment', incidentId: incident.id, incidentNumber: incident.incident_number, place: String(fields.place), fields });
      await AsyncStorage.removeItem(draftKey(incident.id)).catch(() => {});
      // The next place starts clean; what happened usually stays the same.
      setDraft({ hazard: draft.hazard, ward: draft.ward });
      setTried(false);
      setProblems([]);
      Alert.alert(
        t('Assessment filed'),
        online ? t('{place} is on record.', { place: String(fields.place) }) : t('Saved. It sends when you have signal.'),
        [
          { text: t('Assess another place') },
          { text: t('Done'), onPress: () => router.back() },
        ],
      );
    } catch (e) {
      setProblems([(e as Error).message]);
    } finally {
      setBusy(false);
    }
  };

  const file = () => {
    setTried(true);
    const found = missing.map((p) => t(p.message));
    setProblems(found);
    if (!found.length) void submit();
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>;
  if (departmentOf(silo) !== 'disaster') {
    return (
      <View style={[styles.center, { paddingHorizontal: space.lg }]}>
        <EmptyState icon="lock-closed-outline" title={t('For Disaster Management')} body={t('The assessment is filed by Disaster Management officers on site.')} />
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

  const count = (group: 'counts' | 'relief', key: string, label: string) => (
    <View key={key} style={styles.countCell}>
      <Input
        label={label}
        value={draft[group]?.[key] ?? ''}
        onChangeText={(v) => setCount(group, key, v)}
        keyboardType="number-pad"
        placeholder="0"
        style={bad.has(key) ? { borderColor: colors.critical } : undefined}
      />
    </View>
  );
  const chip = (label: string, on: boolean, onPress: () => void) => (
    <Pressable
      key={label}
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      style={[styles.chip, on && styles.chipOn]}
    >
      {on ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{t(label)}</Text>
    </Pressable>
  );
  const section = (icon: keyof typeof Ionicons.glyphMap, title: string) => (
    <View style={styles.sectionHead}>
      <Ionicons name={icon} size={16} color={colors.accent} />
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Card accent={colors.accent}>
          <View style={styles.rowBetween}>
            <Text style={styles.number}>{incident.incident_number}</Text>
            <SeverityPill severity={incident.incident_severity} />
          </View>
          <Text style={styles.type}>{t('Assessment')}</Text>
          <Muted>{incident.incident_type} · {incident.location_address}</Muted>
          {totals.places ? (
            <Text style={styles.sofar}>
              {t('So far: {places} places · {households} households · {displaced} displaced · {destroyed} homes destroyed', {
                places: totals.places, households: totals.households_affected ?? 0,
                displaced: totals.people_displaced ?? 0, destroyed: totals.homes_destroyed ?? 0,
              })}
            </Text>
          ) : null}
        </Card>

        {!onSite ? <Banner tone="info">{t('You are not at the scene yet. The assessment is done on site; the draft is kept.')}</Banner> : null}

        {section('location-outline', t('Where'))}
        <Card>
          <Input
            label={t('Place (street, block or hall)')}
            value={draft.place ?? ''}
            onChangeText={(v) => set('place', v)}
            style={bad.has('place') ? { borderColor: colors.critical } : undefined}
          />
          <View style={{ marginTop: space.md }}>
            <Input label={t('Ward (optional)')} value={draft.ward ?? ''} onChangeText={(v) => set('ward', v)} />
          </View>
          <Text style={[styles.label, bad.has('hazard') && { color: colors.critical }]}>{t('What happened')}</Text>
          <View style={styles.chips}>{HAZARDS.map((h) => chip(h, draft.hazard === h, () => set('hazard', h)))}</View>
        </Card>

        {section('people-outline', t('People'))}
        <Card><View style={styles.grid}>{ASSESSMENT_PEOPLE.map((c) => count('counts', c.key, t(c.label)))}</View></Card>

        {section('home-outline', t('Homes'))}
        <Card><View style={styles.grid}>{ASSESSMENT_HOMES.map((c) => count('counts', c.key, t(c.label)))}</View></Card>

        {section('construct-outline', t('Services hit'))}
        <Card><View style={styles.chips}>{SERVICES_HIT.map((s) => chip(s, (draft.services ?? []).includes(s), () => toggle('services', s)))}</View></Card>

        {section('help-buoy-outline', t('What people need now'))}
        <Card><View style={styles.chips}>{NEEDS.map((n) => chip(n, (draft.needs ?? []).includes(n), () => toggle('needs', n)))}</View></Card>

        {section('gift-outline', t('Relief handed out here'))}
        <Card><View style={styles.grid}>{RELIEF_ITEMS.map((r) => count('relief', r.key, t(r.label)))}</View></Card>

        {section('business-outline', t('Shelter'))}
        <Card>
          <Input
            label={t('Hall or shelter')}
            value={draft.shelter_name ?? ''}
            onChangeText={(v) => set('shelter_name', v)}
            placeholder={t('e.g. community hall')}
            style={bad.has('shelter_name') ? { borderColor: colors.critical } : undefined}
          />
          <View style={{ marginTop: space.md }}>
            <Input
              label={t('People sheltered there')}
              value={draft.people_sheltered ?? ''}
              onChangeText={(v) => set('people_sheltered', v.replace(/[^0-9]/g, '').slice(0, 6))}
              keyboardType="number-pad"
              placeholder="0"
            />
          </View>
        </Card>

        {section('create-outline', t('Notes'))}
        <Card>
          <Input
            value={draft.notes ?? ''}
            onChangeText={(v) => set('notes', v)}
            multiline
            placeholder={t('Anything the JOC should know (optional)')}
            style={{ minHeight: 90, textAlignVertical: 'top' }}
          />
        </Card>

        <View style={{ marginTop: space.lg }}>
          {problems.length ? (
            <View style={{ marginBottom: space.sm }}>
              <Banner tone="error" onDismiss={() => setProblems([])}>{`• ${problems.join('\n• ')}`}</Banner>
            </View>
          ) : null}
          <Button label={t('File assessment')} icon="clipboard" variant="success" size="lg" busy={busy} disabled={!onSite} onPress={file} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  container: { padding: space.lg, paddingBottom: space['3xl'] },
  center: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center', gap: space.sm },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  number: { color: colors.text, fontSize: 16, fontWeight: '900', fontFamily: 'monospace' },
  type: { color: colors.text, fontSize: 18, fontWeight: '800', marginTop: space.sm },
  sofar: { color: colors.text, fontSize: 13, fontWeight: '700', marginTop: space.sm },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: space.md, marginBottom: space.sm },
  sectionTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  label: { color: colors.textDim, fontSize: 12, fontWeight: '800', letterSpacing: 0.6, marginTop: space.md, marginBottom: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  countCell: { flexBasis: '46%', flexGrow: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 40, paddingHorizontal: 12,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgElevated,
  },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontSize: 14, fontWeight: '700' },
  chipTextOn: { color: '#fff' },
}));
