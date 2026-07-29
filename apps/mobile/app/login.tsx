import { useState } from 'react';
import {
  KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getSupabase } from '@/lib/supabase';
import { colors, radius, space, type } from '@/lib/theme';
import { Banner, Button, Input } from '@/components/ui';

const DEPARTMENTS = [
  { label: 'Metro Police', colour: '#f59e0b' },
  { label: 'Fire & Rescue', colour: '#dc3545' },
  { label: 'EMS', colour: '#22c55e' },
  { label: 'Disaster', colour: '#3b82f6' },
];

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const signIn = async () => {
    if (!email || !password) return;
    setError(null);
    setBusy(true);
    const { error: err } = await getSupabase().auth.signInWithPassword({ email, password });
    setBusy(false);
    if (err) setError(err.message);
    // AuthGate redirects on success.
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
          <Text style={styles.brand}>CRITICOMM</Text>
          <Text style={styles.heading}>Responder sign in</Text>
          <Text style={styles.sub}>
            eThekwini Emergency Services. Authorised personnel only — all access is audited.
          </Text>

          {/* Departments served */}
          <View style={styles.chips}>
            {DEPARTMENTS.map((d) => (
              <View key={d.label} style={styles.chip}>
                <View style={[styles.chipDot, { backgroundColor: d.colour }]} />
                <Text style={styles.chipText}>{d.label}</Text>
              </View>
            ))}
          </View>

          {/* Form */}
          <View style={styles.form}>
            {error ? <Banner tone="error" onDismiss={() => setError(null)}>{error}</Banner> : null}

            <Input
              label="Departmental email"
              icon="mail-outline"
              placeholder="name@durban.gov.za"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              autoComplete="email"
              textContentType="emailAddress"
              value={email}
              onChangeText={setEmail}
              returnKeyType="next"
            />

            <View>
              <Input
                label="Password"
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
                {show ? 'Hide' : 'Show'}
              </Text>
            </View>

            <Button
              label="Sign in"
              icon="log-in-outline"
              size="lg"
              busy={busy}
              onPress={() => void signIn()}
              disabled={!email || !password}
            />
          </View>

          <View style={styles.footer}>
            <View style={styles.pulse} />
            <Text style={styles.footerText}>Secure connection · session audited</Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
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

  footer: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: space.sm, marginTop: space['2xl'],
  },
  pulse: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.low },
  footerText: { ...type.small, fontSize: 12, color: colors.muted },
});
