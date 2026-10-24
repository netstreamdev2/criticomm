import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  cleanupOnLogout, endStandby, getMyPersonnel, getMyStandby, getShiftGateProgress, startStandby, submitMentalCheck,
  type StandbyRecord,
} from '@criticom/api';
import { STANDBY_KIT, kitMissing, standbyNumber, standbyProblems } from '@criticom/db/disaster';
import { getSupabase } from '@/lib/supabase';
import { errorWords } from '@/lib/offline-cache-policy';
import { useAuth } from '@/lib/auth';
import { useDuty } from '@/lib/duty';
import { READINESS_ITEMS } from '@/lib/inspection-187c';
import { colors, radius, space, type, makeStyles } from '@/lib/theme';
import { Banner, Button, Card, Input, KeyValue, Muted, Stepper, Title } from '@/components/ui';
import { FieldKitCard } from '@/components/field-kit-card';
import { HikTechLogo } from '@/components/hiktech-logo';
import { tx } from '@criticom/db/i18n';
import { useT } from '@/lib/i18n';

type Step = 'loading' | 'intro' | 'readiness' | 'stood_down' | 'standby' | 'on';
type ReadinessKey = (typeof READINESS_ITEMS)[number][0];
const STEPS = [tx('Welcome'), tx('Readiness'), tx('Standby')];
const errorText = (e: unknown) => errorWords(e, tx('Unable to connect. Check your connection and retry.'));

function saTodayStartIso() {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return new Date(`${day}T00:00:00+02:00`).toISOString();
}

/**
 * Disaster Management starts standby, not a shift (0107): eThekwini's
 * officers work a standby roster and are called out when a flood, a fire or a
 * major accident needs them. The readiness questions (V4's step 1 of 2), then
 * the number the call centre dials and the kit at hand, then on standby until
 * they end it. A missing item of kit is recorded for the supervisor, never a
 * reason to stay off standby.
 */
