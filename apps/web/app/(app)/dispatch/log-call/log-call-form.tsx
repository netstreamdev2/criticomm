'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Ambulance, ArrowLeft, CheckCircle2, ExternalLink, Loader2, Megaphone, Paperclip, Phone, Plus, Radio, RotateCcw,
  Send, Siren, Timer, Trash2,
} from 'lucide-react';
import {
  checkDuplicateIncident, completeCallIntake, logIncomingCall, routeIncident, sendCallEarly, tagIncidentDepartments,
  uploadIncidentEvidence, type IntakeSuggestion,
} from '@criticom/api';
import {
  MED_PRIORITIES, draftDescription, intakeAdvice, maxSeverity, typeMeta,
  type CompleteCallIntakeInput, type DeskSilo, type IncidentSeverity, type LogIncomingCallInput, type Silo,
} from '@criticom/db';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { LocationPicker } from '@/components/location-picker';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/toast';
import { cn } from '@/lib/utils';
import { COUNTRIES, DEFAULT_COUNTRY, checkPhone } from '@/lib/phone';
import { regionFor } from '@/lib/durban-regions';
import { takeCallDraft } from '@/components/criti/shared';
import { CritiStrip } from './criti-strip';
import { DescriptionBox, DescriptionModal, HURT_COUNTS } from './description';
import {
  CritiMark, DEPTS, SEVERITIES, SEVERITY_ON, deskList, fieldCls, inDeptOrder, labelCls, newRef, type AiState,
} from './intake-ui';
import { PlaceSearch, type Place } from './place-search';
import { TypePicker, type TypeOption } from './type-picker';

type CategoryTree = Array<{
  id: string; code: string | null; name: string;
  subcategories: Array<{ id: string; code: string | null; name: string; prompts: string[] }>;
}>;

type Incident = Awaited<ReturnType<typeof logIncomingCall>>;

const REGIONS = ['Central', 'North', 'South', 'West', 'Outer'] as const;

/** Tunables from Admin → Operations Settings, with the code defaults. */
export type IntakeTuning = {
  clockWarnSeconds: number;
  clockCriticalSeconds: number;
};
const DEFAULT_TUNING: IntakeTuning = { clockWarnSeconds: 90, clockCriticalSeconds: 180 };

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The fields Criti may fill in. A field is Criti's until the call taker
 * changes it, and Criti never writes over the call taker's own choice.
 */
type Field = 'type' | 'severity' | 'injuries' | 'victims' | 'patient' | 'priority' | 'description';
type By = 'you' | 'criti';

/** Sent together, so the database can check them as one change (0076). */
const TOGETHER: Array<Array<keyof CompleteCallIntakeInput>> = [
  ['location_address', 'location_lat', 'location_lng'],
  ['incident_type', 'incident_category'],
];
/** Typed text is added after a pause, so the call's timeline is not one line per word. */
const TYPED = new Set<string>(['caller_name', 'caller_number', 'call_description', 'notes', 'patient_name']);

/** What changed since the call was last saved; nothing is ever cleared this way. */
function changedFields(before: CompleteCallIntakeInput, now: CompleteCallIntakeInput): CompleteCallIntakeInput {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(now) as Array<keyof CompleteCallIntakeInput>) {
    if (JSON.stringify(now[k]) !== JSON.stringify(before[k])) out[k] = now[k];
  }
  for (const group of TOGETHER) {
    if (group.some((k) => k in out)) for (const k of group) if (now[k] !== undefined) out[k] = now[k];
  }
  return out as CompleteCallIntakeInput;
}

const evidenceKind = (f: File) =>
  f.type.startsWith('image/') ? 'image' : f.type.startsWith('audio/') ? 'audio' : f.type.startsWith('video/') ? 'video' : 'document';

// The incident number, call time and creation time are all set by the server
// when the call is logged (Operations Manual 22.1). The form shows none of
// them beforehand: a preview number or a browser clock looks authoritative
// and is not, which is worse than showing nothing. ETAs belong to the Assign
// screen, measured from real units — not to intake.

/**
 * Logging an incoming call. What and where come first (type, description,
 * place), then the caller and who to send. Criti says what to ask, suggests
 * the departments, severity and medical code, and reads the description as
 * it is typed. An urgent call can go to dispatch as soon as its type, place
 * and department are known; the rest is then added to the same call.
 */
