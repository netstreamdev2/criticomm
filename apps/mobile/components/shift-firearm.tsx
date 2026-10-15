import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ChamberStatus, FirearmCondition, ShiftFirearm } from '@criticom/api';
import type { Database } from '@criticom/db/types';
import {
  CHAMBER_STATUSES, FIREARM_CHECKS, FIREARM_CONDITIONS, saShortDate, type FirearmCheckKey,
} from '@/lib/inspection-187c';
import {
  ChoiceChips, FieldLabel, Group, PaperButton, PaperInput, Sheet, TickBox, paper,
} from '@/components/shift-form';
import { makeStyles } from '@/lib/theme';
import { tx } from '@criticom/db/i18n';
import { useT } from '@/lib/i18n';

type FirearmChecklist = Database['public']['Tables']['firearm_checklists']['Row'];
type IconName = React.ComponentProps<typeof Ionicons>['name'];

export type FirearmForm = {
  firearmId: string | null;
  rounds: string;
  magazines: string;
  chamber: ChamberStatus | null;
  condition: FirearmCondition | null;
  checks: Partial<Record<FirearmCheckKey, boolean>>;
  notes: string;
  sameAsLast: boolean;
  /** Not drawing a firearm this shift — cancels out the loadout form. */
  noFirearm: boolean;
  noFirearmReason: string;
};

export const emptyFirearm = (): FirearmForm => ({
  firearmId: null,
  rounds: '15',
  magazines: '2',
  chamber: null,
  condition: null,
  checks: {},
  notes: '',
  sameAsLast: false,
  noFirearm: false,
  noFirearmReason: '',
});

export function firearmFormError(form: FirearmForm): string | null {
  if (form.noFirearm) return null;
  if (!form.firearmId) return tx('Select the firearm you are drawing.');
  const rounds = Number(form.rounds);
  if (!form.rounds.trim() || !Number.isInteger(rounds) || rounds < 0 || rounds > 500) {
    return tx('Rounds issued must be a whole number between 0 and 500.');
  }
  const mags = Number(form.magazines);
  if (!form.magazines.trim() || !Number.isInteger(mags) || mags < 0 || mags > 20) {
    return tx('Magazines must be a whole number between 0 and 20.');
  }
  if (!form.chamber) return tx('Select the chamber status.');
  if (!form.condition) return tx('Select the firearm condition.');
  if (form.condition !== 'clean' && !form.notes.trim()) return tx('Describe the firearm condition in the notes.');
  return null;
}

const TYPE_ICON: Record<ShiftFirearm['firearm_type'], IconName> = {
  Sidearm: 'locate',
  Rifle: 'scan',
  Shotgun: 'radio-button-on',
  'Less-lethal': 'flash',
  Other: 'ellipse-outline',
};

