import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { getFireInspection, getFirePremises, type FirePremises } from '@criticom/api';
import {
  FIRE_INSPECTION_GROUPS, FIRE_INSPECTION_ITEMS, INSPECTION_KINDS, INSTRUCTIONS, NOTICE_DAYS, OCCUPANCIES, RISKS, SERVED,
  daysWords, failingItems, followUp, inspectionPayload, inspectionProblems, noticeDays, outcomeOf, usualRisk,
  type InspectionAnswer, type InspectionDraft,
} from '@criticom/db/fire-inspection';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useSync } from '@/lib/sync';
import { departmentOf } from '@/lib/department';
import { hereNow } from '@/lib/here';
import { colors, radius, space, makeStyles } from '@/lib/theme';
import { Banner, Button, Card, EmptyState, Input, KeyValue, Muted, Stepper, Title } from '@/components/ui';
import { tx } from '@criticom/db/i18n';
import { useT } from '@/lib/i18n';

type Step = 'site' | 'checks' | 'outcome' | 'sign';
const STEPS = [tx('Site'), tx('Checks'), tx('Outcome'), tx('Sign off')];
const ORDER: Step[] = ['site', 'checks', 'outcome', 'sign'];
const SITE_KEYS = new Set(['name', 'address', 'occupancy', 'risk', 'kind', 'contact_number']);
const CHECK_KEYS = new Set(FIRE_INSPECTION_ITEMS.map((i) => i.key));
const draftKey = (premisesId: string | undefined) => `hiktech.inspection-draft.${premisesId ?? 'new'}`;

/**
 * A fire safety site inspection (0106), as the eThekwini Fire By-law has it:
 * the site, the checks by by-law section, what follows (compliant, a
 * compliance notice with days to put each fault right, or an instruction to
 * close, evacuate or stop), and how the notice was served. Kept on the phone
 * until it sends; filed through the outbox.
 */
