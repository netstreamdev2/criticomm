'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Phone, Headphones, Ambulance, Siren } from 'lucide-react';
import { logIncomingCall, checkDuplicateIncident } from '@criticom/api';
import type { LogIncomingCallInput, Silo } from '@criticom/db';
import { getBrowserSupabase } from '@/lib/supabase-browser';

type CategoryTree = Array<{
  id: string; code: string | null; name: string;
  subcategories: Array<{ id: string; code: string | null; name: string; prompts: string[] }>;
}>;

const SILO_LABELS: Record<Exclude<Silo, 'Ethekwini'>, string> = {
  MetroPolice: 'Metro Police',
  MetroFire: 'Fire & Rescue',
  Medical: 'EMS / Medical',
  EthekwiniDisaster: 'Disaster Mgmt',
};
const SILOS = Object.keys(SILO_LABELS) as Array<Exclude<Silo, 'Ethekwini'>>;
const SEVERITIES = ['Low', 'Medium', 'High', 'Critical'] as const;
const REGIONS = ['Central', 'North', 'South', 'West', 'Outer'] as const;
const VICTIM_COUNTS = ['1', '2', '3', '4', '5', '6-10', '10+'] as const;
const MED_PRIORITIES = [
  'P1 — Red (Immediate)', 'P2 — Yellow (Urgent)', 'P3 — Green (Delayed)', 'P4 — Blue (Expectant)',
] as const;

const pad = (n: number) => String(n).padStart(2, '0');
const fmtStamp = (d: Date, ms = false) =>
  `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${ms ? `,${String(d.getMilliseconds()).padStart(3, '0')}` : ''}`;

