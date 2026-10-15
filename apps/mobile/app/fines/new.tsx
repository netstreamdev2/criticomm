import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import type { FineNoticeType } from '@criticom/db/types';
import { canIssueFines } from '@criticom/db/roles';
import {
  DIRECTIONS, discountFor, FINE_VEHICLE_TYPES, ID_TYPES, initialsOf, isValidRsaId, LICENCE_CODES, MAX_CHARGES,
  NOTICE_TYPES, noticeInfo, noticeProblems, normaliseReg, OBSERVATION_FIELDS, payByDate, PRDP_CODES, rand,
  rsaIdDetails, saDate, type DraftStep, type FineOffence, type NoticeDraft,
} from '@criticom/db/fines';
import { useAuth } from '@/lib/auth';
import { useFeature } from '@/lib/features';
import { useSync } from '@/lib/sync';
import { useOpenCall } from '@/lib/open-call';
import { useFineOffences } from '@/lib/fines';
import { colors, radius, space, makeStyles } from '@/lib/theme';
import {
  Banner, Button, Card, CheckRow, EmptyState, Input, KeyValue, Muted, SectionLabel, Stepper,
} from '@/components/ui';
import { SignaturePad } from '@/components/signature-pad';
import { OwingPanel } from '@/components/owing-check';
import { tx } from '@criticom/db/i18n';
import { useT } from '@/lib/i18n';

/**
 * Issue a fine — the roadside notice, step by step.
 *
 *   Notice → Infringer → Vehicle → Offence → Sign
 *
 * What matters on this screen:
 *   • It works with no signal. The charge book is cached, the notice is
 *     queued through the outbox, and the slip prints at once.
 *   • It is the law's form, not a free-text box. Each step asks for what the
 *     notice type needs (AARTO 01 at the roadside, Section 56 for a by-law
 *     with the offender present, Section 341 on an unattended vehicle), and
 *     the server checks it all again.
 *   • Nothing is lost. The draft is kept on the phone until it is issued, so
 *     a call that pulls the officer away does not cost the notice.
 */

const DRAFT_KEY = 'criticom.fine_draft.v1';
const DRAFT_MAX_AGE_MS = 12 * 3600_000;

type IdType = (typeof ID_TYPES)[number];

type Charge = { offenceId: string | null; description: string; amount: string; code: string; other: boolean };

type Draft = {
  noticeType: FineNoticeType;
  noticeNumber: string;
  incidentId: string | null;
  surname: string;
  firstNames: string;
  idType: IdType | null;
  idNumber: string;
  dob: string;
  gender: 'Male' | 'Female' | null;
  licenceCode: string | null;
  prdp: string | null;
  phone: string;
  address: string;
  reg: string;
  disc: string;
  vehicleType: string | null;
  make: string;
  model: string;
  colour: string;
  street: string;
  streetB: string;
  suburb: string;
  place: string;
  direction: string | null;
  lat: number | null;
  lng: number | null;
  charges: Charge[];
  courtName: string;
  courtDate: string;
  observations: Record<string, string>;
  officerSig: string | null;
  infringerSig: string | null;
  refused: boolean;
  explained: boolean;
};

const blankCharge = (): Charge => ({ offenceId: null, description: '', amount: '', code: '', other: false });

const emptyDraft = (): Draft => ({
  noticeType: 'AARTO 01', noticeNumber: '', incidentId: null,
  surname: '', firstNames: '', idType: 'RSA ID', idNumber: '', dob: '', gender: null, licenceCode: null, prdp: null,
  phone: '', address: '',
  reg: '', disc: '', vehicleType: null, make: '', model: '', colour: '',
  street: '', streetB: '', suburb: '', place: '', direction: null, lat: null, lng: null,
  charges: [blankCharge()],
  courtName: 'Durban Magistrate’s Court', courtDate: '',
  observations: {},
  officerSig: null, infringerSig: null, refused: false, explained: false,
});

const STEP_LABEL: Record<DraftStep, string> = {
  notice: tx('Notice'), infringer: tx('Infringer'), vehicle: tx('Vehicle'), offence: tx('Offence'), sign: tx('Sign'),
};

function stepsFor(type: FineNoticeType): DraftStep[] {
  return noticeInfo(type).personPresent
    ? ['notice', 'infringer', 'vehicle', 'offence', 'sign']
    : ['notice', 'vehicle', 'offence', 'sign'];
}

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/* ── Small pieces ───────────────────────────────────────────────────── */

