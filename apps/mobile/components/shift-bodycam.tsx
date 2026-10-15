import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { BodycamRow } from '@criticom/api';
import { FieldLabel, Group, PaperButton, PaperInput, Sheet, TickBox, paper } from '@/components/shift-form';
import { makeStyles } from '@/lib/theme';
import { tx } from '@criticom/db/i18n';
import { useT } from '@/lib/i18n';

export const BODYCAM_CHECKS = [
  ['battery', tx('Battery charged for the shift')],
  ['recording', tx('A test recording plays back')],
  ['mounted', tx('Mounted firmly, lens clean and facing forward')],
] as const;
export type BodycamCheckKey = (typeof BODYCAM_CHECKS)[number][0];

export type BodycamForm = {
  bodycamId: string | null;
  checks: Partial<Record<BodycamCheckKey, boolean>>;
  notes: string;
  /** No bodycam this shift: the reason goes on the record instead. */
  none: boolean;
  noneReason: string;
};

export const emptyBodycam = (): BodycamForm => ({ bodycamId: null, checks: {}, notes: '', none: false, noneReason: '' });

export function bodycamFormError(form: BodycamForm): string | null {
  if (form.none) return form.noneReason.trim().length < 3 ? tx('Say why you have no bodycam today.') : null;
  if (!form.bodycamId) return tx('Select the bodycam you are wearing.');
  const allOk = BODYCAM_CHECKS.every(([k]) => form.checks[k]);
  if (!allOk && !form.notes.trim()) return tx('Say what is wrong with the bodycam in the notes.');
  return null;
}

/**
 * Start of shift, after the firearm (migration 0054): book out a bodycam
 * with three quick checks, or say why there is none. A failed check sends the
 * bodycam for repair instead of onto the street.
 */