export function LogCallForm({
  defaultSilo, callTaker, categoryTree = [],
}: {
  defaultSilo: Silo; callTaker?: string; categoryTree?: CategoryTree;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ reason: string; incident_number: string } | null>(null);

  // ── Live SLA timer + auto-generated identifiers ──
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef<Date>(new Date());
  const [ids, setIds] = useState({ incidentId: '', callTs: '', createdTs: '' });
  useEffect(() => {
    const now = new Date();
    startedAt.current = now;
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    setIds({
      incidentId: `INC-${stamp}`,
      callTs: fmtStamp(now, true),
      createdTs: fmtStamp(new Date(now.getTime() + 5000)),
    });
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - now.getTime()) / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  const timerLabel = `${Math.floor(elapsed / 60)}:${pad(elapsed % 60)}`;
  const timerUrgent = elapsed >= 120;

  // ── Form state ──
  const initialSilo = (defaultSilo === 'Ethekwini' ? 'MetroPolice' : defaultSilo) as Exclude<Silo, 'Ethekwini'>;
  const [silo, setSilo] = useState<Exclude<Silo, 'Ethekwini'>>(initialSilo);
  const [callerName, setCallerName] = useState('');
  const [isPatient, setIsPatient] = useState<boolean | null>(null);
  const [phone, setPhone] = useState('');
  const [description, setDescription] = useState('');
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState('0');
  const [lng, setLng] = useState('0');
  const [suburb, setSuburb] = useState('');
  const [city, setCity] = useState('Durban');
  const [postal, setPostal] = useState('');
  const [incidentType, setIncidentType] = useState('');
  const [category, setCategory] = useState('');
  const [region, setRegion] = useState('');
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>('Medium');
  const [emsNotRequired, setEmsNotRequired] = useState(false);
  const [victims, setVictims] = useState('');
  const [medPriority, setMedPriority] = useState('');
  const [notes, setNotes] = useState('');

  const lockedSilo = defaultSilo !== 'Ethekwini';

  // Flat list of 10-codes grouped for the <optgroup> picker.
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
    })();
  };

  const dialZoiper = () => {
    if (!phone) return;
    // Zoiper registers the tel: / callto: URI scheme; fall back to tel:.
    const num = phone.replace(/\s+/g, '');
    window.location.href = `tel:${num}`;
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!callerName.trim()) return setError('Caller name is required.');
    if (!phone.trim()) return setError('Citizen phone number is required.');
    if (!incidentType) return setError('Select an incident code.');
    if (!description.trim()) return setError('Call description is required.');
    if (!address.trim()) return setError('Location address is required.');

    const medicalType = emsNotRequired
      ? 'EMS Not Required'
      : medPriority || null;

    const payload: LogIncomingCallInput = {
      silo,
      caller_name: callerName.trim(),
      caller_number: phone.trim(),
      call_description: description.trim(),
      incident_type: incidentType,
      incident_severity: severity,
      location_address: address.trim(),
      location_lat: Number(lat) || 0,
      location_lng: Number(lng) || 0,
      suburb: suburb.trim() || null,
      city: city.trim() || null,
      postal_code: postal.trim() || null,
      is_caller_patient: isPatient,
      number_of_victims: victims ? (victims === '10+' ? 10 : victims === '6-10' ? 8 : Number(victims)) : null,
      medical_type: medicalType,
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
        router.push(`/incidents/${incident.id}`);
      } catch (err) {
        setError((err as Error).message);
      }
    });
  };

  const label = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground';
  const field = 'h-11 w-full rounded-lg border border-border bg-bg-soft px-3 text-sm text-white placeholder:text-muted-foreground/60 focus:border-accent focus:outline-none';

  return (
    <form onSubmit={onSubmit} className="w-full space-y-6 pb-24">
      {/* Top bar */}
      <div className="flex justify-end">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-bg-soft px-4 py-2 text-sm font-semibold text-white/80 hover:bg-muted"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Dashboard
        </Link>
      </div>

      {/* SLA timer pill */}
      <div className="flex justify-center">
        <div
          className={`rounded-full px-8 py-3 text-lg font-bold shadow-xl ${
            timerUrgent ? 'animate-pulse bg-severity-critical text-white' : 'bg-black text-white'
          }`}
        >
          Dispatch Response Time Alert: {timerLabel}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── Caller Information ── */}
        <section className="rounded-2xl border border-border bg-gradient-to-b from-bg-card to-bg-soft p-6">
          <h2 className="mb-5 text-center text-lg font-bold">Caller Information</h2>

          <div className="space-y-4">
            <div>
              <label className={label} htmlFor="callerName">Caller Name</label>
              <input id="callerName" className={field} placeholder="Enter Caller Name"
                value={callerName} onChange={(e) => setCallerName(e.target.value)} />
            </div>

            {/* Patient info */}
            <div className="rounded-xl border border-border bg-bg-soft/60 p-4">
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <span>👤</span> Patient Information <span className="text-muted-foreground">(Optional)</span>
              </p>
              <div className="flex items-center gap-6 text-sm">
                <span className="text-muted-foreground">Is the caller the patient?</span>
                {([['Yes', true], ['No', false]] as const).map(([txt, val]) => (
                  <button
                    key={txt} type="button" onClick={() => setIsPatient(val)}
                    className={`inline-flex items-center gap-2 rounded-md px-2 py-1 ${
                      isPatient === val ? 'text-white' : 'text-muted-foreground'
                    }`}
                  >
                    <span className={`h-3.5 w-3.5 rounded-full border ${isPatient === val ? 'border-accent bg-accent' : 'border-muted-foreground'}`} />
                    {txt}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className={label}>Citizen Phone Number</label>
              <div className="flex items-center gap-2">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border bg-bg-soft text-accent">
                  <Phone className="h-5 w-5" />
                </span>
                <input className={field} placeholder="e.g. 082 123 4567"
                  value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={checkDup} />
                <button type="button" onClick={dialZoiper}
                  className="inline-flex h-11 shrink-0 items-center gap-2 rounded-lg border border-accent/40 bg-accent/10 px-3 text-xs font-bold uppercase tracking-wide text-accent hover:bg-accent/20">
                  <Headphones className="h-4 w-4" /> Dial Zoiper
                </button>
              </div>
            </div>

            <div>
              <label className={label} htmlFor="desc">Call Description</label>
              <textarea id="desc" rows={4} className={`${field} h-auto py-2`} placeholder="Enter call description here"
                value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>

            <div>
              <label className={label} htmlFor="addr">Location Address</label>
              <input id="addr" className={field} placeholder="Start typing address…"
                value={address} onChange={(e) => setAddress(e.target.value)} onBlur={checkDup} />
              <div className="mt-2 grid grid-cols-2 gap-3">
                <input className={field} type="number" step="any" placeholder="Latitude"
                  value={lat} onChange={(e) => setLat(e.target.value)} />
                <input className={field} type="number" step="any" placeholder="Longitude"
                  value={lng} onChange={(e) => setLng(e.target.value)} />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
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
                <label className={label}>Postal Code <span className="text-muted-foreground">(Optional)</span></label>
                <input className={field} value={postal} onChange={(e) => setPostal(e.target.value)} />
              </div>
            </div>

            <div>
              <label className={label}>Call Timestamp</label>
              <input readOnly className={`${field} cursor-not-allowed text-muted-foreground`} value={ids.callTs} />
            </div>
          </div>
        </section>

        {/* ── Incident Details ── */}
        <section className="rounded-2xl border border-border bg-gradient-to-b from-bg-card to-bg-soft p-6">
          <h2 className="mb-5 text-center text-lg font-bold">Incident Details</h2>

          <div className="space-y-4">
            <div>
              <label className={label}>Incident ID</label>
              <input readOnly className={`${field} cursor-not-allowed font-mono text-muted-foreground`} value={ids.incidentId} />
            </div>

            <div>
              <label className={label}>Department</label>
              <select className={field} value={silo} disabled={lockedSilo}
                onChange={(e) => setSilo(e.target.value as Exclude<Silo, 'Ethekwini'>)}>
                {SILOS.map((s) => <option key={s} value={s}>{SILO_LABELS[s]}</option>)}
              </select>
            </div>

            <div>
              <label className={label}>Incident Type (10-Code)</label>
              <select className={field} value={incidentType} onChange={(e) => onSelectCode(e.target.value)}>
                <option value="">Select Incident Code…</option>
                {codeGroups.map((g) => (
                  <optgroup key={g.id} label={g.name}>
                    {g.subcategories.map((s) => (
                      <option key={s.id} value={s.name}>{s.code ? `${s.code} · ` : ''}{s.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            {/* EMS / Medical Triage */}
            <div className="rounded-xl border border-border bg-bg-soft/60 p-4">
              <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Ambulance className="h-4 w-4 text-severity-critical" /> EMS / Medical Triage
              </p>
              <label className="mb-3 flex cursor-pointer items-center gap-3 text-sm">
                <span className={`relative h-5 w-9 rounded-full transition-colors ${emsNotRequired ? 'bg-severity-low' : 'bg-muted'}`}>
                  <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all"
                    style={{ left: emsNotRequired ? '1.125rem' : '0.125rem' }} />
                </span>
                <input type="checkbox" className="sr-only" checked={emsNotRequired}
                  onChange={(e) => setEmsNotRequired(e.target.checked)} />
                No Injuries / EMS Not Required
              </label>
              <div className={emsNotRequired ? 'pointer-events-none space-y-3 opacity-50' : 'space-y-3'}>
                <div>
                  <label className={label}>Number of Victims</label>
                  <select className={field} value={victims} onChange={(e) => setVictims(e.target.value)}>
                    <option value="">Select Count…</option>
                    {VICTIM_COUNTS.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className={label}>Medical Severity Code</label>
                  <select className={field} value={medPriority} onChange={(e) => setMedPriority(e.target.value)}>
                    <option value="">Select Priority…</option>
                    {MED_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </div>
            </div>

            <div>
              <label className={label}>Global Severity</label>
              <select className={field} value={severity} onChange={(e) => setSeverity(e.target.value as (typeof SEVERITIES)[number])}>
                {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <div>
              <label className={label}>Incident Created At</label>
              <input readOnly className={`${field} cursor-not-allowed text-muted-foreground`} value={ids.createdTs} />
            </div>

            <div>
              <label className={label}>Notes <span className="text-muted-foreground">(Optional)</span></label>
              <textarea rows={4} className={`${field} h-auto py-2`} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
        </section>
      </div>

      {duplicate && (
        <div className="mx-auto max-w-2xl rounded-lg border border-severity-medium/40 bg-severity-medium/10 p-3 text-center text-sm">
          ⚠ Possible duplicate ({duplicate.reason}): incident{' '}
          <span className="font-mono">{duplicate.incident_number}</span> matched in the last 12h.
        </div>
      )}
      {error && (
        <p className="mx-auto max-w-2xl rounded-lg border border-severity-critical/40 bg-severity-critical/10 px-3 py-2 text-center text-sm text-severity-critical">
          {error}
        </p>
      )}

      {/* Send to dispatch */}
      <div className="flex justify-center">
        <button
          type="submit" disabled={pending}
          className="inline-flex items-center gap-2 rounded-lg bg-severity-low px-8 py-3 text-base font-bold uppercase tracking-wide text-black transition-transform hover:scale-[1.02] disabled:opacity-60"
          style={{ boxShadow: '0 0 24px rgba(16,185,129,0.55)' }}
        >
          <Siren className="h-5 w-5" /> {pending ? 'Sending…' : 'Send to Dispatch'}
        </button>
      </div>
    </form>
  );
}