function Chips<T extends string>({
  options, value, onChange, clearable,
}: { options: readonly T[]; value: T | null; onChange: (v: T | null) => void; clearable?: boolean }) {
  const { t } = useT();
  const styles = useStyles();
  return (
    <View style={styles.chips}>
      {options.map((o) => {
        const on = o === value;
        return (
          <Pressable
            key={o}
            onPress={() => onChange(on && clearable ? null : o)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && { opacity: 0.75 }]}
          >
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{t(o)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Field({ children }: { children: React.ReactNode }) {
  return <View style={{ marginBottom: space.md }}>{children}</View>;
}

function Label({ children }: { children: string }) {
  const styles = useStyles();
  return <Text style={styles.label}>{children.toUpperCase()}</Text>;
}

/** Search the charge book; or describe an offence it does not have. */
function OffencePicker({
  regime, offences, onPick, onOther,
}: {
  regime: FineOffence['regime'];
  offences: FineOffence[];
  onPick: (o: FineOffence) => void;
  onOther: () => void;
}) {
  const { t } = useT();
  const styles = useStyles();
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return offences
      .filter((o) => o.regime === regime)
      .filter((o) => !term || o.description.toLowerCase().includes(term) || (o.code ?? '').toLowerCase().includes(term))
      .slice(0, 12);
  }, [offences, regime, q]);

  return (
    <View>
      <Input value={q} onChangeText={setQ} placeholder={t('Search offence or charge code')} icon="search-outline" autoCorrect={false} />
      <View style={styles.pickList}>
        {list.map((o) => (
          <Pressable
            key={o.id}
            onPress={() => onPick(o)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.pickRow, pressed && { backgroundColor: colors.accentSoft }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.pickTitle}>{o.description}</Text>
              <Text style={styles.pickMeta}>
                {[o.code ? `Code ${o.code}` : null, o.legal_ref].filter(Boolean).join(' · ') || t('No code yet')}
              </Text>
            </View>
            <Text style={[styles.pickAmount, o.penalty_amount === null && { color: colors.medium }]}>
              {o.penalty_amount === null ? t('Enter R') : rand(o.penalty_amount)}
            </Text>
          </Pressable>
        ))}
        {list.length === 0 ? <Muted>{t('No offence matches. Describe it below.')}</Muted> : null}
        <Pressable onPress={onOther} accessibilityRole="button" style={({ pressed }) => [styles.pickRow, styles.pickOther, pressed && { opacity: 0.75 }]}>
          <Ionicons name="create-outline" size={16} color={colors.accent} />
          <Text style={[styles.pickTitle, { color: colors.accent }]}>{t('Not in the list — describe the offence')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/* ── Screen ─────────────────────────────────────────────────────────── */

export default function IssueFineScreen() {
  const { t } = useT();
  const styles = useStyles();
  const router = useRouter();
  const { role, silo, fullName } = useAuth();
  const { enqueue, online } = useSync();
  const { offences } = useFineOffences();
  const { calls } = useOpenCall();
  const featureOn = useFeature('mobile.fines');

  const [d, setD] = useState<Draft>(emptyDraft);
  const [stepIndex, setStepIndex] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [restored, setRestored] = useState(false);
  const [scrollOn, setScrollOn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locNote, setLocNote] = useState<string | null>(null);
  // Numbers checked against the register: set when a number is complete or
  // its field is left, never per keystroke (each check is audited and limited).
  const [lookupId, setLookupId] = useState<string | null>(null);
  const [lookupReg, setLookupReg] = useState<string | null>(null);
  const loaded = useRef(false);
  const scroll = useRef<ScrollView>(null);

  const info = noticeInfo(d.noticeType);
  const steps = stepsFor(d.noticeType);
  const step = steps[Math.min(stepIndex, steps.length - 1)]!;
  const set = useCallback(<K extends keyof Draft>(key: K, value: Draft[K]) => setD((cur) => ({ ...cur, [key]: value })), []);

  // Bring back an unfinished notice. Signatures are not kept: a signature is
  // given for what is on the screen at the moment of signing.
  useEffect(() => {
    void AsyncStorage.getItem(DRAFT_KEY)
      .then((raw) => {
        if (!raw) return;
        const saved = JSON.parse(raw) as { d: Draft; step: number; at: number };
        if (Date.now() - saved.at > DRAFT_MAX_AGE_MS) return;
        setD({ ...emptyDraft(), ...saved.d, officerSig: null, infringerSig: null, refused: false, explained: false });
        setStepIndex(Math.min(saved.step, 3));
        setRestored(true);
      })
      .catch(() => {})
      .finally(() => { loaded.current = true; });
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    const { officerSig: _o, infringerSig: _i, ...rest } = d;
    void AsyncStorage.setItem(DRAFT_KEY, JSON.stringify({ d: rest, step: stepIndex, at: Date.now() })).catch(() => {});
  }, [d, stepIndex]);

  const startOver = () => {
    void AsyncStorage.removeItem(DRAFT_KEY);
    setD(emptyDraft());
    setStepIndex(0);
    setErrors([]);
    setRestored(false);
  };

  // What the server would refuse, in the shape the shared rules read.
  const asDraft: NoticeDraft = useMemo(() => ({
    noticeType: d.noticeType,
    capturedFrom: 'device',
    noticeNumber: d.noticeNumber,
    surname: d.surname,
    firstNames: d.firstNames,
    idType: d.idType,
    idNumber: d.idNumber,
    vehicleReg: d.reg,
    street: d.street,
    place: d.place,
    courtName: d.courtName,
    courtDate: d.courtDate,
    officerSignature: d.officerSig,
    infringerSignature: d.infringerSig,
    infringerRefused: d.refused,
    charges: d.charges.map((c) => ({ offenceId: c.offenceId, description: c.description, amount: c.amount, code: c.code })),
  }), [d]);

  const problemsFor = (s: DraftStep) => {
    const list = noticeProblems(asDraft, offences).filter((p) => p.step === s).map((p) => p.message);
    if (s === 'sign' && info.personPresent && !d.explained) {
      list.push('Confirm that you explained the notice and the options to the infringer.');
    }
    return list;
  };

  const go = (next: number) => {
    setErrors([]);
    setStepIndex(next);
    scroll.current?.scrollTo({ y: 0, animated: false });
  };

  const onNext = () => {
    const found = problemsFor(step);
    if (found.length) { setErrors(found); return; }
    go(stepIndex + 1);
  };

  const changeType = (type: FineNoticeType) => {
    if (type === d.noticeType) return;
    // Offences belong to a regime; clear charges that no longer fit.
    const regime = noticeInfo(type).regime;
    setD((cur) => ({
      ...cur,
      noticeType: type,
      charges: cur.charges.map((c) => {
        const off = offences.find((o) => o.id === c.offenceId);
        return off && off.regime !== regime ? blankCharge() : c;
      }),
    }));
  };

  const setIdNumber = (raw: string) => {
    const id = raw.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    const det = d.idType === 'RSA ID' ? rsaIdDetails(id) : null;
    setD((cur) => (det ? { ...cur, idNumber: id, dob: det.dob, gender: det.gender } : { ...cur, idNumber: id }));
    // A complete, valid ID is checked against the register straight away.
    if (det) setLookupId(id);
  };

  const locate = async () => {
    setLocating(true);
    setLocNote(null);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') { setLocNote(t('Location permission was refused. Type the place instead.')); return; }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      setD((cur) => ({ ...cur, lat, lng }));
      // Street names need signal; the coordinates do not.
      try {
        const [a] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
        if (a) {
          setD((cur) => ({
            ...cur, lat, lng,
            street: cur.street || [a.streetNumber, a.street].filter(Boolean).join(' ') || a.name || '',
            suburb: cur.suburb || a.district || a.subregion || '',
          }));
        }
        setLocNote(t('GPS {lat}, {lng} captured.', { lat: lat.toFixed(5), lng: lng.toFixed(5) }));
      } catch {
        setLocNote(t('GPS {lat}, {lng} captured. No signal for the street name — type it.', { lat: lat.toFixed(5), lng: lng.toFixed(5) }));
      }
    } catch {
      setLocNote(t('Could not get a GPS fix. Type the place instead.'));
    } finally {
      setLocating(false);
    }
  };

  const setCharge = (i: number, patch: Partial<Charge>) =>
    setD((cur) => ({ ...cur, charges: cur.charges.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));

  const chargeAmount = (c: Charge): number | null => {
    const off = offences.find((o) => o.id === c.offenceId);
    if (off && off.penalty_amount !== null) return Number(off.penalty_amount);
    const n = Number(c.amount);
    return c.amount.trim() && Number.isFinite(n) && n > 0 ? n : null;
  };
  const total = d.charges.reduce((s, c) => s + (chargeAmount(c) ?? 0), 0);
  const discounted = d.charges.reduce((s, c) => s + (chargeAmount(c) ?? 0) - discountFor(d.noticeType, chargeAmount(c) ?? 0), 0);
  const payBy = payByDate(d.noticeType, new Date(), d.courtDate || null);

  const submit = async () => {
    const all = [...noticeProblems(asDraft, offences).map((p) => p.message), ...problemsFor('sign')];
    if (all.length) { setErrors([...new Set(all)]); return; }
    setBusy(true);
    try {
      const occurredAt = new Date().toISOString();
      const observations = Object.fromEntries(Object.entries(d.observations).filter(([, v]) => v.trim()));
      const notice: Record<string, unknown> = {
        notice_type: d.noticeType,
        captured_from: 'device',
        notice_number: d.noticeNumber.trim() || null,
        incident_id: d.incidentId,
        offender_surname: info.personPresent ? d.surname.trim() : null,
        offender_first_names: info.personPresent ? d.firstNames.trim() : null,
        offender_initials: info.personPresent ? initialsOf(d.firstNames) : null,
        offender_id_type: info.personPresent ? d.idType : null,
        offender_id_number: info.personPresent ? d.idNumber.trim() : null,
        offender_dob: info.personPresent && /^\d{4}-\d{2}-\d{2}$/.test(d.dob) ? d.dob : null,
        offender_gender: info.personPresent ? d.gender : null,
        offender_licence_code: info.personPresent && d.licenceCode !== 'None' ? d.licenceCode : null,
        offender_prdp_code: info.personPresent ? d.prdp : null,
        offender_phone: info.personPresent ? d.phone.trim() : null,
        offender_address: info.personPresent ? d.address.trim() : null,
        vehicle_reg: normaliseReg(d.reg) || null,
        vehicle_licence_disc: d.disc.trim() || null,
        vehicle_type: d.vehicleType,
        vehicle_make: d.make.trim() || null,
        vehicle_model: d.model.trim() || null,
        vehicle_colour: d.colour.trim() || null,
        street_a: d.street.trim() || null,
        street_b: d.streetB.trim() || null,
        suburb: d.suburb.trim() || null,
        location: d.place.trim() || null,
        city: 'Durban',
        province: 'KwaZulu-Natal',
        direction: d.direction,
        latitude: d.lat,
        longitude: d.lng,
        offence_at: occurredAt,
        court_name: d.noticeType === 'Section 56' ? d.courtName.trim() : null,
        court_date: d.noticeType === 'Section 56' ? d.courtDate : null,
        observations,
        officer_signature: d.officerSig,
        infringer_signature: info.personPresent ? d.infringerSig : null,
        infringer_refused: info.personPresent && d.refused && !d.infringerSig,
      };
      const charges = d.charges.map((c) => {
        const off = offences.find((o) => o.id === c.offenceId);
        return {
          offence_id: off?.id ?? null,
          description: off?.description ?? c.description.trim(),
          amount: chargeAmount(c),
          code: off?.code ?? (c.code.trim() || null),
          legal_ref: off?.legal_ref ?? null,
          demerit: off?.demerit_points ?? 0,
        };
      });
      const reg = normaliseReg(d.reg);
      const who = info.personPresent ? `${initialsOf(d.firstNames)} ${d.surname.trim()}`.trim() : 'unattended';
      const id = await enqueue(
        { kind: 'issue_fine', notice, charges, noticeType: d.noticeType, label: [reg, who].filter(Boolean).join(' · ') },
        { occurredAt },
      );
      await AsyncStorage.removeItem(DRAFT_KEY).catch(() => {});
      router.replace(`/fines/${id}`);
    } catch (e) {
      setErrors([(e as Error).message ?? t('The notice could not be saved on this phone.')]);
    } finally {
      setBusy(false);
    }
  };

  if (!featureOn) {
    return (
      <View style={styles.center}>
        <EmptyState icon="receipt-outline" title={t('Not enabled')} body={t('Issuing fines from the phone is not enabled for your organisation.')} />
      </View>
    );
  }
  if (!canIssueFines({ role, silo })) {
    return (
      <View style={styles.center}>
        <EmptyState icon="receipt-outline" title={t('Not for your role')} body={t('Fines are issued by Metro Police officers, supervisors and captains.')} />
      </View>
    );
  }

  const regimeOffences = offences.filter((o) => o.regime === info.regime);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.top}>
        <Stepper steps={steps.map((s) => t(STEP_LABEL[s]))} current={stepIndex} />
      </View>
      <ScrollView
        ref={scroll}
        scrollEnabled={scrollOn}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        {restored ? (
          <Banner tone="info" onDismiss={() => setRestored(false)}>
            {t('Your unfinished notice was kept. Carry on, or tap Start over below.')}
          </Banner>
        ) : null}
        {!online ? (
          <Banner tone="info">{t('No signal. You can still issue the fine: it sends itself when the phone finds a signal, and the slip prints now.')}</Banner>
        ) : null}
        {errors.length ? (
          <Banner tone="error" onDismiss={() => setErrors([])}>{errors.join('\n')}</Banner>
        ) : null}

        {/* ── 1. Notice ─────────────────────────────────────────── */}
        {step === 'notice' ? (
          <>
            <SectionLabel>{t('What are you issuing?')}</SectionLabel>
            {NOTICE_TYPES.map((n) => {
              const on = n.type === d.noticeType;
              return (
                <Pressable
                  key={n.type}
                  onPress={() => changeType(n.type)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  style={({ pressed }) => [styles.typeCard, on && styles.typeCardOn, pressed && { opacity: 0.85 }]}
                >
                  <View style={[styles.typeIcon, on && { backgroundColor: colors.primary }]}>
                    <Ionicons
                      name={n.type === 'AARTO 01' ? 'car-sport' : n.type === 'Section 56' ? 'person' : 'car-outline'}
                      size={20}
                      color={on ? '#fff' : colors.muted}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.typeTitle}>{t(n.label)}</Text>
                    <Text style={styles.typeUse}>{t(n.use)}</Text>
                    <Text style={styles.typeLaw}>{n.law}</Text>
                  </View>
                  <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={20} color={on ? colors.primary : colors.muted} />
                </Pressable>
              );
            })}

            <SectionLabel>{t('Book number (optional)')}</SectionLabel>
            <Card>
              <Input
                label={t('Official notice number')}
                value={d.noticeNumber}
                onChangeText={(v) => set('noticeNumber', v.toUpperCase())}
                placeholder={t('As printed, if you also write in a notice book')}
                autoCapitalize="characters"
                hint={t('Leave empty if this phone is the only notice. The register gives every charge an FN- number.')}
              />
            </Card>

            {calls.length ? (
              <>
                <SectionLabel>{t('Link to an incident (optional)')}</SectionLabel>
                <Card>
                  <View style={styles.chips}>
                    {calls.map((c) => {
                      const on = d.incidentId === c.id;
                      return (
                        <Pressable
                          key={c.id}
                          onPress={() => set('incidentId', on ? null : c.id)}
                          style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && { opacity: 0.75 }]}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: on }}
                        >
                          <Text style={[styles.chipText, on && styles.chipTextOn]}>{c.incident_number}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Muted>{t('The fine shows on that incident’s record.')}</Muted>
                </Card>
              </>
            ) : null}
          </>
        ) : null}

        {/* ── 2. Infringer ──────────────────────────────────────── */}
        {step === 'infringer' ? (
          <>
            <SectionLabel>{t('Infringer')}</SectionLabel>
            <Card>
              <Field><Input label={t('Surname')} value={d.surname} onChangeText={(v) => set('surname', v)} autoCapitalize="words" /></Field>
              <Field><Input label={t('First names')} value={d.firstNames} onChangeText={(v) => set('firstNames', v)} autoCapitalize="words" /></Field>
              <Label>{t('Identification')}</Label>
              <Chips options={ID_TYPES} value={d.idType} onChange={(v) => set('idType', v)} />
              <Field>
                <Input
                  value={d.idNumber}
                  onChangeText={setIdNumber}
                  placeholder={d.idType === 'RSA ID' ? t('13-digit ID number') : t('Number as on the document')}
                  keyboardType={d.idType === 'RSA ID' ? 'number-pad' : 'default'}
                  autoCapitalize="characters"
                  maxLength={d.idType === 'RSA ID' ? 13 : 30}
                  onEndEditing={() => {
                    if (d.idType === 'RSA ID' ? isValidRsaId(d.idNumber) : d.idNumber.length >= 6) setLookupId(d.idNumber);
                  }}
                  icon="id-card-outline"
                  hint={d.idType === 'RSA ID' && d.idNumber.length === 13
                    ? (isValidRsaId(d.idNumber) ? t('✓ Valid ID — date of birth and sex filled in.') : t('✕ Not a valid ID number. Check each digit.'))
                    : undefined}
                />
              </Field>
              {/* What this person already owes, once the number is complete. */}
              {lookupId && lookupId === d.idNumber ? (
                <View style={{ marginBottom: space.md }}><OwingPanel idNumber={d.idNumber} compact /></View>
              ) : null}
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Input label={t('Date of birth')} value={d.dob} onChangeText={(v) => set('dob', v)} placeholder={t('YYYY-MM-DD')} keyboardType="numbers-and-punctuation" maxLength={10} />
                </View>
              </View>
              <View style={{ marginTop: space.md }}>
                <Label>{t('Sex')}</Label>
                <Chips options={[tx('Male'), tx('Female')] as const} value={d.gender} onChange={(v) => set('gender', v)} clearable />
              </View>
            </Card>

            {d.noticeType === 'AARTO 01' ? (
              <>
                <SectionLabel>{t('Driving licence')}</SectionLabel>
                <Card>
                  <Label>{t('Licence code')}</Label>
                  <Chips options={LICENCE_CODES} value={d.licenceCode as (typeof LICENCE_CODES)[number] | null} onChange={(v) => set('licenceCode', v)} clearable />
                  <Label>{t('PrDP (if any)')}</Label>
                  <Chips options={PRDP_CODES} value={d.prdp as (typeof PRDP_CODES)[number] | null} onChange={(v) => set('prdp', v)} clearable />
                  <Muted>{t('G goods · P passengers · D dangerous goods')}</Muted>
                </Card>
              </>
            ) : null}

            <SectionLabel>{t('Contact')}</SectionLabel>
            <Card>
              <Field><Input label={t('Cell number')} value={d.phone} onChangeText={(v) => set('phone', v)} keyboardType="phone-pad" icon="call-outline" /></Field>
              <Input label={t('Residential address')} value={d.address} onChangeText={(v) => set('address', v)} multiline placeholder={t('Street, suburb, code')} />
            </Card>
          </>
        ) : null}

        {/* ── 3. Vehicle ────────────────────────────────────────── */}
        {step === 'vehicle' ? (
          <>
            <SectionLabel>{d.noticeType === 'Section 56' ? t('Vehicle (if one was involved)') : t('Vehicle')}</SectionLabel>
            <Card>
              <Field>
                <Input
                  label={t('Registration')}
                  value={d.reg}
                  onChangeText={(v) => set('reg', v.toUpperCase())}
                  placeholder={t('e.g. ND 123-456')}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  icon="car-outline"
                  style={styles.regInput}
                  onEndEditing={() => { if (normaliseReg(d.reg).length >= 3) setLookupReg(normaliseReg(d.reg)); }}
                />
                {lookupReg && lookupReg === normaliseReg(d.reg) ? <OwingPanel vehicleReg={lookupReg} compact /> : null}
              </Field>
              <Field><Input label={t('Licence disc number')} value={d.disc} onChangeText={(v) => set('disc', v.toUpperCase())} autoCapitalize="characters" /></Field>
              <Label>{t('Type')}</Label>
              <Chips options={FINE_VEHICLE_TYPES} value={d.vehicleType as (typeof FINE_VEHICLE_TYPES)[number] | null} onChange={(v) => set('vehicleType', v)} clearable />
              <View style={styles.row}>
                <View style={{ flex: 1 }}><Input label={t('Make')} value={d.make} onChangeText={(v) => set('make', v)} autoCapitalize="words" /></View>
                <View style={{ flex: 1 }}><Input label={t('Model')} value={d.model} onChangeText={(v) => set('model', v)} autoCapitalize="words" /></View>
              </View>
              <View style={{ marginTop: space.md }}>
                <Input label={t('Colour')} value={d.colour} onChangeText={(v) => set('colour', v)} autoCapitalize="words" />
              </View>
            </Card>
          </>
        ) : null}

        {/* ── 4. Offence ────────────────────────────────────────── */}
        {step === 'offence' ? (
          <>
            {d.charges.map((c, i) => {
              const off = offences.find((o) => o.id === c.offenceId);
              const amount = chargeAmount(c);
              return (
                <View key={`charge-${i}`}>
                  <View style={styles.chargeHead}>
                    <SectionLabel>{d.charges.length > 1 ? t('Charge {n}', { n: i + 1 }) : t('Offence')}</SectionLabel>
                    {d.charges.length > 1 ? (
                      <Pressable
                        onPress={() => setD((cur) => ({ ...cur, charges: cur.charges.filter((_, j) => j !== i) }))}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={t('Remove charge {n}', { n: i + 1 })}
                      >
                        <Text style={styles.remove}>{t('Remove')}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  <Card accent={amount !== null && (off || c.description.trim()) ? colors.low : colors.border}>
                    {off ? (
                      <>
                        <Text style={styles.offTitle}>{off.description}</Text>
                        <Text style={styles.pickMeta}>
                          {[off.code ? t('Code {code}', { code: off.code }) : null, off.legal_ref, off.demerit_points ? (off.demerit_points === 1 ? t('1 demerit point') : t('{n} demerit points', { n: off.demerit_points })) : null].filter(Boolean).join(' · ') || t('No code in the charge book yet')}
                        </Text>
                        {off.penalty_amount === null ? (
                          <View style={{ marginTop: space.md }}>
                            <Input
                              label={t('Penalty amount (R)')}
                              value={c.amount}
                              onChangeText={(v) => setCharge(i, { amount: v.replace(/[^0-9.]/g, '') })}
                              keyboardType="decimal-pad"
                              hint={t('The charge book has no amount for this offence yet. The record notes that you entered it.')}
                            />
                          </View>
                        ) : null}
                        <Pressable onPress={() => setCharge(i, blankCharge())} style={{ marginTop: space.sm }} accessibilityRole="button">
                          <Text style={styles.change}>{t('Change offence')}</Text>
                        </Pressable>
                      </>
                    ) : c.other ? (
                      <>
                        <Field>
                          <Input label={t('Describe the offence')} value={c.description} onChangeText={(v) => setCharge(i, { description: v })} multiline />
                        </Field>
                        <View style={styles.row}>
                          <View style={{ flex: 1 }}>
                            <Input label={t('Charge code')} value={c.code} onChangeText={(v) => setCharge(i, { code: v.toUpperCase() })} autoCapitalize="characters" />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Input label={t('Amount (R)')} value={c.amount} onChangeText={(v) => setCharge(i, { amount: v.replace(/[^0-9.]/g, '') })} keyboardType="decimal-pad" />
                          </View>
                        </View>
                        <Pressable onPress={() => setCharge(i, blankCharge())} style={{ marginTop: space.sm }} accessibilityRole="button">
                          <Text style={styles.change}>{t('Pick from the charge book instead')}</Text>
                        </Pressable>
                      </>
                    ) : (
                      <OffencePicker
                        regime={info.regime}
                        offences={regimeOffences}
                        onPick={(o) => setCharge(i, { offenceId: o.id, description: o.description, code: o.code ?? '', other: false })}
                        onOther={() => setCharge(i, { ...blankCharge(), other: true })}
                      />
                    )}
                    {amount !== null ? (
                      <View style={styles.amountRow}>
                        <Text style={styles.amount}>{rand(amount)}</Text>
                        {d.noticeType === 'AARTO 01' ? (
                          <Text style={styles.amountNote}>{t('{rand} if paid within 32 days', { rand: rand(amount - discountFor('AARTO 01', amount)) })}</Text>
                        ) : null}
                      </View>
                    ) : null}
                  </Card>
                </View>
              );
            })}
            {d.charges.length < MAX_CHARGES ? (
              <Button
                label={t('Add another charge')}
                variant="outline"
                icon="add"
                onPress={() => setD((cur) => ({ ...cur, charges: [...cur.charges, blankCharge()] }))}
              />
            ) : null}

            <SectionLabel>{t('Where')}</SectionLabel>
            <Card>
              <Button
                label={d.lat !== null ? t('Update my location') : t('Use my location')}
                icon="locate-outline"
                variant="subtle"
                busy={locating}
                onPress={() => void locate()}
              />
              {locNote ? <Muted>{locNote}</Muted> : null}
              <View style={{ marginTop: space.md }}>
                <Field><Input label={t('Street')} value={d.street} onChangeText={(v) => set('street', v)} autoCapitalize="words" /></Field>
                <Field><Input label={t('Cross street / between')} value={d.streetB} onChangeText={(v) => set('streetB', v)} autoCapitalize="words" /></Field>
                <Field><Input label={t('Suburb')} value={d.suburb} onChangeText={(v) => set('suburb', v)} autoCapitalize="words" /></Field>
                <Input
                  label={d.noticeType === 'Section 341' ? t('Where the vehicle stood') : t('Landmark / description')}
                  value={d.place}
                  onChangeText={(v) => set('place', v)}
                  placeholder={d.noticeType === 'Section 341' ? t('e.g. Bay 14 outside 120 Florida Rd') : t('Optional')}
                />
              </View>
              {d.noticeType === 'AARTO 01' ? (
                <View style={{ marginTop: space.md }}>
                  <Label>{t('Direction travelled')}</Label>
                  <Chips options={DIRECTIONS} value={d.direction as (typeof DIRECTIONS)[number] | null} onChange={(v) => set('direction', v)} clearable />
                </View>
              ) : null}
            </Card>

            {d.noticeType === 'Section 56' ? (
              <>
                <SectionLabel>{t('Court')}</SectionLabel>
                <Card>
                  <Field><Input label={t('Court')} value={d.courtName} onChangeText={(v) => set('courtName', v)} /></Field>
                  <Input label={t('Date to appear')} value={d.courtDate} onChangeText={(v) => set('courtDate', v)} placeholder={t('YYYY-MM-DD')} keyboardType="numbers-and-punctuation" maxLength={10} />
                  <View style={[styles.chips, { marginTop: space.sm }]}>
                    {[14, 30, 60].map((n) => {
                      const date = addDays(saDate(new Date()), n);
                      return (
                        <Pressable key={n} onPress={() => set('courtDate', date)} style={({ pressed }) => [styles.chip, d.courtDate === date && styles.chipOn, pressed && { opacity: 0.75 }]}>
                          <Text style={[styles.chipText, d.courtDate === date && styles.chipTextOn]}>{t('In {n} days', { n })}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </Card>
              </>
            ) : null}

            <SectionLabel>{t('Notes (optional)')}</SectionLabel>
            <Card>
              {OBSERVATION_FIELDS.filter((f) => info.personPresent || !['driver_description', 'passengers'].includes(f.key)).map((f) => (
                <Field key={f.key}>
                  <Input
                    label={f.label}
                    value={d.observations[f.key] ?? ''}
                    onChangeText={(v) => setD((cur) => ({ ...cur, observations: { ...cur.observations, [f.key]: v } }))}
                    placeholder={f.hint}
                  />
                </Field>
              ))}
            </Card>
          </>
        ) : null}

        {/* ── 5. Sign ───────────────────────────────────────────── */}
        {step === 'sign' ? (
          <>
            <SectionLabel>{t('Check before signing')}</SectionLabel>
            <Card accent={colors.primary}>
              <KeyValue label={t('Notice')} value={t(info.label)} />
              {info.personPresent ? <KeyValue label={t('Infringer')} value={`${d.firstNames} ${d.surname}`.trim() || '—'} /> : null}
              {info.personPresent ? <KeyValue label={d.idType ?? t('ID')} value={d.idNumber || '—'} /> : null}
              <KeyValue label={t('Vehicle')} value={normaliseReg(d.reg) || '—'} />
              <KeyValue label={t('Where')} value={[d.street, d.suburb].filter(Boolean).join(', ') || d.place || '—'} />
              {d.charges.map((c, i) => (
                <KeyValue
                  key={`rev-${i}`}
                  label={d.charges.length > 1 ? t('Charge {n}', { n: i + 1 }) : t('Offence')}
                  value={`${offences.find((o) => o.id === c.offenceId)?.description ?? c.description} · ${rand(chargeAmount(c) ?? 0)}`}
                />
              ))}
              <View style={styles.totalBox}>
                <Text style={styles.totalLabel}>{d.noticeType === 'AARTO 01' ? t('To pay within 32 days') : d.noticeType === 'Section 56' ? t('Admission of guilt') : t('To pay')}</Text>
                <Text style={styles.totalValue}>{rand(d.noticeType === 'AARTO 01' ? discounted : total)}</Text>
                <Text style={styles.totalNote}>
                  {d.noticeType === 'Section 56'
                    ? d.courtName
                      ? t('Or appear at {court} on {date}', { court: d.courtName, date: d.courtDate || '—' })
                      : t('Or appear at court on {date}', { date: d.courtDate || '—' })
                    : d.noticeType === 'AARTO 01'
                      ? t('By {date} · full amount {amount}', { date: payBy ?? '—', amount: rand(total) })
                      : t('By {date}', { date: payBy ?? '—' })}
                </Text>
              </View>
            </Card>

            {info.personPresent ? (
              <>
                <SectionLabel>{t('Explained to the infringer')}</SectionLabel>
                <Card>
                  <CheckRow
                    label={d.noticeType === 'AARTO 01'
                      ? t('I explained the notice and the options: pay within 32 days for the discount, apply to pay in instalments (AARTO 04), or make a representation (AARTO 08).')
                      : t('I explained the court date, and that paying the admission of guilt is a conviction and may give a criminal record.')}
                    checked={d.explained}
                    onToggle={() => set('explained', !d.explained)}
                  />
                </Card>
              </>
            ) : null}

            <SectionLabel>{fullName ? t('Officer signature · {name}', { name: fullName }) : t('Officer signature')}</SectionLabel>
            <Card>
              <SignaturePad onChange={(svg) => set('officerSig', svg)} onDrawingChange={(on) => setScrollOn(!on)} />
            </Card>

            {info.personPresent ? (
              <>
                <SectionLabel>{t('Infringer signature')}</SectionLabel>
                <Card>
                  <SignaturePad
                    onChange={(svg) => set('infringerSig', svg)}
                    onDrawingChange={(on) => setScrollOn(!on)}
                    disabled={d.refused}
                  />
                  <View style={{ marginTop: space.sm }}>
                    <CheckRow label={t('The infringer refused to sign')} checked={d.refused} onToggle={() => set('refused', !d.refused)} />
                  </View>
                </Card>
              </>
            ) : (
              <Muted>{t('Leave the slip on the vehicle. There is no signature from the owner.')}</Muted>
            )}
          </>
        ) : null}

        <Pressable onPress={startOver} style={styles.startOver} accessibilityRole="button">
          <Text style={styles.startOverText}>{t('Start over')}</Text>
        </Pressable>
      </ScrollView>

      <View style={styles.footer}>
        {stepIndex > 0 ? (
          <View style={{ flex: 1 }}>
            <Button label={t('Back')} variant="outline" icon="arrow-back" onPress={() => go(stepIndex - 1)} />
          </View>
        ) : null}
        <View style={{ flex: 2 }}>
          {step === 'sign' ? (
            <Button label={t('Issue fine')} icon="receipt-outline" busy={busy} onPress={() => void submit()} />
          ) : (
            <Button label={t('Next · {step}', { step: t(STEP_LABEL[steps[stepIndex + 1] ?? 'sign']) })} onPress={onNext} />
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  top: { paddingHorizontal: space.lg, paddingTop: space.md, backgroundColor: colors.bgSoft },
  container: { padding: space.lg, paddingBottom: space['3xl'] },
  center: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center' },
  row: { flexDirection: 'row', gap: space.sm, marginTop: space.md },

  label: { color: colors.muted, fontSize: 11, fontWeight: '800', letterSpacing: 0.8, marginBottom: 6, marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: space.md },
  chip: {
    paddingHorizontal: 12, minHeight: 36, justifyContent: 'center', borderRadius: 18,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgElevated,
  },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.textDim, fontSize: 13, fontWeight: '700' },
  chipTextOn: { color: '#fff' },

  typeCard: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, marginBottom: space.sm,
    borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.bgCard,
  },
  typeCardOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  typeIcon: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgElevated,
  },
  typeTitle: { color: colors.text, fontSize: 15, fontWeight: '900' },
  typeUse: { color: colors.textDim, fontSize: 12, marginTop: 1 },
  typeLaw: { color: colors.muted, fontSize: 10, marginTop: 3 },

  regInput: { fontSize: 22, fontWeight: '900', letterSpacing: 2 },

  chargeHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  remove: { color: colors.critical, fontSize: 12, fontWeight: '800' },
  pickList: { marginTop: space.sm, gap: 2 },
  pickRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 10, paddingHorizontal: 6,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, borderRadius: 6,
  },
  pickOther: { borderBottomWidth: 0, marginTop: 4 },
  pickTitle: { color: colors.text, fontSize: 14, fontWeight: '700' },
  pickMeta: { color: colors.muted, fontSize: 11, marginTop: 2 },
  pickAmount: { color: colors.text, fontSize: 13, fontWeight: '900', fontVariant: ['tabular-nums'] },
  offTitle: { color: colors.text, fontSize: 16, fontWeight: '900' },
  change: { color: colors.accent, fontSize: 12, fontWeight: '800' },
  amountRow: {
    marginTop: space.md, paddingTop: space.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
    flexDirection: 'row', alignItems: 'baseline', gap: space.sm, flexWrap: 'wrap',
  },
  amount: { color: colors.text, fontSize: 22, fontWeight: '900', fontVariant: ['tabular-nums'] },
  amountNote: { color: colors.low, fontSize: 12, fontWeight: '700' },

  totalBox: {
    marginTop: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: colors.bgElevated, alignItems: 'center',
  },
  totalLabel: { color: colors.muted, fontSize: 11, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },
  totalValue: { color: colors.text, fontSize: 30, fontWeight: '900', fontVariant: ['tabular-nums'], marginTop: 2 },
  totalNote: { color: colors.textDim, fontSize: 12, marginTop: 2, textAlign: 'center' },

  startOver: { alignSelf: 'center', padding: space.md, marginTop: space.md },
  startOverText: { color: colors.muted, fontSize: 12, fontWeight: '700', textDecorationLine: 'underline' },

  footer: {
    flexDirection: 'row', gap: space.sm, padding: space.md, paddingBottom: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.bgSoft,
  },
}));
