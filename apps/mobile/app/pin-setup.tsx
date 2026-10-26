import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { mySignInPin } from '@criticom/api';
import { pinProblem } from '@criticom/db/sign-in-pin';
import { useAuth } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { errorWords } from '@/lib/offline-cache-policy';
import { choosePin, clearPinSetupOffer, type PinChoice } from '@/lib/pin-sign-in';
import { colors, space, type, makeStyles } from '@/lib/theme';
import { PinPad } from '@/components/pin-pad';
import { Banner, Button, Input, Muted } from '@/components/ui';
import { useT } from '@/lib/i18n';

type Step = 'current' | 'first' | 'again' | 'password';

/**
 * Choosing or changing the sign-in PIN (0110), straight with the database —
 * no web server, so a new Wi-Fi or a moved server does not get in the way.
 * Changing it: the current PIN, then the new one twice. Forgotten or locked:
 * the password instead. Straight after signing in with the password: just
 * the new PIN twice. The database checks it is really them, and the rules.
 */
export default function PinSetupScreen() {
  const { t } = useT();
  const styles = useStyles();
  const router = useRouter();
  const { change } = useLocalSearchParams<{ change?: string }>();
  const { session, fullName } = useAuth();
  const [checking, setChecking] = useState(true);
  const [hasPin, setHasPin] = useState(false);
  const [badge, setBadge] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('first');
  /** Forgotten or locked: the password proves it is them. */
  const [usePassword, setUsePassword] = useState(false);
  const [current, setCurrent] = useState('');
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const fromProfile = change === '1';

  const leave = () => {
    clearPinSetupOffer();
    if (fromProfile && router.canGoBack()) router.back();
    else router.replace('/');
  };

  useEffect(() => {
    if (!session) return;
    let gone = false;
    void (async () => {
      const sb = getSupabase();
      const [mine, me] = await Promise.all([
        mySignInPin(sb).catch(() => null),
        sb.from('profiles').select('badge_number').eq('id', session.user.id).maybeSingle(),
      ]);
      if (gone) return;
      setBadge((me.data as { badge_number?: string | null } | null)?.badge_number ?? null);
      setHasPin(Boolean(mine?.hasPin));
      // Offered after signing in, to someone who already has a PIN: nothing to do.
      if (mine?.hasPin && !fromProfile) { leave(); return; }
      if (mine?.locked) setUsePassword(true);
      setStep(mine?.hasPin && !mine.locked ? 'current' : 'first');
      setChecking(false);
    })();
    return () => { gone = true; };
    // Once, when the screen opens.
  }, [session?.user.id]);

  const startOver = () => {
    setFirst('');
    setSecond('');
    setStep('first');
  };

  const save = async (proof: { currentPin?: string; password?: string }) => {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const result: PinChoice = await choosePin({
        pin: first, currentPin: proof.currentPin ?? null, password: proof.password ?? null,
        userId: session.user.id, name: fullName || null, badge,
      });
      if (result.ok) { setDone(true); return; }
      switch (result.state) {
        case 'proof':
          setError(t('To make sure it is you, enter your password.'));
          setStep('password');
          break;
        case 'wrong_pin':
          setError(result.triesLeft === 1 ? t('Wrong PIN. 1 try left.') : t('Wrong PIN. {n} tries left.', { n: result.triesLeft ?? 0 }));
          setCurrent('');
          startOver();
          setStep('current');
          break;
        case 'locked':
          setError(t('Your PIN is locked after 5 wrong tries. Enter your password to choose a new one.'));
          setUsePassword(true);
          setStep('password');
          break;
        case 'wrong_password':
          setError(t('That password is not right.'));
          setPassword('');
          setStep('password');
          break;
        case 'busy':
          setError(t('Too many tries. Wait a few minutes, then try again.'));
          break;
        case 'rule':
          setError(t(result.message ?? 'Choose another PIN.'));
          startOver();
          break;
        default:
          setError(t(result.message ?? 'We could not save your PIN just now. Try again shortly.'));
      }
    } catch (e) {
      setError(errorWords(e));
    } finally {
      setBusy(false);
    }
  };

  const currentDone = (pin: string) => {
    setCurrent(pin);
    setError(null);
    setStep('first');
  };

  const firstDone = (pin: string) => {
    const problem = pinProblem(pin);
    if (problem) { setError(t(problem)); setFirst(''); return; }
    setError(null);
    setStep('again');
  };

  const againDone = (pin: string) => {
    if (pin !== first) {
      setError(t('The two PINs are not the same. Enter your new PIN again.'));
      startOver();
      return;
    }
    if (usePassword) { setStep('password'); return; }
    void save(current ? { currentPin: current } : {});
  };

  if (checking) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (done) {
    return (
      <View style={[styles.center, { padding: space.xl }]}>
        <Ionicons name="checkmark-circle" size={56} color={colors.low} />
        <Text style={styles.title}>{t('Your PIN is set')}</Text>
        <Muted style={{ textAlign: 'center' }}>
          {t('Next time, on any registered radio or phone, choose your name, then enter your PIN.')}
        </Muted>
        <View style={{ width: '100%', marginTop: space.lg }}>
          <Button label={t('Done')} icon="checkmark" size="lg" onPress={leave} />
        </View>
      </View>
    );
  }

  const prompt = step === 'current' ? t('Enter your current PIN')
    : step === 'first' ? t('Enter your new PIN')
      : step === 'again' ? t('Enter it again')
        : t('Enter your password');

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.badge}><Ionicons name="keypad" size={26} color={colors.accent} /></View>
        <Text style={styles.title}>{hasPin ? t('Change your PIN') : t('Choose your sign-in PIN')}</Text>
        <Muted style={{ textAlign: 'center' }}>
          {t('6 digits you will remember. Use it on any registered radio or phone instead of your password.')}
        </Muted>

        {error ? <Banner tone="error" onDismiss={() => setError(null)}>{error}</Banner> : null}

        <Text style={styles.prompt}>{prompt}</Text>
        {step === 'current' ? (
          <>
            <PinPad key="current" value={current} onChange={setCurrent} onFull={currentDone} disabled={busy} />
            <Text
              onPress={() => { setUsePassword(true); setError(null); setStep('first'); }}
              accessibilityRole="button"
              style={styles.link}
            >
              {t('Forgot your PIN? Use your password instead')}
            </Text>
          </>
        ) : step === 'first' ? (
          <PinPad key="first" value={first} onChange={setFirst} onFull={firstDone} disabled={busy} />
        ) : step === 'again' ? (
          <PinPad key="again" value={second} onChange={setSecond} onFull={againDone} disabled={busy} />
        ) : (
          <>
            <Input
              label={t('Your password')}
              icon="lock-closed-outline"
              secureTextEntry
              autoCapitalize="none"
              autoComplete="password"
              textContentType="password"
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={() => { if (password) void save({ password }); }}
              returnKeyType="done"
            />
            <Button
              label={t('Save my new PIN')}
              icon="checkmark"
              size="lg"
              busy={busy}
              disabled={!password}
              onPress={() => void save({ password })}
            />
          </>
        )}
        {busy && step !== 'password' ? <ActivityIndicator color={colors.accent} /> : null}

        <Muted style={{ textAlign: 'center', marginTop: space.md }}>
          {t('Not one digit six times, and not 123456 or 654321.')}
        </Muted>
        <View style={{ marginTop: space.md }}>
          <Button label={hasPin ? t('Cancel') : t('Not now')} variant="subtle" onPress={leave} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  container: { padding: space.xl, gap: space.md, paddingBottom: space['3xl'] },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: space.md },
  badge: {
    alignSelf: 'center', width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.borderStrong,
  },
  title: { ...type.h2, color: colors.text, textAlign: 'center' },
  prompt: { ...type.bodyStrong, color: colors.text, textAlign: 'center', marginTop: space.sm },
  link: { color: colors.accent, fontSize: 14, fontWeight: '700', textAlign: 'center', paddingVertical: space.sm },
}));
