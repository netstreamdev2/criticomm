import {
  ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View,
  type PressableProps, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  colors, elevation, radius, severityColor, space, statusColor, type,
} from '@/lib/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/* ── Surfaces ──────────────────────────────────────────────────────── */

export function Card({
  children, style, accent, tight,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Colour of the 3px left rail — use for severity or status at a glance. */
  accent?: string;
  tight?: boolean;
}) {
  return (
    <View style={[styles.card, tight && styles.cardTight, style]}>
      {accent ? <View style={[styles.cardRail, { backgroundColor: accent }]} /> : null}
      {children}
    </View>
  );
}

/** Small all-caps heading that separates groups of cards. */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionLabel}>{String(children).toUpperCase()}</Text>;
}

/* ── Typography ────────────────────────────────────────────────────── */

export function Title({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.title, style]}>{children}</Text>;
}

export function Muted({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.muted, style]}>{children}</Text>;
}

/* ── Buttons ───────────────────────────────────────────────────────── */

type ButtonVariant = 'primary' | 'outline' | 'danger' | 'success' | 'subtle';

const VARIANT_BG: Record<ButtonVariant, string> = {
  primary: colors.accent,
  outline: 'transparent',
  danger: colors.critical,
  success: colors.low,
  subtle: colors.bgElevated,
};

const VARIANT_FG: Record<ButtonVariant, string> = {
  primary: '#fff',
  outline: colors.textDim,
  danger: '#fff',
  success: '#fff',
  subtle: colors.text,
};

export function Button({
  label, variant = 'primary', busy, icon, size = 'md', ...props
}: PressableProps & {
  label: string;
  variant?: ButtonVariant;
  busy?: boolean;
  icon?: IconName;
  size?: 'sm' | 'md' | 'lg';
}) {
  const disabled = Boolean(props.disabled) || Boolean(busy);
  const fg = VARIANT_FG[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, busy: Boolean(busy) }}
      {...props}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        size === 'sm' && styles.buttonSm,
        size === 'lg' && styles.buttonLg,
        { backgroundColor: VARIANT_BG[variant] },
        variant === 'outline' && styles.buttonOutline,
        pressed && { opacity: 0.75, transform: [{ scale: 0.985 }] },
        disabled && { opacity: 0.45 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={fg} size="small" />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={size === 'sm' ? 14 : 16} color={fg} /> : null}
          <Text style={[styles.buttonText, size === 'sm' && { fontSize: 13 }, { color: fg }]}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

/* ── Inputs ────────────────────────────────────────────────────────── */

