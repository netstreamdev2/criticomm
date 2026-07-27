import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { getSupabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { Button, Input } from '@/components/ui';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const signIn = async () => {
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
      <View style={styles.box}>
        <Text style={styles.brand}>CRITICOM</Text>
        <Text style={styles.heading}>Responder sign in</Text>
        <Text style={styles.sub}>eThekwini Emergency Services. Authorised personnel only — all access is audited.</Text>

        <View style={{ gap: 12, marginTop: 24 }}>
          <Input
            placeholder="Departmental email"
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            value={email}
            onChangeText={setEmail}
          />
          <Input
            placeholder="Password"
            secureTextEntry
            autoComplete="password"
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={signIn}
          />
          {error && <Text style={styles.error}>{error}</Text>}
          <Button label="Sign in" busy={busy} onPress={signIn} disabled={!email || !password} />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', padding: 24 },
  box: { width: '100%', maxWidth: 420, alignSelf: 'center' },
  brand: { color: colors.primary, fontWeight: '800', letterSpacing: 4, fontSize: 14 },
  heading: { color: colors.text, fontSize: 28, fontWeight: '800', marginTop: 12 },
  sub: { color: colors.muted, marginTop: 8, lineHeight: 20 },
  error: {
    color: colors.critical, backgroundColor: `${colors.critical}22`,
    borderColor: `${colors.critical}66`, borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 13,
  },
});
