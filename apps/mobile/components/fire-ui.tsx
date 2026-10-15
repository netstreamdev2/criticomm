import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, makeStyles, radius, space, useTheme } from '@/lib/theme';
import { useT } from '@/lib/i18n';

/**
 * Fire looks like every other department: the same backdrop, colours and
 * elements as the Police app, with Fire's own content. Only the words and
 * icons say Fire & Rescue.
 */

/** The home backdrop the Police app uses: earth at night in dark mode, plain in light. */
export function FireBackdrop() {
  const { isDark } = useTheme();
  if (!isDark) return null;
  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Image
        source={require('../assets/shift-earth-network-portrait.png')}
        resizeMode="cover"
        style={StyleSheet.absoluteFillObject}
        accessibilityIgnoresInvertColors
      />
      <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(5,5,16,0.55)' }]} />
    </View>
  );
}

export function FireButton({ label, onPress, busy, disabled, secondary = false, icon = 'arrow-forward' }: {
  label: string; onPress: () => void; busy?: boolean; disabled?: boolean; secondary?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const styles = useStyles();
  const foreground = secondary ? colors.text : '#fff';
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: busy || disabled, busy }} aria-busy={busy}
      disabled={busy || disabled} onPress={onPress}
      style={({ pressed }) => [styles.button, secondary && styles.secondary, (pressed || busy || disabled) && { opacity: 0.55 }]}>
      {busy ? <ActivityIndicator color={foreground} /> : <>
        <Text style={[styles.buttonText, { color: foreground }]}>{label}</Text>
        <Ionicons name={icon} size={18} color={foreground} />
      </>}
    </Pressable>
  );
}

export function FireCheck({ label, hint, value, onChange, disabled, invalid }: {
  label: string; hint?: string; value: boolean | undefined; onChange: (value: boolean) => void;
  disabled?: boolean; invalid?: boolean;
}) {
  const { t } = useT();
  const styles = useStyles();
  return (
    <View style={[styles.check, invalid && value === undefined && { borderColor: colors.critical }]}>
      <Text style={styles.label}>{t(label)}</Text>
      {hint ? <Text style={styles.hint}>{t(hint)}</Text> : null}
      <View style={styles.choices}>
        {[true, false].map((yes) => {
          const selected = value === yes;
          const tone = yes ? colors.low : colors.critical;
          return <Pressable key={String(yes)} accessibilityRole="radio" accessibilityLabel={`${t(label)}: ${yes ? t('Yes') : t('No')}`}
            accessibilityState={{ checked: selected, disabled }} aria-checked={selected} disabled={disabled} onPress={() => onChange(yes)}
            style={[styles.choice, selected && { backgroundColor: `${tone}18`, borderColor: tone }]}>
            <Ionicons name={selected ? (yes ? 'checkmark-circle' : 'close-circle') : 'ellipse-outline'} size={19} color={selected ? tone : colors.muted} />
            <Text style={[styles.choiceText, selected && { color: tone }]}>{yes ? t('Yes') : t('No')}</Text>
          </Pressable>;
        })}
      </View>
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  button: { minHeight: 52, paddingHorizontal: space.lg, paddingVertical: space.md, borderRadius: radius.md, backgroundColor: colors.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  secondary: { backgroundColor: colors.bgElevated, borderWidth: 1, borderColor: colors.border },
  buttonText: { fontSize: 15, fontWeight: '700', textAlign: 'center', flexShrink: 1 },
  check: { paddingVertical: space.md, borderBottomWidth: 1, borderColor: colors.border, gap: 6 },
  label: { color: colors.text, fontSize: 15, lineHeight: 22, fontWeight: '700' },
  hint: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
  choices: { flexDirection: 'row', gap: 10, marginTop: 5 },
  choice: { flex: 1, minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, backgroundColor: colors.bgElevated },
  choiceText: { color: colors.textDim, fontSize: 14, fontWeight: '700' },
}));
