'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Ambulance, ArrowLeft, Flame, Loader2, MapPin, Megaphone, Paperclip, Phone,
  Radio, Shield, Siren, Timer, Waves, Zap,
} from 'lucide-react';
import {
  checkDuplicateIncident, logIncomingCall, routeIncident, uploadIncidentEvidence,
} from '@criticom/api';
import type { LogIncomingCallInput, Silo } from '@criticom/db';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { LocationPicker } from '@/components/location-picker';
import { useToast } from '@/components/toast';
import { cn } from '@/lib/utils';

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
  MetroPolice: 'Metro Police',
  MetroFire: 'Fire & Rescue',
  Medical: 'EMS / Medical',
  EthekwiniDisaster: 'Disaster Mgmt',
};

const SEVERITIES = ['Low', 'Medium', 'High', 'Critical'] as const;
const REGIONS = ['Central', 'North', 'South', 'West', 'Outer'] as const;
const VICTIM_COUNTS = ['1', '2', '3', '4', '5', '6-10', '10+'] as const;
const MED_PRIORITIES = [
  'P1 — Red (Immediate)', 'P2 — Yellow (Urgent)', 'P3 — Green (Delayed)', 'P4 — Blue (Expectant)',
] as const;

/** Average urban response speed used for the straight-line ETA estimate. */
const AVG_SPEED_KMH = 42;
const DEPOT: Record<Department, [number, number]> = {
  // Approximate departmental control points around the metro.
  MetroPolice: [-29.8579, 31.0292],
  MetroFire: [-29.8489, 31.0181],
  Medical: [-29.8687, 31.0104],
  EthekwiniDisaster: [-29.7830, 30.9950],
};

