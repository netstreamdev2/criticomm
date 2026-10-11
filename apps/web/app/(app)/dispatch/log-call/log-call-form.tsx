'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Ambulance, ArrowLeft, Flame, Loader2, MapPin, Megaphone, Paperclip, Phone,
  Plus, Radio, Shield, Siren, Timer, Trash2, Waves,
} from 'lucide-react';
import {
  checkDuplicateIncident, logIncomingCall, routeIncident, uploadIncidentEvidence,
} from '@criticom/api';
import { DEPARTMENT_NAMES, suggestedDesks, type LogIncomingCallInput, type Silo } from '@criticom/db';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { LocationPicker } from '@/components/location-picker';
import { useToast } from '@/components/toast';
import { cn } from '@/lib/utils';
import { COUNTRIES, DEFAULT_COUNTRY, checkPhone } from '@/lib/phone';
import { regionFor } from '@/lib/durban-regions';
import { takeCallDraft } from '@/components/criti/shared';

type CategoryTree = Array<{
  id: string; code: string | null; name: string;
  subcategories: Array<{ id: string; code: string | null; name: string; prompts: string[] }>;
}>;

type Department = Exclude<Silo, 'Ethekwini'>;

/** The four routing buttons, in the order the control room reads them. */
const DEPARTMENTS: Array<{
  id: Department; label: string; icon: typeof Flame; className: string;
}> = [
  { id: 'MetroFire', label: 'Fire', icon: Flame, className: 'bg-[#f59e0b] text-black' },
  { id: 'MetroPolice', label: 'Police', icon: Shield, className: 'bg-[#3b82f6] text-white' },
  { id: 'Medical', label: 'Medical', icon: Ambulance, className: 'bg-[#dc3545] text-white' },
  { id: 'EthekwiniDisaster', label: 'Disaster', icon: Waves, className: 'bg-[#8b5cf6] text-white' },
];

const SILO_LABELS: Record<Department, string> = {
  MetroPolice: DEPARTMENT_NAMES.MetroPolice,
  MetroFire: DEPARTMENT_NAMES.MetroFire,
  Medical: DEPARTMENT_NAMES.Medical,
  EthekwiniDisaster: DEPARTMENT_NAMES.EthekwiniDisaster,
};
const deskList = (ds: Department[]) => ds.map((d) => SILO_LABELS[d]).join(', ');

