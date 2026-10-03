import { useCallback } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import type { Database } from '@criticom/db/types';
import type { InspectionItemStatus, ShiftType } from '@criticom/api';
import type { DeptIdentity } from '@/lib/branding';
import {
  ESSENTIALS, FUEL_LEVELS, SECTION_ORDER, SHIFT_TYPES, TABS, TOTAL_ITEMS,
  countItems, faultLabels, saShortDate, sectionKeys,
  type EssentialKey, type FuelLevel, type ItemMap, type Section,
} from '@/lib/inspection-187c';
import { SignaturePad } from '@/components/signature-pad';
import {
  CrestHeader, FieldLabel, FooterNav, FuelPicker, Group, ItemRow, PaperButton, PaperInput,
  QuickFill, Sheet, Stat, TabStrip, TickBox, YesNo, paper,
} from '@/components/shift-form';
import { colors, makeStyles } from '@/lib/theme';

type Vehicle = Database['public']['Tables']['apparatus']['Row'];
type VehicleChecklist = Database['public']['Tables']['vehicle_checklists']['Row'];

export type InspectionForm = {
  fuel: FuelLevel | null;
  essentials: Partial<Record<EssentialKey, boolean>>;
  ndm: string;
  mileage: string;
  shiftType: ShiftType | null;
  items: ItemMap;
  faultRemarks: string;
  signature: string | null;
  signatureConfirmed: boolean;
  photos: string[];
  licenceDisk: string | null;
  licencePhoto: string | null;
  declaration: boolean;
  sameAsLast: boolean;
};

export const emptyInspection = (vehicle?: Vehicle | null): InspectionForm => ({
  fuel: null,
  essentials: {},
  // Durban Metro plates are the NDM number; start from the fleet record.
  ndm: vehicle?.license_plate ?? '',
  mileage: '',
  shiftType: null,
  items: {},
  faultRemarks: '',
  signature: null,
  signatureConfirmed: false,
  photos: [],
  licenceDisk: null,
  licencePhoto: null,
  declaration: false,
  sameAsLast: false,
});

const MAX_PHOTOS = 6;

/** Why the officer cannot leave this tab yet, or null. */
export function inspectionTabError(form: InspectionForm, tab: number): string | null {
  const t = TABS[tab];
  if (!t) return null;
  switch (t.id) {
    case 'check':
      if (!form.fuel) return 'Select the fuel level.';
      if (ESSENTIALS.some(([k]) => form.essentials[k] === undefined)) return 'Answer Yes or No for every essential check.';
      return null;
    case 'details': {
      if (!form.ndm.trim()) return 'Enter the NDM number.';
      const km = Number(form.mileage);
      if (!form.mileage.trim() || !Number.isInteger(km) || km < 0 || km > 2_000_000) {
        return 'Enter the current mileage in whole kilometres.';
      }
      if (!form.shiftType) return 'Select the shift.';
      return null;
    }
    case 'review':
      if (countItems(form.items).fault > 0 && !form.faultRemarks.trim()) return 'Describe the faults found.';
      return null;
    case 'signoff':
      if (!form.signature) return 'Sign in the signature box.';
      if (!form.signatureConfirmed) return 'Tap Confirm Signature.';
      if (!form.declaration) return 'Accept the inspection declaration.';
      return null;
    default: {
      const missing = t.sections.flatMap((s) => sectionKeys(s)).filter((k) => !form.items[k]).length;
      return missing ? `Mark ${missing} remaining item${missing === 1 ? '' : 's'} as ✓, × or NIL.` : null;
    }
  }
}

/** Share of the whole sheet completed — drives the footer progress bar. */
function completion(form: InspectionForm) {
  const essentials = ESSENTIALS.filter(([k]) => form.essentials[k] !== undefined).length + (form.fuel ? 1 : 0);
  const details = (form.ndm.trim() ? 1 : 0) + (form.mileage.trim() ? 1 : 0) + (form.shiftType ? 1 : 0);
  const signoff = (form.signatureConfirmed ? 1 : 0) + (form.declaration ? 1 : 0);
  const total = 6 + 3 + TOTAL_ITEMS + 2;
  return ((essentials + details + countItems(form.items).done + signoff) / total) * 100;
}