const pad = (n: number) => String(n).padStart(2, '0');
const fmtStamp = (d: Date, ms = false) =>
  `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ` +
  `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
  `${ms ? `,${String(d.getMilliseconds()).padStart(3, '0')}` : ''}`;

/** Great-circle distance in km. Good enough for a first-cut ETA. */
function haversineKm(a: [number, number], b: [number, number]) {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const lat1 = (a[0] * Math.PI) / 180;
  const lat2 = (b[0] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function LogCallForm({
  defaultSilo, callTaker, categoryTree = [],
}: {
  defaultSilo: Silo; callTaker?: string; categoryTree?: CategoryTree;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ reason: string; incident_number: string } | null>(null);

  /* ── Live SLA timer + generated identifiers ─────────────────────── */
  const [elapsed, setElapsed] = useState(0);
  const [ids, setIds] = useState({ incidentId: '', callTs: '', createdTs: '' });
  const [execTime, setExecTime] = useState('');

  useEffect(() => {
    const now = new Date();
    const stamp =
      `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
      `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    setIds({
      incidentId: `INC-${stamp}`,
      callTs: fmtStamp(now),
      createdTs: fmtStamp(now),
    });
    const t = setInterval(() => {
      setElapsed(Math.floor((Date.now() - now.getTime()) / 1000));
      setExecTime(fmtStamp(new Date(), true));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const timerLabel = `${pad(Math.floor(elapsed / 60))}:${pad(elapsed % 60)}`;
  const timerTone = elapsed >= 180 ? 'critical' : elapsed >= 90 ? 'warn' : 'ok';

  /* ── Form state ─────────────────────────────────────────────────── */
  const lockedSilo = defaultSilo !== 'Ethekwini';
  const initialDept = (lockedSilo ? defaultSilo : 'MetroPolice') as Department;

  const [callerName, setCallerName] = useState('');
  const [isPatient, setIsPatient] = useState<boolean | null>(null);
  const [phone, setPhone] = useState('');
  const [description, setDescription] = useState('');
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [suburb, setSuburb] = useState('');
  const [city, setCity] = useState('Durban');
  const [postal, setPostal] = useState('');
  const [region, setRegion] = useState('');
  const [incidentType, setIncidentType] = useState('');
  const [category, setCategory] = useState('');
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>('Medium');
  const [emsNotRequired, setEmsNotRequired] = useState(false);
  const [victims, setVictims] = useState('');
  const [medPriority, setMedPriority] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);

  /* ── Routing ────────────────────────────────────────────────────── */
  const [targets, setTargets] = useState<Department[]>(lockedSilo ? [initialDept] : []);
  const [eta, setEta] = useState<string | null>(null);

  const toggleTarget = (id: Department) => {
    setTargets((cur) => (cur.includes(id) ? cur.filter((s) => s !== id) : [...cur, id]));
    setEta(null);
  };
  const broadcastAll = () => {
    setTargets(DEPARTMENTS.map((d) => d.id));
    setSeverity('Critical');
    setEta(null);
    toast.push({
      title: 'Broadcast armed',
      body: 'All four departments will be alerted on dispatch.',
      tone: 'critical',
      duration: 5000,
    });
  };

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
    if (address.trim().length < 4) { setSuggestions([]); return; }
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

  const applySuggestion = (s: (typeof suggestions)[number]) => {
    suppressLookup.current = true;
    setAddress(s.label.split(',').slice(0, 3).join(',').trim());
    setLat(s.lat);
    setLng(s.lng);
    if (s.suburb) setSuburb(s.suburb);
    if (s.city) setCity(s.city);
    if (s.postalCode) setPostal(s.postalCode);
    setSuggestions([]);
  };

  // Moving the pin fills the address fields back in.
  const onPickPoint = useCallback(async ({ lat: la, lng: ln }: { lat: number; lng: number }) => {
    setLat(la);
    setLng(ln);
    setEta(null);
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
    } catch {
      /* keep the coordinates; the address stays whatever was typed */
    }
  }, []);

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

  const checkDup = () => {
    if (!phone && !address) return;
    void (async () => {
      const dupe = await checkDuplicateIncident(getBrowserSupabase(), {
        phone: phone || null, location: address || null, type: incidentType || null,
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
    if (!phone) return;
    // Zoiper and most softphones register the tel: scheme.
    window.location.href = `tel:${phone.replace(/\s+/g, '')}`;
  };

  const calculateEta = () => {
    if (lat === null || lng === null) {
      setError('Place the scene on the map before calculating an ETA.');
      return;
    }
    if (targets.length === 0) {
      setError('Select at least one department to calculate an ETA.');
      return;
    }
    setError(null);
    const legs = targets.map((t) => {
      const km = haversineKm(DEPOT[t], [lat, lng]);
      // Straight-line understates road distance; 1.35 is the usual urban factor.
      const minutes = Math.max(2, Math.round(((km * 1.35) / AVG_SPEED_KMH) * 60));
      return `${SILO_LABELS[t]} ≈ ${minutes} min (${km.toFixed(1)} km)`;
    });
    setEta(legs.join('  ·  '));
  };

  /* ── Submit ─────────────────────────────────────────────────────── */
  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!callerName.trim()) return setError('Caller name is required.');
    if (!phone.trim()) return setError('Citizen phone number is required.');
    if (!incidentType) return setError('Select an incident code.');
    if (!description.trim()) return setError('Call description is required.');
    if (!address.trim()) return setError('Location address is required.');
    if (targets.length === 0) return setError('Select at least one department to dispatch to.');

    // The owning silo is the first department selected — that team runs the call.
    const owner = targets[0]!;
    const payload: LogIncomingCallInput = {
      silo: owner,
      caller_name: callerName.trim(),
      caller_number: phone.trim(),
      call_description: description.trim(),
      incident_type: incidentType,
      incident_severity: severity,
      location_address: address.trim(),
      location_lat: lat ?? 0,
      location_lng: lng ?? 0,
      suburb: suburb.trim() || null,
      city: city.trim() || null,
      postal_code: postal.trim() || null,
      is_caller_patient: isPatient,
      number_of_victims: victims
        ? (victims === '10+' ? 10 : victims === '6-10' ? 8 : Number(victims))
        : null,
      medical_type: emsNotRequired ? 'EMS Not Required' : (medPriority || null),
      notes: notes.trim() || null,
    };

    start(async () => {
      try {
        const sb = getBrowserSupabase();
        const incident = await logIncomingCall(sb, payload);

        await sb.from('incidents').update({
          call_taken_by: callTaker ?? null,
          incident_category: category || null,
          region: region || null,
        }).eq('id', incident.id);

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

        // Fans out to every selected department and pops an alert on their screens.
        await routeIncident(sb, {
          incident_id: incident.id,
          silos: targets,
          notes: notes.trim() || null,
        });

        // Realtime already reached every open screen; this reaches the phones
        // that are locked. Fire-and-forget — a push failure is not a dispatch
        // failure.
        void fetch('/api/push/notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ incidentId: incident.id, silos: targets }),
        }).catch(() => {});

        toast.push({
          title: `${incident.incident_number} dispatched`,
          body: `${targets.map((t) => SILO_LABELS[t]).join(', ')} alerted.`,
          tone: 'success',
          badge: severity,
        });
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
  const readOnlyField = `${field} cursor-not-allowed bg-muted/40 font-mono text-xs text-muted-foreground`;

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
              <label className={label}>Contact citizen</label>
              <div className="flex items-center gap-2">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border bg-bg-soft text-severity-low-ink">
                  <Phone className="h-4 w-4" />
                </span>
                <input
                  className={field} placeholder="e.g. 082 123 4567" inputMode="tel"
                  value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={checkDup}
                />
                <button
                  type="button" onClick={dial} disabled={!phone}
                  className="inline-flex h-11 shrink-0 items-center gap-2 rounded-lg bg-severity-low px-5 text-xs font-bold uppercase tracking-wider transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  <Phone className="h-3.5 w-3.5" /> Call
                </button>
              </div>
            </div>

            {/* Is the caller the patient */}
            <div className="rounded-xl border border-border bg-bg-soft/60 px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                <span className="text-muted-foreground">Is the caller the patient?</span>
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
            </div>

            <div>
              <label className={label} htmlFor="callTs">Call timestamp</label>
              <input id="callTs" readOnly className={readOnlyField} value={ids.callTs} />
            </div>

            {/* Map */}
            <div>
              <label className={label}>
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-3 w-3" /> Incident location
                </span>
              </label>
              <div className="relative">
                <input
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
                <label className={label}>Latitude</label>
                <input
                  className={field} type="number" step="any" placeholder="—"
                  value={lat ?? ''} onChange={(e) => setLat(e.target.value === '' ? null : Number(e.target.value))}
                />
              </div>
              <div>
                <label className={label}>Longitude</label>
                <input
                  className={field} type="number" step="any" placeholder="—"
                  value={lng ?? ''} onChange={(e) => setLng(e.target.value === '' ? null : Number(e.target.value))}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={label}>Suburb</label>
                <input className={field} value={suburb} onChange={(e) => setSuburb(e.target.value)} />
              </div>
              <div>
                <label className={label}>Region</label>
                <select className={field} value={region} onChange={(e) => setRegion(e.target.value)}>
                  <option value="">Select region…</option>
                  {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className={label}>City</label>
                <input className={field} value={city} onChange={(e) => setCity(e.target.value)} />
              </div>
              <div>
                <label className={label}>Postal code</label>
                <input className={field} value={postal} onChange={(e) => setPostal(e.target.value)} />
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
              <label className={label}>Incident ID</label>
              <input readOnly className={readOnlyField} value={ids.incidentId} />
            </div>

            <div>
              <label className={label}>Incident type (10-code)</label>
              <select className={field} value={incidentType} onChange={(e) => onSelectCode(e.target.value)}>
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
                  onChange={(e) => setEmsNotRequired(e.target.checked)}
                />
                No injuries / EMS not required
              </label>

              <div className={cn('space-y-3', emsNotRequired && 'pointer-events-none opacity-45')}>
                <div>
                  <label className={label}>Number of victims</label>
                  <select className={field} value={victims} onChange={(e) => setVictims(e.target.value)}>
                    <option value="">Select count…</option>
                    {VICTIM_COUNTS.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className={label}>Medical severity code</label>
                  <select className={field} value={medPriority} onChange={(e) => setMedPriority(e.target.value)}>
                    <option value="">Select priority…</option>
                    {MED_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={label}>Incident severity</label>
                <select
                  className={field} value={severity}
                  onChange={(e) => setSeverity(e.target.value as (typeof SEVERITIES)[number])}
                >
                  {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className={label}>Created at</label>
                <input readOnly className={readOnlyField} value={ids.createdTs} />
              </div>
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

            {/* ── Routing ── */}
            <div className="rounded-xl border border-border bg-bg-soft/60 p-4">
              <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Radio className="h-4 w-4 text-accent" /> Unit dispatch &amp; routing
                {targets.length > 0 ? (
                  <span className="ml-auto text-xs font-normal text-muted-foreground">
                    {targets.length} selected · lead is {SILO_LABELS[targets[0]!]}
                  </span>
                ) : null}
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

              {targets.length > 0 ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  On dispatch, every screen in{' '}
                  <span className="font-semibold text-fg">
                    {targets.map((t) => SILO_LABELS[t]).join(', ')}
                  </span>{' '}
                  is alerted{severity === 'High' || severity === 'Critical'
                    ? ' with a blocking pop-up that must be acknowledged.'
                    : '.'}
                </p>
              ) : null}
            </div>

            <div>
              <label className={label}>Dispatch execution time</label>
              <input readOnly className={readOnlyField} value={execTime || ids.createdTs} />
            </div>

            {eta ? (
              <p className="flex items-start gap-2 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2.5 text-xs">
                <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                <span>
                  <span className="font-semibold">Estimated response:</span> {eta}
                  <span className="mt-0.5 block text-muted-foreground">
                    Straight-line estimate from departmental control points at {AVG_SPEED_KMH} km/h — not a routed ETA.
                  </span>
                </span>
              </p>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={calculateEta}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-severity-low text-sm font-bold uppercase tracking-wider transition-opacity hover:opacity-90"
              >
                <Zap className="h-4 w-4" /> Calculate ETA
              </button>
              <button
                type="submit"
                disabled={pending}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-accent text-sm font-bold uppercase tracking-wider transition-transform hover:scale-[1.01] disabled:opacity-60"
              >
                {pending
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Dispatching…</>
                  : <><Siren className="h-4 w-4" /> Dispatch incident</>}
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
