import {
  ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View,
  type PressableProps, type TextInputProps,
} from 'react-native';
import { colors, severityColor } from '@/lib/theme';

export function Card({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Title({ children }: { children: React.ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Muted({ children }: { children: React.ReactNode }) {
  return <Text style={styles.muted}>{children}</Text>;
}

export function Button({
  label, variant = 'primary', busy, ...props
}: PressableProps & { label: string; variant?: 'primary' | 'outline' | 'danger'; busy?: boolean }) {
  return (
    <Pressable
      {...props}
      disabled={props.disabled || busy}
      style={({ pressed }) => [
        styles.button,
        variant === 'outline' && styles.buttonOutline,
        variant === 'danger' && styles.buttonDanger,
        (pressed || props.disabled || busy) && { opacity: 0.6 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <Text style={[styles.buttonText, variant === 'outline' && { color: colors.text }]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Input(props: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={colors.muted}
      {...props}
      style={[styles.input, props.style]}
    />
  );
}

export function SeverityPill({ severity }: { severity: string }) {
  return (
    <View style={[styles.pill, { backgroundColor: severityColor(severity) }]}>
      <Text style={styles.pillText}>{severity.toUpperCase()}</Text>
    </View>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{status}</Text>
    </View>
  );
}

export function CheckRow({
  label, checked, onToggle,
}: { label: string; checked: boolean; onToggle: () => void }) {
  return (
    <Pressable onPress={onToggle} style={[styles.checkRow, checked && styles.checkRowActive]}>
      <View style={[styles.checkBox, checked && styles.checkBoxActive]}>
        {checked && <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>✓</Text>}
      </View>
      <Text style={styles.checkLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bgCard,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  title: { color: colors.text, fontSize: 18, fontWeight: '700' },
  muted: { color: colors.muted, fontSize: 13, marginTop: 2 },
  button: {
    height: 46,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  buttonOutline: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
  buttonDanger: { backgroundColor: colors.critical },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  input: {
    height: 46,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgSoft,
    color: colors.text,
    paddingHorizontal: 12,
    fontSize: 15,
  },
  pill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' },
  pillText: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  badge: {
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgSoft,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start',
  },
  badgeText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  checkRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderColor: colors.border, borderRadius: 10,
    padding: 12, marginBottom: 8, backgroundColor: colors.bgSoft,
  },
  checkRowActive: { borderColor: colors.low },
  checkBox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: colors.muted,
    alignItems: 'center', justifyContent: 'center',
  },
  checkBoxActive: { backgroundColor: colors.low, borderColor: colors.low },
  checkLabel: { color: colors.text, flex: 1, fontSize: 14 },
});