export function Input({
  label, hint, icon, ...props
}: TextInputProps & { label?: string; hint?: string; icon?: IconName }) {
  return (
    <View>
      {label ? <Text style={styles.fieldLabel}>{label.toUpperCase()}</Text> : null}
      <View style={styles.inputWrap}>
        {icon ? <Ionicons name={icon} size={16} color={colors.muted} style={styles.inputIcon} /> : null}
        <TextInput
          placeholderTextColor={colors.muted}
          {...props}
          style={[styles.input, icon ? { paddingLeft: 38 } : null, props.style]}
        />
      </View>
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

/* ── Status indicators ─────────────────────────────────────────────── */

export function SeverityPill({ severity }: { severity: string }) {
  return (
    <View style={[styles.pill, { backgroundColor: severityColor(severity) }]}>
      <Text style={styles.pillText}>{severity.toUpperCase()}</Text>
    </View>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tone = statusColor(status);
  return (
    <View style={[styles.badge, { borderColor: `${tone}66`, backgroundColor: `${tone}1f` }]}>
      <View style={[styles.badgeDot, { backgroundColor: tone }]} />
      <Text style={[styles.badgeText, { color: tone }]}>{status}</Text>
    </View>
  );
}

/** Neutral key/value line for detail cards. */
export function KeyValue({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <View style={styles.kv}>
      <Text style={styles.kvLabel}>{label}</Text>
      <Text style={styles.kvValue}>{value}</Text>
    </View>
  );
}

/* ── Feedback ──────────────────────────────────────────────────────── */

export function Banner({
  tone = 'error', children, onDismiss,
}: {
  tone?: 'error' | 'success' | 'info';
  children: React.ReactNode;
  onDismiss?: () => void;
}) {
  const map = {
    error: { colour: colors.critical, icon: 'alert-circle' as IconName },
    success: { colour: colors.low, icon: 'checkmark-circle' as IconName },
    info: { colour: colors.accent, icon: 'information-circle' as IconName },
  }[tone];
  return (
    <View style={[styles.banner, { borderColor: `${map.colour}55`, backgroundColor: `${map.colour}1a` }]}>
      <Ionicons name={map.icon} size={16} color={map.colour} />
      <Text style={[styles.bannerText, { color: map.colour }]}>{children}</Text>
      {onDismiss ? (
        <Pressable onPress={onDismiss} hitSlop={10} accessibilityLabel="Dismiss">
          <Ionicons name="close" size={16} color={map.colour} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function EmptyState({
  icon = 'file-tray-outline', title, body, action,
}: {
  icon?: IconName;
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={26} color={colors.muted} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {body ? <Text style={styles.emptyBody}>{body}</Text> : null}
      {action ? <View style={{ marginTop: space.lg, alignSelf: 'stretch' }}>{action}</View> : null}
    </View>
  );
}

/* ── Wizard progress ───────────────────────────────────────────────── */

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <View style={styles.stepper}>
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        const tone = done ? colors.low : active ? colors.accent : colors.border;
        return (
          <View key={label} style={styles.stepItem}>
            <View style={styles.stepRow}>
              <View style={[styles.stepDot, { backgroundColor: done || active ? tone : colors.bgElevated, borderColor: tone }]}>
                {done
                  ? <Ionicons name="checkmark" size={12} color="#fff" />
                  : <Text style={[styles.stepNum, { color: active ? '#fff' : colors.muted }]}>{i + 1}</Text>}
              </View>
              {i < steps.length - 1 ? (
                <View style={[styles.stepLine, { backgroundColor: done ? colors.low : colors.border }]} />
              ) : null}
            </View>
            <Text style={[styles.stepLabel, (done || active) && { color: colors.text }]} numberOfLines={1}>
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** Segmented picker — used for fuel level and other short option sets. */
export function Segmented<T extends string>({
  options, value, onChange,
}: { options: readonly T[]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={styles.segmented}>
      {options.map((opt) => {
        const active = opt === value;
        return (
          <Pressable
            key={opt}
            onPress={() => onChange(opt)}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            style={({ pressed }) => [
              styles.segment,
              active && styles.segmentActive,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text style={[styles.segmentText, active && { color: '#fff' }]}>{opt}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ── Checklist ─────────────────────────────────────────────────────── */

export function CheckRow({
  label, checked, onToggle,
}: { label: string; checked: boolean; onToggle: () => void }) {
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      style={({ pressed }) => [
        styles.checkRow,
        checked && styles.checkRowActive,
        pressed && { opacity: 0.8 },
      ]}
    >
      <View style={[styles.checkBox, checked && styles.checkBoxActive]}>
        {checked ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
      </View>
      <Text style={[styles.checkLabel, checked && { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bgCard,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.lg,
    marginBottom: space.md,
    overflow: 'hidden',
    ...elevation.card,
  },
  cardTight: { padding: space.md },
  cardRail: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },

  sectionLabel: {
    ...type.label,
    color: colors.muted,
    marginBottom: space.sm,
    marginTop: space.xs,
  },

  title: { ...type.h1, color: colors.text },
  muted: { ...type.small, color: colors.muted, marginTop: 2, lineHeight: 19 },

  button: {
    minHeight: 48,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
  },
  buttonSm: { minHeight: 36, paddingHorizontal: space.md, borderRadius: radius.sm },
  buttonLg: { minHeight: 54 },
  buttonOutline: { borderWidth: 1, borderColor: colors.borderStrong },
  buttonText: { fontWeight: '700', fontSize: 15 },

  fieldLabel: { ...type.label, color: colors.muted, marginBottom: 6 },
  fieldHint: { ...type.small, color: colors.muted, marginTop: 6 },
  inputWrap: { position: 'relative', justifyContent: 'center' },
  inputIcon: { position: 'absolute', left: 13, zIndex: 1 },
  input: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgSoft,
    color: colors.text,
    paddingHorizontal: space.md,
    fontSize: 15,
  },

  pill: {
    borderRadius: radius.pill,
    paddingHorizontal: space.sm + 2,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  pillText: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },

  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 12, fontWeight: '700' },

  kv: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: space.md,
    paddingVertical: 7,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  kvLabel: { ...type.small, color: colors.muted },
  kvValue: { ...type.small, color: colors.text, fontWeight: '600', flexShrink: 1, textAlign: 'right' },

  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md - 2,
    marginBottom: space.md,
  },
  bannerText: { flex: 1, fontSize: 13, lineHeight: 18 },

  empty: { alignItems: 'center', paddingVertical: space['3xl'], paddingHorizontal: space.lg },
  emptyIcon: {
    width: 56, height: 56, borderRadius: radius.pill,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.bgElevated,
    borderWidth: 1, borderColor: colors.border,
  },
  emptyTitle: { ...type.h2, color: colors.text, marginTop: space.lg, textAlign: 'center' },
  emptyBody: {
    ...type.small, color: colors.muted, marginTop: 6,
    textAlign: 'center', lineHeight: 20, maxWidth: 300,
  },

  stepper: { flexDirection: 'row', marginBottom: space.lg },
  stepItem: { flex: 1 },
  stepRow: { flexDirection: 'row', alignItems: 'center' },
  stepDot: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  stepNum: { fontSize: 11, fontWeight: '800' },
  stepLine: { flex: 1, height: 2, marginHorizontal: 4 },
  stepLabel: { ...type.small, fontSize: 11, color: colors.muted, marginTop: 6 },

  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.bgSoft,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1, minHeight: 36, borderRadius: radius.sm,
    alignItems: 'center', justifyContent: 'center',
  },
  segmentActive: { backgroundColor: colors.accent },
  segmentText: { fontSize: 13, fontWeight: '700', color: colors.muted },

  checkRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    padding: space.md, marginBottom: space.sm, backgroundColor: colors.bgSoft,
  },
  checkRowActive: { borderColor: colors.low, backgroundColor: colors.lowSoft },
  checkBox: {
    width: 22, height: 22, borderRadius: radius.sm, borderWidth: 1.5,
    borderColor: colors.borderStrong,
    alignItems: 'center', justifyContent: 'center',
  },
  checkBoxActive: { backgroundColor: colors.low, borderColor: colors.low },
  checkLabel: { color: colors.textDim, flex: 1, fontSize: 14, lineHeight: 19 },
});
