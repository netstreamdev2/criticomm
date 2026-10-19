import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import {
  answeredCount, CASE_SECTIONS, checkSections, composeReportType, forDepartment, formSections, getIncident, getMyBodycam,
  listIncidentAttachments, POLICE_REPORT_FORMS, rowCount, rowsKey, sectionFields, splitReportAnswers, suggestFormsFor,
  validateReportAnswers, type PoliceReportForm, type ReportSection,
} from '@criticom/api';
import type { Database } from '@criticom/db/types';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useSync } from '@/lib/sync';
import { leadsOnPhone, mediaOnPhone, statusOnPhone } from '@/lib/outbox';
import { setReportingFor } from '@/lib/open-call';
import { colors, radius, space, type, makeStyles } from '@/lib/theme';
import { Banner, Button, Card, EmptyState, Muted, SectionLabel, SeverityPill, Title } from '@/components/ui';
import { OrgMark } from '@/components/org-mark';
import { onTone, ReportWizard, type WizardSpec } from '@/components/report-wizard';
import { useT } from '@/lib/i18n';

type Incident = Database['public']['Tables']['incidents']['Row'];
type IconName = keyof typeof Ionicons.glyphMap;

const draftKey = (id: string) => `hiktech.report-draft.${id}`;

/** Each DMPS form's picture on its tile and in its wizard. */
const FORM_ICON: Record<string, IconName> = {
  arrest: 'hand-left-outline',
  accident: 'car-sport-outline',
  vehicle: 'construct-outline',
  firearm: 'locate-outline',
  incident: 'warning-outline',
  tow: 'trail-sign-outline',
  dog: 'paw-outline',
};

/**
 * The officer's case report — the step that finishes their part of a call.
 *
 * A short page: the case report (response, outcome, evidence, narrative),
 * which every report needs, and the seven DMPS forms, which are optional.
 * Each is a coloured tile; tapping one opens it full screen as a step-by-step
 * wizard, and Done puts a tick on the tile. Only ticked forms are filed, with
 * the case report, as one report. Answers are kept as a draft on the phone
 * until filed, so a crash or a dead battery loses nothing. Filing goes
 * through the outbox like every other field action.
 */