export function FirearmSheet({
  firearms, form, patch, invalid: invalidProp, lastLoadout, onSubmit, busy, userId,
}: {
  firearms: ShiftFirearm[];
  form: FirearmForm;
  patch: (p: Partial<FirearmForm>) => void;
  invalid: boolean;
  lastLoadout: FirearmChecklist | null;
  onSubmit: () => void;
  busy: boolean;
  userId: string | null;
}) {
  const { t } = useT();
  const styles = useStyles();
  // A cancelled form has nothing to flag.
  const invalid = invalidProp && !form.noFirearm;
  const selected = firearms.find((f) => f.id === form.firearmId) ?? null;
  const allChecks = FIREARM_CHECKS.every(([k]) => form.checks[k]);
  const lastAvailable = lastLoadout?.firearm_id ? firearms.some((f) => f.id === lastLoadout.firearm_id) : false;

  const toggleSameAsLast = () => {
    if (form.sameAsLast || !lastLoadout) {
      patch({ sameAsLast: false });
      return;
    }
    patch({
      sameAsLast: true,
      firearmId: lastAvailable ? lastLoadout.firearm_id : form.firearmId,
      rounds: String(lastLoadout.rounds_issued),
      magazines: String(lastLoadout.magazines),
      chamber: lastLoadout.chamber_status ?? form.chamber,
    });
  };

  return (
    <Sheet>
      <View style={styles.head}>
        <Text style={styles.title}>{t('Select Firearm & Checklist')}</Text>
        <Text style={styles.sub}>{t('Select your issued weapon and complete the mandatory SAPS inspection.')}</Text>
      </View>

      <View style={{ paddingHorizontal: 14 }}>
        <TickBox
          checked={form.noFirearm}
          onToggle={() => patch({ noFirearm: !form.noFirearm })}
          tone={paper.red}
          style={[styles.noFirearm, form.noFirearm && styles.noFirearmOn]}
        >
          <Text style={styles.tickTitle}>{t('No firearm')}</Text>
          <Text style={styles.tickBody}>
            {t('I am not drawing a firearm this shift (e.g. mine is not on the armoury register). This is recorded on my start-of-shift record.')}
          </Text>
        </TickBox>
        {form.noFirearm ? (
          <PaperInput
            label={t('Reason (optional)')}
            placeholder={t('e.g. Firearm not on the register, unarmed duty…')}
            value={form.noFirearmReason}
            onChangeText={(noFirearmReason) => patch({ noFirearmReason })}
          />
        ) : null}

        <View
          pointerEvents={form.noFirearm ? 'none' : 'auto'}
          importantForAccessibility={form.noFirearm ? 'no-hide-descendants' : 'auto'}
          style={form.noFirearm ? styles.cancelled : undefined}
        >
        {lastLoadout ? (
          <TickBox checked={form.sameAsLast} onToggle={toggleSameAsLast} tone={paper.green} style={{ marginBottom: 12 }}>
            <Text style={styles.tickTitle}>{t('Same loadout as last shift')}</Text>
            <Text style={styles.tickBody}>
              {t('{firearm} · S/N {serial} · {rounds} rounds · {magazines} magazines ({date})', {
                firearm: lastLoadout.make_model, serial: lastLoadout.serial_number, rounds: lastLoadout.rounds_issued,
                magazines: lastLoadout.magazines, date: saShortDate(lastLoadout.created_at),
              })}
              {lastAvailable ? '' : t(' — that firearm is not available today, select another.')}
            </Text>
          </TickBox>
        ) : null}

        <FieldLabel label={t('Firearm')} required invalid={invalid && !form.firearmId} />
        {firearms.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="lock-closed-outline" size={22} color={paper.muted} />
            <Text style={styles.emptyText}>
              {t('No firearms are available on your armoury register. Ask your supervisor to log or return one, or tick No firearm above.')}
            </Text>
          </View>
        ) : (
          <View style={styles.grid}>
            {firearms.map((f) => {
              const active = f.id === form.firearmId;
              const mine = f.status === 'Issued' && f.issued_to === userId;
              return (
                <Pressable
                  key={f.id}
                  onPress={() => patch({ firearmId: f.id })}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={t('{make} {model}, serial {serial_number}', { make: f.make, model: f.model, serial_number: f.serial_number })}
                  style={[
                    styles.card,
                    invalid && !form.firearmId && { borderColor: paper.red },
                    active && styles.cardActive,
                  ]}
                >
                  <Ionicons name={TYPE_ICON[f.firearm_type] ?? 'locate'} size={30} color={active ? paper.blue : paper.muted} />
                  <Text style={styles.cardTitle} numberOfLines={1}>{f.make} {f.model !== '—' ? f.model : ''}</Text>
                  <Text style={styles.cardSub} numberOfLines={1}>
                    {[f.calibre, f.firearm_type].filter(Boolean).join(' ')}
                  </Text>
                  <Text style={styles.cardSerial} numberOfLines={1}>{t('S/N {serial_number}', { serial_number: f.serial_number })}</Text>
                  {mine ? <Text style={styles.mine}>{t('BOOKED OUT TO YOU')}</Text> : null}
                </Pressable>
              );
            })}
          </View>
        )}

        <View style={styles.divider} />

        <FieldLabel label={t('Serial number')} />
        <View style={[styles.dark, { marginBottom: 14 }]}>
          <Text style={[styles.darkText, !selected && { color: paper.faint }]}>
            {selected ? selected.serial_number : t('Select a firearm above')}
          </Text>
          {selected ? <Ionicons name="lock-closed" size={14} color={paper.faint} /> : null}
        </View>

        <View style={styles.pair}>
          <View style={{ flex: 1 }}>
            <PaperInput
              label={t('Ammunition issued (rounds)')}
              required
              invalid={invalid && !/^\d+$/.test(form.rounds.trim())}
              keyboardType="number-pad"
              value={form.rounds}
              onChangeText={(v) => patch({ rounds: v.replace(/[^\d]/g, '') })}
              style={styles.darkInput}
            />
          </View>
          <View style={{ flex: 1 }}>
            <PaperInput
              label={t('Magazines')}
              required
              invalid={invalid && !/^\d+$/.test(form.magazines.trim())}
              keyboardType="number-pad"
              value={form.magazines}
              onChangeText={(v) => patch({ magazines: v.replace(/[^\d]/g, '') })}
              style={styles.darkInput}
            />
          </View>
        </View>

        <FieldLabel label={t('Chamber status')} required invalid={invalid && !form.chamber} />
        <ChoiceChips options={CHAMBER_STATUSES} value={form.chamber} onChange={(chamber) => patch({ chamber })} invalid={invalid} />
        <View style={{ height: 14 }} />

        <FieldLabel label={t('Condition & functionality')} required invalid={invalid && !form.condition} />
        <ChoiceChips options={FIREARM_CONDITIONS} value={form.condition} onChange={(condition) => patch({ condition })} invalid={invalid} />
        <View style={{ height: 14 }} />

        <Group
          title={t('Safety checks')}
          right={(
            <Pressable
              onPress={() => patch({
                checks: Object.fromEntries(FIREARM_CHECKS.map(([k]) => [k, !allChecks])) as FirearmForm['checks'],
              })}
              hitSlop={6}
            >
              <Text style={styles.allChecks}>{allChecks ? t('Clear all') : t('✓ All passed')}</Text>
            </Pressable>
          )}
        >
          {FIREARM_CHECKS.map(([k, label]) => (
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
              {t('Any unticked check fails the inspection and the firearm is sent to the armourer.')}
            </Text>
          ) : null}
        </Group>

        <PaperInput
          label={t('Inspection notes / defect report')}
          required={Boolean(form.condition && form.condition !== 'clean')}
          invalid={invalid && Boolean(form.condition && form.condition !== 'clean') && !form.notes.trim()}
          multiline
          placeholder={t('Note any scratches, missing parts, or mechanical stiffness…')}
          value={form.notes}
          onChangeText={(notes) => patch({ notes })}
          style={styles.darkInput}
        />
        </View>

        <PaperButton
          label={form.noFirearm ? t('Confirm No Firearm & Start Shift') : t('Confirm Loadout & Start Shift')}
          icon="shield-checkmark-outline"
          tone="success"
          onPress={onSubmit}
          busy={busy}
          disabled={!form.noFirearm && firearms.length === 0}
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

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card: {
    width: '48%', flexGrow: 1, backgroundColor: paper.raised, borderRadius: 12, borderWidth: 1.5,
    borderColor: paper.line, alignItems: 'center', paddingVertical: 14, paddingHorizontal: 8,
  },
  cardActive: { borderColor: paper.blue, backgroundColor: paper.blueSoft },
  cardTitle: { color: paper.ink, fontWeight: '800', fontSize: 15, marginTop: 8 },
  cardSub: { color: paper.muted, fontSize: 13, marginTop: 2 },
  cardSerial: { color: paper.faint, fontSize: 11, fontFamily: 'monospace', marginTop: 4 },
  mine: { color: paper.green, fontWeight: '800', fontSize: 9, letterSpacing: 1, marginTop: 6 },
  empty: {
    alignItems: 'center', gap: 8, padding: 18, borderRadius: 12, borderWidth: 1,
    borderStyle: 'dashed', borderColor: paper.lineStrong, backgroundColor: paper.field,
  },
  emptyText: { color: paper.muted, textAlign: 'center', fontSize: 13, lineHeight: 18 },
  noFirearm: { marginBottom: 12 },
  noFirearmOn: { borderColor: paper.red, backgroundColor: paper.redSoft },
  cancelled: { opacity: 0.35 },
  divider: { height: 1, backgroundColor: paper.line, marginVertical: 18 },

  dark: {
    minHeight: 48, borderRadius: 12, backgroundColor: paper.field, borderWidth: 1, borderColor: paper.lineStrong, paddingHorizontal: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  darkText: { color: paper.ink, fontSize: 15, fontFamily: 'monospace' },
  darkInput: { backgroundColor: paper.field, color: paper.ink, borderColor: paper.lineStrong },
  pair: { flexDirection: 'row', gap: 10 },

  allChecks: { color: paper.green, fontWeight: '800', fontSize: 12 },
  check: { padding: 12, marginBottom: 8 },
  checkText: { color: paper.inkDim, fontSize: 14 },
  checkWarn: { color: paper.amber, fontSize: 12, fontWeight: '600', marginTop: 2 },
}));
