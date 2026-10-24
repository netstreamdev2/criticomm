import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { answeredCount, forDepartment, getIncident, getMyPersonnel, listIncidentAttachments, type ReportSection } from '@criticom/api';
import { fireReportPayload, formatDuration } from '@criticom/db/fire-report';
import type { Database } from '@criticom/db/types';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useDept } from '@/lib/branding';
import { useSync } from '@/lib/sync';
import { leadsOnPhone, mediaOnPhone, statusOnPhone } from '@/lib/outbox';
import { setReportingFor } from '@/lib/open-call';
import { FIRE_PHOTOS_STEP, FIRE_STEP_ICONS, fireAnswer, fireStepProblems, fireSteps, problemsOn } from '@/lib/report-steps';
import { colors, radius, space, type, makeStyles } from '@/lib/theme';
import { OrgMark } from '@/components/org-mark';
import { ReportWizard, type WizardSpec } from '@/components/report-wizard';
import { ReportStartCard, StepTiles, type StepTile } from '@/components/report-steps-cover';
import { Banner, Button, Card, EmptyState, KeyValue, Muted, SectionLabel, SeverityPill, Title } from '@/components/ui';
import { useT } from '@/lib/i18n';

type Incident = Database['public']['Tables']['incidents']['Row'];

const draftKey = (id: string) => `hiktech.fire-report-draft.${id}`;
const sast = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('en-ZA', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit' }) : '—';
const noop = () => {};

/**
 * The fire incident report — the step that closes a Fire incident (0059).
 *
 * The report is filled in as a step-by-step wizard, as the police forms are:
 * one section per step, Next checks the step and Done checks the lot. The
 * incident details and the response timeline come from the incident and are
 * shown, not typed. Answers are kept on the phone until filed, so a dead
 * battery or another call does not lose them. Filing goes through the outbox;
 * the server files the report, resolves the incident and tells dispatch and
 * command.
 */
export default function FireReportScreen() {
  const { t } = useT();
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
  // Set once File is pressed: from then on the steps with something missing turn red.
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
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
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // Keep the draft on the phone as the firefighter types.
  useEffect(() => {
    if (!id || !draftLoaded.current) return;
    const timer = setTimeout(() => { void AsyncStorage.setItem(draftKey(id), JSON.stringify(answers)).catch(() => {}); }, 400);
    return () => clearTimeout(timer);
  }, [id, answers]);

  // Counts are whole numbers and amounts are money, as the form always took them.
  const set = (key: string, value: string) => setAnswers((cur) => ({ ...cur, [key]: fireAnswer(key, value) }));

  /** The officer's status as they last set it, delivered or not. */
  const status = useMemo(() => statusOnPhone(pending, id ?? '', incident?.status), [pending, id, incident]);
  const alreadyQueued = pending.some((e) => e.op.kind === 'fire_report' && e.op.incidentId === id);
  // Photos still waiting to send count as taken.
  const photos = photosOnFile + mediaOnPhone(pending, id ?? '').photos;

  /** The steps, with only the questions that apply to the answers so far. */
  const steps = useMemo(() => fireSteps(answers, photos), [answers, photos]);
  /** Everything still missing, with the fields to mark. */
  const missing = useMemo(() => fireStepProblems(answers, photos), [answers, photos]);
  const check = useCallback(
    (on: readonly ReportSection[], a: Record<string, string>) => problemsOn(fireStepProblems(a, photos), on),
    [photos],
  );

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
      t('File this fire report?'),
      t('It resolves {incident_number} and becomes a permanent record — it cannot be edited or deleted afterwards.', { incident_number: incident.incident_number }),
      [
        { text: t('Keep editing'), style: 'cancel' },
        { text: t('File report'), style: 'destructive', onPress: () => void submit() },
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
        t('Fire report filed'),
        online ? t('Your report for {incident_number} is on record.', { incident_number: incident.incident_number }) : t('Saved. It sends when you have signal.'),
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
        <Muted>{t('Preparing the fire report…')}</Muted>
      </View>
    );
  }
  if (!incident) {
    return (
      <View style={[styles.center, { paddingHorizontal: space.lg }]}>
        <EmptyState icon="alert-circle-outline" title={t('Incident not available')} body={t('It may have been reassigned, or you no longer have access to it.')} />
      </View>
    );
  }
  if (incident.report_filed_at || alreadyQueued) {
    return (
      <View style={[styles.center, { paddingHorizontal: space.lg }]}>
        <EmptyState
          icon="lock-closed-outline"
          title={t('Fire report already filed')}
          body={alreadyQueued ? t('It is waiting for signal and sends automatically.') : t('Your fire report is on record.')}
        />
      </View>
    );
  }
  if (!leadsOnPhone(incident, session?.user.id, pending, incident.id)) {
    return (
      <View style={[styles.center, { paddingHorizontal: space.lg }]}>
        <EmptyState icon="person-outline" title={t('Not your incident')} body={t('Only the firefighter leading this incident files its fire report.')} />
      </View>
    );
  }

  const onScene = status === 'Arrived' || status === 'On Scene' || status === 'Transporting';
  const arrived = incident.arrived_timestamp ? new Date(incident.arrived_timestamp).getTime() : null;
  const tone = colors.accent;
  const ready = missing.length === 0;
  const overall = answeredCount(steps, answers);

  const tiles: StepTile[] = steps.map((s) => {
    const toFix = problemsOn(missing, [s]).length;
    const { answered, total } = answeredCount([s], answers);
    const state = tried && toFix
      ? (toFix === 1 ? t('1 to fix') : t('{n} to fix', { n: toFix }))
      : s.key === FIRE_PHOTOS_STEP && photos
        ? (photos === 1 ? t('1 photo') : t('{n} photos', { n: photos }))
        : t('{answered} of {total} answered', { answered, total });
    return {
      key: s.key ?? s.title,
      title: s.title,
      icon: FIRE_STEP_ICONS[s.key ?? ''] ?? 'document-outline',
      state,
      done: !toFix && (answered > 0 || total === 0),
      toFix: tried && toFix > 0,
    };
  });

  /** The first step with something to fix, else the first. */
  const firstToFix = Math.max(0, steps.findIndex((s) => problemsOn(missing, [s]).length > 0));

  const spec: WizardSpec | null = openAt === null ? null : {
    code: 'FIRE',
    title: 'Fire incident report',
    tone,
    icon: 'flame',
    sections: steps,
  };

  /** What a step shows beside its questions: the incident's own record, and the photos. */
  const extra = (s: ReportSection) => {
    if (s.key === 'incident') {
      return (
        <View style={{ gap: space.md }}>
          <Card>
            <KeyValue label={t('Report number')} value={`FR-${incident.incident_number}`} />
            <KeyValue label={t('Date')} value={new Date(incident.call_timestamp ?? incident.incident_created_at).toLocaleDateString('en-ZA', { timeZone: 'Africa/Johannesburg' })} />
            <KeyValue label={t('Time of call')} value={sast(incident.call_timestamp ?? incident.incident_created_at)} />
          </Card>
          <Card>
            <Text style={styles.cardHead}>{t('Response timeline')}</Text>
            <View style={styles.synced}>
              <Ionicons name="lock-closed" size={12} color={colors.cyan} />
              <Text style={styles.syncedText}>{t('Timestamps auto-synced from the incident')}</Text>
            </View>
            <KeyValue label={t('Dispatched')} value={sast(incident.dispatch_time)} />
            <KeyValue label={t('Responding')} value={sast(incident.accepted_at)} />
            <KeyValue label={t('Arrived on scene')} value={sast(incident.arrived_timestamp)} />
            <View style={styles.total}>
              <Text style={styles.totalLabel}>{t('TOTAL TIME ON SCENE')}</Text>
              <Text style={styles.totalValue}>{arrived ? formatDuration((now - arrived) / 1000) : '—'}</Text>
            </View>
          </Card>
        </View>
      );
    }
    if (s.key === FIRE_PHOTOS_STEP) {
      return (
        <Card>
          <Muted>
            {photos
              ? photos === 1
                ? t('The photo on the incident is filed with this report.')
                : t('{n} photos on the incident are filed with this report.', { n: photos })
              : t('No photos on the incident yet. Add them from the incident screen, or say why there are none.')}
          </Muted>
        </Card>
      );
    }
    return null;
  };

  // Done: back to the report and straight on to filing, when on scene.
  const done = () => {
    setOpenAt(null);
    if (onScene) setTimeout(file, 350);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={styles.container}>
        <Card accent={tone}>
          <OrgMark style={styles.letterhead} />
          <View style={styles.rowBetween}>
            <View style={styles.titleRow}>
              <Ionicons name="flame" size={18} color={tone} />
              <Text style={styles.number}>{incident.incident_number}</Text>
            </View>
            <SeverityPill severity={incident.incident_severity} />
          </View>
          <Title>{incident.incident_type}</Title>
          <View style={styles.metaRow}>
            <Ionicons name="location-outline" size={13} color={colors.muted} />
            <Text style={styles.metaText}>{incident.location_address}</Text>
          </View>
          <View style={styles.metaRow}>
            <Ionicons name="camera-outline" size={13} color={colors.muted} />
            <Text style={styles.metaText}>{photos === 1 ? t('1 photo') : t('{n} photos', { n: photos })}</Text>
            <Text style={styles.link} onPress={() => router.push(`/incident/${incident.id}`)} accessibilityRole="link">{t('Open the incident')}</Text>
          </View>
        </Card>

        {!onScene ? <Banner tone="info">{t('Mark yourself on scene before filing. You can start writing now; the draft is kept.')}</Banner> : null}

        <ReportStartCard
          title={t('Fire incident report')}
          sub={ready ? t('Ready to file') : t('Step by step · {answered} of {total} answered', { answered: overall.answered, total: overall.total })}
          icon="flame"
          tone={tone}
          ready={ready}
          onPress={() => setOpenAt(ready ? 0 : firstToFix)}
        />

        <SectionLabel>{t('Steps')}</SectionLabel>
        <StepTiles tiles={tiles} tone={tone} onOpen={setOpenAt} />

        {/* Why it will not file, right where the button is pressed. */}
        {problems.length ? (
          <View style={{ marginBottom: space.sm }}>
            <Banner tone="error" onDismiss={() => setProblems([])}>
              {`${problems.length === 1 ? t('One thing is missing:') : t('{n} things are missing:', { n: problems.length })}\n• ${problems.map((p) => t(p)).join('\n• ')}`}
            </Banner>
          </View>
        ) : null}
        <Button
          label={t('File fire report')}
          icon="document-text"
          variant="success"
          size="lg"
          busy={busy}
          disabled={!onScene}
          onPress={file}
        />
        <Muted style={{ textAlign: 'center', marginTop: space.sm }}>
          {t('Filing resolves the incident. The report is permanent and visible to command and case managers.')}
        </Muted>
      </ScrollView>

      <ReportWizard
        spec={spec}
        answers={answers}
        set={set}
        addRow={noop}
        removeRow={noop}
        onDone={done}
        onClose={() => setOpenAt(null)}
        check={check}
        extra={extra}
        startStep={openAt ?? 0}
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
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5 },
  metaText: { ...type.small, color: colors.muted, flexShrink: 1 },
  link: { ...type.small, color: colors.accent, fontWeight: '800', marginLeft: 'auto' },
  cardHead: { ...type.bodyStrong, color: colors.text, marginBottom: space.sm },
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
