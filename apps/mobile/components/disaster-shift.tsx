import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { cleanupOnLogout, getShiftGateProgress, submitMentalCheck, toggleDuty } from '@criticom/api';
import { getSupabase } from '@/lib/supabase';
import { errorWords } from '@/lib/offline-cache-policy';
import { useAuth } from '@/lib/auth';
import { useDuty } from '@/lib/duty';
import { READINESS_ITEMS } from '@/lib/inspection-187c';
import { colors, radius, space, type, makeStyles } from '@/lib/theme';
import { Banner, Button, Card, Input, Muted, Stepper, Title } from '@/components/ui';
import { HikTechLogo } from '@/components/hiktech-logo';
import { tx } from '@criticom/db/i18n';
import { useT } from '@/lib/i18n';

type Step = 'loading' | 'intro' | 'readiness' | 'stood_down' | 'complete';
type ReadinessKey = (typeof READINESS_ITEMS)[number][0];
const STEPS = [tx('Welcome'), tx('Readiness')];
const errorText = (e: unknown) => errorWords(e, tx('Unable to connect. Check your connection and retry.'));

function saTodayStartIso() {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return new Date(`${day}T00:00:00+02:00`).toISOString();
}

/**
 * Disaster Management start of shift — V4's two steps: the welcome and the
 * readiness assessment, then on duty. No vehicle form (migration 0065).
 */
export function DisasterShift({ gated = false }: { gated?: boolean }) {
  const { t } = useT();
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, silo } = useAuth();
  const { refresh: refreshDuty, onDuty } = useDuty();
  const [step, setStep] = useState<Step>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [mental, setMental] = useState<Partial<Record<ReadinessKey, boolean>>>({});
  const [comments, setComments] = useState('');

  const init = useCallback(async () => {
    if (!session) return;
    try {
      const sb = getSupabase();
      const gate = await getShiftGateProgress(sb);
      if (gate.readiness) { setStep('complete'); return; }
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
  const submit = () => {
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
      setStep(passed ? 'complete' : 'stood_down');
    });
  };

  const goOnDuty = () => void run(async () => {
    if (!onDuty) await toggleDuty(getSupabase(), { onDuty: true });
    if (gated) {
      const cleared = await refreshDuty();
      if (!cleared) throw new Error('Your readiness is saved, but clearance could not be verified. Reconnect and retry.');
      router.replace('/');
    } else {
      await refreshDuty();
      router.push('/');
    }
  });

  const signOut = () => void run(async () => {
    const sb = getSupabase();
    await cleanupOnLogout(sb).catch(() => {});
    await sb.auth.signOut();
    router.replace('/login');
  });

  if (step === 'loading') {
    return <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>;
  }

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
            <Text style={styles.gateEyebrow}>{t('START OF SHIFT')}</Text>
          </View>
          <Button label={t('Sign out')} variant="subtle" size="sm" disabled={busy} onPress={signOut} />
        </View>
      ) : null}

      {error ? <Banner tone="error" onDismiss={() => setError(null)}>{error}</Banner> : null}
      {step === 'readiness' || step === 'stood_down' ? <Stepper steps={STEPS} current={1} /> : null}

      {step === 'intro' ? (
        <Card>
          <Text style={styles.eyebrow}>{t('DISASTER MANAGEMENT · STEP 1 OF 2')}</Text>
          <Ionicons name="warning-outline" size={40} color={colors.accent} style={{ marginVertical: space.md }} />
          <Title>{t('Start of Shift')}</Title>
          <Muted>{t('Begin your start-of-shift readiness check to go on duty.')}</Muted>
          <View style={{ marginTop: space.lg }}>
            <Button label={t('Go on Duty — Begin Check')} icon="play-circle-outline" variant="success" size="lg" onPress={() => setStep('readiness')} />
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
                <View style={styles.answerRow}>
                  {([true, false] as const).map((answer) => {
                    const active = mental[key] === answer;
                    const tone = answer ? colors.low : colors.critical;
                    return (
                      <Pressable
                        key={String(answer)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={`${label}: ${answer ? 'Yes' : 'No'}`}
                        onPress={() => setMental((m) => ({ ...m, [key]: answer }))}
                        style={[styles.answer, invalid && mental[key] === undefined && { borderColor: colors.critical }, active && { backgroundColor: tone, borderColor: tone }]}
                        hitSlop={4}
                      >
                        <Ionicons name={answer ? 'checkmark' : 'close'} size={17} color={active ? '#fff' : tone} />
                        <Text style={[styles.answerText, active && { color: '#fff' }]}>{answer ? t('Yes') : t('No')}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
            <View style={{ marginTop: space.md, marginBottom: space.lg }}>
              <Input label={t('Comments')} placeholder={t('Anything your supervisor should know (optional)')} value={comments} onChangeText={setComments} multiline />
            </View>
            <Button label={t('Submit Readiness Check')} icon="checkmark-done" size="lg" busy={busy} onPress={submit} />
          </View>
        </Card>
      ) : null}

      {step === 'stood_down' ? (
        <Card accent={colors.critical}>
          <Title>{t('Readiness check not passed')}</Title>
          <Muted>{t('You have not been placed on duty. Speak to your supervisor, then retake the check.')}</Muted>
          <View style={{ marginTop: space.lg }}>
            <Button label={t('Retake check')} icon="refresh" variant="outline" onPress={() => { setMental({}); setStep('readiness'); }} />
          </View>
        </Card>
      ) : null}

      {step === 'complete' ? (
        <Card accent={colors.low}>
          <View style={styles.done}><Ionicons name="shield-checkmark" size={30} color="#fff" /></View>
          <Title>{t('Ready for duty')}</Title>
          <Muted>{t('Your readiness check for today is on record.')}</Muted>
          <View style={{ marginTop: space.lg }}>
            <Button label={onDuty ? t('Go to Dashboard') : t('Go on Duty')} icon="arrow-forward-circle" variant="success" size="lg" busy={busy} onPress={goOnDuty} />
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