export function BodycamSheet({
  bodycams, form, patch, invalid: invalidProp, onSubmit, busy, userId,
}: {
  bodycams: BodycamRow[];
  form: BodycamForm;
  patch: (p: Partial<BodycamForm>) => void;
  invalid: boolean;
  onSubmit: () => void;
  busy: boolean;
  userId: string | null;
}) {
  const { t } = useT();
  const styles = useStyles();
  const invalid = invalidProp && !form.none;
  const allChecks = BODYCAM_CHECKS.every(([k]) => form.checks[k]);

  return (
    <Sheet>
      <View style={styles.head}>
        <Text style={styles.title}>{t('Select Your Bodycam')}</Text>
        <Text style={styles.sub}>{t('Choose the bodycam you are wearing this shift and check it works.')}</Text>
      </View>

      <View style={{ paddingHorizontal: 14 }}>
        <TickBox
          checked={form.none}
          onToggle={() => patch({ none: !form.none })}
          tone={paper.red}
          style={[styles.none, form.none && styles.noneOn]}
        >
          <Text style={styles.tickTitle}>{t('No bodycam today')}</Text>
          <Text style={styles.tickBody}>
            {t('I am not wearing a bodycam this shift. My reason is on my start-of-shift record and my supervisor sees it.')}
          </Text>
        </TickBox>
        {form.none ? (
          <PaperInput
            label={t('Reason')}
            required
            invalid={invalidProp && form.noneReason.trim().length < 3}
            placeholder={t('e.g. None left at the station, mine is in for repair…')}
            value={form.noneReason}
            onChangeText={(noneReason) => patch({ noneReason })}
          />
        ) : null}

        <View
          pointerEvents={form.none ? 'none' : 'auto'}
          importantForAccessibility={form.none ? 'no-hide-descendants' : 'auto'}
          style={form.none ? styles.cancelled : undefined}
        >
          <FieldLabel label={t('Bodycam')} required invalid={invalid && !form.bodycamId} />
          {bodycams.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="videocam-off-outline" size={22} color={paper.muted} />
              <Text style={styles.emptyText}>
                {t('No bodycam is available on your register. Ask your supervisor, or tick No bodycam today above.')}
              </Text>
            </View>
          ) : (
            <View style={styles.grid}>
              {bodycams.map((c) => {
                const active = c.id === form.bodycamId;
                const mine = c.status === 'Booked out' && c.booked_to === userId;
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => patch({ bodycamId: c.id })}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={c.model ? t('Bodycam {serial}, {model}', { serial: c.serial_number, model: c.model }) : t('Bodycam {serial}', { serial: c.serial_number })}
                    style={[styles.card, invalid && !form.bodycamId && { borderColor: paper.red }, active && styles.cardActive]}
                  >
                    <Ionicons name="videocam" size={28} color={active ? paper.blue : paper.muted} />
                    <Text style={styles.cardSerial} numberOfLines={1}>{c.serial_number}</Text>
                    <Text style={styles.cardSub} numberOfLines={1}>{[c.model, c.station].filter(Boolean).join(' · ') || t('Bodycam')}</Text>
                    {mine ? <Text style={styles.mine}>{t('BOOKED OUT TO YOU')}</Text> : null}
                  </Pressable>
                );
              })}
            </View>
          )}

          <View style={{ height: 14 }} />
          <Group
            title={t('Checks')}
            right={(
              <Pressable
                onPress={() => patch({
                  checks: Object.fromEntries(BODYCAM_CHECKS.map(([k]) => [k, !allChecks])) as BodycamForm['checks'],
                })}
                hitSlop={6}
              >
                <Text style={styles.allChecks}>{allChecks ? t('Clear all') : t('✓ All passed')}</Text>
              </Pressable>
            )}
          >
            {BODYCAM_CHECKS.map(([k, label]) => (
              <TickBox
                key={k}
                checked={Boolean(form.checks[k])}
                onToggle={() => patch({ checks: { ...form.checks, [k]: !form.checks[k] } })}
                tone={paper.green}
                style={styles.check}
              >
                <Text style={styles.checkText}>{label}</Text>
              </TickBox>
            ))}
            {!allChecks ? (
              <Text style={styles.checkWarn}>
                {t('Any unticked check sends the bodycam for repair. You will choose another one.')}
              </Text>
            ) : null}
          </Group>

          <PaperInput
            label={t('Notes')}
            required={!allChecks}
            invalid={invalid && !allChecks && !form.notes.trim()}
            multiline
            placeholder={t('Anything wrong with it: battery, mount, lens…')}
            value={form.notes}
            onChangeText={(notes) => patch({ notes })}
            style={styles.darkInput}
          />
        </View>

        <PaperButton
          label={form.none ? t('Confirm No Bodycam & Start Shift') : t('Confirm Bodycam & Start Shift')}
          icon="videocam-outline"
          tone="success"
          onPress={onSubmit}
          busy={busy}
          disabled={!form.none && bodycams.length === 0}
          style={{ marginBottom: 16, minHeight: 56 }}
        />
      </View>
    </Sheet>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  head: { alignItems: 'center', paddingHorizontal: 16, paddingTop: 22, paddingBottom: 14 },
  title: { color: paper.ink, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  sub: { color: paper.inkDim, fontSize: 14, textAlign: 'center', marginTop: 6 },

  tickTitle: { color: paper.ink, fontWeight: '800', fontSize: 15 },
  tickBody: { color: paper.muted, fontSize: 13, marginTop: 2, lineHeight: 18 },
  none: { marginBottom: 12 },
  noneOn: { borderColor: paper.red, backgroundColor: paper.redSoft },
  cancelled: { opacity: 0.35 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card: {
    width: '48%', flexGrow: 1, backgroundColor: paper.raised, borderRadius: 12, borderWidth: 1.5,
    borderColor: paper.line, alignItems: 'center', paddingVertical: 14, paddingHorizontal: 8,
  },
  cardActive: { borderColor: paper.blue, backgroundColor: paper.blueSoft },
  cardSerial: { color: paper.ink, fontWeight: '800', fontSize: 15, marginTop: 8, fontFamily: 'monospace' },
  cardSub: { color: paper.muted, fontSize: 12, marginTop: 2 },
  mine: { color: paper.green, fontWeight: '800', fontSize: 9, letterSpacing: 1, marginTop: 6 },
  empty: {
    alignItems: 'center', gap: 8, padding: 18, borderRadius: 12, borderWidth: 1,
    borderStyle: 'dashed', borderColor: paper.lineStrong, backgroundColor: paper.field,
  },
  emptyText: { color: paper.muted, textAlign: 'center', fontSize: 13, lineHeight: 18 },

  allChecks: { color: paper.green, fontWeight: '800', fontSize: 12 },
  check: { padding: 12, marginBottom: 8 },
  checkText: { color: paper.inkDim, fontSize: 14 },
  checkWarn: { color: paper.amber, fontSize: 12, fontWeight: '600', marginTop: 2 },
  darkInput: { backgroundColor: paper.field, color: paper.ink, borderColor: paper.lineStrong },
}));
