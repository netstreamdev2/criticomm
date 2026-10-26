import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space, makeStyles } from '@/lib/theme';
import { useT } from '@/lib/i18n';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'] as const;

/**
 * Six dots and a keypad, with keys big enough for gloves on a radio. The
 * digits never show; `onFull` runs once the sixth is in.
 */
export function PinPad({ value, onChange, onFull, disabled, length = 6, error = false }: {
  value: string;
  onChange: (next: string) => void;
  onFull?: (pin: string) => void;
  disabled?: boolean;
  length?: number;
  /** The dots turn red: the last PIN was wrong. */
  error?: boolean;
}) {
  const { t } = useT();
  const styles = useStyles();
  const press = (key: (typeof KEYS)[number]) => {
    if (disabled || !key) return;
    if (key === 'back') { onChange(value.slice(0, -1)); return; }
    if (value.length >= length) return;
    const next = value + key;
    onChange(next);
    if (next.length === length) onFull?.(next);
  };

  return (
    <View style={styles.root}>
      <View style={styles.dots} accessibilityLabel={t('{n} of {total} digits entered', { n: value.length, total: length })}>
        {Array.from({ length }, (_, i) => (
          <View key={i} style={[styles.dot, i < value.length && styles.dotOn, error && styles.dotError]} />
        ))}
      </View>
      <View style={styles.grid}>
        {KEYS.map((key, i) => (
          <Pressable
            key={`${key}-${i}`}
            onPress={() => press(key)}
            disabled={disabled || !key}
            accessibilityRole={key ? 'button' : undefined}
            accessibilityLabel={key === 'back' ? t('Delete the last digit') : key || undefined}
            style={({ pressed }) => [styles.key, !key && styles.keyBlank, pressed && key && styles.keyPressed, disabled && { opacity: 0.5 }]}
          >
            {key === 'back'
              ? <Ionicons name="backspace-outline" size={26} color={colors.text} />
              : <Text style={styles.keyText}>{key}</Text>}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  root: { alignItems: 'center', gap: space.lg },
  dots: { flexDirection: 'row', gap: 14, paddingVertical: space.sm },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: colors.borderStrong },
  dotOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  dotError: { borderColor: colors.critical, backgroundColor: colors.criticalSoft },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.md, maxWidth: 300 },
  key: {
    width: 84, height: 64, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border,
  },
  keyBlank: { backgroundColor: 'transparent', borderColor: 'transparent' },
  keyPressed: { backgroundColor: colors.bgElevated },
  keyText: { color: colors.text, fontSize: 28, fontWeight: '800' },
}));
