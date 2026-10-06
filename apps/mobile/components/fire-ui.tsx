import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, makeStyles, radius, space, useTheme } from '@/lib/theme';

export const FIRE_ORANGE = '#f97316';
export const FIRE_PHOTO = require('../assets/fire-rescue.jpg');

/** The original MVC firefighter photograph, bundled for offline use. */
export function FireBackdrop() {
  const { isDark } = useTheme();
  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Image source={FIRE_PHOTO} resizeMode="cover" style={[StyleSheet.absoluteFillObject, { width: '100%', height: '100%', opacity: isDark ? 0.3 : 0.09 }]} />
      <View style={[StyleSheet.absoluteFillObject, { backgroundColor: isDark ? 'rgba(9,12,19,0.58)' : 'rgba(255,250,245,0.68)' }]} />
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
  const styles = useStyles();
  return (
    <View style={[styles.check, invalid && value === undefined && { borderColor: colors.critical }]}>
      <Text style={styles.label}>{label}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <View style={styles.choices}>
        {[true, false].map((yes) => {
          const selected = value === yes;
          const tone = yes ? colors.low : colors.critical;
          return <Pressable key={String(yes)} accessibilityRole="radio" accessibilityLabel={`${label}: ${yes ? 'Yes' : 'No'}`}
            accessibilityState={{ checked: selected, disabled }} aria-checked={selected} disabled={disabled} onPress={() => onChange(yes)}
            style={[styles.choice, selected && { backgroundColor: `${tone}18`, borderColor: tone }]}>
            <Ionicons name={selected ? (yes ? 'checkmark-circle' : 'close-circle') : 'ellipse-outline'} size={19} color={selected ? tone : colors.muted} />
            <Text style={[styles.choiceText, selected && { color: tone }]}>{yes ? 'Yes' : 'No'}</Text>
          </Pressable>;
        })}
      </View>
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  button: { minHeight: 54, padding: space.md, borderRadius: radius.md, backgroundColor: '#c2410c', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  secondary: { backgroundColor: colors.bgElevated, borderWidth: 1, borderColor: colors.borderStrong },
  buttonText: { fontSize: 15, fontWeight: '800', textAlign: 'center', flexShrink: 1 },
  check: { paddingVertical: space.md, borderBottomWidth: 1, borderColor: colors.border, gap: 6 },
  label: { color: colors.text, fontSize: 15, lineHeight: 22, fontWeight: '700' },
  hint: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
  choices: { flexDirection: 'row', gap: 10, marginTop: 5 },
  choice: { flex: 1, minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, backgroundColor: colors.bgElevated },
  choiceText: { color: colors.textDim, fontSize: 14, fontWeight: '700' },
}));
