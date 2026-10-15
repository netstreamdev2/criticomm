import { useState } from 'react';
import {
  KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import {
  DEPARTMENT_NAMES, formatActivationCode, INVITATION_ATTEMPTS, normaliseActivationCode, passwordChecklist,
  POPIA_NOTICE_VERSION, type Silo, type UserRole,
} from '@criticom/db';
import { callPublicApi, webUrl } from '@/lib/api-host';
import { getSupabase } from '@/lib/supabase';
import { colors, radius, space, type, makeStyles } from '@/lib/theme';
import { Banner, Button, Card, CheckRow, Input, KeyValue, Stepper } from '@/components/ui';
import { tx, type Translate } from '@criticom/db/i18n';
import { useT } from '@/lib/i18n';

/** What the server says about a code and badge number (web: app/api/onboarding/check). */
type Checked =
  | {
    ok: true; fullName: string; signIn: 'email' | 'badge'; signInAs: string; role: UserRole; silo: Silo;
    organisation: string | null; invitedBy: string | null; expiresAt: string;
  }
  | { ok: false; state: string; message: string; triesLeft?: number };

/** The account the server created (web: app/api/onboarding/activate). */
type Activated =
  | { ok: true; loginEmail: string; signIn: 'email' | 'badge'; signInAs: string; role: UserRole; silo: Silo; fullName: string }
  | { ok: false; message: string; state?: string };

const STEPS = [tx('Code'), tx('Password'), tx('Terms')];

/** A password rule in the person's language; the shared rules are written in English. */
function ruleWords(rule: string, t: Translate) {
  const least = /^At least (\d+) characters$/.exec(rule);
  if (least) return t('At least {n} characters', { n: Number(least[1]) });
  // tx() so the translators get the shared rules.
  return t(rule === 'Not your name' ? tx('Not your name') : rule === 'Not your badge number' ? tx('Not your badge number') : rule);
}

/** Answers that end the journey: there is nothing to retry. */
const FINAL = new Set(['expired', 'used', 'locked', 'closed']);

/**
 * Activating an account with a printed activation slip (migration 0049), for
 * staff without email. The code and badge number prove who they are; they
 * choose their own password and accept the POPIA notice; the server creates
 * the account, and the app signs straight in. Every check, attempt limit and
 * lockout is the server's, exactly as on the web page.
 */
export default function ActivateScreen() {
  const { t } = useT();
  const styles = useStyles();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [code, setCode] = useState('');
  const [badge, setBadge] = useState('');
  const [who, setWho] = useState<Extract<Checked, { ok: true }> | null>(null);
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [show, setShow] = useState(false);
  const [readNotice, setReadNotice] = useState(false);
  const [agreeUse, setAgreeUse] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState<{ message: string; used: boolean } | null>(null);
  /** The account exists but signing in failed: who to sign in as. */
  const [made, setMade] = useState<string | null>(null);

  const codeOk = normaliseActivationCode(code).length === 8;
  const checklist = [
    ...passwordChecklist(password, { name: who?.fullName, badge }),
    { rule: tx('Both entries match'), ok: password.length > 0 && password === again },
  ];
  const passwordOk = checklist.every((c) => c.ok);
  const first = who?.fullName.trim().split(/\s+/)[0] ?? '';
  const popia = webUrl('/legal/popia');

  const finish = (state: string | undefined, message: string) => {
    if (state && FINAL.has(state)) setEnded({ message, used: state === 'used' });
    else setError(message);
  };

  const check = async () => {
    if (!codeOk || !badge.trim() || busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await callPublicApi<Checked>('/api/onboarding/check', { code, badge });
      if (res.ok) { setWho(res); setStep(1); } else finish(res.state, res.message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const activate = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await callPublicApi<Activated>('/api/onboarding/activate', {
        code, badge, password, accepted: readNotice && agreeUse,
      });
      if (!res.ok) { finish(res.state, res.message); return; }
      const { error: err } = await getSupabase().auth.signInWithPassword({ email: res.loginEmail, password });
      // Signed in: AuthGate takes them into the app. If not, the account still exists.
      if (err) setMade(res.signInAs);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (ended || made) {
    return (
      <View style={[styles.root, styles.centre]}>
        <View style={styles.box}>
          <View style={[styles.mark, { backgroundColor: made ? colors.lowSoft : colors.criticalSoft }]}>
            <Ionicons name={made ? 'checkmark-circle' : 'close-circle'} size={28} color={made ? colors.low : colors.critical} />
          </View>
          <Text style={styles.heading}>{made ? t('Your account is ready') : t('This code can’t be used')}</Text>
          <Text style={styles.sub}>
            {made
              ? who?.signIn === 'badge'
                ? t('Sign in with your badge number, {made}, and the password you just chose.', { made })
                : t('Sign in with your email address, {made}, and the password you just chose.', { made })
              : ended!.message}
          </Text>
          <View style={{ marginTop: space['2xl'] }}>
            <Button label={made || ended?.used ? t('Sign in') : t('Back to sign in')} icon="log-in-outline" size="lg"
              onPress={() => router.replace('/login')} />
          </View>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.box}>
          <Pressable onPress={() => (step > 0 ? setStep(step - 1) : router.replace('/login'))} hitSlop={12}
            accessibilityRole="button" accessibilityLabel={step > 0 ? t('Back') : t('Back to sign in')} style={styles.back}
            disabled={busy}>
            <Ionicons name="chevron-back" size={18} color={colors.accent} />
            <Text style={styles.backText}>{step > 0 ? t('Back') : t('Sign in')}</Text>
          </Pressable>

          <Stepper steps={STEPS} current={step} />
          {error ? <View style={{ marginBottom: space.md }}><Banner tone="error" onDismiss={() => setError(null)}>{error}</Banner></View> : null}

          {step === 0 ? (
            <View style={styles.form}>
              <View>
                <Text style={styles.heading}>{t('Activate your account')}</Text>
                <Text style={styles.sub}>{t('Enter the code on the activation slip your administrator gave you, and your badge number.')}</Text>
              </View>
              <Input
                label={t('Activation code')}
                icon="key-outline"
                placeholder={t('XXXX-XXXX')}
                value={code}
                onChangeText={(value) => { setCode(formatActivationCode(value)); setError(null); }}
                autoCapitalize="characters"
                autoCorrect={false}
                autoComplete="off"
                maxLength={9}
                style={styles.code}
                returnKeyType="next"
              />
              <Input
                label={t('Badge number')}
                icon="id-card-outline"
                placeholder={t('Your badge number')}
                value={badge}
                onChangeText={(value) => { setBadge(value); setError(null); }}
                autoCapitalize="characters"
                autoCorrect={false}
                autoComplete="off"
                hint={t('As on your appointment letter or ID card. {INVITATION_ATTEMPTS} wrong tries lock the code.', { INVITATION_ATTEMPTS })}
                returnKeyType="go"
                onSubmitEditing={() => void check()}
              />
              <Button label={t('Continue')} icon="arrow-forward" size="lg" busy={busy}
                disabled={!codeOk || !badge.trim()} onPress={() => void check()} />
            </View>
          ) : null}

          {step === 1 && who ? (
            <View style={styles.form}>
              <View>
                <Text style={styles.heading}>{t('Welcome, {first}', { first })}</Text>
                <Text style={styles.sub}>{t('Choose a password. Only you will know it: administrators never see or set passwords.')}</Text>
              </View>
              <Card tight>
                <KeyValue label={t('Role')} value={`${who.role}, ${DEPARTMENT_NAMES[who.silo] ?? who.silo}`} />
                {who.organisation ? <KeyValue label={t('Organisation')} value={who.organisation} /> : null}
                {who.invitedBy ? <KeyValue label={t('Invited by')} value={who.invitedBy} /> : null}
                <KeyValue label={t('You sign in with')} value={who.signIn === 'badge' ? `Badge ${who.signInAs}` : who.signInAs} />
              </Card>
              <View>
                <Input
                  label={t('Password')}
                  icon="lock-closed-outline"
                  secureTextEntry={!show}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="new-password"
                  textContentType="newPassword"
                  value={password}
                  onChangeText={setPassword}
                  returnKeyType="next"
                />
                <Text onPress={() => setShow((s) => !s)} accessibilityRole="button" style={styles.reveal}>
                  {show ? t('Hide') : t('Show')}
                </Text>
              </View>
              <Input
                label={t('Type it again')}
                icon="lock-closed-outline"
                secureTextEntry={!show}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="new-password"
                textContentType="newPassword"
                value={again}
                onChangeText={setAgain}
                returnKeyType="done"
                onSubmitEditing={() => { if (passwordOk) setStep(2); }}
              />
              <View style={styles.rules} accessibilityLabel={t('Password rules')}>
                {checklist.map((c) => (
                  <View key={c.rule} style={styles.rule}>
                    <Ionicons name={c.ok ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={c.ok ? colors.low : colors.muted} />
                    <Text style={[styles.ruleText, c.ok && { color: colors.text }]}>{ruleWords(c.rule, t)}</Text>
                  </View>
                ))}
                <Text style={styles.note}>{t('Passwords known from data breaches elsewhere are refused.')}</Text>
              </View>
              <Button label={t('Next')} icon="arrow-forward" size="lg" disabled={!passwordOk} onPress={() => setStep(2)} />
            </View>
          ) : null}

          {step === 2 ? (
            <View style={styles.form}>
              <View>
                <Text style={styles.heading}>{t('Before you start')}</Text>
                <Text style={styles.sub}>
                  {t('HikTech holds personal information about members of the public and about staff. The POPIA notice explains what is kept, why, who can see it and for how long.')}
                </Text>
                {popia ? (
                  <Text style={styles.link} accessibilityRole="link" onPress={() => void Linking.openURL(popia)}>
                    {t('Read the POPIA notice')}
                  </Text>
                ) : null}
              </View>
              <CheckRow label={t('I have read the POPIA notice (version {POPIA_NOTICE_VERSION})', { POPIA_NOTICE_VERSION })}
                checked={readNotice} onToggle={() => setReadNotice((v) => !v)} />
              <CheckRow label={t('I will use HikTech only for official duties and keep my password private')}
                checked={agreeUse} onToggle={() => setAgreeUse((v) => !v)} />
              <Button label={t('Activate my account')} icon="checkmark-circle-outline" size="lg" busy={busy}
                disabled={!readNotice || !agreeUse} onPress={() => void activate()} />
            </View>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  centre: { justifyContent: 'center', padding: space['2xl'] },
  scroll: { flexGrow: 1, padding: space['2xl'], paddingTop: space['3xl'] },
  box: { width: '100%', maxWidth: 420, alignSelf: 'center' },

  back: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', marginBottom: space.lg },
  backText: { color: colors.accent, fontSize: 14, fontWeight: '700' },

  mark: {
    width: 56, height: 56, borderRadius: radius.xl,
    alignItems: 'center', justifyContent: 'center', marginBottom: space.lg,
  },
  heading: { ...type.h1, color: colors.text },
  sub: { color: colors.muted, marginTop: space.sm, lineHeight: 20, fontSize: 14 },
  link: { color: colors.accent, fontSize: 14, fontWeight: '700', marginTop: space.md },

  form: { gap: space.md },
  code: { fontSize: 20, letterSpacing: 4, fontWeight: '700' },
  reveal: {
    position: 'absolute', right: space.md, top: 34,
    color: colors.accent, fontSize: 12, fontWeight: '700',
  },

  rules: { gap: 6 },
  rule: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  ruleText: { ...type.small, color: colors.muted },
  note: { ...type.small, fontSize: 12, color: colors.muted, marginTop: 2 },
}));
