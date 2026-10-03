import { useEffect, useRef } from 'react';
import {
  ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
  type StyleProp, type TextInputProps, type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { InspectionItemStatus } from '@criticom/api';
import type { DeptIdentity } from '@/lib/branding';
import { DeptBadge } from '@/components/dept-badge';
import { saLongDate } from '@/lib/inspection-187c';
import { paper, makeStyles } from '@/lib/theme';

/**
 * The start-of-shift paperwork: the department crest on top, numbered tabs,
 * quick-fill chips per section and ✓ / × / NIL per item — the structure
 * officers know from V4 and the paper 187(c) — shaded dark slate at night, a
 * white sheet in light mode (the palette follows the app theme).
 *
 * Required fields carry a red asterisk, and turn red when the officer tries
 * to move on without them. (The signature pad stays a light panel with dark
 * ink: that ink is what goes into the PDF report.)
 */

/** The form palette lives with the app theme (lib/theme.ts) so it follows the light/dark toggle. */
export { paper } from '@/lib/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/* ── Sheet + crest header ─────────────────────────────────────────── */

export function Sheet({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  return <View style={[styles.sheet, style]}>{children}</View>;
}

export function CrestHeader({ dept, subtitle }: { dept: DeptIdentity; subtitle: string }) {
  const styles = useStyles();
  const policeInspection = subtitle === 'Vehicle Inspection 187(c)'
    && (dept.silo === 'MetroPolice' || dept.silo === 'Ethekwini');
  return (
    <View style={styles.crestHeader}>
      {/* Soft light behind the crest, purely decorative. */}
      <View style={styles.crestGlow} pointerEvents="none" />
      <View style={styles.crestDate}>
        <Ionicons name="calendar-outline" size={10} color={paper.muted} />
        <Text style={styles.crestDateText}>{saLongDate()}</Text>
      </View>
      <View style={styles.badgePlate}>
        {policeInspection ? (
          <Image
            source={require('../assets/dmps-inspection-badge.png')}
            style={styles.inspectionBadge}
            resizeMode="contain"
            accessibilityLabel="Metro Police inspection badge"
          />
        ) : <DeptBadge dept={dept} size={56} />}
      </View>
      <Text style={styles.crestName} numberOfLines={2}>
        {policeInspection ? 'Durban Metropolitan Police Service' : dept.official_name}
      </Text>
      <View style={styles.crestSubPill}>
        <Text style={styles.crestSub}>{subtitle.toUpperCase()}</Text>
      </View>
    </View>
  );
}

/* ── Tabs ─────────────────────────────────────────────────────────── */

export function TabStrip({
  tabs, current, reached, onSelect,
}: {
  tabs: readonly { id: string; label: string }[];
  current: number;
  /** Furthest tab the officer has opened; only those can be tapped. */
  reached: number;
  onSelect: (i: number) => void;
}) {
  const styles = useStyles();
  const scroller = useRef<ScrollView>(null);
  const offsets = useRef<number[]>([]);
  useEffect(() => {
    const x = offsets.current[current];
    if (x != null) scroller.current?.scrollTo({ x: Math.max(0, x - 24), animated: true });
  }, [current]);

  return (
    <ScrollView
      ref={scroller}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.tabs}
      contentContainerStyle={{ paddingHorizontal: 8, paddingVertical: 8, gap: 6 }}
    >
      {tabs.map((t, i) => {
        const done = i < current;
        const active = i === current;
        const tone = active ? paper.blue : done ? paper.green : paper.faint;
        return (
          <Pressable
            key={t.id}
            disabled={i > reached}
            onPress={() => onSelect(i)}
            onLayout={(e) => { offsets.current[i] = e.nativeEvent.layout.x; }}
            accessibilityRole="tab"
            accessibilityState={{ selected: active, disabled: i > reached }}
            style={[styles.tab, active && styles.tabActive, done && styles.tabDone]}
          >
            <View style={[styles.tabDot, { borderColor: tone }, (done || active) && { backgroundColor: tone }]}>
              {done
                ? <Ionicons name="checkmark" size={12} color="#fff" />
                : <Text style={[styles.tabNum, { color: active ? '#fff' : paper.faint }]}>{i + 1}</Text>}
            </View>
            <Text style={[styles.tabLabel, { color: active ? paper.ink : done ? paper.green : paper.faint }]}>
              {t.label.toUpperCase()}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/* ── Groups and labels ────────────────────────────────────────────── */

export function Group({
  title, children, right,
}: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.group}>
      <View style={styles.groupHead}>
        <View style={styles.groupMark} />
        <Text style={styles.groupTitle}>{title.toUpperCase()}</Text>
        <View style={styles.groupLine} />
        {right}
      </View>
      {children}
    </View>
  );
}

export function FieldLabel({
  label, required, invalid,
}: { label: string; required?: boolean; invalid?: boolean }) {
  const styles = useStyles();
  return (
    <Text style={[styles.fieldLabel, invalid && { color: paper.red }]}>
      {label.toUpperCase()}
      {required ? <Text style={styles.star}> *</Text> : null}
    </Text>
  );
}

export function PaperInput({
  label, required, invalid, hint, ...props
}: TextInputProps & { label: string; required?: boolean; invalid?: boolean; hint?: string }) {
  const styles = useStyles();
  return (
    <View style={{ marginBottom: 14 }}>
      <FieldLabel label={label} required={required} invalid={invalid} />
      <TextInput
        placeholderTextColor={paper.faint}
        selectionColor={paper.blue}
        {...props}
        style={[
          styles.input,
          props.multiline && { minHeight: 88, textAlignVertical: 'top', paddingTop: 12 },
          props.style,
          invalid && styles.inputInvalid,
        ]}
      />
      {invalid ? <Text style={styles.invalidText}>Required</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

/** Wrapped option chips — a select that needs no native picker. */
export function ChoiceChips<T extends string>({
  options, value, onChange, invalid,
}: {
  options: readonly (readonly [T, string])[];
  value: T | null;
  onChange: (v: T) => void;
  invalid?: boolean;
}) {
  const styles = useStyles();
  return (
    <View style={styles.chips}>
      {options.map(([v, label]) => {
        const active = v === value;
        return (
          <Pressable
            key={v}
            onPress={() => onChange(v)}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            style={[styles.chip, invalid && !value && { borderColor: paper.red }, active && styles.chipActive]}
          >
            <View style={[styles.chipRadio, active && { borderColor: paper.blue }]}>
              {active ? <View style={styles.chipRadioDot} /> : null}
            </View>
            <Text style={[styles.chipText, active && { color: paper.ink }]}>{label}</Text>
            {active ? <Ionicons name="checkmark-circle" size={16} color={paper.blue} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/* ── Fuel ─────────────────────────────────────────────────────────── */

/** Read at render time, so it follows the light/dark theme. */
const FUEL_TONE = (): Record<string, [string, string]> => ({
  '1/4': [paper.red, paper.redSoft],
  '1/2': [paper.amber, paper.amberSoft],
  '3/4': [paper.lime, paper.limeSoft],
  Full: [paper.green, paper.greenSoft],
});

export function FuelPicker<T extends string>({
  options, value, onChange, invalid,
}: { options: readonly T[]; value: T | null; onChange: (v: T) => void; invalid?: boolean }) {
  const styles = useStyles();
  return (
    <View style={styles.fuelRow}>
      {options.map((opt) => {
        const [tone, soft] = FUEL_TONE()[opt] ?? [paper.blue, paper.blueSoft];
        const active = opt === value;
        return (
          <Pressable
            key={opt}
            onPress={() => onChange(opt)}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`Fuel ${opt}`}
            style={[
              styles.fuel,
              {
                borderColor: invalid && !value ? paper.red : active ? tone : paper.lineStrong,
                backgroundColor: active ? tone : soft,
              },
            ]}
          >
            <Ionicons name="speedometer-outline" size={13} color={active ? '#fff' : tone} />
            <Text style={[styles.fuelText, { color: active ? '#fff' : tone }]}>{opt}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ── Yes / No ─────────────────────────────────────────────────────── */

export function YesNo({
  label, value, onChange, required, invalid,
}: {
  label: string;
  value: boolean | undefined;
  onChange: (v: boolean) => void;
  required?: boolean;
  invalid?: boolean;
}) {
  const styles = useStyles();
  return (
    <View style={styles.yesNo}>
      <Text style={[styles.yesNoLabel, invalid && value === undefined && { color: paper.red }]}>
        {label}{required ? <Text style={styles.star}> *</Text> : null}
      </Text>
      <View style={styles.segment}>
        {([true, false] as const).map((answer) => {
          const active = value === answer;
          const tone = answer ? paper.green : paper.red;
          return (
            <Pressable
              key={String(answer)}
              onPress={() => onChange(answer)}
              hitSlop={4}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${label}: ${answer ? 'Yes' : 'No'}`}
              style={[
                styles.segmentBtn,
                invalid && value === undefined && { borderColor: paper.red },
                active && { backgroundColor: tone, borderColor: tone },
              ]}
            >
              <Ionicons name={answer ? 'checkmark' : 'close'} size={16} color={active ? '#fff' : tone} />
              <Text style={[styles.segmentText, active && { color: '#fff' }]}>{answer ? 'Yes' : 'No'}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/* ── 187(c) items ─────────────────────────────────────────────────── */

export function QuickFill({ onFill }: { onFill: (status: InspectionItemStatus) => void }) {
  const styles = useStyles();
  return (
    <View style={styles.quick}>
      <Ionicons name="flash-outline" size={12} color={paper.muted} />
      <Text style={styles.quickLabel}>QUICK FILL</Text>
      <Pressable onPress={() => onFill('ok')} style={[styles.quickBtn, { borderColor: `${paper.green}66`, backgroundColor: paper.greenSoft }]}>
        <Ionicons name="checkmark" size={13} color={paper.green} />
        <Text style={[styles.quickText, { color: paper.green }]}>All working</Text>
      </Pressable>
      <Pressable onPress={() => onFill('fault')} style={[styles.quickBtn, { borderColor: `${paper.red}66`, backgroundColor: paper.redSoft }]}>
        <Ionicons name="close" size={13} color={paper.red} />
        <Text style={[styles.quickText, { color: paper.red }]}>All fault</Text>
      </Pressable>
      <Pressable onPress={() => onFill('nil')} style={[styles.quickBtn, { borderColor: paper.lineStrong, backgroundColor: paper.raised }]}>
        <Text style={[styles.quickText, { color: paper.inkDim }]}>NIL all</Text>
      </Pressable>
    </View>
  );
}

/** Read at render time, so it follows the light/dark theme. */
const ITEM_TONE = (): Record<InspectionItemStatus, string> => ({ ok: paper.green, fault: paper.red, nil: '#64748b' });

export function ItemRow({
  label, value, onChange, missing,
}: {
  label: string;
  value: InspectionItemStatus | undefined;
  onChange: (v: InspectionItemStatus) => void;
  missing?: boolean;
}) {
  const styles = useStyles();
  const accent = value ? ITEM_TONE()[value] : missing ? paper.red : 'transparent';
  return (
    <View style={[styles.item, missing && { borderColor: `${paper.red}88`, backgroundColor: paper.redSoft }]}>
      <View style={[styles.itemAccent, { backgroundColor: accent }]} />
      <Text style={styles.itemLabel} numberOfLines={2}>{label}</Text>
      <View style={styles.itemGroup}>
        {(['ok', 'fault', 'nil'] as const).map((s, i) => {
          const active = value === s;
          return (
            <Pressable
              key={s}
              onPress={() => onChange(s)}
              hitSlop={4}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${label}: ${s === 'ok' ? 'working' : s === 'fault' ? 'fault' : 'not applicable'}`}
              style={[styles.itemBtn, i > 0 && styles.itemBtnDivider, active && { backgroundColor: ITEM_TONE()[s] }]}
            >
              {s === 'nil'
                ? <Text style={[styles.itemBtnText, { fontSize: 10 }, active && { color: '#fff' }]}>NIL</Text>
                : <Ionicons name={s === 'ok' ? 'checkmark' : 'close'} size={18} color={active ? '#fff' : ITEM_TONE()[s]} />}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/* ── Tick box ─────────────────────────────────────────────────────── */

export function TickBox({
  checked, onToggle, children, tone = paper.blue, invalid, style,
}: {
  checked: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  tone?: string;
  invalid?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles();
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      style={({ pressed }) => [
        styles.tick,
        checked && { borderColor: `${tone}99`, backgroundColor: `${tone}1f` },
        invalid && !checked && { borderColor: paper.red, backgroundColor: paper.redSoft },
        style,
        pressed && { opacity: 0.85 },
      ]}
    >
      <View style={[styles.tickBox, checked && { backgroundColor: tone, borderColor: tone }]}>
        {checked ? <Ionicons name="checkmark" size={16} color="#fff" /> : null}
      </View>
      <View style={{ flex: 1 }}>{children}</View>
    </Pressable>
  );
}

/* ── Stats + buttons ──────────────────────────────────────────────── */

export function Stat({ value, label, tone }: { value: number; label: string; tone: string }) {
  const styles = useStyles();
  return (
    <View style={styles.stat}>
      <View style={[styles.statAccent, { backgroundColor: tone }]} />
      <Text style={[styles.statValue, { color: tone }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export function PaperButton({
  label, onPress, tone = 'primary', icon, busy, disabled, style,
}: {
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'outline' | 'success' | 'teal' | 'danger';
  icon?: IconName;
  busy?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles();
  const t = {
    primary: { bg: paper.blue, fg: '#fff', border: paper.blue },
    success: { bg: '#16a34a', fg: '#fff', border: '#22c55e' },
    teal: { bg: '#0891b2', fg: '#fff', border: '#06b6d4' },
    danger: { bg: paper.redSoft, fg: paper.red, border: `${paper.red}88` },
    outline: { bg: paper.raised, fg: paper.inkDim, border: paper.lineStrong },
  }[tone];
  const off = disabled || busy;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(off), busy: Boolean(busy) }}
      style={({ pressed }) => [
        styles.pbtn,
        { backgroundColor: t.bg, borderColor: t.border },
        pressed && { opacity: 0.8 },
        off && { opacity: 0.5 },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={t.fg} size="small" /> : (
        <>
          {icon ? <Ionicons name={icon} size={17} color={t.fg} /> : null}
          <Text style={[styles.pbtnText, { color: t.fg }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

/** Back · progress · Next, pinned under each tab like the V4 form. */
export function FooterNav({
  onBack, onNext, nextLabel = 'Next →', percent, position, busy, nextTone = 'outline',
}: {
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: string;
  percent: number;
  position: string;
  busy?: boolean;
  nextTone?: 'outline' | 'primary';
}) {
  const styles = useStyles();
  return (
    <View style={styles.footer}>
      {onBack ? (
        <Pressable onPress={onBack} style={styles.backBtn} accessibilityRole="button">
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
      ) : <View style={{ width: 84 }} />}
      <View style={styles.progress}>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.round(percent)}%` }]} />
        </View>
        <Text style={styles.progressText}>{Math.round(percent)}%  {position}</Text>
      </View>
      <Pressable
        onPress={onNext}
        disabled={busy}
        accessibilityRole="button"
        style={[styles.nextBtn, nextTone === 'primary' && { backgroundColor: paper.blue }]}
      >
        {busy
          ? <ActivityIndicator size="small" color={nextTone === 'primary' ? '#fff' : paper.blue} />
          : <Text style={[styles.nextText, nextTone === 'primary' && { color: '#fff' }]}>{nextLabel}</Text>}
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  sheet: {
    backgroundColor: paper.canvas, borderRadius: 18, overflow: 'hidden', marginBottom: 16,
    borderWidth: 1, borderColor: paper.line,
    shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8,
  },
  crestHeader: {
    backgroundColor: paper.head, alignItems: 'center', paddingTop: 22, paddingBottom: 14,
    paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: paper.line, overflow: 'hidden',
  },
  crestGlow: {
    position: 'absolute', top: -70, width: 260, height: 220, borderRadius: 130,
    backgroundColor: 'rgba(59,130,246,0.10)',
  },
  crestDate: {
    position: 'absolute', right: 12, top: 10, flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999, backgroundColor: paper.raised,
    borderWidth: 1, borderColor: paper.line,
  },
  crestDateText: { fontFamily: 'monospace', fontSize: 9, color: paper.muted },
  // A soft silver disc: the crest's dark outline needs something light behind it.
  badgePlate: {
    width: 108, height: 108, borderRadius: 54, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(203,213,225,0.16)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
    shadowColor: paper.blue, shadowOpacity: 0.4, shadowRadius: 20, shadowOffset: { width: 0, height: 0 },
  },
  inspectionBadge: { width: 92, height: 92 },
  crestName: { color: paper.ink, fontWeight: '800', fontSize: 15, marginTop: 10, textAlign: 'center' },
  crestSubPill: {
    marginTop: 6, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999,
    backgroundColor: paper.blueSoft, borderWidth: 1, borderColor: `${paper.blue}55`,
  },
  crestSub: { color: paper.blueInk, fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },

  tabs: { backgroundColor: paper.sheet, borderBottomWidth: 1, borderBottomColor: paper.line, flexGrow: 0 },
  tab: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 7,
    borderRadius: 999, borderWidth: 1, borderColor: 'transparent',
  },
  tabActive: { borderColor: `${paper.blue}88`, backgroundColor: paper.blueSoft },
  tabDone: { borderColor: `${paper.green}44` },
  tabDot: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  tabNum: { fontSize: 10, fontWeight: '800' },
  tabLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },

  group: {
    backgroundColor: paper.sheet, borderRadius: 14, padding: 14, marginBottom: 12,
    borderWidth: 1, borderColor: paper.line,
  },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  groupMark: { width: 3, height: 13, borderRadius: 2, backgroundColor: paper.blue },
  groupTitle: { color: paper.blueInk, fontSize: 11, fontWeight: '900', letterSpacing: 1.5 },
  groupLine: { flex: 1, height: 1, backgroundColor: paper.line },

  fieldLabel: { color: paper.muted, fontSize: 11, fontWeight: '800', letterSpacing: 0.9, marginBottom: 6 },
  star: { color: paper.red, fontWeight: '800' },
  input: {
    minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: paper.lineStrong,
    backgroundColor: paper.field, color: paper.ink, paddingHorizontal: 14, fontSize: 15,
  },
  inputInvalid: { borderColor: paper.red, borderWidth: 1.5 },
  invalidText: { color: paper.red, fontSize: 11, fontWeight: '700', marginTop: 4 },
  hint: { color: paper.muted, fontSize: 11, marginTop: 4 },

  chips: { gap: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: paper.lineStrong,
    borderRadius: 12, paddingHorizontal: 12, minHeight: 46, backgroundColor: paper.raised,
  },
  chipActive: { borderColor: paper.blue, backgroundColor: paper.blueSoft },
  chipRadio: {
    width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: paper.faint,
    alignItems: 'center', justifyContent: 'center',
  },
  chipRadioDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: paper.blue },
  chipText: { color: paper.inkDim, fontSize: 14, fontWeight: '600', flex: 1 },

  fuelRow: { flexDirection: 'row', gap: 8 },
  fuel: {
    flex: 1, minHeight: 48, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: 5,
  },
  fuelText: { fontWeight: '900', fontSize: 15 },

  yesNo: { paddingVertical: 12, borderTopWidth: 1, borderTopColor: paper.line },
  yesNoLabel: { color: paper.ink, fontSize: 15, marginBottom: 10, lineHeight: 21 },
  segment: { flexDirection: 'row', gap: 8 },
  segmentBtn: {
    flex: 1, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: paper.lineStrong,
    backgroundColor: paper.raised, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  segmentText: { color: paper.inkDim, fontSize: 15, fontWeight: '700' },

  quick: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 12 },
  quickLabel: { color: paper.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1.2, marginRight: 2 },
  quickBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6,
  },
  quickText: { fontSize: 12, fontWeight: '800' },

  item: {
    flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: paper.line,
    borderRadius: 12, paddingVertical: 7, paddingLeft: 14, paddingRight: 7, marginBottom: 8,
    backgroundColor: paper.raised, overflow: 'hidden',
  },
  itemAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  itemLabel: { flex: 1, color: paper.ink, fontSize: 15 },
  itemGroup: {
    flexDirection: 'row', borderRadius: 10, borderWidth: 1, borderColor: paper.lineStrong,
    backgroundColor: paper.field, overflow: 'hidden',
  },
  itemBtn: { width: 44, height: 38, alignItems: 'center', justifyContent: 'center' },
  itemBtnDivider: { borderLeftWidth: 1, borderLeftColor: paper.lineStrong },
  itemBtnText: { color: paper.muted, fontWeight: '900', fontSize: 15 },

  tick: {
    flexDirection: 'row', gap: 12, alignItems: 'flex-start', borderWidth: 1, borderColor: paper.lineStrong,
    backgroundColor: paper.raised, borderRadius: 14, padding: 14,
  },
  tickBox: {
    width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, borderColor: paper.faint,
    alignItems: 'center', justifyContent: 'center', backgroundColor: paper.field, marginTop: 1,
  },

  stat: {
    flex: 1, backgroundColor: paper.sheet, borderRadius: 12, borderWidth: 1, borderColor: paper.line,
    alignItems: 'center', paddingVertical: 12, overflow: 'hidden',
  },
  statAccent: { position: 'absolute', top: 0, left: '30%', right: '30%', height: 2, borderRadius: 1 },
  statValue: { fontSize: 24, fontWeight: '900', fontFamily: 'monospace' },
  statLabel: { color: paper.muted, fontSize: 9, fontWeight: '800', letterSpacing: 1, marginTop: 2 },

  pbtn: {
    minHeight: 50, borderRadius: 12, borderWidth: 1, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16,
  },
  pbtnText: { fontWeight: '800', fontSize: 15 },

  footer: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    backgroundColor: paper.sheet, paddingHorizontal: 12, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: paper.line,
  },
  backBtn: {
    borderWidth: 1, borderColor: paper.lineStrong, borderRadius: 12, backgroundColor: paper.raised,
    paddingHorizontal: 14, minHeight: 44, justifyContent: 'center', width: 84,
  },
  backText: { color: paper.inkDim, fontWeight: '700', fontSize: 15 },
  progress: { flex: 1, alignItems: 'center', gap: 4 },
  progressTrack: { width: 80, height: 5, borderRadius: 3, backgroundColor: paper.line, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: paper.blue },
  progressText: { fontFamily: 'monospace', fontSize: 10, color: paper.muted },
  nextBtn: {
    borderWidth: 1, borderColor: paper.blue, backgroundColor: paper.blueSoft, borderRadius: 12,
    paddingHorizontal: 14, minHeight: 44, minWidth: 84, justifyContent: 'center', alignItems: 'center',
  },
  nextText: { color: paper.blueInk, fontWeight: '800', fontSize: 15 },
}));