export function DisasterShift({ gated = false }: { gated?: boolean }) {
  const { t } = useT();
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, silo } = useAuth();
  const { refresh: refreshDuty } = useDuty();
  const [step, setStep] = useState<Step>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [mental, setMental] = useState<Partial<Record<ReadinessKey, boolean>>>({});
  const [comments, setComments] = useState('');
  const [number, setNumber] = useState('');
  const [kit, setKit] = useState<Partial<Record<string, boolean>>>({});
  const [standby, setStandby] = useState<StandbyRecord | null>(null);

  const init = useCallback(async () => {
    if (!session) return;
    try {
      const sb = getSupabase();
      const [gate, open, me] = await Promise.all([
        getShiftGateProgress(sb),
        getMyStandby(sb, session.user.id).catch(() => null),
        getMyPersonnel(sb, session.user.id).catch(() => null),
      ]);
      setNumber((cur) => cur || open?.contact_number || (me as { work_cellphone?: string | null } | null)?.work_cellphone || '');
      if (open) { setStandby(open); setStep('on'); return; }
      if (gate.readiness) { setStep('standby'); return; }
      // A check today that did not pass means the officer was stood down.
      const { data: today } = await sb.from('mental_checks').select('id')
        .eq('user_id', session.user.id).gte('timestamp', saTodayStartIso()).limit(1).maybeSingle();
      setStep(today ? 'stood_down' : 'intro');
    } catch (e) {
      setError(errorText(e));
      setStep('intro');
    }
  }, [session]);
  useEffect(() => { void init(); }, [init]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  const answered = READINESS_ITEMS.filter(([k]) => mental[k] !== undefined).length;
  const submitReadiness = () => {
    if (answered !== READINESS_ITEMS.length) {
      setInvalid(true);
      setError(t('Answer Yes or No for every readiness question.'));
      return;
    }
    void run(async () => {
      const { passed } = await submitMentalCheck(getSupabase(), {
        silo,
        memory_recall: Boolean(mental.memory_recall),
        judgment: Boolean(mental.judgment),
        situational_awareness: Boolean(mental.situational_awareness),
        not_under_influence: Boolean(mental.not_under_influence),
        anger_check: Boolean(mental.anger_check),
        reflexes: Boolean(mental.reflexes),
        comments,
      });
      setInvalid(false);
      setStep(passed ? 'standby' : 'stood_down');
    });
  };

  const goOnStandby = () => {
    const problems = standbyProblems({ number, kit });
    if (problems.length) {
      setInvalid(true);
      setError(problems.map((p) => t(p)).join('\n'));
      return;
    }
    void run(async () => {
      const row = await startStandby(getSupabase(), {
        contactNumber: standbyNumber(number) ?? number,
        kit: Object.fromEntries(STANDBY_KIT.map((k) => [k.key, Boolean(kit[k.key])])),
      });
      setStandby(row);
      setInvalid(false);
      const cleared = await refreshDuty();
      if (gated) {
        if (!cleared) throw new Error(t('Your standby is saved, but it could not be confirmed. Reconnect and retry.'));
        router.replace('/');
      } else {
        setStep('on');
      }
    });
  };

  const stopStandby = () => {
    Alert.alert(t('End standby?'), t('The call centre will no longer call you out.'), [
      { text: t('Cancel'), style: 'cancel' },
      {
        text: t('End standby'), style: 'destructive',
        onPress: () => void run(async () => {
          await endStandby(getSupabase());
          setStandby(null);
          await refreshDuty();
          setStep('standby');
        }),
      },
    ]);
  };

  const signOut = () => void run(async () => {
    const sb = getSupabase();
    await cleanupOnLogout(sb).catch(() => {});
    await sb.auth.signOut();
    router.replace('/login');
  });

  if (step === 'loading') {
    return <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>;
  }

  const stepNumber = step === 'intro' ? 0 : step === 'readiness' || step === 'stood_down' ? 1 : 2;
  const yesNo = (value: boolean | undefined, onPick: (v: boolean) => void, label: string) => (
    <View style={styles.answerRow}>
      {([true, false] as const).map((answer) => {
        const active = value === answer;
        const tone = answer ? colors.low : colors.critical;
        return (
          <Pressable
            key={String(answer)}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${label}: ${answer ? t('Yes') : t('No')}`}
            onPress={() => onPick(answer)}
            style={[styles.answer, invalid && value === undefined && { borderColor: colors.critical }, active && { backgroundColor: tone, borderColor: tone }]}
            hitSlop={4}
          >
            <Ionicons name={answer ? 'checkmark' : 'close'} size={17} color={active ? '#fff' : tone} />
            <Text style={[styles.answerText, active && { color: '#fff' }]}>{answer ? t('Yes') : t('No')}</Text>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={[styles.container, gated && { paddingTop: insets.top + space.md, paddingBottom: insets.bottom + space['3xl'] }]}
      keyboardShouldPersistTaps="handled"
    >
      {gated ? (
        <View style={styles.gateHeader}>
          <View style={{ gap: 4 }}>
            <HikTechLogo height={14} />
            <Text style={styles.gateEyebrow}>{t('START STANDBY')}</Text>
          </View>
          <Button label={t('Sign out')} variant="subtle" size="sm" disabled={busy} onPress={signOut} />
        </View>
      ) : null}

      {error ? <Banner tone="error" onDismiss={() => setError(null)}>{error}</Banner> : null}
      {step !== 'on' && step !== 'intro' ? <Stepper steps={STEPS} current={stepNumber} /> : null}

      {step === 'intro' ? (
        <Card>
          <Text style={styles.eyebrow}>{t('DISASTER MANAGEMENT · STANDBY')}</Text>
          <Ionicons name="radio-outline" size={40} color={colors.accent} style={{ marginVertical: space.md }} />
          <Title>{t('Start standby')}</Title>
          <Muted>{t('Check you are ready, then go on standby. You will be called out when you are needed.')}</Muted>
          <View style={{ marginTop: space.lg }}>
            <Button label={t('Begin')} icon="play-circle-outline" variant="success" size="lg" onPress={() => setStep('readiness')} />
          </View>
        </Card>
      ) : null}

      {step === 'readiness' ? (
        <Card>
          <Title>{t('Readiness Assessment')}</Title>
          <Muted>{t('Answer every question honestly.')}</Muted>
          <View style={{ marginTop: space.md }}>
            {READINESS_ITEMS.map(([key, label]) => (
              <View key={key} style={styles.question}>
                <Text style={[styles.questionLabel, invalid && mental[key] === undefined && { color: colors.critical }]}>
                  {label}<Text style={{ color: colors.critical }}> *</Text>
                </Text>
                {yesNo(mental[key], (v) => setMental((m) => ({ ...m, [key]: v })), label)}
              </View>
            ))}
            <View style={{ marginTop: space.md, marginBottom: space.lg }}>
              <Input label={t('Comments')} placeholder={t('Anything your supervisor should know (optional)')} value={comments} onChangeText={setComments} multiline />
            </View>
            <Button label={t('Submit Readiness Check')} icon="checkmark-done" size="lg" busy={busy} onPress={submitReadiness} />
          </View>
        </Card>
      ) : null}

      {step === 'stood_down' ? (
        <Card accent={colors.critical}>
          <Title>{t('Readiness check not passed')}</Title>
          <Muted>{t('You cannot go on standby. Speak to your supervisor, then retake the check.')}</Muted>
          <View style={{ marginTop: space.lg }}>
            <Button label={t('Retake check')} icon="refresh" variant="outline" onPress={() => { setMental({}); setInvalid(false); setStep('readiness'); }} />
          </View>
        </Card>
      ) : null}

      {step === 'standby' ? (
        <Card>
          <Title>{t('Your standby')}</Title>
          <Muted>{t('The call centre calls this number when you are needed.')}</Muted>
          <View style={{ marginTop: space.md }}>
            <Input
              label={t('Phone number')}
              value={number}
              onChangeText={setNumber}
              keyboardType="phone-pad"
              placeholder="082 123 4567"
              style={invalid && !standbyNumber(number) ? { borderColor: colors.critical } : undefined}
            />
          </View>
          <Text style={[styles.kitTitle, { marginTop: space.lg }]}>{t('Kit at hand')}</Text>
          {STANDBY_KIT.map((k) => (
            <View key={k.key} style={styles.question}>
              <Text style={[styles.questionLabel, invalid && kit[k.key] === undefined && { color: colors.critical }]}>{t(k.label)}</Text>
              {yesNo(kit[k.key], (v) => setKit((cur) => ({ ...cur, [k.key]: v })), t(k.label))}
            </View>
          ))}
          {kitMissing(kit).length ? (
            <Muted style={{ marginBottom: space.md }}>{t('Your supervisor will see what is missing.')}</Muted>
          ) : null}
          <Button label={t('Start standby')} icon="radio" variant="success" size="lg" busy={busy} onPress={goOnStandby} />
        </Card>
      ) : null}

      {step === 'on' && standby ? (
        <Card accent={colors.low}>
          <View style={styles.done}><Ionicons name="radio" size={28} color="#fff" /></View>
          <Title>{t('On standby')}</Title>
          <Muted>{t('You will be called out when you are needed.')}</Muted>
          <View style={{ marginTop: space.md }}>
            <KeyValue label={t('Since')} value={new Date(standby.started_at).toLocaleString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} />
            <KeyValue label={t('Phone number')} value={standby.contact_number ?? t('Not given')} />
            {standby.kit_missing.length ? (
              <KeyValue label={t('Kit missing')} value={standby.kit_missing.map((k) => t(k)).join(', ')} />
            ) : null}
          </View>
          <View style={{ marginTop: space.md }}><FieldKitCard /></View>
          <View style={{ marginTop: space.lg, gap: space.sm }}>
            <Button label={t('Go to Dashboard')} icon="arrow-forward-circle" variant="success" size="lg" onPress={() => router.push('/')} />
            <Button label={t('End standby')} icon="moon-outline" variant="outline" busy={busy} onPress={stopStandby} />
          </View>
        </Card>
      ) : null}
    </ScrollView>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  container: { padding: space.lg, paddingBottom: space['3xl'], gap: space.md },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  gateHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  gateEyebrow: { ...type.label, color: colors.accent },
  eyebrow: { ...type.label, color: colors.accent },
  question: { paddingVertical: space.md },
  questionLabel: { ...type.bodyStrong, color: colors.text, marginBottom: space.sm, lineHeight: 21 },
  kitTitle: { ...type.bodyStrong, color: colors.text, fontSize: 16 },
  answerRow: { flexDirection: 'row', gap: space.sm },
  answer: {
    flex: 1, minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgElevated,
  },
  answerText: { color: colors.textDim, fontSize: 16, fontWeight: '700' },
  done: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: colors.low, alignItems: 'center', justifyContent: 'center',
    marginBottom: space.md,
  },
}));
