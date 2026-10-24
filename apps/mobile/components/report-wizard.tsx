import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  checkSections, rowCount, rowLabel, sectionFields, type ReportField, type ReportSection,
} from '@criticom/api';
import { colors, radius, space, type, makeStyles } from '@/lib/theme';
import { Input, Segmented } from '@/components/ui';
import { useT } from '@/lib/i18n';

type IconName = keyof typeof Ionicons.glyphMap;

const YES_NO = ['Yes', 'No'] as const;
const CHECK = ['OK', 'Fault', 'NIL'] as const;
/** More options than this and a choice is a dropdown, not a wall of chips. */
const CHIPS_MAX = 4;
const MULTI_CHIPS_MAX = 6;

/** Readable text on a form's colour: dark on the light hues (yellow), white on the rest. */
export function onTone(hex: string) {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 165 ? '#111827' : '#ffffff';
}

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/* ── One field ─────────────────────────────────────────────────────────── */

/**
 * A report field as the officer fills it: Yes/No and OK/Fault/NIL as
 * buttons, a short list as chips, a long list as a dropdown, dates and times
 * with Today and Now one tap away.
 */
export function ReportFieldInput({ field, value, onChange, tone = colors.accent }: {
  field: ReportField; value: string; onChange: (v: string) => void; tone?: string;
}) {
  const { t } = useT();
  const styles = useStyles();
  const [picking, setPicking] = useState(false);
  const label = `${t(field.label)}${field.required ? ' *' : ''}`;

  if (field.kind === 'yesno' || field.kind === 'check') {
    const opts = field.kind === 'yesno' ? YES_NO : CHECK;
    return (
      <View>
        <Text style={styles.fieldLabel}>{label.toUpperCase()}</Text>
        <Segmented options={opts} value={(opts as readonly string[]).includes(value) ? (value as (typeof opts)[number]) : null} onChange={onChange} />
      </View>
    );
  }

  if (field.kind === 'choice' || field.kind === 'multi') {
    const options = field.options ?? [];
    const multi = field.kind === 'multi';
    const chosen = multi ? (value ? value.split('; ').filter(Boolean) : []) : (value ? [value] : []);
    const toggle = (opt: string) => {
      if (!multi) { onChange(value === opt ? '' : opt); return; }
      onChange((chosen.includes(opt) ? chosen.filter((c) => c !== opt) : [...chosen, opt]).join('; '));
    };

    if (options.length > (multi ? MULTI_CHIPS_MAX : CHIPS_MAX)) {
      return (
        <View>
          <Text style={styles.fieldLabel}>{label.toUpperCase()}</Text>
          <Pressable
            onPress={() => setPicking(true)}
            accessibilityRole="button"
            accessibilityLabel={`${t(field.label)}: ${chosen.length ? chosen.map((c) => t(c)).join(', ') : t('not chosen')}`}
            style={({ pressed }) => [styles.select, chosen.length > 0 && { borderColor: `${tone}88` }, pressed && { opacity: 0.8 }]}
          >
            <Text style={[styles.selectText, !chosen.length && { color: colors.muted }]} numberOfLines={2}>
              {chosen.length ? chosen.map((c) => t(c)).join(', ') : multi ? t('Choose all that apply') : t('Choose…')}
            </Text>
            <Ionicons name="chevron-down" size={18} color={colors.muted} />
          </Pressable>
          <OptionPicker
            visible={picking}
            title={t(field.label)}
            options={options}
            chosen={chosen}
            multi={multi}
            tone={tone}
            onToggle={(opt) => { toggle(opt); if (!multi) setPicking(false); }}
            onClose={() => setPicking(false)}
          />
        </View>
      );
    }

    return (
      <View>
        <Text style={styles.fieldLabel}>{label.toUpperCase()}</Text>
        <View style={styles.chips}>
          {options.map((opt) => {
            const active = chosen.includes(opt);
            return (
              <Pressable
                key={opt}
                onPress={() => toggle(opt)}
                accessibilityRole={multi ? 'checkbox' : 'radio'}
                accessibilityState={multi ? { checked: active } : { selected: active }}
                style={({ pressed }) => [styles.chip, active && { backgroundColor: tone, borderColor: tone }, pressed && { opacity: 0.75 }]}
              >
                <Text style={[styles.chipText, active && { color: onTone(tone) }]}>{t(opt)}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  }

  const quick = field.kind === 'date'
    ? [[t('Today'), ymd(new Date())], [t('Yesterday'), ymd(new Date(Date.now() - 86_400_000))]]
    : field.kind === 'time'
      ? [[t('Now'), (() => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; })()]]
      : [];

  return (
    <View>
      <Input
        label={label}
        value={value}
        onChangeText={onChange}
        placeholder={field.placeholder ? t(field.placeholder) : field.kind === 'date' ? t('YYYY-MM-DD') : field.kind === 'time' ? t('HH:MM') : undefined}
        keyboardType={field.kind === 'number' ? 'decimal-pad' : field.kind === 'date' || field.kind === 'time' ? 'numbers-and-punctuation' : 'default'}
        autoCapitalize={/plate|vin|reg/.test(field.key) ? 'characters' : field.kind === 'date' || field.kind === 'time' ? 'none' : 'sentences'}
        multiline={field.kind === 'multiline'}
        style={field.kind === 'multiline' ? styles.multiline : undefined}
      />
      {quick.length ? (
        <View style={styles.quickRow}>
          {quick.map(([text, v]) => (
            <Pressable key={text} onPress={() => onChange(v as string)} accessibilityRole="button" hitSlop={6} style={styles.quick}>
              <Text style={[styles.quickText, { color: tone }]}>{text}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** The dropdown's list: one tap picks (or ticks, for several), a search box for long lists. */
function OptionPicker({ visible, title, options, chosen, multi, tone, onToggle, onClose }: {
  visible: boolean; title: string; options: readonly string[]; chosen: string[]; multi: boolean; tone: string;
  onToggle: (opt: string) => void; onClose: () => void;
}) {
  const { t } = useT();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  useEffect(() => { if (visible) setQ(''); }, [visible]);
  const shown = q.trim() ? options.filter((o) => t(o).toLowerCase().includes(q.trim().toLowerCase())) : options;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.pickerBackdrop} onPress={onClose} accessibilityLabel={t('Close list')} />
      <View style={[styles.picker, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View style={styles.pickerHandle} />
        <View style={styles.pickerHead}>
          <Text style={styles.pickerTitle} numberOfLines={2}>{title}</Text>
          <Pressable onPress={onClose} accessibilityRole="button" hitSlop={8} style={[styles.pickerDone, { backgroundColor: tone }]}>
            <Text style={[styles.pickerDoneText, { color: onTone(tone) }]}>{t('Done')}</Text>
          </Pressable>
        </View>
        {options.length > 10 ? (
          <View style={styles.pickerSearch}>
            <Ionicons name="search" size={15} color={colors.muted} />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder={t('Search')}
              placeholderTextColor={colors.muted}
              style={styles.pickerSearchInput}
              autoCorrect={false}
            />
          </View>
        ) : null}
        <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 420 }}>
          {shown.map((opt) => {
            const on = chosen.includes(opt);
            return (
              <Pressable
                key={opt}
                onPress={() => onToggle(opt)}
                accessibilityRole={multi ? 'checkbox' : 'radio'}
                accessibilityState={multi ? { checked: on } : { selected: on }}
                style={({ pressed }) => [styles.option, pressed && { backgroundColor: colors.bgElevated }]}
              >
                <Ionicons
                  name={multi ? (on ? 'checkbox' : 'square-outline') : (on ? 'radio-button-on' : 'radio-button-off')}
                  size={20}
                  color={on ? tone : colors.muted}
                />
                <Text style={[styles.optionText, on && { fontWeight: '800' }]}>{t(opt)}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

/* ── The wizard ────────────────────────────────────────────────────────── */

export type WizardSpec = {
  /** "12A" — or "CASE" for the case report. */
  code: string;
  title: string;
  tone: string;
  icon: IconName;
  sections: readonly ReportSection[];
};

/**
 * One form, full screen, one section per step. The bar across the top is in
 * the form's colour and shows every step; tap one to jump to it. Next checks
 * the step, Done checks the whole form and jumps to anything missing.
 *
 * The police forms use it as it is. The fire and patient reports bring their
 * own rules (`check`) and the parts that are not plain answers (`extra`: the
 * timeline, casualties, signature pads).
 */
export function ReportWizard({
  spec, answers, set, addRow, removeRow, onDone, onClose, onRemove,
  check = checkSections, extra, extraKeys, headingFor, noteFor, startStep = 0, scrollLocked = false,
}: {
  spec: WizardSpec | null;
  answers: Record<string, string>;
  set: (key: string, value: string) => void;
  addRow: (section: ReportSection) => void;
  removeRow: (section: ReportSection) => void;
  onDone: () => void;
  onClose: () => void;
  /** Take a ticked form back off the report. */
  onRemove?: () => void;
  /** What is wrong in these steps, by answer key. Defaults to the police form checks. */
  check?: (sections: readonly ReportSection[], answers: Record<string, string>) => ReadonlyArray<{ key: string }>;
  /** Drawn at the top of a step, above its questions; `bad` is what is marked red. */
  extra?: (section: ReportSection, bad: ReadonlySet<string>) => ReactNode;
  /** Answers a step's `extra` holds (a signature), so Done can go back to it. */
  extraKeys?: (section: ReportSection) => readonly string[];
  /** A small heading before a question. */
  headingFor?: (key: string) => string | undefined;
  /** A line under a question (the GCS total). */
  noteFor?: (key: string) => string | undefined;
  /** The step the form opens on. */
  startStep?: number;
  /** Holds the page still while a signature is drawn. */
  scrollLocked?: boolean;
}) {
  const { t } = useT();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const [bad, setBad] = useState<Set<string>>(new Set());
  const scroll = useRef<ScrollView>(null);
  const openKey = spec ? `${spec.code}:${spec.title}` : null;

  // Every time a form opens: the step asked for, nothing marked.
  useEffect(() => {
    setStep(startStep);
    setBad(new Set());
    // Only on opening: the start step does not move a form already open.
  }, [openKey]);

  const sections = spec?.sections ?? [];
  const section = sections[Math.min(step, Math.max(0, sections.length - 1))];
  const last = step >= sections.length - 1;

  // A fixed answer stops glowing red.
  const stillBad = useMemo(() => {
    if (!bad.size) return bad;
    const now = new Set(check(sections, answers).map((p) => p.key));
    return new Set([...bad].filter((k) => now.has(k)));
  }, [bad, sections, answers, check]);

  if (!spec || !section) return null;
  const tone = spec.tone;
  const ink = onTone(tone);
  const stepTitle = t(section.title.startsWith(`${spec.code} · `) ? section.title.slice(spec.code.length + 3) : section.title);

  const go = (to: number) => {
    setStep(to);
    scroll.current?.scrollTo({ y: 0, animated: false });
  };

  const holds = (s: ReportSection, keys: ReadonlySet<string>) =>
    sectionFields(s, answers).some((f) => keys.has(f.key)) || (extraKeys?.(s) ?? []).some((k) => keys.has(k));

  const next = () => {
    const problems = check([section], answers);
    if (problems.length) { setBad(new Set(problems.map((p) => p.key))); return; }
    if (!last) { go(step + 1); return; }
    const all = check(sections, answers);
    if (all.length) {
      const keys = new Set(all.map((p) => p.key));
      const first = sections.findIndex((s) => holds(s, keys));
      // Nothing on these steps to fix: the screen checks again when it files.
      if (first < 0) { onDone(); return; }
      setBad(keys);
      go(first);
      return;
    }
    onDone();
  };

  const rows = section.repeat ? rowCount(section, answers) : 1;
  const fields = sectionFields(section, answers);
  const stepProblems = fields.filter((f) => stillBad.has(f.key)).length
    + (extraKeys?.(section) ?? []).filter((k) => stillBad.has(k)).length;

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={[styles.wizard, { paddingTop: insets.top }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.wHead}>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t('Close, keep answers')} hitSlop={10} style={styles.wIconBtn}>
            <Ionicons name="close" size={24} color={colors.text} />
          </Pressable>
          <View style={[styles.wBadge, { backgroundColor: tone }]}>
            <Ionicons name={spec.icon} size={16} color={ink} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.wCode, { color: tone }]}>{spec.code}</Text>
            <Text style={styles.wTitle} numberOfLines={1}>{t(spec.title)}</Text>
          </View>
          {onRemove ? (
            <Pressable onPress={onRemove} accessibilityRole="button" hitSlop={8}>
              <Text style={styles.wRemove}>{t('Remove')}</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.wBar} accessibilityRole="progressbar" accessibilityValue={{ min: 1, max: sections.length, now: step + 1 }}>
          {sections.map((s, i) => (
            <Pressable
              key={s.key ?? s.title}
              onPress={() => go(i)}
              hitSlop={{ top: 10, bottom: 10 }}
              accessibilityLabel={t('Step {n}', { n: i + 1 })}
              style={[styles.wSeg, { backgroundColor: i <= step ? tone : colors.track }]}
            />
          ))}
        </View>
        <Text style={styles.wStep}>
          {t('Step {n} of {total}', { n: step + 1, total: sections.length })} · <Text style={{ color: colors.text }}>{stepTitle}</Text>
        </Text>

        <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={styles.wBody} keyboardShouldPersistTaps="handled" scrollEnabled={!scrollLocked}>
          {extra?.(section, stillBad)}
          {Array.from({ length: rows }, (_, i) => i + 1).map((row) => (
            <View key={row} style={section.repeat ? styles.wRow : undefined}>
              {section.repeat ? (
                <View style={styles.wRowHead}>
                  <Text style={[styles.wRowTitle, { color: tone }]}>{`${t(section.repeat.noun)} ${rowLabel(section, row).slice(section.repeat.noun.length + 1)}`}</Text>
                  {row === rows && rows > section.repeat.min ? (
                    <Pressable onPress={() => removeRow(section)} accessibilityRole="button" hitSlop={8}>
                      <Text style={styles.wRemove}>{t('Remove')}</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
              {fields.filter((f) => (section.repeat ? f.row === row : true)).map(({ key, field }) => {
                const isBad = stillBad.has(key);
                const heading = headingFor?.(key);
                const note = noteFor?.(key);
                return (
                  <View key={key}>
                    {heading ? <Text style={[styles.wGroup, { color: tone }]}>{t(heading)}</Text> : null}
                    <View style={[styles.wField, isBad && styles.fieldBad]}>
                      {isBad ? <Text style={styles.badHint}>{field.required && !(answers[key] ?? '').trim() ? t('Required — fill this in') : t('Check this answer')}</Text> : null}
                      <ReportFieldInput field={field} value={answers[key] ?? ''} onChange={(v) => set(key, v)} tone={tone} />
                      {note ? <Text style={styles.wNote}>{note}</Text> : null}
                    </View>
                  </View>
                );
              })}
            </View>
          ))}
          {section.repeat && rows < section.repeat.max ? (
            <Pressable onPress={() => addRow(section)} accessibilityRole="button" style={[styles.wAdd, { borderColor: `${tone}88` }]}>
              <Ionicons name="add-circle-outline" size={18} color={tone} />
              <Text style={[styles.wAddText, { color: tone }]}>{t('Add {noun}', { noun: t(section.repeat.noun).toLowerCase() })}</Text>
            </Pressable>
          ) : null}
        </ScrollView>

        <View style={[styles.wFoot, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          {stepProblems ? (
            <Text style={styles.wFootWarn}>{stepProblems === 1 ? t('One answer needs fixing') : t('{stepProblems} answers need fixing', { stepProblems })}{' '}{t('— marked in red.')}</Text>
          ) : null}
          <View style={styles.wFootRow}>
            <Pressable
              onPress={() => (step === 0 ? onClose() : go(step - 1))}
              accessibilityRole="button"
              style={({ pressed }) => [styles.wBack, pressed && { opacity: 0.8 }]}
            >
              <Ionicons name="chevron-back" size={18} color={colors.text} />
              <Text style={styles.wBackText}>{step === 0 ? t('Close') : t('Back')}</Text>
            </Pressable>
            <Pressable
              onPress={next}
              accessibilityRole="button"
              style={({ pressed }) => [styles.wNext, { backgroundColor: tone }, pressed && { opacity: 0.85 }]}
            >
              <Text style={[styles.wNextText, { color: ink }]}>{last ? t('Done') : t('Next')}</Text>
              <Ionicons name={last ? 'checkmark-circle' : 'chevron-forward'} size={20} color={ink} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  fieldLabel: { ...type.label, fontSize: 11, color: colors.muted, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard,
  },
  chipText: { ...type.small, color: colors.text, fontWeight: '600' },
  multiline: { minHeight: 110, textAlignVertical: 'top', paddingTop: 12 },
  select: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 48, paddingHorizontal: space.md,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard,
  },
  selectText: { ...type.body, color: colors.text, flex: 1 },
  quickRow: { flexDirection: 'row', gap: space.sm, marginTop: 6 },
  quick: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.bgElevated },
  quickText: { fontSize: 12, fontWeight: '800' },
  fieldBad: {
    borderLeftWidth: 3, borderLeftColor: colors.critical, paddingLeft: space.sm,
    backgroundColor: colors.criticalSoft, borderRadius: radius.sm, paddingVertical: 6,
  },
  badHint: { fontSize: 11, fontWeight: '800', color: colors.critical, marginBottom: 4 },

  pickerBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  picker: {
    backgroundColor: colors.bgSoft, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    paddingHorizontal: space.lg, paddingTop: 8, borderWidth: 1, borderColor: colors.borderStrong, borderBottomWidth: 0,
  },
  pickerHandle: { alignSelf: 'center', width: 42, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong, marginBottom: 10 },
  pickerHead: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.sm },
  pickerTitle: { ...type.h2, color: colors.text, flex: 1 },
  pickerDone: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill },
  pickerDoneText: { fontSize: 13, fontWeight: '800' },
  pickerSearch: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, height: 40, paddingHorizontal: space.md, marginBottom: space.sm,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard,
  },
  pickerSearchInput: { flex: 1, color: colors.text, fontSize: 14, paddingVertical: 0 },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 12, paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  optionText: { ...type.body, color: colors.text, flex: 1 },

  wizard: { flex: 1, backgroundColor: colors.bg },
  wHead: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md },
  wIconBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  wBadge: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  wCode: { fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  wTitle: { ...type.h2, color: colors.text },
  wRemove: { color: colors.critical, fontSize: 13, fontWeight: '800' },
  wBar: { flexDirection: 'row', gap: 4, paddingHorizontal: space.lg },
  wSeg: { flex: 1, height: 5, borderRadius: 3 },
  wStep: { ...type.small, color: colors.muted, paddingHorizontal: space.lg, marginTop: space.sm, fontWeight: '700' },
  wBody: { padding: space.lg, paddingBottom: space['3xl'], gap: space.md },
  wField: { marginBottom: space.sm },
  wGroup: { fontSize: 12, fontWeight: '900', letterSpacing: 0.8, textTransform: 'uppercase', marginTop: space.sm, marginBottom: space.sm },
  wNote: { ...type.bodyStrong, color: colors.text, marginTop: space.sm },
  wRow: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.md,
    backgroundColor: colors.bgCard, gap: space.sm,
  },
  wRowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  wRowTitle: { fontSize: 13, fontWeight: '900', letterSpacing: 0.5 },
  wAdd: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 46,
    borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed',
  },
  wAddText: { fontSize: 14, fontWeight: '800' },
  wFoot: {
    paddingHorizontal: space.lg, paddingTop: space.md, gap: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.bgSoft,
  },
  wFootWarn: { fontSize: 12, fontWeight: '800', color: colors.critical, textAlign: 'center' },
  wFootRow: { flexDirection: 'row', gap: space.sm },
  wBack: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, minHeight: 52, paddingHorizontal: space.lg,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard,
  },
  wBackText: { fontSize: 15, fontWeight: '800', color: colors.text },
  wNext: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 52, borderRadius: radius.md },
  wNextText: { fontSize: 16, fontWeight: '900' },
}));