export default function NewInspectionScreen() {
  const { t } = useT();
  const styles = useStyles();
  const router = useRouter();
  const { premises: premisesId } = useLocalSearchParams<{ premises?: string }>();
  const { silo } = useAuth();
  const { enqueue, online } = useSync();
  const scroll = useRef<ScrollView>(null);
  const [step, setStep] = useState<Step>('site');
  const [premises, setPremises] = useState<FirePremises | null>(null);
  const [lastNotice, setLastNotice] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<InspectionDraft>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [marked, setMarked] = useState<Set<string>>(new Set());
  // The risk follows the use until the inspector picks it themselves.
  const [riskChosen, setRiskChosen] = useState(false);
  const loaded = useRef(false);

  const load = useCallback(async () => {
    const sb = getSupabase();
    let p: FirePremises | null = null;
    if (premisesId) p = await getFirePremises(sb, premisesId).catch(() => null);
    setPremises(p);
    // Following up a notice: the faults it named are checked again first.
    if (p?.last_inspection_id && p.last_outcome && p.last_outcome !== 'Compliant') {
      const prev = await getFireInspection(sb, p.last_inspection_id).catch(() => null);
      setLastNotice(new Set((prev?.notice_items ?? []).map((n) => n.key)));
    }
    let kept: InspectionDraft = {};
    try { kept = JSON.parse((await AsyncStorage.getItem(draftKey(premisesId)).catch(() => null)) ?? '{}'); } catch { kept = {}; }
    setDraft({
      premises_id: p?.id ?? null,
      kind: p?.last_outcome && p.last_outcome !== 'Compliant' ? 'Re-inspection' : 'Routine',
      contact_person: p?.contact_person ?? '',
      contact_number: p?.contact_number ?? '',
      ...kept,
      ...(p ? { premises_id: p.id } : {}),
    });
    loaded.current = true;
    setLoading(false);
  }, [premisesId]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!loaded.current) return;
    const timer = setTimeout(() => { void AsyncStorage.setItem(draftKey(premisesId), JSON.stringify(draft)).catch(() => {}); }, 400);
    return () => clearTimeout(timer);
  }, [premisesId, draft]);

  const set = <K extends keyof InspectionDraft>(key: K, value: InspectionDraft[K]) => setDraft((cur) => ({ ...cur, [key]: value }));
  const answer = (key: string, a: InspectionAnswer) => setDraft((cur) => ({ ...cur, checklist: { ...(cur.checklist ?? {}), [key]: a } }));

  const all = useMemo(() => inspectionProblems(draft), [draft]);
  const failing = failingItems(draft.checklist);
  const outcome = outcomeOf(draft);
  const dates = followUp({ ...draft, risk: premises?.risk ?? draft.risk });
  const answered = FIRE_INSPECTION_ITEMS.filter((i) => draft.checklist?.[i.key]).length;

  const go = (next: Step) => {
    setStep(next);
    setProblems([]);
    setMarked(new Set());
    scroll.current?.scrollTo({ y: 0, animated: false });
  };
  const next = () => {
    const keys = step === 'site' ? SITE_KEYS : step === 'checks' ? CHECK_KEYS : null;
    const here = keys ? all.filter((p) => p.keys.some((k) => keys.has(k))) : [];
    if (here.length) {
      setProblems(here.map((p) => t(p.message)));
      setMarked(new Set(here.flatMap((p) => p.keys)));
      return;
    }
    go(ORDER[ORDER.indexOf(step) + 1] ?? 'sign');
  };
  const back = () => go(ORDER[ORDER.indexOf(step) - 1] ?? 'site');

  /** The address from where the phone is: for a new site, typed over if it is wrong. */
  const useMyLocation = async () => {
    setLocating(true);
    try {
      const here = await hereNow();
      if (!here) { setProblems([t('Your location could not be found. Type the address.')]); return; }
      set('lat', here.lat); set('lng', here.lng); set('accuracy', here.accuracy);
      const [a] = await Location.reverseGeocodeAsync({ latitude: here.lat, longitude: here.lng }).catch(() => []);
      if (a) {
        const street = [a.streetNumber, a.street].filter(Boolean).join(' ') || a.name || '';
        const address = [street, a.district || a.subregion, a.city].filter(Boolean).join(', ');
        if (address) set('address', address);
      }
    } finally {
      setLocating(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    try {
      const here = draft.lat != null ? null : await hereNow();
      const fields = inspectionPayload({
        ...draft,
        ...(here ? { lat: here.lat, lng: here.lng, accuracy: here.accuracy } : {}),
      });
      const label = premises?.name ?? String(fields.name ?? '');
      await enqueue({ kind: 'fire_inspection', fields, label });
      await AsyncStorage.removeItem(draftKey(premisesId)).catch(() => {});
      Alert.alert(
        t('Inspection filed'),
        online ? t('{name} is on record.', { name: label }) : t('Saved. It sends when you have signal.'),
        [{ text: t('OK'), onPress: () => router.replace('/inspections') }],
      );
    } catch (e) {
      setProblems([(e as Error).message]);
    } finally {
      setBusy(false);
    }
  };

  const file = () => {
    if (all.length) {
      setProblems(all.map((p) => t(p.message)));
      setMarked(new Set(all.flatMap((p) => p.keys)));
      return;
    }
    const body = outcome === 'Compliant'
      ? t('The site is compliant.')
      : outcome === 'Instruction'
        ? t('{instruction}. Fire command is told at once.', { instruction: t(draft.instruction ?? '') })
        : t('{n} faults to put right by {date}.', { n: failing.length, date: dates.complyBy ?? '' });
    Alert.alert(t('File the inspection?'), body, [
      { text: t('Keep editing'), style: 'cancel' },
      { text: t('File'), onPress: () => void submit() },
    ]);
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>;
  if (departmentOf(silo) !== 'fire') {
    return (
      <View style={[styles.center, { paddingHorizontal: space.lg }]}>
        <EmptyState icon="lock-closed-outline" title={t('For Fire & Rescue')} body={t('Site inspections are done by Fire & Rescue.')} />
      </View>
    );
  }

  const chip = (label: string, on: boolean, onPress: () => void, tone: string = colors.accent, bad = false) => (
    <Pressable
      key={label}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      style={[styles.chip, bad && { borderColor: colors.critical }, on && { backgroundColor: tone, borderColor: tone }]}
    >
      <Text style={[styles.chipText, on && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );
  const answerButton = (key: string, a: InspectionAnswer, current: InspectionAnswer | undefined) => {
    const tone = a === 'yes' ? colors.low : a === 'no' ? colors.critical : colors.muted;
    const on = current === a;
    return (
      <Pressable
        key={a}
        onPress={() => answer(key, a)}
        accessibilityRole="radio"
        accessibilityState={{ selected: on }}
        style={[styles.answer, marked.has(key) && !current && { borderColor: colors.critical }, on && { backgroundColor: tone, borderColor: tone }]}
        hitSlop={4}
      >
        <Text style={[styles.answerText, on && { color: '#fff' }]}>{a === 'yes' ? t('Yes') : a === 'no' ? t('No') : t('N/A')}</Text>
      </Pressable>
    );
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scroll} style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Stepper steps={STEPS} current={ORDER.indexOf(step)} />

        {problems.length ? (
          <View style={{ marginVertical: space.sm }}>
            <Banner tone="error" onDismiss={() => setProblems([])}>{`• ${problems.join('\n• ')}`}</Banner>
          </View>
        ) : null}

        {step === 'site' ? (
          <Card>
            {premises ? (
              <>
                <Title>{premises.name}</Title>
                <Muted>{premises.address}</Muted>
                <View style={{ marginTop: space.md }}>
                  <KeyValue label={t('Used as')} value={t(premises.occupancy)} />
                  <KeyValue label={t('Risk')} value={t(premises.risk)} />
                  <KeyValue label={t('Last outcome')} value={premises.last_outcome ? t(premises.last_outcome) : t('Never inspected')} />
                  {premises.next_due ? <KeyValue label={t('Due')} value={premises.next_due} /> : null}
                </View>
              </>
            ) : (
              <>
                <Title>{t('New site')}</Title>
                <View style={styles.field}>
                  <Input label={t('Business or site name')} value={draft.name ?? ''} onChangeText={(v) => set('name', v)}
                    style={marked.has('name') ? { borderColor: colors.critical } : undefined} />
                </View>
                <View style={styles.field}>
                  <Input label={t('Address')} value={draft.address ?? ''} onChangeText={(v) => set('address', v)}
                    style={marked.has('address') ? { borderColor: colors.critical } : undefined} />
                  <Pressable onPress={() => void useMyLocation()} style={styles.link} accessibilityRole="button">
                    {locating ? <ActivityIndicator size="small" color={colors.accent} /> : <Ionicons name="locate" size={15} color={colors.accent} />}
                    <Text style={styles.linkText}>{t('Use where I am')}</Text>
                  </Pressable>
                </View>
                <Text style={[styles.label, marked.has('occupancy') && { color: colors.critical }]}>{t('Used as')}</Text>
                <View style={styles.chips}>
                  {OCCUPANCIES.map((o) => chip(t(o), draft.occupancy === o, () => setDraft((cur) => ({
                    ...cur, occupancy: o, risk: riskChosen ? cur.risk : usualRisk(o),
                  }))))}
                </View>
                <Text style={[styles.label, marked.has('risk') && { color: colors.critical }]}>{t('Risk')}</Text>
                <View style={styles.chips}>
                  {RISKS.map((r) => chip(t(r), draft.risk === r, () => { setRiskChosen(true); set('risk', r); }))}
                </View>
              </>
            )}
            <Text style={[styles.label, marked.has('kind') && { color: colors.critical }]}>{t('Why you are here')}</Text>
            <View style={styles.chips}>{INSPECTION_KINDS.map((k) => chip(t(k), draft.kind === k, () => set('kind', k)))}</View>
            <View style={styles.field}>
              <Input label={t('Contact person')} value={draft.contact_person ?? ''} onChangeText={(v) => set('contact_person', v)} />
            </View>
            <View style={styles.field}>
              <Input label={t('Contact number')} value={draft.contact_number ?? ''} onChangeText={(v) => set('contact_number', v)} keyboardType="phone-pad"
                style={marked.has('contact_number') ? { borderColor: colors.critical } : undefined} />
            </View>
          </Card>
        ) : null}

        {step === 'checks' ? (
          <>
            <Muted>{t('{answered} of {total} checked', { answered, total: FIRE_INSPECTION_ITEMS.length })}</Muted>
            {FIRE_INSPECTION_GROUPS.map((g) => (
              <View key={g.id}>
                <View style={styles.sectionHead}>
                  <Ionicons name={g.icon as keyof typeof Ionicons.glyphMap} size={16} color={colors.accent} />
                  <Text style={styles.sectionTitle}>{t(g.title)}</Text>
                  <View style={{ flex: 1 }} />
                  <Pressable
                    onPress={() => setDraft((cur) => ({ ...cur, checklist: { ...(cur.checklist ?? {}), ...Object.fromEntries(g.items.map((i) => [i.key, 'yes'])) } }))}
                    accessibilityRole="button"
                    hitSlop={8}
                  >
                    <Text style={styles.linkText}>{t('All yes')}</Text>
                  </Pressable>
                </View>
                <Card>
                  {g.items.map((i, n) => (
                    <View key={i.key} style={[styles.check, n > 0 && styles.divider]}>
                      <Text style={[styles.checkLabel, marked.has(i.key) && !draft.checklist?.[i.key] && { color: colors.critical }]}>{t(i.label)}</Text>
                      <View style={styles.checkMeta}>
                        <Text style={styles.section}>{i.section}</Text>
                        {lastNotice.has(i.key) ? <Text style={styles.onNotice}>{t('On the last notice')}</Text> : null}
                      </View>
                      <View style={styles.answerRow}>
                        {(['yes', 'no', ...(i.na ? ['na'] : [])] as InspectionAnswer[]).map((a) => answerButton(i.key, a, draft.checklist?.[i.key]))}
                      </View>
                    </View>
                  ))}
                </Card>
              </View>
            ))}
          </>
        ) : null}

        {step === 'outcome' ? (
          <>
            {failing.length === 0 ? (
              <Card accent={colors.low}>
                <Title>{t('Compliant')}</Title>
                <Muted>{t('Every check passed. Next visit due {date}.', { date: dates.nextDue })}</Muted>
              </Card>
            ) : (
              <Card accent={colors.high}>
                <Title>{t('Compliance notice')}</Title>
                <Muted>{t('Choose how long the owner has to put each fault right.')}</Muted>
                {noticeDays(draft).map(({ item, days }) => (
                  <View key={item.key} style={[styles.check, styles.divider]}>
                    <Text style={styles.checkLabel}>{t(item.label)}</Text>
                    <Text style={styles.section}>{item.section} · {t(item.remedy)}</Text>
                    <View style={styles.chips}>
                      {NOTICE_DAYS.map((d) => chip(t(daysWords(d)), days === d,
                        () => setDraft((cur) => ({ ...cur, days: { ...(cur.days ?? {}), [item.key]: d } })), colors.high))}
                    </View>
                  </View>
                ))}
                <View style={{ marginTop: space.md }}>
                  <KeyValue label={t('Put right by')} value={dates.complyBy ?? '—'} />
                  <KeyValue label={t('Back to check on')} value={dates.reinspectOn ?? '—'} />
                </View>
              </Card>
            )}
            <Card>
              <Text style={styles.checkLabel}>{t('A danger that cannot wait?')}</Text>
              <View style={[styles.chips, { marginTop: space.sm }]}>
                {chip(t('No'), !draft.instruction, () => set('instruction', null))}
                {INSTRUCTIONS.map((i) => chip(t(i), draft.instruction === i, () => set('instruction', i), colors.critical))}
              </View>
              {draft.instruction ? (
                <View style={styles.field}>
                  <Input label={t('Why')} value={draft.instruction_reason ?? ''} onChangeText={(v) => set('instruction_reason', v)} multiline
                    style={[{ minHeight: 70, textAlignVertical: 'top' }, marked.has('instruction_reason') ? { borderColor: colors.critical } : null]} />
                </View>
              ) : null}
            </Card>
          </>
        ) : null}

        {step === 'sign' ? (
          <Card accent={outcome === 'Compliant' ? colors.low : outcome === 'Instruction' ? colors.critical : colors.high}>
            <Title>{t(outcome)}</Title>
            {outcome !== 'Compliant' ? (
              <>
                <Muted>{t('How the notice was served')}</Muted>
                <View style={[styles.chips, { marginTop: space.sm }]}>
                  {SERVED.map((s) => chip(t(s), draft.served === s, () => set('served', s), colors.accent, marked.has('served')))}
                </View>
              </>
            ) : null}
            <View style={styles.field}>
              <Input
                label={outcome === 'Compliant' ? t('Person in charge (optional)') : t('Person in charge')}
                value={draft.person_in_charge ?? ''}
                onChangeText={(v) => set('person_in_charge', v)}
                style={marked.has('person_in_charge') ? { borderColor: colors.critical } : undefined}
              />
            </View>
            <View style={styles.field}>
              <Input label={t('Notes (optional)')} value={draft.notes ?? ''} onChangeText={(v) => set('notes', v)} multiline
                style={{ minHeight: 80, textAlignVertical: 'top' }} />
            </View>
          </Card>
        ) : null}

        <View style={styles.nav}>
          {step !== 'site' ? <View style={{ flex: 1 }}><Button label={t('Back')} icon="arrow-back" variant="outline" onPress={back} /></View> : null}
          <View style={{ flex: 2 }}>
            {step === 'sign'
              ? <Button label={t('File inspection')} icon="document-text" variant="success" size="lg" busy={busy} onPress={file} />
              : <Button label={t('Next')} icon="arrow-forward" size="lg" onPress={next} />}
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  container: { padding: space.lg, paddingBottom: space['3xl'], gap: space.md },
  center: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' },
  field: { marginTop: space.md },
  label: { color: colors.textDim, fontSize: 12, fontWeight: '800', letterSpacing: 0.6, marginTop: space.md, marginBottom: space.sm },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.sm, alignSelf: 'flex-start' },
  linkText: { color: colors.accent, fontSize: 13, fontWeight: '800' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    minHeight: 40, paddingHorizontal: 12, justifyContent: 'center',
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgElevated,
  },
  chipText: { color: colors.text, fontSize: 14, fontWeight: '700' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: space.md, marginBottom: space.sm },
  sectionTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  check: { paddingVertical: space.md },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  checkLabel: { color: colors.text, fontSize: 15, fontWeight: '700', lineHeight: 21 },
  checkMeta: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: 2, marginBottom: space.sm },
  section: { color: colors.muted, fontSize: 12, fontWeight: '700', marginTop: 2, marginBottom: space.sm },
  onNotice: { color: colors.high, fontSize: 12, fontWeight: '800' },
  answerRow: { flexDirection: 'row', gap: space.sm },
  answer: {
    flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgElevated,
  },
  answerText: { color: colors.textDim, fontSize: 15, fontWeight: '800' },
  nav: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
}));