export function InspectionSheet({
  dept, form, patch, tab, reached, onTab, onNext, onBack, invalid, vehicle, lastInspection,
  inspectorName, busy, onDrawingChange,
}: {
  dept: DeptIdentity;
  form: InspectionForm;
  patch: (p: Partial<InspectionForm>) => void;
  tab: number;
  reached: number;
  onTab: (i: number) => void;
  onNext: () => void;
  onBack?: () => void;
  /** Show required fields in red — set after a blocked Next. */
  invalid: boolean;
  vehicle: Vehicle | null;
  lastInspection: VehicleChecklist | null;
  inspectorName: string;
  busy: boolean;
  onDrawingChange: (drawing: boolean) => void;
}) {
  const styles = useStyles();
  const t = TABS[tab] ?? TABS[0];
  const setItem = (key: string, v: InspectionItemStatus) => patch({ items: { ...form.items, [key]: v } });
  const fillSection = (s: Section, v: InspectionItemStatus) => {
    const next = { ...form.items };
    for (const k of sectionKeys(s)) next[k] = v;
    patch({ items: next });
  };
  const onSignature = useCallback((svg: string | null) => {
    patch({ signature: svg, signatureConfirmed: false });
  }, [patch]);

  const lastItems = (lastInspection?.items ?? {}) as ItemMap;
  const canCopyLast = countItems(lastItems).done === TOTAL_ITEMS;

  const toggleSameAsLast = () => {
    if (form.sameAsLast) {
      patch({ sameAsLast: false, items: {} });
    } else if (lastInspection) {
      patch({
        sameAsLast: true,
        items: { ...lastItems },
        ndm: lastInspection.ndm_number ?? form.ndm,
      });
    }
  };

  const pick = async (source: 'camera' | 'library'): Promise<string | null> => {
    if (source === 'camera') {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') return null;
    }
    const launch = source === 'camera' ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
    const result = await launch({ mediaTypes: ['images'], quality: 0.5 });
    if (result.canceled || !result.assets[0]) return null;
    return result.assets[0].uri;
  };

  const addPhoto = async (source: 'camera' | 'library') => {
    if (form.photos.length >= MAX_PHOTOS) return;
    const uri = await pick(source);
    if (uri) patch({ photos: [...form.photos, uri] });
  };

  const counts = countItems(form.items);
  const isLast = tab === TABS.length - 1;

  return (
    <Sheet>
      <CrestHeader dept={dept} subtitle="Vehicle Inspection 187(c)" />
      <TabStrip tabs={TABS} current={tab} reached={reached} onSelect={onTab} />

      <View style={styles.body}>
        {t.id === 'check' ? (
          <>
            <View style={styles.heading}>
              <Text style={styles.headingTitle}>🚐 Checklist for Vehicle</Text>
              <Text style={styles.headingSub}>Complete all pre-shift essential checks before proceeding.</Text>
              {vehicle ? (
                <Text style={styles.unitLine}>
                  {vehicle.unit_number} — {vehicle.name}{vehicle.license_plate ? ` · ${vehicle.license_plate}` : ''}
                </Text>
              ) : null}
            </View>
            <Group title="☑ Essential checks">
              <FieldLabel label="Fuel level" required invalid={invalid && !form.fuel} />
              <FuelPicker options={FUEL_LEVELS} value={form.fuel} onChange={(fuel) => patch({ fuel })} invalid={invalid} />
              <View style={{ height: 6 }} />
              {ESSENTIALS.map(([key, label]) => (
                <YesNo
                  key={key}
                  label={label}
                  required
                  invalid={invalid}
                  value={form.essentials[key]}
                  onChange={(v) => patch({ essentials: { ...form.essentials, [key]: v } })}
                />
              ))}
            </Group>
            {ESSENTIALS.some(([k]) => form.essentials[k] === false) ? (
              <View style={styles.warn}>
                <Ionicons name="warning" size={16} color={paper.red} />
                <Text style={styles.warnText}>
                  A “No” here is recorded, but the vehicle will not be cleared for duty. Report it to fleet control.
                </Text>
              </View>
            ) : null}
          </>
        ) : null}

        {t.id === 'details' ? (
          <>
            {lastInspection && canCopyLast ? (
              <TickBox checked={form.sameAsLast} onToggle={toggleSameAsLast} tone={paper.green} style={{ marginBottom: 12 }}>
                <Text style={styles.tickTitle}>Same as last inspection</Text>
                <Text style={styles.tickBody}>
                  Copies the NDM number and all {TOTAL_ITEMS} item results from{' '}
                  {saShortDate(lastInspection.checked_at)}
                  {lastInspection.inspector_name ? ` (${lastInspection.inspector_name})` : ''}.
                  Check anything that has changed before you sign.
                </Text>
              </TickBox>
            ) : null}
            <Group title="Vehicle details">
              <PaperInput
                label="NDM number"
                required
                invalid={invalid && !form.ndm.trim()}
                placeholder="NDM-"
                autoCapitalize="characters"
                value={form.ndm}
                onChangeText={(ndm) => patch({ ndm })}
              />
              <PaperInput
                label="Current mileage (km)"
                required
                invalid={invalid && !/^\d+$/.test(form.mileage.trim())}
                placeholder="km"
                keyboardType="number-pad"
                value={form.mileage}
                onChangeText={(m) => patch({ mileage: m.replace(/[^\d]/g, '') })}
                hint={vehicle?.mileage ? `Last recorded on the fleet register: ${vehicle.mileage.toLocaleString('en-ZA')} km` : undefined}
              />
            </Group>
            <Group title="Shift details">
              <FieldLabel label="Shift" required invalid={invalid && !form.shiftType} />
              <View style={styles.shiftRow}>
                {SHIFT_TYPES.map(([value, label]) => {
                  const active = form.shiftType === value;
                  return (
                    <Pressable
                      key={value}
                      onPress={() => patch({ shiftType: value })}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active }}
                      style={[
                        styles.shiftChip,
                        invalid && !form.shiftType && { borderColor: paper.red },
                        active && { borderColor: paper.blue, backgroundColor: paper.blueSoft },
                      ]}
                    >
                      <Text style={[styles.shiftText, active && { color: paper.blue }]}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <View style={{ marginTop: 14 }}>
                <FieldLabel label="Date" />
                <View style={styles.readonly}>
                  <Text style={styles.readonlyText}>{saShortDate()}</Text>
                  <Ionicons name="calendar-outline" size={18} color={paper.muted} />
                </View>
              </View>
            </Group>
          </>
        ) : null}

        {t.sections.length > 0 ? t.sections.map((s) => (
          <Group key={s.id} title={s.title}>
            <QuickFill onFill={(v) => fillSection(s, v)} />
            {s.items.map(([k, label]) => {
              const key = `${s.id}.${k}`;
              return (
                <ItemRow
                  key={key}
                  label={label}
                  value={form.items[key]}
                  missing={invalid && !form.items[key]}
                  onChange={(v) => setItem(key, v)}
                />
              );
            })}
          </Group>
        )) : null}

        {t.id === 'review' ? (
          <>
            <View style={styles.stats}>
              <Stat value={TOTAL_ITEMS} label="TOTAL ITEMS" tone={paper.blue} />
              <Stat value={counts.ok} label="WORKING" tone={paper.green} />
              <Stat value={counts.fault} label="FAULTS" tone={paper.red} />
              <Stat value={counts.nil} label="NIL / N/A" tone={paper.faint} />
            </View>
            {counts.fault > 0 ? (
              <View style={[styles.banner, { borderColor: `${paper.red}66`, backgroundColor: paper.redSoft }]}>
                <Text style={[styles.bannerText, { color: paper.red }]}>
                  × {counts.fault} fault{counts.fault === 1 ? '' : 's'}: {faultLabels(form.items).join(', ')}
                </Text>
              </View>
            ) : (
              <View style={[styles.banner, { borderColor: `${paper.green}66`, backgroundColor: paper.greenSoft }]}>
                <Text style={[styles.bannerText, { color: paper.green }]}>✓ No faults detected</Text>
              </View>
            )}
            <Text style={styles.completion}>
              Completion: {counts.done}/{TOTAL_ITEMS} ({Math.round((counts.done / TOTAL_ITEMS) * 100)}%)
            </Text>
            {counts.fault > 0 ? (
              <Group title="Fault remarks">
                <PaperInput
                  label="Describe the faults found"
                  required
                  invalid={invalid && !form.faultRemarks.trim()}
                  multiline
                  placeholder="What is wrong, where, and whether it affects safe driving…"
                  value={form.faultRemarks}
                  onChangeText={(faultRemarks) => patch({ faultRemarks })}
                />
              </Group>
            ) : null}
            {SECTION_ORDER.map((s) => (
              <View key={s.id} style={styles.reviewSection}>
                <Text style={styles.reviewTitle}>{s.title.toUpperCase()}</Text>
                {s.items.map(([k, label]) => {
                  const v = form.items[`${s.id}.${k}`];
                  return (
                    <View key={k} style={styles.reviewRow}>
                      <Text style={styles.reviewLabel}>{label}</Text>
                      <StatusPill status={v} />
                    </View>
                  );
                })}
              </View>
            ))}
          </>
        ) : null}

        {t.id === 'signoff' ? (
          <>
            <Group title="Inspector details">
              <FieldLabel label="Inspected by" />
              <View style={styles.readonly}>
                <Ionicons name="person" size={16} color={colors.purple} />
                <Text style={[styles.readonlyText, { flex: 1 }]}>{inspectorName}</Text>
              </View>
              <View style={{ height: 12 }} />
              <FieldLabel label="Inspection date" />
              <View style={styles.readonly}>
                <Text style={styles.readonlyText}>{saShortDate()}</Text>
                <Ionicons name="calendar-outline" size={18} color={paper.muted} />
              </View>
            </Group>

            <Group title="Inspector signature *">
              <SignaturePad
                onChange={onSignature}
                onDrawingChange={onDrawingChange}
                disabled={form.signatureConfirmed}
              />
              {form.signatureConfirmed ? (
                <View style={styles.sigDone}>
                  <Text style={styles.sigDoneText}>✓ Signature confirmed</Text>
                  <Pressable onPress={() => patch({ signatureConfirmed: false })} hitSlop={8}>
                    <Text style={styles.sigRedo}>Re-sign</Text>
                  </Pressable>
                </View>
              ) : (
                <PaperButton
                  label="✓ Confirm Signature"
                  onPress={() => patch({ signatureConfirmed: true })}
                  disabled={!form.signature}
                  style={{ marginTop: 10, alignSelf: 'flex-start', minHeight: 44 }}
                />
              )}
              {invalid && (!form.signature || !form.signatureConfirmed) ? (
                <Text style={styles.required}>Sign and confirm your signature.</Text>
              ) : null}
            </Group>

            <Group title="Inspection photos">
              {form.photos.length ? (
                <View style={styles.thumbs}>
                  {form.photos.map((uri, i) => (
                    <View key={uri}>
                      <Image source={{ uri }} style={styles.thumb} />
                      <Pressable
                        onPress={() => patch({ photos: form.photos.filter((_, j) => j !== i) })}
                        style={styles.thumbRemove}
                        accessibilityLabel="Remove photo"
                      >
                        <Ionicons name="close" size={14} color="#fff" />
                      </Pressable>
                    </View>
                  ))}
                </View>
              ) : (
                <View style={styles.drop}>
                  <Text style={{ fontSize: 26 }}>🖼️</Text>
                  <Text style={styles.dropTitle}>Attach inspection photos</Text>
                  <Text style={styles.dropSub}>Optional · up to {MAX_PHOTOS}</Text>
                </View>
              )}
              <View style={styles.photoBtns}>
                <PaperButton label="📷 Take Photo" tone="outline" onPress={() => void addPhoto('camera')} disabled={form.photos.length >= MAX_PHOTOS} style={styles.photoBtn} />
                <PaperButton label="Choose from Gallery" tone="outline" onPress={() => void addPhoto('library')} disabled={form.photos.length >= MAX_PHOTOS} style={styles.photoBtn} />
              </View>
            </Group>

            <Group title="Licence documents">
              <View style={styles.docs}>
                <DocSlot
                  title="Licence disk"
                  emoji="📋"
                  uri={form.licenceDisk}
                  onPick={async (src) => { const uri = await pick(src); if (uri) patch({ licenceDisk: uri }); }}
                  onClear={() => patch({ licenceDisk: null })}
                />
                <DocSlot
                  title="Licence photo"
                  emoji="🪪"
                  uri={form.licencePhoto}
                  onPick={async (src) => { const uri = await pick(src); if (uri) patch({ licencePhoto: uri }); }}
                  onClear={() => patch({ licencePhoto: null })}
                />
              </View>
            </Group>

            <TickBox
              checked={form.declaration}
              onToggle={() => patch({ declaration: !form.declaration })}
              invalid={invalid}
            >
              <Text style={styles.declaration}>
                I confirm that I have physically inspected the above vehicle and that the information recorded is
                accurate to the best of my knowledge. Any faults noted must be reported to the immediate supervisor
                and recorded in the official pocket book.{' '}
                <Text style={{ fontWeight: '800' }}>
                  By signing above and checking this box I accept full responsibility for this declaration.
                </Text>
                <Text style={{ color: paper.red, fontWeight: '800' }}> *</Text>
              </Text>
            </TickBox>
          </>
        ) : null}
      </View>

      <FooterNav
        onBack={onBack}
        onNext={onNext}
        nextLabel={isLast ? 'Generate Report' : 'Next →'}
        nextTone={isLast ? 'primary' : 'outline'}
        percent={completion(form)}
        position={`${tab + 1}/${TABS.length}`}
        busy={busy}
      />
    </Sheet>
  );
}

function DocSlot({
  title, emoji, uri, onPick, onClear,
}: {
  title: string;
  emoji: string;
  uri: string | null;
  onPick: (src: 'camera' | 'library') => Promise<void>;
  onClear: () => void;
}) {
  const styles = useStyles();
  return (
    <View style={styles.doc}>
      <Text style={styles.docTitle}>🪪  {title.toUpperCase()}</Text>
      <View style={styles.docBox}>
        {uri ? (
          <>
            <Image source={{ uri }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
            <Pressable onPress={onClear} style={styles.thumbRemove} accessibilityLabel={`Remove ${title}`}>
              <Ionicons name="close" size={14} color="#fff" />
            </Pressable>
          </>
        ) : (
          <>
            <Text style={{ fontSize: 22 }}>{emoji}</Text>
            <Text style={styles.docEmpty}>No {title.toLowerCase()} captured</Text>
          </>
        )}
      </View>
      <View style={styles.docBtns}>
        <Pressable onPress={() => void onPick('camera')} style={[styles.docBtn, { borderColor: paper.blue }]}>
          <Text style={[styles.docBtnText, { color: paper.blue }]}>📷 Capture</Text>
        </Pressable>
        <Pressable onPress={() => void onPick('library')} style={[styles.docBtn, { borderColor: paper.green }]}>
          <Text style={[styles.docBtnText, { color: paper.green }]}>Photo</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function StatusPill({ status }: { status: InspectionItemStatus | undefined }) {
  const styles = useStyles();
  const map = {
    ok: ['OK', paper.green, paper.greenSoft],
    fault: ['FAULT', paper.red, paper.redSoft],
    nil: ['NIL', paper.muted, paper.raised],
  } as const;
  const [text, fg, bg] = status ? map[status] : ['—', paper.faint, paper.raised];
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.pillText, { color: fg }]}>{text}</Text>
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  body: { padding: 12 },
  heading: { alignItems: 'center', paddingVertical: 10, marginBottom: 6 },
  headingTitle: { color: paper.ink, fontSize: 19, fontWeight: '800' },
  headingSub: { color: paper.muted, fontSize: 13, marginTop: 4, textAlign: 'center' },
  unitLine: { color: paper.blue, fontSize: 13, fontWeight: '700', marginTop: 6 },

  warn: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start', borderWidth: 1, borderColor: `${paper.red}66`,
    backgroundColor: paper.redSoft, borderRadius: 10, padding: 12, marginBottom: 12,
  },
  warnText: { color: paper.red, flex: 1, fontSize: 13, lineHeight: 18 },

  tickTitle: { color: paper.ink, fontWeight: '800', fontSize: 15 },
  tickBody: { color: paper.muted, fontSize: 13, marginTop: 2, lineHeight: 18 },

  shiftRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  shiftChip: {
    flexBasis: '47%', flexGrow: 1, minHeight: 46, borderRadius: 10, borderWidth: 1, borderColor: paper.lineStrong,
    alignItems: 'center', justifyContent: 'center', backgroundColor: paper.raised,
  },
  shiftText: { color: paper.inkDim, fontWeight: '700', fontSize: 14 },
  readonly: {
    minHeight: 48, borderRadius: 10, borderWidth: 1, borderColor: paper.lineStrong, backgroundColor: paper.field,
    paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8,
  },
  readonlyText: { color: paper.ink, fontSize: 15, fontWeight: '600' },

  stats: { flexDirection: 'row', gap: 6, marginBottom: 12 },
  banner: { borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 10 },
  bannerText: { fontWeight: '700', fontSize: 14, lineHeight: 19 },
  completion: { color: paper.faint, fontFamily: 'monospace', fontSize: 11, marginBottom: 12 },
  reviewSection: {
    backgroundColor: paper.sheet, borderRadius: 12, borderWidth: 1, borderColor: paper.line,
    marginBottom: 10, overflow: 'hidden',
  },
  reviewTitle: {
    color: paper.blue, fontWeight: '800', fontSize: 11, letterSpacing: 1.5,
    backgroundColor: paper.raised, paddingHorizontal: 14, paddingVertical: 10,
  },
  reviewRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 9, borderTopWidth: 1, borderTopColor: paper.line,
  },
  reviewLabel: { color: paper.inkDim, fontSize: 14 },
  pill: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, minWidth: 34, alignItems: 'center' },
  pillText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },

  sigDone: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  sigDoneText: { color: paper.green, fontWeight: '800' },
  sigRedo: { color: paper.blue, fontWeight: '700' },
  required: { color: paper.red, fontSize: 12, fontWeight: '700', marginTop: 8 },

  drop: {
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: paper.lineStrong, borderRadius: 12,
    alignItems: 'center', paddingVertical: 18, backgroundColor: paper.field,
  },
  dropTitle: { color: paper.inkDim, fontWeight: '700', marginTop: 6 },
  dropSub: { color: paper.faint, fontSize: 12, marginTop: 2 },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  thumb: { width: 92, height: 92, borderRadius: 10, backgroundColor: paper.line },
  thumbRemove: {
    position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(15,23,42,0.75)', alignItems: 'center', justifyContent: 'center',
  },
  photoBtns: { flexDirection: 'row', gap: 8, marginTop: 10 },
  photoBtn: { flex: 1, minHeight: 44, paddingHorizontal: 8 },

  docs: { gap: 12 },
  doc: { borderWidth: 1, borderColor: paper.line, borderRadius: 12, padding: 12, backgroundColor: paper.raised },
  docTitle: { color: paper.inkDim, fontWeight: '700', letterSpacing: 1, fontSize: 12, marginBottom: 8 },
  docBox: {
    height: 120, borderRadius: 10, backgroundColor: paper.field, borderWidth: 1, borderColor: paper.line,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  docEmpty: { color: paper.muted, fontSize: 12, marginTop: 4 },
  docBtns: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 10 },
  docBtn: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  docBtnText: { fontWeight: '700', fontSize: 13 },

  declaration: { color: paper.inkDim, fontSize: 14, lineHeight: 21 },
}));
