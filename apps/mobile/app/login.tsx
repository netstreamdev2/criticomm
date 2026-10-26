import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { signInEmailFor } from '@criticom/db';
import { getSupabase } from '@/lib/supabase';
import { errorWords } from '@/lib/offline-cache-policy';
import {
  clearPinSetupOffer, deviceOfficers, notePasswordSignIn, offerPinSetup, signInWithPin, useRegisteredDevice,
  type DeviceOfficer, type PinOutcome,
} from '@/lib/pin-sign-in';
import { colors, radius, space, type, makeStyles } from '@/lib/theme';
import { HikTechLogo } from '@/components/hiktech-logo';
import { PinPad } from '@/components/pin-pad';
import { Banner, Button, Input } from '@/components/ui';
import { tx } from '@criticom/db/i18n';
import { useT } from '@/lib/i18n';

/** Each in its own department colour (Admin → Departments' defaults). */
const DEPARTMENTS = [
  { silo: 'MetroPolice', label: tx('Metro Police'), colour: '#3b82f6' },
  { silo: 'MetroFire', label: tx('Fire & Rescue'), colour: '#dc3545' },
  { silo: 'Medical', label: tx('EMS'), colour: '#10b981' },
  { silo: 'EthekwiniDisaster', label: tx('Disaster Management'), colour: '#f59e0b' },
];
const DEPARTMENT_OF: Record<string, { label: string; colour: string }> = {
  ...Object.fromEntries(DEPARTMENTS.map((d) => [d.silo, d])),
  Ethekwini: { label: tx('Administration'), colour: '#8b5cf6' },
};
/** Officers this device remembers but whose department it has not been told yet. */
const ON_THIS_DEVICE = 'device';
/** More names than this and the list gets a search box. */
const SEARCH_FROM = 8;

// The Banner translates them.
const DEACTIVATED = tx('This account has been deactivated. If you think this is a mistake, speak to your station commander or system administrator.');
const NO_MATCH = tx('That email or badge number and password do not match an account.');

/** What a PIN sign-in that did not work says (0108). */
const PIN_WORDS: Record<string, string> = {
  locked: tx('Your PIN is locked after 5 wrong tries. Sign in with your password and choose a new PIN, or ask your supervisor to unlock it.'),
  device: tx('This device is no longer registered for PIN sign-in. Sign in with your password, and ask your supervisor to register it again.'),
  unknown: tx('We could not find that officer. Check the badge number, or sign in with your password.'),
  inactive: DEACTIVATED,
  elsewhere: tx('This device belongs to another department. Use one of your own department\'s devices, or sign in with your password.'),
  no_pin: tx('You have not chosen a PIN yet. Sign in with your password once, then choose one.'),
  busy: tx('Too many tries from this device. Wait a few minutes, then try again.'),
  error: tx('We could not sign you in just now. Try again shortly.'),
  offline_none: tx('No signal, and this device does not know you yet. Sign in when you have signal.'),
  offline_expired: tx('No signal, and this device only remembers you for one shift. Sign in when you have signal.'),
  offline_no_session: tx('No signal. Without signal this device only signs you back in after you have handed it over. Sign in when you have signal.'),
  offline_locked: tx('Too many wrong PINs, so this device has forgotten you. Sign in when you have signal.'),
};

type Officer = { userId: string | null; name: string | null; badge: string | null; silo: string | null };
type Mode = 'choose' | 'pin' | 'password';

/**
 * Signing in. First the way in: a PIN (on a device registered for it, 0108)
 * or the password. With a PIN: the department, the name, then six digits —
 * or the badge number when the name is not listed. The password always works.
 */