export default function IncidentReportScreen() {
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
  // The DMPS forms ticked Done; null until the incident has loaded.
  const [forms, setForms] = useState<string[] | null>(null);
  const reportType = useMemo(() => (forms ? composeReportType(forms) : null), [forms]);
  const [suggested, setSuggested] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [evidenceOnFile, setEvidence] = useState({ photos: 0, voice: 0 });
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  /** The wizard open: 'case' or a form id. */
  const [open, setOpen] = useState<string | null>(null);
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
    setForms((saved.forms ?? []).filter((f) => POLICE_REPORT_FORMS.some((x) => x.id === f)));
    // The call type hints at a form; "incident" is only the fallback, so no hint then.
    const hint = inc ? suggestFormsFor(inc)[0] : undefined;
    setSuggested(hint && hint !== 'incident' ? hint : null);
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
    const timer = setTimeout(() => {
      void AsyncStorage.setItem(draftKey(id), JSON.stringify({ forms, answers })).catch(() => {});
    }, 400);
    return () => clearTimeout(timer);
  }, [id, forms, answers]);

  const set = useCallback((key: string, value: string) => setAnswers((cur) => ({ ...cur, [key]: value })), []);
  /** Add a row to a repeated section, or take the last one off (its answers go with it). */
  const addRow = useCallback((section: ReportSection) => setAnswers((cur) => ({ ...cur, [rowsKey(section)]: String(rowCount(section, cur) + 1) })), []);
  const removeRow = useCallback((section: ReportSection) => setAnswers((cur) => {
    const n = rowCount(section, cur);
    const next = { ...cur, [rowsKey(section)]: String(n - 1) };
    for (const { key, row } of sectionFields(section, cur)) if (row === n) delete next[key];
    return next;
  }), []);

  /** The officer's status as they last set it, delivered or not. */
  const status = useMemo(() => statusOnPhone(pending, id ?? '', incident?.status), [pending, id, incident]);
  const alreadyQueued = pending.some((e) => e.op.kind === 'incident_report' && e.op.incidentId === id);
  // Photos and voice notes still waiting to send count as taken.
  const evidence = useMemo(() => {
    const waiting = mediaOnPhone(pending, id ?? '');
    return { photos: evidenceOnFile.photos + waiting.photos, voice: evidenceOnFile.voice + waiting.voice };
  }, [pending, id, evidenceOnFile]);

  const caseDone = checkSections(CASE_SECTIONS, answers).length === 0;
  const caseCount = answeredCount(CASE_SECTIONS, answers);

  // Once fixed, a problem leaves the list by itself (re-checked only while some are showing).
  const showing = problems.length > 0;
  useEffect(() => {
    if (showing && reportType) setProblems(validateReportAnswers(reportType, answers));
  }, [showing, reportType, answers]);

  const spec: WizardSpec | null = useMemo(() => {
    if (!open) return null;
    if (open === 'case') {
      return { code: 'CASE', title: 'Case report', tone: colors.accent, icon: 'document-text-outline', sections: CASE_SECTIONS };
    }
    const form = POLICE_REPORT_FORMS.find((f) => f.id === open);
    if (!form) return null;
    return { code: form.code, title: form.label, tone: form.tone, icon: FORM_ICON[form.id] ?? 'document-outline', sections: formSections(form.id) };
  }, [open]);

  const markDone = () => {
    if (open && open !== 'case') {
      setForms((cur) => {
        const next = new Set([...(cur ?? []), open]);
        return POLICE_REPORT_FORMS.map((f) => f.id).filter((f) => next.has(f));
      });
    }
    setOpen(null);
  };

  /** Take a form off the report; its answers go with it. */
  const removeForm = (form: PoliceReportForm) => {
    Alert.alert(t('Remove {code}?', { code: form.code }), t('{label} comes off this report and its answers are cleared.', { label: t(form.label) }), [
      { text: t('Keep it'), style: 'cancel' },
      {
        text: t('Remove'),
        style: 'destructive',
        onPress: () => {
          setForms((cur) => (cur ?? []).filter((f) => f !== form.id));
          setAnswers((cur) => Object.fromEntries(Object.entries(cur).filter(([k]) =>
            !k.startsWith(`${form.id}_`) && !k.startsWith(`rows_${form.id}_`) && !k.startsWith(`rows_${form.code} · `))));
          setOpen(null);
        },
      },
    ]);
  };

  const file = () => {
    if (!incident || !reportType) return;
    const found = validateReportAnswers(reportType, answers);
    setProblems(found);
    if (found.length) {
      // The ticked forms were checked at Done: what is left is the case report.
      if (checkSections(CASE_SECTIONS, answers).length) setOpen('case');
      return;
    }

    Alert.alert(
      t('File this report?'),
      t('The report on {incident_number} becomes a permanent record — it cannot be edited or deleted afterwards.', { incident_number: incident.incident_number }),
      [
        { text: t('Keep editing'), style: 'cancel' },
        {
          text: t('File report'),
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
        t('Report filed'),
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
        <Muted>{t('Preparing the report…')}</Muted>
      </View>
    );
  }

  if (!incident || !reportType) {
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
          title={t('Report already filed')}
          body={alreadyQueued
            ? t('It is waiting for signal and sends automatically.')
            : t('Your report is on record.')}
        />
      </View>
    );
  }

  if (!leadsOnPhone(incident, session?.user.id, pending, incident.id)) {
    return (
      <View style={[styles.center, { paddingHorizontal: space.lg }]}>
        <EmptyState
          icon="person-outline"
          title={t('Not your incident')}
          body={t('Only the lead officer on this incident can file its report.')}
        />
      </View>
    );
  }

  const onScene = status === 'Arrived' || status === 'On Scene' || status === 'Transporting';
  const done = forms ?? [];
  const filing = [t('Case report'), ...POLICE_REPORT_FORMS.filter((f) => done.includes(f.id)).map((f) => f.code)];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={styles.container}>
        <Card>
          <OrgMark police style={styles.letterhead} />
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
              {evidence.photos === 1 ? t('1 photo') : t('{n} photos', { n: evidence.photos })} · {evidence.voice === 1 ? t('1 voice note on file') : t('{n} voice notes on file', { n: evidence.voice })}
            </Text>
          </View>
        </Card>

        {!onScene ? (
          <Banner tone="info">{t('Mark yourself On Scene before filing — the report can be drafted now.')}</Banner>
        ) : null}

        {/* The case report: every report has it. */}
        <Pressable
          onPress={() => setOpen('case')}
          accessibilityRole="button"
          accessibilityLabel={caseDone ? t('Case report, done') : t('Case report, required')}
          style={({ pressed }) => [styles.caseCard, caseDone && styles.caseDone, pressed && { opacity: 0.85 }]}
        >
          <View style={[styles.caseIcon, { backgroundColor: colors.accent }]}>
            <Ionicons name="document-text" size={20} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.caseTitle}>{t('Case report')}</Text>
            <Text style={styles.caseSub}>
              {caseDone ? t('Ready') : t('Response, outcome, evidence and narrative · {answered} of {total}', { answered: caseCount.answered, total: caseCount.total })}
            </Text>
          </View>
          {caseDone ? (
            <View style={[styles.tick, { backgroundColor: colors.low }]}><Ionicons name="checkmark" size={16} color="#fff" /></View>
          ) : (
            <View style={styles.requiredChip}><Text style={styles.requiredText}>{t('REQUIRED')}</Text></View>
          )}
        </Pressable>

        <SectionLabel>{t('DMPS forms · optional')}</SectionLabel>
        <View style={styles.grid}>
          {POLICE_REPORT_FORMS.map((f) => {
            const ticked = done.includes(f.id);
            const { answered } = answeredCount(formSections(f.id), answers);
            const ink = onTone(f.tone);
            return (
              <Pressable
                key={f.id}
                onPress={() => setOpen(f.id)}
                onLongPress={ticked ? () => removeForm(f) : undefined}
                accessibilityRole="button"
                accessibilityLabel={`${f.code} ${t(f.label)}${ticked ? `, ${t('done')}` : answered ? `, ${t('{n} answered', { n: answered })}` : ''}`}
                style={({ pressed }) => [
                  styles.tile,
                  { borderColor: ticked ? f.tone : `${f.tone}55`, backgroundColor: ticked ? `${f.tone}2e` : `${f.tone}12` },
                  pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
                ]}
              >
                <View style={[styles.tileBand, { backgroundColor: f.tone }]} />
                <View style={styles.tileHead}>
                  <View style={[styles.tileIcon, { backgroundColor: ticked ? f.tone : `${f.tone}33` }]}>
                    <Ionicons name={FORM_ICON[f.id] ?? 'document-outline'} size={16} color={ticked ? ink : f.tone} />
                  </View>
                  {ticked ? (
                    <View style={[styles.tick, { backgroundColor: f.tone }]}><Ionicons name="checkmark" size={15} color={ink} /></View>
                  ) : (
                    <Ionicons name="add-circle-outline" size={20} color={`${f.tone}cc`} />
                  )}
                </View>
                <Text style={[styles.tileCode, { color: f.tone }]}>{f.code}</Text>
                <Text style={styles.tileLabel} numberOfLines={2}>{t(f.label)}</Text>
                <Text style={styles.tileState} numberOfLines={1}>
                  {ticked ? t('Done') : answered ? t('{answered} answered · not done', { answered }) : suggested === f.id ? t('Suggested for this call') : t('Tap to fill')}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {problems.length > 0 ? (
          <Banner tone="error" onDismiss={() => setProblems([])}>
            {`${problems.length === 1 ? t('One thing is missing:') : t('{n} things are missing:', { n: problems.length })}\n• ${problems.join('\n• ')}`}
          </Banner>
        ) : null}

        <View style={styles.summary}>
          <Ionicons name="layers-outline" size={14} color={colors.muted} />
          <Text style={styles.summaryText}>{t('Filing: {filing}', { filing: filing.join(' · ') })}</Text>
        </View>
        <Button
          label={t('File report')}
          icon="lock-closed"
          variant="success"
          size="lg"
          busy={busy}
          disabled={!onScene}
          onPress={file}
        />
        <Muted style={{ marginTop: space.sm, textAlign: 'center' }}>
          {t('Filed reports are permanent and visible to dispatch and command.')}
        </Muted>
      </ScrollView>

      <ReportWizard
        spec={spec}
        answers={answers}
        set={set}
        addRow={addRow}
        removeRow={removeRow}
        onDone={markDone}
        onClose={() => setOpen(null)}
        onRemove={open && open !== 'case' && done.includes(open)
          ? () => { const f = POLICE_REPORT_FORMS.find((x) => x.id === open); if (f) removeForm(f); }
          : undefined}
      />
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  container: { padding: space.lg, paddingBottom: space['3xl'] },
  center: {
    flex: 1, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center', gap: space.md,
  },
  letterhead: {
    marginBottom: space.md, paddingBottom: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  number: { ...type.mono, color: colors.accent, marginBottom: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5 },
  metaText: { ...type.small, color: colors.muted, flexShrink: 1 },

  caseCard: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, marginTop: space.md,
    borderRadius: radius.lg, borderWidth: 1.5, borderColor: `${colors.accent}88`, backgroundColor: colors.accentSoft,
  },
  caseDone: { borderColor: `${colors.low}aa`, backgroundColor: colors.lowSoft },
  caseIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  caseTitle: { ...type.bodyStrong, fontSize: 16, color: colors.text, fontWeight: '800' },
  caseSub: { ...type.small, fontSize: 12, color: colors.textDim, marginTop: 2 },
  requiredChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.accent },
  requiredText: { color: '#fff', fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  tick: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.md },
  tile: {
    width: '48%', flexGrow: 1, padding: space.md, paddingLeft: space.md + 4, borderRadius: radius.lg,
    borderWidth: 1.5, overflow: 'hidden', minHeight: 124,
  },
  tileBand: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  tileHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tileIcon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  tileCode: { fontSize: 12, fontWeight: '900', letterSpacing: 1, marginTop: space.sm },
  tileLabel: { ...type.bodyStrong, color: colors.text, marginTop: 1 },
  tileState: { ...type.small, fontSize: 11, color: colors.muted, marginTop: 4 },

  summary: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: space.sm },
  summaryText: { ...type.small, color: colors.textDim, fontWeight: '700', flex: 1 },
}));