const SEVERITIES = ['Low', 'Medium', 'High', 'Critical'] as const;
const REGIONS = ['Central', 'North', 'South', 'West', 'Outer'] as const;
const VICTIM_COUNTS: Array<[string, string]> = [['0', '0'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', 'Multiple (5+)']];
const MED_PRIORITIES = [
  'P1 - RED: Critical / Life Threatening', 'P2 - ORANGE: Urgent / Serious',
  'P3 - YELLOW: Minor / Walking Wounded', 'P4 - BLUE: Deceased (Mortuary)',
] as const;

/** Tunables from Admin → Operations Settings, with the code defaults. */
export type IntakeTuning = {
  clockWarnSeconds: number;
  clockCriticalSeconds: number;
};
const DEFAULT_TUNING: IntakeTuning = { clockWarnSeconds: 90, clockCriticalSeconds: 180 };

const pad = (n: number) => String(n).padStart(2, '0');

// The incident number, call time and creation time are all set by the server
// when the call is logged (Operations Manual 22.1). The form shows none of
// them beforehand: a preview number or a browser clock looks authoritative
// and is not, which is worse than showing nothing. ETAs belong to the Assign
// screen, measured from real units — not to intake.

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
  const initialDept = (lockedSilo ? defaultSilo : 'MetroPolice') as Department;

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
  // No default: severity decides whether crews get a toast or a blocking
  // interrupt, so it is chosen deliberately on every call.
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number] | null>(null);
  const [emsNotRequired, setEmsNotRequired] = useState(false);
  const [victims, setVictims] = useState('');
  const [medPriority, setMedPriority] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);

  /* ── Which dispatch desks get the call (0068) ───────────────────── */
  // Only the tagged departments' dispatchers receive it. The incident code
  // (and anyone hurt) suggests them until the call taker chooses by hand.
  const [targets, setTargets] = useState<Department[]>(lockedSilo ? [initialDept] : []);
  const [targetsTouched, setTargetsTouched] = useState(false);
  // Desk chairs may send it straight to the crews on duty instead of the queue.
  const [dispatchNow, setDispatchNow] = useState(false);

  const toggleTarget = (id: Department) => {
    setTargetsTouched(true);
    setTargets((cur) => (cur.includes(id) ? cur.filter((s) => s !== id) : [...cur, id]));
  };
  const broadcastAll = () => {
    setTargetsTouched(true);
    setTargets(DEPARTMENTS.map((d) => d.id));
    setSeverity('Critical');
    if (canRoute) setDispatchNow(true);
    toast.push({
      title: 'Broadcast armed',
      body: canRoute ? 'All four departments will be alerted on dispatch.' : 'All four dispatch desks will receive this call.',
      tone: 'critical',
      duration: 5000,
    });
  };

  useEffect(() => {
    if (targetsTouched) return;
    const suggested = suggestedDesks({
      category, incidentType, victims: victims === '' ? null : Number(victims), emsNotRequired,
    });
    const own: Department[] = lockedSilo ? [initialDept] : [];
    setTargets(DEPARTMENTS.map((d) => d.id).filter((d) => own.includes(d) || suggested.includes(d)));
  }, [category, incidentType, victims, emsNotRequired, targetsTouched, lockedSilo, initialDept]);

  /* ── Address ⇄ coordinates ──────────────────────────────────────── */
  const [suggestions, setSuggestions] = useState<Array<{
    label: string; lat: number; lng: number;
    suburb: string | null; city: string; postalCode: string | null;
  }>>([]);
  const [geocoding, setGeocoding] = useState(false);
  const suppressLookup = useRef(false);

  // Debounced forward geocode as the call-taker types the address.
  useEffect(() => {
    if (suppressLookup.current) { suppressLookup.current = false; return; }
    if (address.trim().length < 3) { setSuggestions([]); return; }
    const t = setTimeout(async () => {
      setGeocoding(true);
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(address)}`);
        const data = (await res.json()) as { results?: typeof suggestions };
        setSuggestions(data.results ?? []);
      } catch {
        setSuggestions([]);
      } finally {
        setGeocoding(false);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [address]);

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

  const applySuggestion = (s: (typeof suggestions)[number]) => {
    suppressLookup.current = true;
    setAddress(s.label.split(',').slice(0, 3).join(',').trim());
    setLat(s.lat);
    setLng(s.lng);
    if (s.suburb) setSuburb(s.suburb);
    if (s.city) setCity(s.city);
    if (s.postalCode) setPostal(s.postalCode);
    setRegionFromLocation(s.lat, s.lng, s.suburb);
    setSuggestions([]);
  };

  // Moving the pin fills the address fields back in.
  const onPickPoint = useCallback(async ({ lat: la, lng: ln }: { lat: number; lng: number }) => {
    setLat(la);
    setLng(ln);
    setRegionFromLocation(la, ln);
    try {
      const res = await fetch(`/api/geocode?lat=${la}&lng=${ln}`);
      const data = (await res.json()) as { results?: typeof suggestions };
      const hit = data.results?.[0];
      if (!hit) return;
      suppressLookup.current = true;
      setAddress(hit.label.split(',').slice(0, 3).join(',').trim());
      if (hit.suburb) setSuburb(hit.suburb);
      if (hit.city) setCity(hit.city);
      if (hit.postalCode) setPostal(hit.postalCode);
      if (hit.suburb) setRegionFromLocation(la, ln, hit.suburb);
    } catch {
      /* keep the coordinates; the address stays whatever was typed */
    }
  }, [setRegionFromLocation]);

  /* ── Helpers ────────────────────────────────────────────────────── */
  const codeGroups = useMemo(
    () => categoryTree.filter((g) => g.subcategories.length > 0),
    [categoryTree],
  );

  const onSelectCode = (value: string) => {
    setIncidentType(value);
    const group = categoryTree.find((g) => g.subcategories.some((s) => s.name === value));
    if (group) setCategory(group.name);
  };

  /* ── A call Criti started ("Open in the form") ──────────────────── */
  // Filled in once, when the form opens. Every field stays editable and the
  // call is logged only by this form's own button, with its own checks.
  useEffect(() => {
    const draft = takeCallDraft();
    if (!draft) return;
    if (draft.caller_name) setCallerName(draft.caller_name);
    if (draft.caller_number) { setPhone(draft.caller_number); setPhoneTouched(true); }
    if (draft.is_caller_patient !== null) setIsPatient(draft.is_caller_patient);
    if (draft.is_caller_patient === false && draft.patient_names) {
      setPatientNames(draft.patient_names.split(',').map((n) => n.trim()).filter(Boolean));
    }
    if (draft.call_description) setDescription(draft.call_description);
    if (draft.location_address) { suppressLookup.current = true; setAddress(draft.location_address); }
    if (draft.location_lat !== null && draft.location_lng !== null) { setLat(draft.location_lat); setLng(draft.location_lng); }
    if (draft.suburb) setSuburb(draft.suburb);
    if (draft.city) setCity(draft.city);
    if (draft.postal_code) setPostal(draft.postal_code);
    if (draft.region) { setRegion(draft.region); setRegionFromMap(true); }
    if (draft.incident_type && categoryTree.some((g) => g.subcategories.some((s) => s.name === draft.incident_type))) {
      onSelectCode(draft.incident_type);
    }
    if (draft.incident_severity) setSeverity(draft.incident_severity);
    if (draft.ems_not_required) {
      setEmsNotRequired(true); setVictims('0'); setMedPriority('');
    } else {
      if (draft.number_of_victims !== null) setVictims(String(draft.number_of_victims));
      if (draft.medical_priority) setMedPriority(draft.medical_priority);
    }
    if (draft.notes) setNotes(draft.notes);
    if (draft.tagged_silos.length) {
      setTargetsTouched(true);
      setTargets(DEPARTMENTS.map((d) => d.id).filter((d) => draft.tagged_silos.includes(d)));
    }
    toast.push({
      title: 'Filled in by Criti',
      body: 'Check every field and the place on the map, then log the call.',
      tone: 'info',
    });
  }, []);

  const checkDup = () => {
    const caller = phoneCheck.ok ? phoneCheck.e164 : null;
    if (!caller && !address) return;
    void (async () => {
      const dupe = await checkDuplicateIncident(getBrowserSupabase(), {
        phone: caller, location: address || null, type: incidentType || null,
      });
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

  /* ── Submit ─────────────────────────────────────────────────────── */
  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!callerName.trim()) return setError('Caller name is required.');
    if (!phoneCheck.ok) {
      setPhoneTouched(true);
      return setError(phoneCheck.error);
    }
    if (isPatient === null) return setError('Say whether the caller is the patient.');
    if (!incidentType) return setError('Select an incident code.');
    if (!description.trim()) return setError('Call description is required.');
    if (!address.trim()) return setError('Location address is required.');
    if (lat === null || lng === null) {
      return setError('Place the scene on the map — pick an address suggestion or click the map.');
    }
    if (!region) return setError('Select the region.');
    if (!severity) return setError('Select the incident severity.');
    if (!emsNotRequired && victims === '') return setError('Select the number of victims.');
    if (!emsNotRequired && !medPriority) return setError('Select a medical severity code.');
    if (targets.length === 0) return setError('Choose the department this call is for: who must receive it.');

    // With departments selected (dispatch-desk chairs), the call routes on
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
      is_caller_patient: isPatient,
      patient_name: isPatient
        ? callerName.trim()
        : (patientNames.map((n) => n.trim()).filter(Boolean).join(', ') || 'Unknown / Not Provided'),
      number_of_victims: emsNotRequired ? 0 : victims === '' ? null : Number(victims),
      medical_type: emsNotRequired ? 'EMS Not Required' : (medPriority || null),
      notes: notes.trim() || null,
      // Stamped by log_incoming_call in the same transaction (migration 0038);
      // the call-taker's name is taken from their profile on the server.
      incident_category: category || null,
      region,
      tagged_silos: targets,
    };

    start(async () => {
      try {
        const sb = getBrowserSupabase();
        const incident = await logIncomingCall(sb, payload);

        if (file) {
          await uploadIncidentEvidence(sb, {
            incident_id: incident.id,
            silo: owner,
            file,
            filename: file.name,
            kind: file.type.startsWith('image/') ? 'image'
              : file.type.startsWith('audio/') ? 'audio'
              : file.type.startsWith('video/') ? 'video' : 'document',
            caption: 'Attached at call intake',
          }).catch(() => {
            // An attachment failure must not lose the call itself.
            toast.push({
              title: 'Attachment not uploaded',
              body: 'The incident was created; re-attach the file from the incident page.',
              tone: 'warning',
            });
          });
        }

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
              badge: severity,
            });
          } else {
            // Realtime already reached every open phone; this reaches the
            // locked ones. Fire-and-forget — a push failure is not a
            // dispatch failure.
            void fetch('/api/push/notify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ incidentId: incident.id, silos: targets }),
            }).catch(() => {});

            toast.push({
              title: `${incident.incident_number} dispatched`,
              body: `Sent to everyone on duty in ${deskList(targets)}.`,
              tone: 'success',
              badge: severity,
            });
          }
        } else {
          // The intake desk's flow: log it and hand it to the tagged desks.
          toast.push({
            title: `${incident.incident_number} logged`,
            body: `Sent to the ${deskList(targets)} dispatch desk${targets.length === 1 ? '' : 's'}. Only they receive it.`,
            tone: 'success',
            badge: severity,
          });
        }
        router.push(`/incidents/${incident.id}`);
      } catch (err) {
        setError((err as Error).message);
      }
    });
  };

  /* ── Shared class strings ───────────────────────────────────────── */
  const label = 'mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-muted-foreground';
  const field =
    'h-11 w-full rounded-lg border border-border bg-bg-soft px-3 text-sm text-fg ' +
    'placeholder:text-muted-foreground/60 transition-colors focus:border-accent focus:outline-none ' +
    'focus:ring-2 focus:ring-accent/25';

  return (
    <form onSubmit={onSubmit} className="w-full space-y-5 pb-10">
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

      <div className="grid gap-5 xl:grid-cols-2">
        {/* ══ CALLER & LOCATION ══ */}
        <section className="overflow-hidden rounded-2xl border border-border bg-bg-card">
          <h2 className="border-b border-border bg-bg-soft px-5 py-3 text-center text-xs font-bold uppercase tracking-[0.18em]">
            Caller &amp; location info
          </h2>

          <div className="space-y-4 p-5">
            <div>
              <label className={label} htmlFor="callerName">Caller name</label>
              <input
                id="callerName" className={field} placeholder="Full name as given"
                value={callerName} onChange={(e) => setCallerName(e.target.value)}
              />
            </div>

            {/* Contact citizen */}
            <div>
              <label className={label} htmlFor="callerPhone">Contact citizen</label>
              <div className="flex items-center gap-2">
                <label htmlFor="callerCountry" className="sr-only">Country of the caller’s number</label>
                <select
                  id="callerCountry"
                  className={cn(field, 'w-[7.5rem] shrink-0 px-2')}
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
                  className={cn(field, phoneTouched && !phoneCheck.ok && 'border-severity-critical focus:border-severity-critical')}
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
                  onBlur={() => { setPhoneTouched(true); checkDup(); }}
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
                  : phoneTouched ? phoneCheck.error : `${phoneCheck.country.name} · +${phoneCheck.country.code}`}
              </p>
            </div>

            {/* Is the caller the patient */}
            <div className={cn(
              'rounded-xl border bg-bg-soft/60 px-4 py-3',
              error && isPatient === null ? 'border-severity-critical' : 'border-border',
            )}>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm" role="radiogroup" aria-required="true" aria-label="Is the caller the patient?">
                <span className="text-muted-foreground">
                  Is the caller the patient? <span className="text-severity-critical-ink" aria-hidden>*</span>
                </span>
                {([['Yes', true], ['No', false]] as const).map(([txt, val]) => (
                  <button
                    key={txt} type="button" onClick={() => setIsPatient(val)}
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
                        className={field}
                        placeholder={i === 0 ? 'Enter patient name' : 'Enter additional patient name'}
                        aria-label={`Patient name ${i + 1}`}
                        value={n}
                        onChange={(e) => setPatientNames((cur) => cur.map((x, j) => (j === i ? e.target.value : x)))}
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

            {/* Map */}
            <div>
              <label className={label} htmlFor="address">
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-3 w-3" /> Incident location
                </span>
              </label>
              <div className="relative">
                <input
                  id="address"
                  className={field}
                  placeholder="Start typing an address…"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  onBlur={checkDup}
                  autoComplete="off"
                />
                {geocoding ? (
                  <Loader2 className="absolute right-3 top-3.5 h-4 w-4 animate-spin text-muted-foreground" />
                ) : null}
                {suggestions.length > 0 ? (
                  <ul className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-border bg-bg-card shadow-2xl">
                    {suggestions.map((s) => (
                      <li key={`${s.lat},${s.lng}`}>
                        <button
                          type="button"
                          onClick={() => applySuggestion(s)}
                          className="block w-full px-3 py-2 text-left text-xs transition-colors hover:bg-muted"
                        >
                          {s.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              <div className="mt-2">
                <LocationPicker lat={lat} lng={lng} onPick={onPickPoint} height={300} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label} htmlFor="lat">Latitude</label>
                <input
                  id="lat" className={field} type="number" step="any" placeholder="—"
                  value={lat ?? ''} onChange={(e) => setLat(e.target.value === '' ? null : Number(e.target.value))}
                />
              </div>
              <div>
                <label className={label} htmlFor="lng">Longitude</label>
                <input
                  id="lng" className={field} type="number" step="any" placeholder="—"
                  value={lng ?? ''} onChange={(e) => setLng(e.target.value === '' ? null : Number(e.target.value))}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={label} htmlFor="suburb">Suburb</label>
                <input id="suburb" className={field} value={suburb} onChange={(e) => setSuburb(e.target.value)} />
              </div>
              <div>
                <label className={label} htmlFor="region">Region</label>
                <select
                  id="region" className={field} value={region}
                  onChange={(e) => { setRegion(e.target.value); setRegionFromMap(false); }}
                >
                  <option value="">Select region…</option>
                  {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {regionFromMap ? 'Set from the map pin' : lat !== null && !region ? 'Outside eThekwini: choose the region' : ' '}
                </p>
              </div>
              <div>
                <label className={label} htmlFor="city">City</label>
                <input id="city" className={field} value={city} onChange={(e) => setCity(e.target.value)} />
              </div>
              <div>
                <label className={label} htmlFor="postal">Postal code</label>
                <input id="postal" className={field} value={postal} onChange={(e) => setPostal(e.target.value)} />
              </div>
            </div>
          </div>
        </section>

        {/* ══ INCIDENT DETAILS & ROUTING ══ */}
        <section className="overflow-hidden rounded-2xl border border-border bg-bg-card">
          <h2 className="border-b border-border bg-bg-soft px-5 py-3 text-center text-xs font-bold uppercase tracking-[0.18em]">
            Incident details &amp; routing
          </h2>

          <div className="space-y-4 p-5">
            <div>
              <label className={label} htmlFor="incidentType">Incident type (10-code)</label>
              <select id="incidentType" className={field} value={incidentType} onChange={(e) => onSelectCode(e.target.value)}>
                <option value="">Select incident code…</option>
                {codeGroups.map((g) => (
                  <optgroup key={g.id} label={g.name}>
                    {g.subcategories.map((s) => (
                      <option key={s.id} value={s.name}>
                        {s.code ? `${s.code}: ` : ''}{s.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {codeGroups.length === 0 ? (
                <p role="alert" className="mt-1.5 text-xs text-severity-critical-ink">
                  No incident codes are set up for your organisation, so a call cannot be logged yet.
                  An administrator adds them under Admin → Configuration → Incident categories.
                </p>
              ) : null}
            </div>

            <div>
              <label className={label} htmlFor="narrative">Call description / narrative</label>
              <textarea
                id="narrative" rows={3}
                className={`${field} h-auto py-2.5 leading-relaxed`}
                placeholder="What the caller reported, verbatim where possible"
                value={description} onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            {/* EMS triage */}
            <div className="rounded-xl border border-border bg-bg-soft/60 p-4">
              <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Ambulance className="h-4 w-4 text-severity-critical-ink" /> EMS / medical triage
              </p>

              <label className="mb-3 flex cursor-pointer items-center gap-3 text-sm">
                <span className={cn(
                  'relative h-5 w-9 shrink-0 rounded-full transition-colors',
                  emsNotRequired ? 'bg-severity-low' : 'bg-muted',
                )}>
                  <span
                    className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all"
                    style={{ left: emsNotRequired ? '1.125rem' : '0.125rem' }}
                  />
                </span>
                <input
                  type="checkbox" className="sr-only" checked={emsNotRequired}
                  onChange={(e) => {
                    setEmsNotRequired(e.target.checked);
                    if (e.target.checked) { setVictims('0'); setMedPriority(''); }
                  }}
                />
                No injuries / EMS not required
              </label>

              <div className={cn('space-y-3', emsNotRequired && 'pointer-events-none opacity-45')}>
                <div>
                  <label className={label} htmlFor="victims">Number of victims</label>
                  <select id="victims" className={field} value={victims} onChange={(e) => setVictims(e.target.value)}>
                    <option value="">Select count…</option>
                    {VICTIM_COUNTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label className={label} htmlFor="medPriority">Medical severity code</label>
                  <select id="medPriority" className={field} value={medPriority} onChange={(e) => setMedPriority(e.target.value)}>
                    <option value="">Select priority…</option>
                    {MED_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </div>
            </div>

            <div>
              <label className={label} htmlFor="severity">Incident severity</label>
              <select
                id="severity" className={field} value={severity ?? ''}
                onChange={(e) => setSeverity(e.target.value as (typeof SEVERITIES)[number])}
              >
                <option value="" disabled>Select severity…</option>
                {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <div>
              <label className={label} htmlFor="attach">Attachment (optional)</label>
              <label
                htmlFor="attach"
                className="flex h-11 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border bg-bg-soft px-3 text-sm transition-colors hover:border-accent/50"
              >
                <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className={cn('truncate', !file && 'text-muted-foreground')}>
                  {file ? file.name : 'Choose a photo, recording or document…'}
                </span>
              </label>
              <input
                id="attach" type="file" className="sr-only"
                accept="image/*,audio/*,video/*,.pdf,.doc,.docx"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>

            <div>
              <label className={label} htmlFor="dispatchNotes">Internal dispatch notes</label>
              <textarea
                id="dispatchNotes" rows={2}
                className={`${field} h-auto py-2.5 leading-relaxed`}
                placeholder="Access notes, hazards, standing instructions for the crew"
                value={notes} onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            {/* ── Send to dispatch: only the tagged desks receive the call (0068) ── */}
            <div className={cn('rounded-xl border bg-bg-soft/60 p-4', targets.length === 0 ? 'border-severity-medium/50' : 'border-border')}>
              <p className="mb-3 flex flex-wrap items-center gap-2 text-sm font-semibold">
                <Radio className="h-4 w-4 text-accent" /> Send to dispatch
                <span className="ml-auto text-xs font-normal text-muted-foreground">
                  {targets.length === 0
                    ? 'Choose at least one department'
                    : !targetsTouched ? 'Suggested from the incident type: change if needed' : `${targets.length} selected`}
                </span>
              </p>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {DEPARTMENTS.map((d) => {
                  const active = targets.includes(d.id);
                  const Icon = d.icon;
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => toggleTarget(d.id)}
                      aria-pressed={active}
                      className={cn(
                        'inline-flex h-11 items-center justify-center gap-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all',
                        active
                          ? `${d.className} ring-2 ring-fg/40 ring-offset-2 ring-offset-bg-card`
                          : 'border border-border bg-bg text-muted-foreground hover:border-accent/40 hover:text-fg',
                      )}
                    >
                      <Icon className="h-4 w-4" /> {d.label}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={broadcastAll}
                className="mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-severity-critical text-xs font-bold uppercase tracking-wider transition-transform hover:scale-[1.01]"
              >
                <Megaphone className="h-4 w-4" /> Broadcast all (emergency)
              </button>

              {canRoute ? (
                <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-sm">
                  <input type="checkbox" className="mt-0.5 h-4 w-4" checked={dispatchNow} onChange={(e) => setDispatchNow(e.target.checked)} />
                  <span>
                    Dispatch to the crews on duty now
                    <span className="block text-xs text-muted-foreground">Leave unticked to send it to the dispatch desks&apos; queue.</span>
                  </span>
                </label>
              ) : null}

              <p className="mt-3 text-xs text-muted-foreground">
                {targets.length === 0
                  ? 'No dispatch desk receives a call that is not sent to it.'
                  : dispatchNow && canRoute
                    ? <>Every crew on duty in <span className="font-semibold text-fg">{deskList(targets)}</span> is alerted{severity === 'High' || severity === 'Critical' ? ' with a blocking pop-up that must be acknowledged.' : '.'}</>
                    : <>Only the <span className="font-semibold text-fg">{deskList(targets)}</span> dispatch desk{targets.length === 1 ? '' : 's'} receive{targets.length === 1 ? 's' : ''} this call.</>}
              </p>
            </div>

            <div className="grid gap-3">
              <button
                type="submit"
                disabled={pending || codeGroups.length === 0}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-accent text-sm font-bold uppercase tracking-wider transition-transform hover:scale-[1.01] disabled:opacity-60"
              >
                {pending
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> {canRoute && dispatchNow ? 'Dispatching…' : 'Sending…'}</>
                  : canRoute && dispatchNow
                    ? <><Siren className="h-4 w-4" /> Dispatch incident</>
                    : <><Siren className="h-4 w-4" /> {targets.length > 1 ? `Send to ${targets.length} dispatch desks` : 'Send to dispatch'}</>}
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* ── Footer feedback ── */}
      {duplicate ? (
        <p className="rounded-lg border border-severity-medium/40 bg-severity-medium/10 px-4 py-2.5 text-center text-sm">
          Possible duplicate ({duplicate.reason}): incident{' '}
          <span className="font-mono font-semibold">{duplicate.incident_number}</span> matched in the last 12 hours.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-lg border border-severity-critical/40 bg-severity-critical/10 px-4 py-2.5 text-center text-sm text-severity-critical-ink">
          {error}
        </p>
      ) : null}
    </form>
  );
}