export function LogCallForm({
  defaultSilo, canRoute = true, categoryTree = [], tuning = DEFAULT_TUNING,
}: {
  defaultSilo: Silo;
  /** False for pure call-takers: they queue for the dispatch desk, never route. */
  canRoute?: boolean;
  categoryTree?: CategoryTree;
  tuning?: IntakeTuning;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ reason: string; incident_number: string } | null>(null);
  // One reference per call: pressing send twice returns the same call.
  const ref = useRef<string | null>(null);
  const clientRef = () => (ref.current ??= newRef());

  /* ── Intake clock: runs from the moment the screen opens ────────── */
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const openedAt = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - openedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const timerLabel = `${pad(Math.floor(elapsed / 60))}:${pad(elapsed % 60)}`;
  const timerTone = elapsed >= tuning.clockCriticalSeconds
    ? 'critical'
    : elapsed >= tuning.clockWarnSeconds ? 'warn' : 'ok';

  /* ── Form state ─────────────────────────────────────────────────── */
  const lockedSilo = defaultSilo !== 'Ethekwini';
  const ownDesks = useMemo<DeskSilo[]>(() => (lockedSilo ? [defaultSilo as DeskSilo] : []), [lockedSilo, defaultSilo]);

  const [callerName, setCallerName] = useState('');
  const [isPatient, setIsPatient] = useState<boolean | null>(null);
  // When the caller is not the patient: the patients' names, if known.
  const [patientNames, setPatientNames] = useState<string[]>(['']);
  const [phone, setPhone] = useState('');
  const [countryIso, setCountryIso] = useState(DEFAULT_COUNTRY.iso);
  // Shown once the call-taker leaves the field, or tries to submit.
  const [phoneTouched, setPhoneTouched] = useState(false);
  const phoneCheck = useMemo(() => checkPhone(phone, countryIso), [phone, countryIso]);
  const [description, setDescription] = useState('');
  const [injuries, setInjuries] = useState<string[]>([]);
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [suburb, setSuburb] = useState('');
  const [city, setCity] = useState('Durban');
  const [postal, setPostal] = useState('');
  const [region, setRegion] = useState('');
  // True while the region is the one the pin gave, not one chosen by hand.
  const [regionFromMap, setRegionFromMap] = useState(false);
  const [incidentType, setIncidentType] = useState('');
  const [category, setCategory] = useState('');
  // Severity decides whether crews get a toast or a blocking interrupt.
  // Criti suggests it from the type and the injuries; the call taker decides.
  const [severity, setSeverity] = useState<IncidentSeverity | null>(null);
  const [emsNotRequired, setEmsNotRequired] = useState(false);
  const [victims, setVictims] = useState('');
  const [medPriority, setMedPriority] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [descOpen, setDescOpen] = useState(false);

  /* ── Who filled each field in: the call taker or Criti ──────────── */
  const [by, setBy] = useState<Partial<Record<Field, By>>>({});
  const mark = useCallback((f: Field, who: By | null) => setBy((s) => {
    if ((s[f] ?? null) === who) return s;
    const next = { ...s };
    if (who) next[f] = who; else delete next[f];
    return next;
  }), []);
  /** Criti may write a field that is its own, or one nobody has filled in. */
  const mayFill = (f: Field, empty: boolean) => by[f] === 'criti' || (by[f] === undefined && empty);

  /* ── Which dispatch desks get the call (0068) ───────────────────── */
  // Only the tagged departments' dispatchers receive it. Criti suggests them
  // from the type and anyone hurt until the call taker chooses by hand.
  const [targets, setTargets] = useState<DeskSilo[]>(ownDesks);
  const [targetsTouched, setTargetsTouched] = useState(false);
  // Desk chairs may send it straight to the crews on duty instead of the queue.
  const [dispatchNow, setDispatchNow] = useState(false);

  /* ── A call already sent to dispatch, still being filled in (0076) ── */
  const [sent, setSent] = useState<Incident | null>(null);
  const [sentTags, setSentTags] = useState<DeskSilo[]>([]);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [addingDesk, setAddingDesk] = useState(false);
  const sentRef = useRef<Incident | null>(null);
  const savedRef = useRef<CompleteCallIntakeInput>({});
  const saving = useRef<Promise<void> | null>(null);
  const lastFailed = useRef<string | null>(null);

  /* ── Incident types ─────────────────────────────────────────────── */
  const types = useMemo<TypeOption[]>(() => categoryTree.flatMap((g) => g.subcategories.map((s) => {
    const meta = typeMeta(s.name, g.name);
    return { id: s.id, code: s.code, name: s.name, group: g.name, prompts: s.prompts, departments: meta.departments, severity: meta.severity };
  })), [categoryTree]);
  const chosen = types.find((t) => t.name === incidentType) ?? null;

  const chooseType = useCallback((name: string, who: By | null) => {
    setIncidentType(name);
    setCategory(types.find((t) => t.name === name)?.group ?? '');
    mark('type', who);
  }, [types, mark]);

  /* ── What Criti knows from the rules: instant, no AI ────────────── */
  const victimsNum = victims === '' ? null : Number(victims);
  const advice = useMemo(() => intakeAdvice({
    incidentType: incidentType || null,
    group: category || null,
    injuries,
    victims: victimsNum,
    isCallerPatient: isPatient,
    callerName,
    phoneOk: phoneCheck.ok,
    description,
    hasPin: lat !== null && lng !== null,
    region,
    severity,
    medPriority,
    emsNotRequired,
    targets,
  }, chosen?.prompts ?? []), [
    incidentType, category, injuries, victimsNum, isPatient, callerName, phoneCheck.ok, description,
    lat, lng, region, severity, medPriority, emsNotRequired, targets, chosen,
  ]);
  // The database asks it on every call EMS is sent to (0076).
  const patientAsked = advice.medical || targets.includes('Medical');
  const missing = useMemo(
    () => (patientAsked && !advice.medical && isPatient === null ? [...advice.missing, 'Is the caller the patient?'] : advice.missing),
    [advice, patientAsked, isPatient],
  );

  /* ── What Criti reads in the description: the AI ────────────────── */
  const [ai, setAi] = useState<IntakeSuggestion | null>(null);
  const [aiState, setAiState] = useState<AiState>('idle');
  const factsRef = useRef({ incidentType: null as string | null, group: null as string | null, injuries: [] as string[], victims: null as number | null, isCallerPatient: null as boolean | null });
  factsRef.current = { incidentType: incidentType || null, group: category || null, injuries, victims: victimsNum, isCallerPatient: isPatient };

  // Once the call taker pauses typing. Criti's own draft is not read back to it.
  useEffect(() => {
    if (by.description === 'criti') return;
    const text = description.trim();
    if (text.length < 8) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setAiState('reading');
      try {
        const res = await fetch('/api/criti/intake', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Never the caller's name or number.
          body: JSON.stringify({ ...factsRef.current, description: text }),
          signal: ctrl.signal,
        });
        if (res.status === 404 || res.status === 403) { setAiState('off'); return; }
        const data = (await res.json().catch(() => ({}))) as { suggestion?: IntakeSuggestion; configured?: boolean; error?: string };
        if (data.configured === false) { setAiState('off'); return; }
        if (!res.ok || data.error || !data.suggestion) { setAiState('error'); return; }
        setAi(data.suggestion);
        setAiState('ready');
      } catch (e) {
        if ((e as Error).name === 'AbortError') setAiState((s) => (s === 'reading' ? 'idle' : s));
        else setAiState('error');
      }
    }, 1200);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [description, by.description]);

  /* ── Criti fills in what is still empty ─────────────────────────── */
  const critiSeverity = maxSeverity(advice.severity, ai?.severity);
  useEffect(() => {
    if (!critiSeverity || !mayFill('severity', severity === null)) return;
    // Once the call is with dispatch, Criti only ever raises it.
    const next = sent ? maxSeverity(critiSeverity, severity) : critiSeverity;
    if (next && next !== severity) { setSeverity(next); mark('severity', 'criti'); }
  }, [critiSeverity, severity, by.severity, sent, mark]);

  const typeInjuries = useMemo(() => typeMeta(incidentType || null, category || null).injuries, [incidentType, category]);
  const critiInjuries = useMemo(
    () => (emsNotRequired ? [] : [...new Set([...typeInjuries, ...(ai?.injuries ?? [])])]),
    [typeInjuries, ai, emsNotRequired],
  );
  useEffect(() => {
    if (!mayFill('injuries', injuries.length === 0)) return;
    if (critiInjuries.join('|') === injuries.join('|')) return;
    setInjuries(critiInjuries);
    mark('injuries', critiInjuries.length ? 'criti' : null);
  }, [critiInjuries, injuries, by.injuries, mark]);

  useEffect(() => {
    if (emsNotRequired || !mayFill('victims', victims === '')) return;
    const fromAi = ai?.victims ?? null;
    if (fromAi !== null) {
      const next = String(Math.min(fromAi, 5));
      if (next !== victims) { setVictims(next); mark('victims', 'criti'); }
    } else if (victims === '' && injuries.length > 0) {
      // Someone has an injury: at least one person is hurt.
      setVictims('1');
      mark('victims', 'criti');
    } else if (by.victims === 'criti' && injuries.length === 0) {
      setVictims('');
      mark('victims', null);
    }
  }, [ai, injuries.length, victims, by.victims, emsNotRequired, mark]);

  useEffect(() => {
    const v = ai?.isCallerPatient ?? null;
    if (v === null || !mayFill('patient', isPatient === null)) return;
    if (v !== isPatient) { setIsPatient(v); mark('patient', 'criti'); }
  }, [ai, isPatient, by.patient, mark]);

  useEffect(() => {
    if (!advice.medical || !advice.priority || !mayFill('priority', medPriority === '')) return;
    if (advice.priority !== medPriority) { setMedPriority(advice.priority); mark('priority', 'criti'); }
  }, [advice.medical, advice.priority, medPriority, by.priority, mark]);

  useEffect(() => {
    // The type of a call already with dispatch is changed only by hand.
    const t = ai?.incidentType;
    if (sent || !t || !types.some((x) => x.name === t) || !mayFill('type', incidentType === '')) return;
    if (t !== incidentType) chooseType(t, 'criti');
  }, [ai, types, incidentType, by.type, sent, chooseType]);

  const critiDesks = useMemo(() => {
    const all = inDeptOrder([...ownDesks, ...advice.departments, ...(ai?.departments ?? [])]);
    return emsNotRequired ? all.filter((d) => d !== 'Medical' || ownDesks.includes(d)) : all;
  }, [ownDesks, advice.departments, ai, emsNotRequired]);
  useEffect(() => {
    if (targetsTouched || sent) return;
    if (critiDesks.join() !== targets.join()) setTargets(critiDesks);
  }, [critiDesks, targets, targetsTouched, sent]);
  const suggestAdd = critiDesks.filter((d) => !targets.includes(d));

  // Criti's start on the description, from what was ticked, until the call taker types.
  const draft = useMemo(
    () => draftDescription({ incidentType: incidentType || null, injuries, victims: victimsNum, isCallerPatient: isPatient }),
    [incidentType, injuries, victimsNum, isPatient],
  );
  useEffect(() => {
    if (by.description !== 'criti') return;
    if (!draft) { setDescription(''); mark('description', null); }
    else if (draft !== description) setDescription(draft);
  }, [draft, description, by.description, mark]);

  const ask = useMemo(() => [...new Set([...advice.ask, ...(ai?.ask ?? [])])].slice(0, 6), [advice.ask, ai]);

  /* ── Address ⇄ coordinates ──────────────────────────────────────── */
  /** The region follows the pin: every new location sets it again. */
  const setRegionFromLocation = useCallback((la: number, ln: number, sub?: string | null) => {
    const found = regionFor(la, ln, sub);
    if (found) {
      setRegion(found);
      setRegionFromMap(true);
    } else {
      setRegionFromMap(false);
    }
  }, []);

  const applyPlace = (p: Place) => {
    setAddress(p.label.split(',').slice(0, 3).join(',').trim());
    setLat(p.lat);
    setLng(p.lng);
    if (p.suburb) setSuburb(p.suburb);
    if (p.city) setCity(p.city);
    if (p.postalCode) setPostal(p.postalCode);
    setRegionFromLocation(p.lat, p.lng, p.suburb);
  };

  // Moving the pin fills the address fields back in.
  const onPickPoint = useCallback(async ({ lat: la, lng: ln }: { lat: number; lng: number }) => {
    setLat(la);
    setLng(ln);
    setRegionFromLocation(la, ln);
    try {
      const res = await fetch(`/api/geocode?lat=${la}&lng=${ln}`);
      const data = (await res.json()) as { results?: Place[] };
      const hit = data.results?.[0];
      if (!hit) return;
      setAddress(hit.label.split(',').slice(0, 3).join(',').trim());
      if (hit.suburb) setSuburb(hit.suburb);
      if (hit.city) setCity(hit.city);
      if (hit.postalCode) setPostal(hit.postalCode);
      if (hit.suburb) setRegionFromLocation(la, ln, hit.suburb);
    } catch {
      /* keep the coordinates; the address stays whatever was typed */
    }
  }, [setRegionFromLocation]);

  /* ── A call Criti started ("Open in the form") ──────────────────── */
  // Filled in once, when the form opens. Every field stays editable and the
  // call is logged only by this form's own button, with its own checks.
  useEffect(() => {
    const d = takeCallDraft();
    if (!d) return;
    if (d.caller_name) setCallerName(d.caller_name);
    if (d.caller_number) { setPhone(d.caller_number); setPhoneTouched(true); }
    if (d.is_caller_patient !== null) setIsPatient(d.is_caller_patient);
    if (d.is_caller_patient === false && d.patient_names) {
      setPatientNames(d.patient_names.split(',').map((n) => n.trim()).filter(Boolean));
    }
    if (d.call_description) setDescription(d.call_description);
    if (d.location_address) setAddress(d.location_address);
    if (d.location_lat !== null && d.location_lng !== null) { setLat(d.location_lat); setLng(d.location_lng); }
    if (d.suburb) setSuburb(d.suburb);
    if (d.city) setCity(d.city);
    if (d.postal_code) setPostal(d.postal_code);
    if (d.region) { setRegion(d.region); setRegionFromMap(true); }
    if (d.incident_type && types.some((t) => t.name === d.incident_type)) chooseType(d.incident_type, null);
    if (d.incident_severity) setSeverity(d.incident_severity);
    if (d.ems_not_required) {
      setEmsNotRequired(true); setVictims('0'); setMedPriority('');
    } else {
      if (d.number_of_victims !== null) setVictims(String(Math.min(d.number_of_victims, 5)));
      if (d.medical_priority) setMedPriority(d.medical_priority);
    }
    if (d.notes) setNotes(d.notes);
    if (d.tagged_silos.length) {
      setTargetsTouched(true);
      setTargets(inDeptOrder(d.tagged_silos));
    }
    toast.push({
      title: 'Filled in by Criti',
      body: 'Check every field and the place on the map, then send the call.',
      tone: 'info',
    });
  }, []);

  const checkDup = () => {
    const caller = phoneCheck.ok ? phoneCheck.e164 : null;
    if (!caller && !address) return;
    void (async () => {
      const dupe = await checkDuplicateIncident(getBrowserSupabase(), {
        phone: caller, location: address || null, type: incidentType || null,
      }).catch(() => null);
      setDuplicate(dupe ?? null);
      if (dupe) {
        toast.push({
          title: 'Possible duplicate call',
          body: `${dupe.incident_number} matched on ${dupe.reason} in the last 12 hours.`,
          tone: 'warning',
        });
      }
    })();
  };

  const dial = () => {
    if (!phoneCheck.ok) {
      setPhoneTouched(true);
      return;
    }
    // Zoiper and most softphones register the tel: scheme.
    window.location.href = `tel:${phoneCheck.e164}`;
  };

  /* ── The values as the database takes them ──────────────────────── */
  const patientNameValue = (): string | null => {
    if (!patientAsked || isPatient === null) return null;
    if (isPatient) return callerName.trim() || null;
    return patientNames.map((n) => n.trim()).filter(Boolean).join(', ') || 'Unknown / Not Provided';
  };
  const victimsValue = (): number | null => (emsNotRequired ? 0 : victimsNum);
  const medicalTypeValue = (): string | null => (emsNotRequired ? 'EMS Not Required' : advice.medical ? (medPriority || null) : null);
  const placeText = () => address.trim() || (lat !== null && lng !== null ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : '');

  /** Everything known now, as a call already sent takes it (complete_call_intake). */
  const intakeFields = (): CompleteCallIntakeInput => {
    const f: CompleteCallIntakeInput = {};
    if (callerName.trim()) f.caller_name = callerName.trim();
    if (phoneCheck.ok) f.caller_number = phoneCheck.e164;
    if (description.trim()) f.call_description = description.trim();
    if (patientAsked && isPatient !== null) f.is_caller_patient = isPatient;
    const pn = patientNameValue();
    if (pn) f.patient_name = pn;
    const v = victimsValue();
    if (v !== null) f.number_of_victims = v;
    const mt = medicalTypeValue();
    if (mt) f.medical_type = mt;
    f.injuries = injuries;
    if (notes.trim()) f.notes = notes.trim();
    if (severity) f.incident_severity = severity;
    if (incidentType) { f.incident_type = incidentType; if (category) f.incident_category = category; }
    if (lat !== null && lng !== null) { f.location_lat = lat; f.location_lng = lng; f.location_address = placeText(); }
    if (suburb.trim()) f.suburb = suburb.trim();
    if (city.trim()) f.city = city.trim();
    if (postal.trim()) f.postal_code = postal.trim();
    if (region) f.region = region;
    return f;
  };
  const fields = intakeFields();
  const fieldsKey = JSON.stringify(fields);
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;

  /* ── Adding to a call already sent ──────────────────────────────── */
  const flush = useCallback(async (retry = false): Promise<boolean> => {
    while (saving.current) await saving.current;
    const incident = sentRef.current;
    if (!incident) return true;
    const changed = changedFields(savedRef.current, fieldsRef.current);
    if (Object.keys(changed).length === 0) return true;
    // A change the database refused is tried again only when asked.
    const key = JSON.stringify(changed);
    if (!retry && key === lastFailed.current) return false;
    let ok = false;
    const run = (async () => {
      setSaveState('saving');
      try {
        await completeCallIntake(getBrowserSupabase(), { incident_id: incident.id, fields: changed });
        savedRef.current = { ...savedRef.current, ...changed };
        lastFailed.current = null;
        setSaveState('saved');
        setSaveError(null);
        setSavedAt(new Date().toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }));
        ok = true;
      } catch (e) {
        lastFailed.current = key;
        setSaveState('error');
        setSaveError((e as Error).message);
      }
    })();
    saving.current = run;
    await run;
    saving.current = null;
    return ok;
  }, []);

  useEffect(() => {
    if (!sent) return;
    const keys = Object.keys(changedFields(savedRef.current, fieldsRef.current));
    if (keys.length === 0) return;
    const t = setTimeout(() => void flush(), keys.some((k) => TYPED.has(k)) ? 4000 : 800);
    return () => clearTimeout(t);
  }, [sent, fieldsKey, flush]);

  // Typed text is added when the call taker moves on, without waiting.
  const saveNow = () => { if (sentRef.current) void flush(); };

  useEffect(() => {
    if (!sent) return;
    const warn = (e: BeforeUnloadEvent) => {
      if (Object.keys(changedFields(savedRef.current, fieldsRef.current)).length) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [sent]);

  const uploadFile = async (incident: Incident, owner: Silo, f: File) => {
    await uploadIncidentEvidence(getBrowserSupabase(), {
      incident_id: incident.id,
      silo: owner,
      file: f,
      filename: f.name,
      kind: evidenceKind(f),
      caption: 'Attached at call intake',
    }).then(() => {
      if (sentRef.current) toast.push({ title: 'Attachment added', body: `${f.name} is on ${incident.incident_number}.`, tone: 'success' });
    }, () => {
      // An attachment failure must not lose the call itself.
      toast.push({
        title: 'Attachment not uploaded',
        body: 'The call is logged; attach the file again from the incident page.',
        tone: 'warning',
      });
    });
  };

  const addDesks = (ds: DeskSilo[]) => {
    const incident = sentRef.current;
    const fresh = ds.filter((d) => !sentTags.includes(d));
    if (!incident || fresh.length === 0 || addingDesk) return;
    setAddingDesk(true);
    void tagIncidentDepartments(getBrowserSupabase(), { incident_id: incident.id, silos: fresh })
      .then(() => {
        setSentTags((cur) => inDeptOrder([...cur, ...fresh]));
        setTargets((cur) => inDeptOrder([...cur, ...fresh]));
        toast.push({ title: `Sent to ${deskList(fresh)}`, body: `${incident.incident_number} is on their dispatch desk now.`, tone: 'success' });
      }, (e: Error) => setError(e.message))
      .finally(() => setAddingDesk(false));
  };

  const toggleTarget = (id: DeskSilo) => {
    if (sent) { addDesks([id]); return; }
    setTargetsTouched(true);
    setTargets((cur) => (cur.includes(id) ? cur.filter((s) => s !== id) : inDeptOrder([...cur, id])));
  };
  const addSuggested = (d: DeskSilo) => {
    if (sent) { addDesks([d]); return; }
    setTargetsTouched(true);
    setTargets((cur) => inDeptOrder([...cur, d]));
  };
  const broadcastAll = () => {
    setSeverity('Critical');
    mark('severity', 'you');
    if (sent) { addDesks(DEPTS.map((d) => d.id)); return; }
    setTargetsTouched(true);
    setTargets(DEPTS.map((d) => d.id));
    if (canRoute) setDispatchNow(true);
    toast.push({
      title: 'Broadcast armed',
      body: canRoute ? 'All four departments will be alerted on dispatch.' : 'All four dispatch desks will receive this call.',
      tone: 'critical',
      duration: 5000,
    });
  };

  /* ── After the call is logged, either way ───────────────────────── */
  const afterLogged = async (incident: Incident, owner: Silo, routing: boolean, early: boolean) => {
    const sb = getBrowserSupabase();
    if (file) await uploadFile(incident, owner, file);
    const sevBadge = incident.incident_severity;
    if (routing) {
      // Goes out to every officer on duty in the selected departments;
      // the first to respond leads, others may back up (0040, 0042).
      const routed = await routeIncident(sb, {
        incident_id: incident.id,
        silos: targets,
        notes: notes.trim() || null,
      }).then(() => null, (e: Error) => e.message);

      if (routed) {
        // The call is logged either way — most often nobody is on duty.
        // Say so rather than failing the form, which invites a duplicate.
        toast.push({
          title: `${incident.incident_number} logged — not dispatched`,
          body: `${routed} It is in the pending queue.`,
          tone: 'warning',
          badge: sevBadge,
        });
        return;
      }
      // Realtime already reached every open phone; this reaches the locked
      // ones. Fire-and-forget — a push failure is not a dispatch failure.
      void fetch('/api/push/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ incidentId: incident.id, silos: targets }),
      }).catch(() => {});
      toast.push({
        title: `${incident.incident_number} dispatched`,
        body: `Sent to everyone on duty in ${deskList(targets)}.${early ? ' Keep filling in: details follow.' : ''}`,
        tone: 'success',
        badge: sevBadge,
      });
      return;
    }
    // The intake desk's flow: log it and hand it to the tagged desks.
    toast.push({
      title: `${incident.incident_number} ${early ? 'sent early' : 'logged'}`,
      body: `Sent to the ${deskList(targets)} dispatch desk${targets.length === 1 ? '' : 's'}.${early ? ' Keep filling in: details follow.' : ' Only they receive it.'}`,
      tone: 'success',
      badge: sevBadge,
    });
  };

  /* ── Send to dispatch now, before the form is complete (0076) ───── */
  const earlySeverity = severity ?? advice.severity;
  const earlyReady = advice.canSendEarly && !sent && missing.length > 0
    && (earlySeverity === 'High' || earlySeverity === 'Critical');
  const [earlyAsk, setEarlyAsk] = useState(false);
  const [earlyDismissed, setEarlyDismissed] = useState(false);
  useEffect(() => {
    if (!earlyReady) { setEarlyAsk(false); return; }
    // Asked once per call, and not over the description while it is being typed.
    if (!earlyDismissed && !descOpen && !pending) setEarlyAsk(true);
  }, [earlyReady, earlyDismissed, descOpen, pending]);

  const sendNow = () => {
    if (!earlyReady || pending || lat === null || lng === null) return;
    const sev = earlySeverity as 'High' | 'Critical';
    setError(null);
    setEarlyAsk(false);
    setEarlyDismissed(true);
    const routing = canRoute && dispatchNow;
    const owner: Silo = routing ? targets[0]! : defaultSilo;
    const snapshot = { ...fieldsRef.current, incident_severity: sev };
    start(async () => {
      try {
        const incident = await sendCallEarly(getBrowserSupabase(), {
          client_ref: clientRef(),
          silo: owner,
          incident_type: incidentType,
          incident_category: category || null,
          incident_severity: sev,
          location_address: placeText(),
          location_lat: lat,
          location_lng: lng,
          suburb: suburb.trim() || null,
          city: city.trim() || null,
          postal_code: postal.trim() || null,
          region: region || null,
          tagged_silos: targets,
          caller_name: callerName.trim() || null,
          caller_number: phoneCheck.ok ? phoneCheck.e164 : null,
          call_description: description.trim() || null,
          is_caller_patient: patientAsked ? isPatient : null,
          patient_name: patientNameValue(),
          number_of_victims: victimsValue(),
          medical_type: medicalTypeValue(),
          injuries,
          notes: notes.trim() || null,
        });
        savedRef.current = snapshot;
        sentRef.current = incident;
        setSent(incident);
        setSentTags(inDeptOrder(targets));
        if (!severity) { setSeverity(sev); mark('severity', 'criti'); }
        await afterLogged(incident, owner, routing, true);
        setFile(null);
      } catch (err) {
        setError((err as Error).message);
      }
    });
  };

  /* ── Submit ─────────────────────────────────────────────────────── */
  const finish = async () => {
    const incident = sentRef.current;
    if (!incident) return;
    setError(null);
    const ok = await flush(true);
    if (!ok) {
      setError('Some details were not added. Fix them, or open the call and add them there.');
      return;
    }
    router.push(`/incidents/${incident.id}`);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (sent) { void finish(); return; }
    setError(null);

    if (!incidentType) return setError('Choose the incident type.');
    if (!description.trim()) return setError('Add the description: what the caller says.');
    if (!address.trim()) return setError('Add the location address.');
    if (lat === null || lng === null) {
      return setError('Place the incident on the map: pick a search result or click the map.');
    }
    if (!region) return setError('Choose the region.');
    if (!callerName.trim()) return setError('Add the caller name.');
    if (!phoneCheck.ok) {
      setPhoneTouched(true);
      return setError(phoneCheck.error);
    }
    if (patientAsked && isPatient === null) return setError('Say whether the caller is the patient.');
    if (!severity) return setError('Choose the severity.');
    if (advice.medical && victims === '') return setError('Choose how many people are hurt.');
    if (advice.medical && !medPriority) return setError('Choose the medical code.');
    if (targets.length === 0) return setError('Choose the department this call is for: who must receive it.');

    // With "dispatch now" ticked (dispatch-desk chairs), the call routes on
    // submit. Without — a pure call-taker's flow — it lands in the pending
    // queue for the dispatcher to route, filed under the call-taker's own
    // department (Operations Manual 22.1 step 10). For the control room that
    // is Ethekwini, so an unrouted call is visible to the control room and the
    // dispatch desk only — not to every officer in whichever service the form
    // happened to default to.
    const routing = canRoute && dispatchNow;
    const owner: Silo = routing ? targets[0]! : defaultSilo;
    const payload: LogIncomingCallInput = {
      silo: owner,
      caller_name: callerName.trim(),
      caller_number: phoneCheck.e164,
      call_description: description.trim(),
      incident_type: incidentType,
      incident_severity: severity,
      location_address: address.trim(),
      location_lat: lat,
      location_lng: lng,
      suburb: suburb.trim() || null,
      city: city.trim() || null,
      postal_code: postal.trim() || null,
      is_caller_patient: patientAsked ? isPatient : null,
      patient_name: patientNameValue(),
      number_of_victims: victimsValue(),
      medical_type: medicalTypeValue(),
      notes: notes.trim() || null,
      // Stamped by log_incoming_call in the same transaction (migration 0038);
      // the call-taker's name is taken from their profile on the server.
      incident_category: category || null,
      region,
      tagged_silos: targets,
      injuries,
      client_ref: clientRef(),
    };

    start(async () => {
      try {
        const incident = await logIncomingCall(getBrowserSupabase(), payload);
        await afterLogged(incident, owner, routing, false);
        router.push(`/incidents/${incident.id}`);
      } catch (err) {
        setError((err as Error).message);
      }
    });
  };

  /* ── Field handlers that mark the call taker's own choice ───────── */
  const onSeverity = (s: IncidentSeverity) => { setSeverity(s); mark('severity', 'you'); };
  const onInjuries = (list: string[]) => { setInjuries(list); mark('injuries', 'you'); };
  const onVictims = (v: string) => { setVictims(v); mark('victims', 'you'); };
  const onPatient = (v: boolean | null) => { setIsPatient(v); mark('patient', 'you'); };
  const onPriority = (p: string) => { setMedPriority(p); mark('priority', 'you'); };
  const onType = (name: string) => chooseType(name, 'you');
  const onDescription = (text: string) => { setDescription(text); mark('description', 'you'); };
  const addDraft = () => {
    setDescription((cur) => (cur.trim() ? `${draft} ${cur.trim()}` : draft));
    mark('description', 'you');
  };
  const openDescription = () => {
    // Criti starts it from what was ticked; the call taker finishes it.
    if (!description.trim() && draft) { setDescription(draft); mark('description', 'criti'); }
    setDescOpen(true);
  };
  const closeDescription = () => { setDescOpen(false); saveNow(); };
  const onNoOneHurt = (on: boolean) => {
    setEmsNotRequired(on);
    if (on) {
      setVictims('0'); setMedPriority(''); setInjuries([]);
      mark('victims', 'you'); mark('priority', 'you'); mark('injuries', 'you');
    } else {
      setVictims('');
      mark('victims', null); mark('priority', null); mark('injuries', null);
    }
  };
  const onFile = (f: File | null) => {
    if (f && sentRef.current) { void uploadFile(sentRef.current, sentRef.current.silo, f); return; }
    setFile(f);
  };

  const triageShown = advice.medical || emsNotRequired;
  const showInvalid = (cond: boolean) => Boolean(error) && cond;

  return (
    <form onSubmit={onSubmit} className="w-full space-y-4 pb-10">
      {/* ── Header row ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className={cn(
            'inline-flex items-center gap-2.5 rounded-full px-5 py-2.5 text-base font-bold shadow-lg',
            timerTone === 'critical' && 'animate-pulse bg-severity-critical',
            timerTone === 'warn' && 'bg-severity-medium',
            timerTone === 'ok' && 'border border-border bg-bg-card',
          )}
          role="timer"
          aria-label="Time since call intake started"
        >
          <Timer className="h-4 w-4" />
          Response clock <span className="font-mono tabular-nums">{timerLabel}</span>
        </div>

        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-bg-soft px-4 py-2 text-sm font-semibold hover:bg-muted"
        >
          <ArrowLeft className="h-4 w-4" /> Back to dashboard
        </Link>
      </div>

      <CritiStrip
        aiState={aiState}
        danger={ai?.danger ?? []}
        ask={ask}
        missing={missing}
        departments={critiDesks}
        severity={critiSeverity}
        priority={advice.priority}
        suggestAdd={targetsTouched || sent ? suggestAdd : []}
        onAddDesk={addSuggested}
        early={earlyReady ? { severity: earlySeverity!, busy: pending, onSend: sendNow } : null}
        sent={sent ? { number: sent.incident_number } : null}
      />

      {sent ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-severity-low/40 bg-severity-low/10 px-4 py-2.5 text-sm">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-severity-low-ink" />
          <p className="min-w-0 flex-1">
            <span className="font-mono font-semibold">{sent.incident_number}</span> is with the{' '}
            <span className="font-semibold">{deskList(sentTags)}</span> dispatch desk{sentTags.length === 1 ? '' : 's'}.
            {' '}Keep filling in: each change is added to the call.
          </p>
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {saveState === 'saving' ? <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Adding…</span>
              : saveState === 'saved' && savedAt ? `Added ${savedAt}`
              : null}
          </span>
          <Link href={`/incidents/${sent.id}`} target="_blank" className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
            Open the call <ExternalLink className="h-3 w-3" />
          </Link>
          {saveState === 'error' && saveError ? (
            <p role="alert" className="flex w-full items-center gap-2 text-xs text-severity-critical-ink">
              Not added: {saveError}
              <button type="button" onClick={() => void flush(true)} className="inline-flex items-center gap-1 font-semibold underline">
                <RotateCcw className="h-3 w-3" /> Try again
              </button>
            </p>
          ) : null}
        </div>
      ) : null}

      {duplicate ? (
        <p className="rounded-lg border border-severity-medium/40 bg-severity-medium/10 px-4 py-2.5 text-sm">
          Possible duplicate ({duplicate.reason}): incident{' '}
          <span className="font-mono font-semibold">{duplicate.incident_number}</span> matched in the last 12 hours.
        </p>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-2">
        {/* ══ WHAT AND WHERE ══ */}
        <section className="rounded-2xl border border-border bg-bg-card">
          <h2 className="rounded-t-2xl border-b border-border bg-bg-soft px-5 py-3 text-center text-xs font-bold uppercase tracking-[0.18em]">
            What and where
          </h2>

          <div className="space-y-4 p-5">
            <div>
              <label className={labelCls} htmlFor="incidentType">Incident type</label>
              <TypePicker
                types={types}
                value={incidentType}
                onChange={onType}
                byCriti={by.type === 'criti'}
                invalid={showInvalid(!incidentType)}
              />
              {types.length === 0 ? (
                <p role="alert" className="mt-1.5 text-xs text-severity-critical-ink">
                  No incident types are set up for your organisation, so a call cannot be logged yet.
                  An administrator adds them under Admin → Configuration → Incident categories.
                </p>
              ) : null}
            </div>

            <div>
              <label className={labelCls} htmlFor="description">Description</label>
              <DescriptionBox
                description={description}
                byCriti={by.description === 'criti'}
                draft={draft}
                injuries={injuries}
                victims={victims}
                isPatient={isPatient}
                invalid={showInvalid(!description.trim())}
                onOpen={openDescription}
              />
            </div>

            <div>
              <label className={labelCls} htmlFor="address">Location</label>
              <PlaceSearch
                value={address}
                onChange={setAddress}
                onPick={applyPlace}
                onBlur={() => { checkDup(); saveNow(); }}
                invalid={showInvalid(!address.trim() || lat === null)}
              />
              <div className="mt-2">
                <LocationPicker lat={lat} lng={lng} onPick={onPickPoint} height={300} />
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelCls} htmlFor="suburb">Suburb</label>
                  <input id="suburb" className={fieldCls} value={suburb} onChange={(e) => setSuburb(e.target.value)} />
                </div>
                <div>
                  <label className={labelCls} htmlFor="region">Region</label>
                  <select
                    id="region" className={cn(fieldCls, showInvalid(!region) && 'border-severity-critical')} value={region}
                    onChange={(e) => { setRegion(e.target.value); setRegionFromMap(false); }}
                  >
                    <option value="">Select region…</option>
                    {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {regionFromMap ? 'Set from the map pin' : lat !== null && !region ? 'Outside eThekwini: choose the region' : ' '}
                  </p>
                </div>
              </div>
              <details className="mt-1">
                <summary className="cursor-pointer text-xs font-semibold text-muted-foreground hover:text-fg">
                  City, postal code and exact point
                </summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className={labelCls} htmlFor="city">City</label>
                    <input id="city" className={fieldCls} value={city} onChange={(e) => setCity(e.target.value)} />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="postal">Postal code</label>
                    <input id="postal" className={fieldCls} value={postal} onChange={(e) => setPostal(e.target.value)} />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="lat">Latitude</label>
                    <input
                      id="lat" className={fieldCls} type="number" step="any" placeholder="—"
                      value={lat ?? ''} onChange={(e) => setLat(e.target.value === '' ? null : Number(e.target.value))}
                    />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="lng">Longitude</label>
                    <input
                      id="lng" className={fieldCls} type="number" step="any" placeholder="—"
                      value={lng ?? ''} onChange={(e) => setLng(e.target.value === '' ? null : Number(e.target.value))}
                    />
                  </div>
                </div>
              </details>
            </div>
          </div>
        </section>

        {/* ══ CALLER AND DISPATCH ══ */}
        <section className="rounded-2xl border border-border bg-bg-card">
          <h2 className="rounded-t-2xl border-b border-border bg-bg-soft px-5 py-3 text-center text-xs font-bold uppercase tracking-[0.18em]">
            Caller and dispatch
          </h2>

          <div className="space-y-4 p-5">
            <div>
              <label className={labelCls} htmlFor="callerName">Caller name</label>
              <input
                id="callerName" className={cn(fieldCls, showInvalid(!callerName.trim()) && 'border-severity-critical')}
                placeholder="Full name as given"
                value={callerName} onChange={(e) => setCallerName(e.target.value)} onBlur={saveNow}
              />
            </div>

            <div>
              <label className={labelCls} htmlFor="callerPhone">Caller number</label>
              <div className="flex items-center gap-2">
                <label htmlFor="callerCountry" className="sr-only">Country of the caller’s number</label>
                <select
                  id="callerCountry"
                  className={cn(fieldCls, 'w-[7.5rem] shrink-0 px-2')}
                  value={countryIso}
                  onChange={(e) => setCountryIso(e.target.value)}
                  title={COUNTRIES.find((c) => c.iso === countryIso)?.name}
                >
                  {COUNTRIES.map((c) => (
                    <option key={c.iso} value={c.iso}>{c.iso} +{c.code}</option>
                  ))}
                </select>
                <input
                  id="callerPhone"
                  className={cn(fieldCls, phoneTouched && !phoneCheck.ok && 'border-severity-critical focus:border-severity-critical')}
                  placeholder={`e.g. ${COUNTRIES.find((c) => c.iso === countryIso)?.example ?? DEFAULT_COUNTRY.example}`}
                  inputMode="tel" autoComplete="off" maxLength={24}
                  aria-invalid={phoneTouched && !phoneCheck.ok}
                  aria-describedby="callerPhoneHelp"
                  value={phone}
                  onChange={(e) => {
                    const next = e.target.value;
                    setPhone(next);
                    // A whole international number (+1 …, 0044 …) brings its country.
                    const seen = checkPhone(next, countryIso);
                    if (/^\s*(\+|00)/.test(next) && seen.country.iso !== countryIso) setCountryIso(seen.country.iso);
                  }}
                  onBlur={() => { setPhoneTouched(true); checkDup(); saveNow(); }}
                />
                <button
                  type="button" onClick={dial} disabled={!phoneCheck.ok}
                  className="inline-flex h-11 shrink-0 items-center gap-2 rounded-lg bg-severity-low px-5 text-xs font-bold uppercase tracking-wider transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  <Phone className="h-3.5 w-3.5" /> Call
                </button>
              </div>
              <p id="callerPhoneHelp" className={cn('mt-1.5 text-xs', phoneTouched && !phoneCheck.ok ? 'text-severity-critical-ink' : 'text-muted-foreground')}>
                {phoneCheck.ok
                  ? `Saved as ${phoneCheck.display}`
                  : phoneTouched && phone.trim() ? phoneCheck.error : `${phoneCheck.country.name} · +${phoneCheck.country.code}`}
              </p>
            </div>

            {/* Is the caller the patient: only when someone is, or may be, hurt */}
            {patientAsked ? (
              <div className={cn(
                'rounded-xl border bg-bg-soft/60 px-4 py-3',
                showInvalid(isPatient === null) ? 'border-severity-critical' : 'border-border',
              )}>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm" role="radiogroup" aria-required="true" aria-label="Is the caller the patient?">
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    Is the caller the patient? <span className="text-severity-critical-ink" aria-hidden>*</span>
                    {by.patient === 'criti' ? <CritiMark /> : null}
                  </span>
                  {([['Yes', true], ['No', false]] as const).map(([txt, val]) => (
                    <button
                      key={txt} type="button" onClick={() => onPatient(val)}
                      className="inline-flex items-center gap-2"
                      aria-pressed={isPatient === val}
                    >
                      <span className={cn(
                        'h-3.5 w-3.5 rounded-full border-2',
                        isPatient === val ? 'border-accent bg-accent' : 'border-muted-foreground',
                      )} />
                      <span className={isPatient === val ? 'font-semibold' : 'text-muted-foreground'}>{txt}</span>
                    </button>
                  ))}
                </div>
                {isPatient === false ? (
                  <div className="mt-3 space-y-2">
                    <span className="block text-xs text-muted-foreground">Patient name(s)</span>
                    {patientNames.map((n, i) => (
                      <div key={`patient-${i}`} className="flex gap-2">
                        <input
                          className={fieldCls}
                          placeholder={i === 0 ? 'Enter patient name' : 'Enter additional patient name'}
                          aria-label={`Patient name ${i + 1}`}
                          value={n}
                          onChange={(e) => setPatientNames((cur) => cur.map((x, j) => (j === i ? e.target.value : x)))}
                          onBlur={saveNow}
                        />
                        {i === 0 ? (
                          <button
                            type="button" title="Add another patient" aria-label="Add another patient"
                            onClick={() => setPatientNames((cur) => [...cur, ''])}
                            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-severity-low/50 text-severity-low-ink hover:bg-severity-low/10"
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        ) : (
                          <button
                            type="button" title="Remove patient" aria-label={`Remove patient ${i + 1}`}
                            onClick={() => setPatientNames((cur) => cur.filter((_, j) => j !== i))}
                            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-severity-critical/50 text-severity-critical-ink hover:bg-severity-critical/10"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Severity */}
            <div>
              <p className={labelCls} id="severityLabel">
                Severity {by.severity === 'criti' ? <CritiMark /> : null}
              </p>
              <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-labelledby="severityLabel">
                {SEVERITIES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={severity === s}
                    onClick={() => onSeverity(s)}
                    className={cn(
                      'h-11 rounded-lg text-xs font-bold uppercase tracking-wider transition-all',
                      severity === s
                        ? `${SEVERITY_ON[s]} ring-2 ring-fg/40 ring-offset-2 ring-offset-bg-card`
                        : cn('border bg-bg text-muted-foreground hover:text-fg', showInvalid(!severity) ? 'border-severity-critical' : 'border-border'),
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
              {by.severity === 'you' && critiSeverity && critiSeverity !== severity ? (
                <p className="mt-1.5 text-xs text-muted-foreground">Criti suggests {critiSeverity}.</p>
              ) : null}
            </div>

            {/* EMS triage: only when someone is, or may be, hurt */}
            {triageShown ? (
              <div className="rounded-xl border border-border bg-bg-soft/60 p-4">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <Ambulance className="h-4 w-4 text-severity-critical-ink" /> EMS / medical triage
                  </p>
                  <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs">
                    <span className={cn('relative h-5 w-9 shrink-0 rounded-full transition-colors', emsNotRequired ? 'bg-severity-low' : 'bg-muted')}>
                      <span
                        className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all"
                        style={{ left: emsNotRequired ? '1.125rem' : '0.125rem' }}
                      />
                    </span>
                    <input type="checkbox" className="sr-only" checked={emsNotRequired} onChange={(e) => onNoOneHurt(e.target.checked)} />
                    No one hurt
                  </label>
                </div>

                {emsNotRequired ? (
                  <p className="text-xs text-muted-foreground">No injuries: EMS not required.</p>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <p className={labelCls} id="victimsLabel">People hurt {by.victims === 'criti' ? <CritiMark /> : null}</p>
                      <div className="grid grid-cols-6 gap-1.5" role="radiogroup" aria-labelledby="victimsLabel">
                        {HURT_COUNTS.map(([v, l]) => (
                          <button
                            key={v}
                            type="button"
                            aria-pressed={victims === v}
                            onClick={() => onVictims(v)}
                            className={cn(
                              'h-10 rounded-lg border text-sm font-bold tabular-nums',
                              victims === v ? 'border-accent bg-accent/15 text-fg'
                                : cn('bg-bg text-muted-foreground hover:text-fg', showInvalid(victims === '') ? 'border-severity-critical' : 'border-border'),
                            )}
                          >
                            {l}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className={labelCls} htmlFor="medPriority">Medical code {by.priority === 'criti' ? <CritiMark /> : null}</label>
                      <select
                        id="medPriority" className={cn(fieldCls, showInvalid(!medPriority) && 'border-severity-critical')}
                        value={medPriority} onChange={(e) => onPriority(e.target.value)}
                      >
                        <option value="">Select priority…</option>
                        {MED_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            <div>
              <label className={labelCls} htmlFor="dispatchNotes">Internal dispatch notes</label>
              <textarea
                id="dispatchNotes" rows={2}
                className={`${fieldCls} h-auto py-2.5 leading-relaxed`}
                placeholder="Access notes, hazards, standing instructions for the crew"
                value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={saveNow}
              />
            </div>

            <div>
              <label className={labelCls} htmlFor="attach">Attachment (optional)</label>
              <label
                htmlFor="attach"
                className="flex h-11 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border bg-bg-soft px-3 text-sm transition-colors hover:border-accent/50"
              >
                <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className={cn('truncate', !file && 'text-muted-foreground')}>
                  {file ? file.name : sent ? 'Add a photo, recording or document to the call…' : 'Choose a photo, recording or document…'}
                </span>
              </label>
              <input
                id="attach" type="file" className="sr-only"
                accept="image/*,audio/*,video/*,.pdf,.doc,.docx"
                onChange={(e) => { onFile(e.target.files?.[0] ?? null); e.target.value = ''; }}
              />
            </div>

            {/* ── Send to dispatch: only the tagged desks receive the call (0068) ── */}
            <div className={cn('rounded-xl border bg-bg-soft/60 p-4', targets.length === 0 ? 'border-severity-medium/50' : 'border-border')}>
              <p className="mb-3 flex flex-wrap items-center gap-2 text-sm font-semibold">
                <Radio className="h-4 w-4 text-accent" /> Send to dispatch
                <span className="ml-auto text-xs font-normal text-muted-foreground">
                  {sent
                    ? 'Sent. Add a department if it is needed.'
                    : targets.length === 0
                      ? 'Choose at least one department'
                      : !targetsTouched ? 'Suggested by Criti: change if needed' : `${targets.length} selected`}
                </span>
              </p>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {DEPTS.map((d) => {
                  const active = targets.includes(d.id);
                  const locked = Boolean(sent) && sentTags.includes(d.id);
                  const Icon = d.icon;
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => toggleTarget(d.id)}
                      disabled={locked || addingDesk}
                      aria-pressed={active}
                      title={locked ? 'Already sent' : sent ? `Send to ${d.label} too` : undefined}
                      className={cn(
                        'inline-flex h-11 items-center justify-center gap-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all',
                        active
                          ? `${d.solid} ring-2 ring-fg/40 ring-offset-2 ring-offset-bg-card`
                          : 'border border-border bg-bg text-muted-foreground hover:border-accent/40 hover:text-fg',
                        locked && 'cursor-default opacity-90',
                      )}
                    >
                      {sent && !locked ? <Plus className="h-4 w-4" /> : <Icon className="h-4 w-4" />} {d.label}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={broadcastAll}
                disabled={addingDesk}
                className="mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-severity-critical text-xs font-bold uppercase tracking-wider transition-transform hover:scale-[1.01] disabled:opacity-60"
              >
                <Megaphone className="h-4 w-4" /> Broadcast all (emergency)
              </button>

              {canRoute && !sent ? (
                <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-sm">
                  <input type="checkbox" className="mt-0.5 h-4 w-4" checked={dispatchNow} onChange={(e) => setDispatchNow(e.target.checked)} />
                  <span>
                    Dispatch to the crews on duty now
                    <span className="block text-xs text-muted-foreground">Leave unticked to send it to the dispatch desks&apos; queue.</span>
                  </span>
                </label>
              ) : null}

              {!sent ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  {targets.length === 0
                    ? 'No dispatch desk receives a call that is not sent to it.'
                    : dispatchNow && canRoute
                      ? <>Every crew on duty in <span className="font-semibold text-fg">{deskList(targets)}</span> is alerted{severity === 'High' || severity === 'Critical' ? ' with a blocking pop-up that must be acknowledged.' : '.'}</>
                      : <>Only the <span className="font-semibold text-fg">{deskList(targets)}</span> dispatch desk{targets.length === 1 ? '' : 's'} receive{targets.length === 1 ? 's' : ''} this call.</>}
                </p>
              ) : null}
            </div>

            {error ? (
              <p role="alert" className="rounded-lg border border-severity-critical/40 bg-severity-critical/10 px-4 py-2.5 text-center text-sm text-severity-critical-ink">
                {error}
              </p>
            ) : null}

            <div className="grid gap-2">
              {earlyReady ? (
                <button
                  type="button"
                  onClick={sendNow}
                  disabled={pending}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border-2 border-severity-critical text-xs font-bold uppercase tracking-wider text-severity-critical-ink transition-colors hover:bg-severity-critical/10 disabled:opacity-60"
                >
                  <Send className="h-4 w-4" /> Send to dispatch now · details to follow
                </button>
              ) : null}
              <button
                type="submit"
                disabled={pending || types.length === 0}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-accent text-sm font-bold uppercase tracking-wider transition-transform hover:scale-[1.01] disabled:opacity-60"
              >
                {sent
                  ? (saveState === 'saving' ? <><Loader2 className="h-4 w-4 animate-spin" /> Adding…</> : <><CheckCircle2 className="h-4 w-4" /> Done · open the call</>)
                  : pending
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> {canRoute && dispatchNow ? 'Dispatching…' : 'Sending…'}</>
                    : canRoute && dispatchNow
                      ? <><Siren className="h-4 w-4" /> Dispatch incident</>
                      : <><Siren className="h-4 w-4" /> {targets.length > 1 ? `Send to ${targets.length} dispatch desks` : 'Send to dispatch'}</>}
              </button>
            </div>
          </div>
        </section>
      </div>

      {descOpen ? (
        <DescriptionModal
          description={description}
          onDescription={onDescription}
          byCriti={by.description === 'criti'}
          draft={draft}
          onUseDraft={addDraft}
          injuries={injuries}
          onInjuries={onInjuries}
          injuriesByCriti={by.injuries === 'criti'}
          victims={victims}
          onVictims={onVictims}
          victimsByCriti={by.victims === 'criti'}
          isPatient={isPatient}
          onPatient={onPatient}
          patientByCriti={by.patient === 'criti'}
          ai={ai}
          aiState={aiState}
          ask={ask}
          sendNow={earlyReady ? { busy: pending, onSend: () => { setDescOpen(false); sendNow(); } } : null}
          onClose={closeDescription}
        />
      ) : null}

      {earlyAsk && earlyReady ? (
        <Modal title="Send to dispatch now?" onClose={() => { setEarlyAsk(false); setEarlyDismissed(true); }}>
          <div className="space-y-3 text-sm">
            <p>
              This is a <span className="font-semibold">{earlySeverity}</span> call. The{' '}
              <span className="font-semibold">{deskList(targets)}</span> dispatch desk{targets.length === 1 ? '' : 's'} can start now
              with what you have.
            </p>
            <p className="text-muted-foreground">
              Still to add: {missing.join(', ')}. You keep filling in on this screen, and each detail is added to the call.
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => { setEarlyAsk(false); setEarlyDismissed(true); }}
              className="inline-flex h-10 items-center rounded-lg border border-border px-4 text-sm font-semibold hover:bg-muted"
            >
              Not yet
            </button>
            <button
              type="button"
              onClick={sendNow}
              disabled={pending}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-severity-critical px-4 text-sm font-bold disabled:opacity-60"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send now
            </button>
          </div>
        </Modal>
      ) : null}
    </form>
  );
}
