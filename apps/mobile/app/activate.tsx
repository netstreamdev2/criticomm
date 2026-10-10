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

const STEPS = ['Code', 'Password', 'Terms'];

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
    { rule: 'Both entries match', ok: password.length > 0 && password === again },
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
          <Text style={styles.heading}>{made ? 'Your account is ready' : 'This code can’t be used'}</Text>
          <Text style={styles.sub}>
            {made
              ? `Sign in with ${who?.signIn === 'badge' ? 'your badge number' : 'your email address'}, ${made}, and the password you just chose.`
              : ended!.message}
          </Text>
          <View style={{ marginTop: space['2xl'] }}>
            <Button label={made || ended?.used ? 'Sign in' : 'Back to sign in'} icon="log-in-outline" size="lg"
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
            accessibilityRole="button" accessibilityLabel={step > 0 ? 'Back' : 'Back to sign in'} style={styles.back}
            disabled={busy}>
            <Ionicons name="chevron-back" size={18} color={colors.accent} />
            <Text style={styles.backText}>{step > 0 ? 'Back' : 'Sign in'}</Text>
          </Pressable>

          <Stepper steps={STEPS} current={step} />
          {error ? <View style={{ marginBottom: space.md }}><Banner tone="error" onDismiss={() => setError(null)}>{error}</Banner></View> : null}

          {step === 0 ? (
            <View style={styles.form}>
              <View>
                <Text style={styles.heading}>Activate your account</Text>
                <Text style={styles.sub}>Enter the code on the activation slip your administrator gave you, and your badge number.</Text>
              </View>
              <Input
                label="Activation code"
                icon="key-outline"
                placeholder="XXXX-XXXX"
                value={code}
                onChangeText={(t) => { setCode(formatActivationCode(t)); setError(null); }}
                autoCapitalize="characters"
                autoCorrect={false}
                autoComplete="off"
                maxLength={9}
                style={styles.code}
                returnKeyType="next"
              />
              <Input
                label="Badge number"
                icon="id-card-outline"
                placeholder="Your badge number"
                value={badge}
                onChangeText={(t) => { setBadge(t); setError(null); }}
                autoCapitalize="characters"
                autoCorrect={false}
                autoComplete="off"
                hint={`As on your appointment letter or ID card. ${INVITATION_ATTEMPTS} wrong tries lock the code.`}
                returnKeyType="go"
                onSubmitEditing={() => void check()}
              />
              <Button label="Continue" icon="arrow-forward" size="lg" busy={busy}
                disabled={!codeOk || !badge.trim()} onPress={() => void check()} />
            </View>
          ) : null}

          {step === 1 && who ? (
            <View style={styles.form}>
              <View>
                <Text style={styles.heading}>Welcome, {first}</Text>
                <Text style={styles.sub}>Choose a password. Only you will know it: administrators never see or set passwords.</Text>
              </View>
              <Card tight>
                <KeyValue label="Role" value={`${who.role}, ${DEPARTMENT_NAMES[who.silo] ?? who.silo}`} />
                {who.organisation ? <KeyValue label="Organisation" value={who.organisation} /> : null}
                {who.invitedBy ? <KeyValue label="Invited by" value={who.invitedBy} /> : null}
                <KeyValue label="You sign in with" value={who.signIn === 'badge' ? `Badge ${who.signInAs}` : who.signInAs} />
              </Card>
              <View>
                <Input
                  label="Password"
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
                  {show ? 'Hide' : 'Show'}
                </Text>
              </View>
              <Input
                label="Type it again"
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
              <View style={styles.rules} accessibilityLabel="Password rules">
                {checklist.map((c) => (
                  <View key={c.rule} style={styles.rule}>
                    <Ionicons name={c.ok ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={c.ok ? colors.low : colors.muted} />
                    <Text style={[styles.ruleText, c.ok && { color: colors.text }]}>{c.rule}</Text>
                  </View>
                ))}
                <Text style={styles.note}>Passwords known from data breaches elsewhere are refused.</Text>
              </View>
              <Button label="Next" icon="arrow-forward" size="lg" disabled={!passwordOk} onPress={() => setStep(2)} />
            </View>
          ) : null}

          {step === 2 ? (
            <View style={styles.form}>
              <View>
                <Text style={styles.heading}>Before you start</Text>
                <Text style={styles.sub}>
                  HikTech holds personal information about members of the public and about staff. The POPIA notice
                  explains what is kept, why, who can see it and for how long.
                </Text>
                {popia ? (
                  <Text style={styles.link} accessibilityRole="link" onPress={() => void Linking.openURL(popia)}>
                    Read the POPIA notice
                  </Text>
                ) : null}
              </View>
              <CheckRow label={`I have read the POPIA notice (version ${POPIA_NOTICE_VERSION})`}
                checked={readNotice} onToggle={() => setReadNotice((v) => !v)} />
              <CheckRow label="I will use HikTech only for official duties and keep my password private"
                checked={agreeUse} onToggle={() => setAgreeUse((v) => !v)} />
              <Button label="Activate my account" icon="checkmark-circle-outline" size="lg" busy={busy}
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