export default function LoginScreen() {
  const { t } = useT();
  const styles = useStyles();
  const router = useRouter();
  const { device, loading: deviceLoading } = useRegisteredDevice();
  const [mode, setMode] = useState<Mode>('choose');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [officers, setOfficers] = useState<DeviceOfficer[] | null>(null);
  const [department, setDepartment] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typingBadge, setTypingBadge] = useState(false);
  const [who, setWho] = useState<Officer | null>(null);
  const [badge, setBadge] = useState('');
  const [pin, setPin] = useState('');
  const [pinWrong, setPinWrong] = useState(false);

  // The names, once the device is known to be registered: fresh with signal, else the list kept.
  useEffect(() => {
    if (!device) return;
    let gone = false;
    void deviceOfficers().then((list) => { if (!gone) setOfficers(list); });
    return () => { gone = true; };
  }, [device]);

  /** The departments on the list, in the usual order. */
  const departments = useMemo(() => {
    const present = new Set((officers ?? []).map((o) => o.silo ?? ON_THIS_DEVICE));
    return [...DEPARTMENTS.map((d) => d.silo), 'Ethekwini', ON_THIS_DEVICE].filter((s) => present.has(s));
  }, [officers]);
  // One department: straight to its names.
  const shownDepartment = departments.length === 1 ? departments[0]! : department;

  const names = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (officers ?? [])
      .filter((o) => (o.silo ?? ON_THIS_DEVICE) === shownDepartment)
      .filter((o) => !q || `${o.name ?? ''} ${o.badge ?? ''}`.toLowerCase().includes(q));
  }, [officers, shownDepartment, search]);
  const inDepartment = (officers ?? []).filter((o) => (o.silo ?? ON_THIS_DEVICE) === shownDepartment).length;

  const go = (next: Mode) => {
    setMode(next);
    setError(null);
  };

  const signIn = async () => {
    if (!email || !password) return;
    setError(null);
    setBusy(true);
    // On a registered device, choosing a PIN comes straight after, without
    // asking for the password again (set first: the screen moves on with the session).
    if (device) offerPinSetup();
    try {
      // Staff without email sign in with their badge number (migration 0049).
      const { error: err } = await getSupabase().auth.signInWithPassword({ email: signInEmailFor(email), password });
      // A deactivated account is banned from signing in (migration 0048).
      if (err) {
        clearPinSetupOffer();
        setError(err.code === 'user_banned' || /banned/i.test(err.message) ? DEACTIVATED
          : err.code === 'invalid_credentials' || /invalid login/i.test(err.message) ? NO_MATCH
            : errorWords(err));
      } else {
        void notePasswordSignIn();
      }
    } catch (e) {
      clearPinSetupOffer();
      setError(errorWords(e));
    } finally {
      setBusy(false);
    }
    // AuthGate redirects on success.
  };

  const pinWords = (out: Extract<PinOutcome, { ok: false }>) => {
    if (out.state === 'wrong' || out.state === 'offline_wrong') {
      return out.triesLeft === 1 ? t('Wrong PIN. 1 try left.') : t('Wrong PIN. {n} tries left.', { n: out.triesLeft ?? 0 });
    }
    return t(PIN_WORDS[out.state] ?? PIN_WORDS.error!);
  };

  const signInPin = async (entered: string) => {
    if (!who) return;
    setError(null);
    setBusy(true);
    try {
      const out = await signInWithPin({ userId: who.userId, badge: who.badge }, entered);
      if (!out.ok) {
        setError(pinWords(out));
        setPin('');
        setPinWrong(out.state === 'wrong' || out.state === 'offline_wrong');
        if (out.state === 'device') go('password');
        // Locked, deactivated, or forgotten here: back to choosing who.
        if (!['wrong', 'offline_wrong', 'busy', 'error'].includes(out.state)) {
          setWho(null);
          setOfficers(await deviceOfficers());
        }
      }
      // AuthGate moves on once the session starts.
    } catch (e) {
      setError(errorWords(e));
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  const pick = (o: Officer) => {
    setWho(o);
    setPin('');
    setPinWrong(false);
    setError(null);
  };

  const byBadge = () => {
    const typed = badge.trim().toUpperCase();
    if (typed) pick({ userId: null, name: null, badge: typed, silo: null });
  };

  const back = () => {
    setError(null);
    if (who) { setWho(null); return; }
    if (typingBadge) { setTypingBadge(false); return; }
    if (department && departments.length > 1) { setDepartment(null); setSearch(''); return; }
    go('choose');
  };

  const departmentName = (silo: string | null) =>
    silo === ON_THIS_DEVICE || !silo ? t('On this device') : t(DEPARTMENT_OF[silo]?.label ?? silo);

  /* ── The PIN steps ────────────────────────────────────────────────── */

  const pinSteps = () => {
    if (deviceLoading) return <ActivityIndicator color={colors.accent} />;
    if (!device) {
      return (
        <>
          <Banner tone="info">
            {t('This device is not set up for PIN sign-in yet. A supervisor or administrator sets it up once: sign in with a password, open Profile, then Sign-in PIN, then Register this device.')}
          </Banner>
          <Button label={t('Sign in with password')} icon="lock-closed-outline" size="lg" onPress={() => go('password')} />
        </>
      );
    }

    if (who) {
      return (
        <>
          <View style={styles.whoCard}>
            <View style={styles.whoAvatar}><Ionicons name="person" size={20} color={colors.accent} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.whoName}>{who.name ?? who.badge ?? t('Officer')}</Text>
              <Text style={styles.whoBadge}>{[who.badge, who.silo ? departmentName(who.silo) : null].filter(Boolean).join(' · ')}</Text>
            </View>
          </View>
          <Text style={styles.prompt}>{busy ? t('Signing in…') : t('Enter your 6-digit PIN')}</Text>
          <PinPad
            value={pin}
            onChange={(v) => { setPin(v); setPinWrong(false); }}
            onFull={(v) => void signInPin(v)}
            disabled={busy}
            error={pinWrong}
          />
        </>
      );
    }

    if (typingBadge || (officers !== null && officers.length === 0)) {
      return (
        <>
          <Text style={styles.prompt}>{t('Enter your badge number')}</Text>
          {officers !== null && officers.length === 0 ? (
            <Text style={styles.hint}>{t('Nobody on this device has a PIN yet. Sign in with your password once and choose one, or enter your badge number.')}</Text>
          ) : null}
          <Input
            label={t('Badge number')}
            icon="id-card-outline"
            placeholder={t('e.g. MP-1042')}
            autoCapitalize="characters"
            autoCorrect={false}
            value={badge}
            onChangeText={setBadge}
            returnKeyType="next"
            onSubmitEditing={byBadge}
          />
          <Button label={t('Next')} icon="arrow-forward" size="lg" disabled={!badge.trim()} onPress={byBadge} />
        </>
      );
    }

    if (officers === null) return <ActivityIndicator color={colors.accent} />;

    if (!shownDepartment) {
      return (
        <>
          <Text style={styles.prompt}>{t('Choose your department')}</Text>
          {departments.map((silo) => {
            const d = DEPARTMENT_OF[silo];
            const count = officers.filter((o) => (o.silo ?? ON_THIS_DEVICE) === silo).length;
            return (
              <Pressable
                key={silo}
                onPress={() => { setDepartment(silo); setSearch(''); }}
                accessibilityRole="button"
                style={({ pressed }) => [styles.row, { borderLeftColor: d?.colour ?? colors.border }, pressed && { opacity: 0.8 }]}
              >
                <View style={[styles.dot, { backgroundColor: d?.colour ?? colors.muted }]} />
                <Text style={[styles.whoName, { flex: 1 }]}>{departmentName(silo)}</Text>
                <Text style={styles.count}>{count}</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </Pressable>
            );
          })}
          <Text onPress={() => setTypingBadge(true)} accessibilityRole="button" style={styles.activate}>{t('Enter your badge number instead')}</Text>
        </>
      );
    }

    return (
      <>
        <Text style={styles.prompt}>{departments.length > 1 ? t('{department}: choose your name', { department: departmentName(shownDepartment) }) : t('Choose your name')}</Text>
        {inDepartment > SEARCH_FROM ? (
          <Input
            label={t('Find your name')}
            icon="search-outline"
            placeholder={t('Name or badge number')}
            autoCorrect={false}
            value={search}
            onChangeText={setSearch}
          />
        ) : null}
        {names.slice(0, 100).map((o) => (
          <Pressable
            key={o.userId}
            onPress={() => pick(o)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.8 }]}
          >
            <View style={styles.whoAvatar}><Ionicons name="person" size={18} color={colors.accent} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.whoName}>{o.name ?? o.badge ?? t('Officer')}</Text>
              {o.badge ? <Text style={styles.whoBadge}>{o.badge}</Text> : null}
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>
        ))}
        {names.length === 0 ? <Text style={styles.hint}>{t('No name matches. Try another spelling, or enter your badge number.')}</Text> : null}
        <Text onPress={() => setTypingBadge(true)} accessibilityRole="button" style={styles.activate}>{t('Not on the list? Enter your badge number')}</Text>
      </>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.box}>
          {/* Brand */}
          <View style={styles.badge}>
            <Ionicons name="shield-half" size={26} color={colors.primary} />
          </View>
          <View style={{ marginVertical: 10 }}><HikTechLogo height={18} /></View>
          <Text style={styles.heading}>{t('Responder sign in')}</Text>
          <Text style={styles.sub}>
            {t('eThekwini Emergency Services. Authorised personnel only — all access is audited.')}
          </Text>

          {/* Departments served */}
          <View style={styles.chips}>
            {DEPARTMENTS.map((d) => (
              <View key={d.label} style={styles.chip}>
                <View style={[styles.chipDot, { backgroundColor: d.colour }]} />
                <Text style={styles.chipText}>{t(d.label)}</Text>
              </View>
            ))}
          </View>

          {mode === 'choose' ? (
            <View style={styles.form}>
              {error ? <Banner tone="error" onDismiss={() => setError(null)}>{error}</Banner> : null}
              <Pressable
                onPress={() => go('pin')}
                accessibilityRole="button"
                style={({ pressed }) => [styles.way, styles.wayMain, pressed && { opacity: 0.85 }]}
              >
                <View style={[styles.wayIcon, { backgroundColor: colors.accent }]}>
                  <Ionicons name="keypad" size={22} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.wayTitle}>{t('Sign in with PIN')}</Text>
                  <Text style={styles.waySub}>
                    {device ? t('Choose your name, then enter your 6-digit PIN') : t('On a device your station has set up for it')}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.muted} />
              </Pressable>
              <Pressable
                onPress={() => go('password')}
                accessibilityRole="button"
                style={({ pressed }) => [styles.way, pressed && { opacity: 0.85 }]}
              >
                <View style={[styles.wayIcon, { backgroundColor: colors.bgElevated }]}>
                  <Ionicons name="lock-closed-outline" size={22} color={colors.text} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.wayTitle}>{t('Sign in with password')}</Text>
                  <Text style={styles.waySub}>{t('Email or badge number, and password')}</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.muted} />
              </Pressable>
              {device ? (
                <View style={styles.deviceRow}>
                  <Ionicons name="phone-portrait-outline" size={14} color={colors.muted} />
                  <Text style={styles.deviceText}>{t('PIN sign-in on {device}', { device: device.label })}</Text>
                </View>
              ) : null}
              <Text
                onPress={() => router.push('/activate')}
                accessibilityRole="link"
                style={styles.activate}
              >
                {t('I have an activation code')}
              </Text>
            </View>
          ) : mode === 'pin' ? (
            <View style={styles.form}>
              <Pressable onPress={back} accessibilityRole="button" hitSlop={8} style={styles.backRow}>
                <Ionicons name="chevron-back" size={18} color={colors.accent} />
                <Text style={styles.link}>{t('Back')}</Text>
              </Pressable>
              {error ? <Banner tone="error" onDismiss={() => setError(null)}>{error}</Banner> : null}
              {pinSteps()}
              {device ? (
                <Text onPress={() => go('password')} accessibilityRole="link" style={styles.activate}>
                  {t('Sign in with your password instead')}
                </Text>
              ) : null}
            </View>
          ) : (
            <View style={styles.form}>
              <Pressable onPress={() => go('choose')} accessibilityRole="button" hitSlop={8} style={styles.backRow}>
                <Ionicons name="chevron-back" size={18} color={colors.accent} />
                <Text style={styles.link}>{t('Back')}</Text>
              </Pressable>
              {error ? <Banner tone="error" onDismiss={() => setError(null)}>{error}</Banner> : null}

              <Input
                label={t('Email or badge number')}
                icon="person-outline"
                placeholder={t('Your email address or badge number')}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                autoComplete="username"
                textContentType="username"
                value={email}
                onChangeText={setEmail}
                returnKeyType="next"
              />

              <View>
                <Input
                  label={t('Password')}
                  icon="lock-closed-outline"
                  placeholder="••••••••"
                  secureTextEntry={!show}
                  autoCapitalize="none"
                  autoComplete="password"
                  textContentType="password"
                  value={password}
                  onChangeText={setPassword}
                  onSubmitEditing={() => void signIn()}
                  returnKeyType="go"
                />
                <Text
                  onPress={() => setShow((s) => !s)}
                  accessibilityRole="button"
                  style={styles.reveal}
                >
                  {show ? t('Hide') : t('Show')}
                </Text>
              </View>

              <Button
                label={t('Sign in')}
                icon="log-in-outline"
                size="lg"
                busy={busy}
                onPress={() => void signIn()}
                disabled={!email || !password}
              />

              <Text
                onPress={() => router.push('/activate')}
                accessibilityRole="link"
                style={styles.activate}
              >
                {t('I have an activation code')}
              </Text>
            </View>
          )}

          <View style={styles.footer}>
            <View style={styles.pulse} />
            <Text style={styles.footerText}>{t('Secure connection · session audited')}</Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: space['2xl'] },
  box: { width: '100%', maxWidth: 420, alignSelf: 'center' },

  badge: {
    width: 56, height: 56, borderRadius: radius.xl,
    backgroundColor: colors.primarySoft,
    borderWidth: 1, borderColor: colors.borderStrong,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: space.xl,
  },
  brand: { color: colors.primary, fontWeight: '800', letterSpacing: 4, fontSize: 13 },
  heading: { ...type.display, color: colors.text, marginTop: space.sm },
  sub: { color: colors.muted, marginTop: space.sm, lineHeight: 20, fontSize: 14 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.lg },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.bgSoft,
    paddingHorizontal: space.md, paddingVertical: 5,
  },
  chipDot: { width: 6, height: 6, borderRadius: 3 },
  chipText: { color: colors.textDim, fontSize: 12, fontWeight: '600' },

  form: { gap: space.md, marginTop: space['2xl'] },
  reveal: {
    position: 'absolute', right: space.md, top: 34,
    color: colors.accent, fontSize: 12, fontWeight: '700',
  },
  activate: {
    color: colors.accent, fontSize: 14, fontWeight: '700',
    textAlign: 'center', paddingVertical: space.sm,
  },

  way: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, minHeight: 76,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard,
  },
  wayMain: { borderColor: `${colors.accent}88`, backgroundColor: colors.accentSoft },
  wayIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  wayTitle: { ...type.bodyStrong, fontSize: 16, color: colors.text, fontWeight: '800' },
  waySub: { ...type.small, fontSize: 12, color: colors.textDim, marginTop: 2 },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start' },
  deviceRow: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center' },
  deviceText: { ...type.small, fontSize: 12, color: colors.muted, fontWeight: '700' },
  prompt: { ...type.bodyStrong, color: colors.text, textAlign: 'center' },
  hint: { ...type.small, color: colors.muted, textAlign: 'center' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, minHeight: 60,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard,
    borderLeftWidth: 4, borderLeftColor: colors.border,
  },
  dot: { width: 12, height: 12, borderRadius: 6 },
  count: { ...type.small, color: colors.muted, fontWeight: '800' },
  whoCard: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.bgSoft,
  },
  whoAvatar: {
    width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft,
  },
  whoName: { ...type.bodyStrong, color: colors.text },
  whoBadge: { ...type.small, color: colors.muted },
  link: { color: colors.accent, fontSize: 14, fontWeight: '800' },

  footer: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: space.sm, marginTop: space['2xl'],
  },
  pulse: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.low },
  footerText: { ...type.small, fontSize: 12, color: colors.muted },
}));
