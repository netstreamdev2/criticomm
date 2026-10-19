'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, PenLine, Plus, Trash2 } from 'lucide-react';
import { DETAIL_FIELDS, MED_PRIORITIES, catalogueType, type IncidentDetails, type IncidentSeverity } from '@criticom/db';
import {
  CALL_CHANNELS, PATIENT_SEVERITIES, type CallChannel, type CallPatient, type PatientSeverity,
} from '@criticom/db/call-facts';
import type { CompleteCallIntakeInput } from '@criticom/db/schemas';
import { Modal } from '@/components/ui/modal';
import { LocationPicker } from '@/components/location-picker';
import { useToast } from '@/components/toast';
import { checkPhone } from '@/lib/phone';
import { regionFor } from '@/lib/durban-regions';
import { cn } from '@/lib/utils';
import { DetailInput } from '../../log-call/description';
import { SEVERITIES, SEVERITY_ON, fieldCls, labelCls } from '../../log-call/intake-ui';
import { PlaceSearch, type Place } from '../../log-call/place-search';
import { TypePicker, type TypeOption } from '../../log-call/type-picker';
import { editCallAction } from '../../actions';
import { useT } from '@/components/i18n';

const REGIONS = ['Central', 'North', 'South', 'West', 'Outer'] as const;

/** The call as it stands: what the dispatcher starts from. */
export type EditableCall = {
  incident_type: string;
  incident_category: string | null;
  incident_severity: IncidentSeverity;
  call_description: string;
  details: IncidentDetails;
  caller_name: string;
  caller_number: string | null;
  call_channel: string | null;
  call_channel_other: string | null;
  is_caller_patient: boolean | null;
  patients: CallPatient[];
  patient_name: string | null;
  number_of_victims: number | null;
  medical_type: string | null;
  location_address: string;
  location_lat: number | null;
  location_lng: number | null;
  suburb: string | null;
  city: string | null;
  postal_code: string | null;
  region: string | null;
  notes: string | null;
};

type FieldKey = 'type' | 'description' | 'callerName' | 'phone' | 'channel' | 'location' | 'victims' | 'patients' | 'reason';
type PatientRow = { name: string; severity: PatientSeverity | '' };

/** Where the database's reason belongs, so it shows by its field. */
function fieldOf(message: string): FieldKey | null {
  if (/caller number|country code/i.test(message)) return 'phone';
  if (/caller name/i.test(message)) return 'callerName';
  if (/description/i.test(message)) return 'description';
  if (/on the map|the place|on scene at/i.test(message)) return 'location';
  if (/call came in/i.test(message)) return 'channel';
  if (/incident type|change its type/i.test(message)) return 'type';
  if (/people hurt/i.test(message)) return 'victims';
  if (/patients/i.test(message)) return 'patients';
  if (/reason/i.test(message)) return 'reason';
  return null;
}

/** The patients as the database keeps them, from what is on the screen; unchanged while the question is unanswered. */
function patientsFrom(isPatient: boolean | null, callerName: string, callerSeverity: PatientSeverity | '', rows: PatientRow[], kept: CallPatient[]): CallPatient[] {
  if (isPatient === true) return [{ name: callerName.trim() || null, severity: callerSeverity || 'Unknown', caller: true }];
  if (isPatient === false) {
    return rows.filter((p) => p.name.trim() || p.severity)
      .map((p) => ({ name: p.name.trim() || null, severity: p.severity || 'Unknown', caller: false }));
  }
  return kept;
}

const rowsOf = (call: EditableCall): PatientRow[] => {
  const others = call.patients.filter((p) => !p.caller);
  if (others.length) return others.map((p) => ({ name: p.name ?? '', severity: p.severity }));
  const names = (call.patient_name ?? '').split(',').map((n) => n.trim()).filter((n) => n && n !== 'Unknown / Not Provided');
  return names.length ? names.map((name) => ({ name, severity: '' })) : [{ name: '', severity: '' }];
};

/**
 * Correct the call before dispatching it (0079): the type, severity,
 * description and details, how it came in, the caller, the place, the
 * patients and the notes. Only what changed is sent; each problem shows by its
 * field. The database keeps each change with who made it, as it was and as it
 * became, for the call page, the audit trail and the PDF.
 */
export function EditCall({ incidentId, incidentNumber, call, types, emsOnCall }: {
  incidentId: string;
  incidentNumber: string;
  call: EditableCall;
  types: TypeOption[];
  /** EMS is on the call: the patient's questions apply. */
  emsOnCall: boolean;
}) {
  const { t } = useT();
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [tried, setTried] = useState(false);
  const [serverError, setServerError] = useState<{ field: FieldKey | null; text: string } | null>(null);

  const callerPatient = call.patients.find((p) => p.caller) ?? null;
  const [type, setType] = useState(call.incident_type);
  const [category, setCategory] = useState(call.incident_category ?? '');
  const [severity, setSeverity] = useState<IncidentSeverity>(call.incident_severity);
  const [description, setDescription] = useState(call.call_description);
  const [details, setDetails] = useState<IncidentDetails>(call.details);
  const [channel, setChannel] = useState<CallChannel | ''>((call.call_channel as CallChannel | null) ?? '');
  const [channelOther, setChannelOther] = useState(call.call_channel_other ?? '');
  const [callerName, setCallerName] = useState(call.caller_name);
  const [phone, setPhone] = useState(call.caller_number ?? '');
  const [isPatient, setIsPatient] = useState<boolean | null>(call.is_caller_patient);
  const [callerSeverity, setCallerSeverity] = useState<PatientSeverity | ''>(callerPatient?.severity ?? '');
  const [patientRows, setPatientRows] = useState<PatientRow[]>(rowsOf(call));
  const [victims, setVictims] = useState(call.number_of_victims === null ? '' : String(call.number_of_victims));
  const [medical, setMedical] = useState(call.medical_type ?? '');
  const [address, setAddress] = useState(call.location_address);
  const [lat, setLat] = useState<number | null>(call.location_lat || null);
  const [lng, setLng] = useState<number | null>(call.location_lng || null);
  const [suburb, setSuburb] = useState(call.suburb ?? '');
  const [city, setCity] = useState(call.city ?? '');
  const [postal, setPostal] = useState(call.postal_code ?? '');
  const [region, setRegion] = useState(call.region ?? '');
  const [notes, setNotes] = useState(call.notes ?? '');
  const [reason, setReason] = useState('');

  const detailIds = catalogueType(type)?.details ?? [];

  const reset = () => {
    setType(call.incident_type); setCategory(call.incident_category ?? ''); setSeverity(call.incident_severity);
    setDescription(call.call_description); setDetails(call.details);
    setChannel((call.call_channel as CallChannel | null) ?? ''); setChannelOther(call.call_channel_other ?? '');
    setCallerName(call.caller_name); setPhone(call.caller_number ?? '');
    setIsPatient(call.is_caller_patient); setCallerSeverity(callerPatient?.severity ?? ''); setPatientRows(rowsOf(call));
    setVictims(call.number_of_victims === null ? '' : String(call.number_of_victims)); setMedical(call.medical_type ?? '');
    setAddress(call.location_address); setLat(call.location_lat || null); setLng(call.location_lng || null);
    setSuburb(call.suburb ?? ''); setCity(call.city ?? ''); setPostal(call.postal_code ?? ''); setRegion(call.region ?? '');
    setNotes(call.notes ?? ''); setReason(''); setTried(false); setServerError(null);
  };

  const chooseType = (name: string) => {
    setType(name);
    setCategory(types.find((x) => x.name === name)?.group ?? '');
    // The details are the type's own: those the new type does not ask go.
    const keep = new Set(catalogueType(name)?.details ?? []);
    setDetails((d) => Object.fromEntries(Object.entries(d).filter(([k]) => keep.has(k) || k.startsWith('q:'))));
  };

  const applyPlace = (p: Place) => {
    setAddress(p.label.split(',').slice(0, 3).join(',').trim());
    setLat(p.lat); setLng(p.lng);
    if (p.suburb) setSuburb(p.suburb);
    if (p.city) setCity(p.city);
    if (p.postalCode) setPostal(p.postalCode);
    const r = regionFor(p.lat, p.lng, p.suburb);
    if (r) setRegion(r);
  };

  const onPickPoint = async ({ lat: la, lng: ln }: { lat: number; lng: number }) => {
    setLat(la); setLng(ln);
    const r = regionFor(la, ln);
    if (r) setRegion(r);
    try {
      const res = await fetch(`/api/geocode?lat=${la}&lng=${ln}`);
      const hit = ((await res.json()) as { results?: Place[] }).results?.[0];
      if (!hit) return;
      setAddress(hit.label.split(',').slice(0, 3).join(',').trim());
      if (hit.suburb) setSuburb(hit.suburb);
      if (hit.city) setCity(hit.city);
      if (hit.postalCode) setPostal(hit.postalCode);
    } catch {
      /* keep the point; the address stays as typed */
    }
  };

  /** Only what the dispatcher changed, and each field's problem. */
  const { fields, errors } = useMemo(() => {
    const f: CompleteCallIntakeInput = {};
    const e: Partial<Record<FieldKey, string>> = {};
    const text = (a: string, b: string | null) => a.trim() !== (b ?? '').trim();
    if (!type.trim()) e.type = 'Choose the incident type.';
    if (type !== call.incident_type || category !== (call.incident_category ?? '')) {
      f.incident_type = type;
      f.incident_category = category;
    }
    if (severity !== call.incident_severity) f.incident_severity = severity;
    if (!description.trim()) e.description = 'Enter the description.';
    else if (text(description, call.call_description)) f.call_description = description.trim();
    if (JSON.stringify(details) !== JSON.stringify(call.details)) f.details = details;
    if (channel === 'Other' && !channelOther.trim()) e.channel = 'Say how the call came in.';
    if (channel && (channel !== (call.call_channel ?? '') || (channel === 'Other' && text(channelOther, call.call_channel_other)))) {
      f.call_channel = channel;
      if (channel === 'Other') f.call_channel_other = channelOther.trim();
    }
    if (!callerName.trim()) e.callerName = 'Enter the caller name.';
    else if (text(callerName, call.caller_name)) f.caller_name = callerName.trim();
    if (text(phone, call.caller_number)) {
      const p = checkPhone(phone);
      if (!p.ok) e.phone = p.error;
      else if (p.e164 !== call.caller_number) f.caller_number = p.e164;
    }
    if (isPatient !== call.is_caller_patient && isPatient !== null) f.is_caller_patient = isPatient;
    const pts = patientsFrom(isPatient, callerName, callerSeverity, patientRows, call.patients);
    if (JSON.stringify(pts) !== JSON.stringify(call.patients)) f.patients = pts;
    const names = isPatient === false ? patientRows.map((p) => p.name.trim()).filter(Boolean).join(', ') : null;
    if (names !== null && names !== (call.patient_name ?? '') && names) f.patient_name = names;
    const hurt = victims.trim() === '' ? null : Number(victims);
    if (hurt !== call.number_of_victims && hurt !== null) {
      if (!Number.isInteger(hurt) || hurt < 0) e.victims = 'People hurt is a whole number.';
      else f.number_of_victims = hurt;
    }
    if (medical !== (call.medical_type ?? '')) f.medical_type = medical;
    if (!address.trim() || lat === null || lng === null) e.location = 'Search for the place or click the map.';
    else if (text(address, call.location_address) || lat !== (call.location_lat || null) || lng !== (call.location_lng || null)) {
      f.location_address = address.trim();
      f.location_lat = lat;
      f.location_lng = lng;
    }
    if (text(suburb, call.suburb)) f.suburb = suburb.trim();
    if (text(city, call.city)) f.city = city.trim();
    if (text(postal, call.postal_code)) f.postal_code = postal.trim();
    if (region !== (call.region ?? '')) f.region = region;
    if (text(notes, call.notes)) f.notes = notes.trim();
    if (reason.trim().length > 500) e.reason = 'Keep the reason under 500 characters.';
    return { fields: f, errors: e };
  }, [type, category, severity, description, details, channel, channelOther, callerName, phone, isPatient, callerSeverity,
    patientRows, victims, medical, address, lat, lng, suburb, city, postal, region, notes, reason, call]);

  const changed = Object.keys(fields).filter((k) => !['incident_category', 'location_lat', 'location_lng', 'call_channel_other'].includes(k)).length;
  const problems = Object.keys(errors).length;
  /** A field's problem, shown once Save was pressed or the field was changed. */
  const problem = (k: FieldKey, dirty: boolean): string | null =>
    (serverError?.field === k ? serverError.text : null) ?? ((tried || dirty) ? errors[k] ?? null : null);
  const bad = (k: FieldKey, dirty: boolean) => (problem(k, dirty) ? 'border-severity-critical focus:border-severity-critical' : '');
  const Problem = ({ k, dirty }: { k: FieldKey; dirty: boolean }) => {
    const p = problem(k, dirty);
    return p ? <p role="alert" className="mt-1 text-xs font-medium text-severity-critical-ink">{p}</p> : null;
  };

  const save = () => {
    setTried(true);
    setServerError(null);
    if (problems > 0 || changed === 0) return;
    start(async () => {
      const res = await editCallAction(incidentId, fields, reason);
      if (!res.ok) { setServerError({ field: fieldOf(res.error), text: res.error }); return; }
      toast.push({ title: `${incidentNumber} updated`, body: 'Your changes are on the call, its audit trail and its case PDF.', tone: 'success' });
      setOpen(false);
      reset();
      router.refresh();
    });
  };

  const close = () => { if (!pending) { setOpen(false); reset(); } };
  const textArea = cn(fieldCls, 'h-auto min-h-24 py-2.5 leading-relaxed');
  const chip = (on: boolean) => cn('rounded-lg border px-3 py-1.5 text-xs font-semibold',
    on ? 'border-accent bg-accent/15 text-fg' : 'border-border bg-bg-soft text-muted-foreground hover:text-fg');
  const sevChip = (s: PatientSeverity, on: boolean) => cn('h-8 rounded-lg border text-[11px] font-bold',
    !on ? 'border-border bg-bg-soft text-muted-foreground hover:text-fg'
      : s === 'Unknown' ? 'border-fg/40 bg-muted text-fg' : `border-transparent text-white ${SEVERITY_ON[s]}`);
  const SeverityRow = ({ value, onPick, label }: { value: PatientSeverity | ''; onPick: (s: PatientSeverity) => void; label: string }) => (
    <div className="grid grid-cols-5 gap-1" role="radiogroup" aria-label={label}>
      {PATIENT_SEVERITIES.map((s) => (
        <button key={s} type="button" aria-pressed={value === s} onClick={() => onPick(s)} className={sevChip(s, value === s)}>{s}</button>
      ))}
    </div>
  );

  const footer = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <span className={cn('mr-auto text-xs', tried && problems ? 'font-semibold text-severity-critical-ink' : 'text-muted-foreground')}>
        {tried && problems
          ? `Fix the ${problems === 1 ? 'field' : `${problems} fields`} marked in red.`
          : serverError && !serverError.field ? serverError.text
            : changed === 0 ? 'No changes yet' : `${changed} change${changed === 1 ? '' : 's'} to save`}
      </span>
      <button type="button" onClick={close} disabled={pending}
        className="h-10 rounded-lg border border-border px-4 text-sm font-semibold hover:bg-muted disabled:opacity-60">
        {t('Cancel')}</button>
      <button type="button" onClick={save} disabled={pending || changed === 0}
        className="inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} {' '}{t('Save changes')}</button>
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => { reset(); setOpen(true); }}
        className="inline-flex items-center gap-2 rounded-lg border border-accent/50 bg-accent/10 px-4 py-2 text-sm font-semibold text-accent hover:bg-accent/15"
      >
        <PenLine className="h-4 w-4" aria-hidden /> {' '}{t('Edit before dispatch')}</button>

      {open ? (
        <Modal
          title={`Edit ${incidentNumber} before dispatch`}
          onClose={close}
          busy={pending}
          large
          footer={footer}
          confirmClose={changed > 0 ? { title: 'Close without saving?', body: 'Your changes to this call will be lost.' } : null}
        >
          <p className="text-sm text-muted-foreground">
            {t('Correct what the caller said or what was captured. Every change is kept with your name, what it was and what it became: on the call, in the audit trail and on the case PDF.')}</p>

          <div className="grid gap-5 lg:grid-cols-2">
            {/* What and how serious */}
            <div className="space-y-4">
              <div>
                <p className={labelCls}>{t('Incident type')}</p>
                <TypePicker types={types} value={type} onChange={chooseType} invalid={Boolean(problem('type', type !== call.incident_type))} />
                <Problem k="type" dirty={type !== call.incident_type} />
              </div>
              <div>
                <p className={labelCls}>{t('Incident severity')}</p>
                <div className="grid grid-cols-4 gap-1.5">
                  {SEVERITIES.map((s) => (
                    <button key={s} type="button" aria-pressed={severity === s} onClick={() => setSeverity(s)}
                      className={cn('h-10 rounded-lg border text-xs font-bold transition-colors',
                        severity === s ? `${SEVERITY_ON[s]} border-transparent text-white` : 'border-border bg-bg-soft text-muted-foreground hover:text-fg')}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className={labelCls} htmlFor="edit-desc">{t('Description')}</label>
                <textarea id="edit-desc" className={cn(textArea, bad('description', description !== call.call_description))} rows={5} maxLength={2000}
                  value={description} onChange={(e) => setDescription(e.target.value)} />
                <Problem k="description" dirty={description !== call.call_description} />
              </div>
              {detailIds.length ? (
                <div className="space-y-3 rounded-xl border border-border bg-bg-soft/50 p-3">
                  <p className={labelCls}>{t('Details for the type')}</p>
                  {detailIds.map((k) => {
                    const field = DETAIL_FIELDS[k];
                    if (!field) return null;
                    return (
                      <div key={k}>
                        <p className="mb-1 text-xs font-semibold">{field.label}</p>
                        <DetailInput field={field} value={details[k]} onChange={(v) => setDetails((d) => {
                          const next = { ...d };
                          if (v === undefined) delete next[k]; else next[k] = v;
                          return next;
                        })} />
                      </div>
                    );
                  })}
                </div>
              ) : null}
              <div>
                <label className={labelCls} htmlFor="edit-notes">{t('Internal dispatch notes')}</label>
                <textarea id="edit-notes" className={textArea} rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>

            {/* How it came in, who called, where, and the patients */}
            <div className="space-y-4">
              <div>
                <p className={labelCls}>{t('How the call came in')}</p>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                  {CALL_CHANNELS.map((c) => (
                    <button key={c} type="button" aria-pressed={channel === c} onClick={() => setChannel(c)} className={cn(chip(channel === c), 'h-9 px-2')}>{c}</button>
                  ))}
                </div>
                {channel === 'Other' ? (
                  <input className={cn(fieldCls, 'mt-2', bad('channel', channelOther !== (call.call_channel_other ?? '')))} maxLength={60}
                    placeholder={t('For example: radio from a security guard')} value={channelOther} onChange={(e) => setChannelOther(e.target.value)} />
                ) : null}
                <Problem k="channel" dirty={channel !== (call.call_channel ?? '')} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelCls} htmlFor="edit-caller">{t('Caller name')}</label>
                  <input id="edit-caller" className={cn(fieldCls, bad('callerName', callerName !== call.caller_name))} maxLength={100}
                    value={callerName} onChange={(e) => setCallerName(e.target.value)} />
                  <Problem k="callerName" dirty={callerName !== call.caller_name} />
                </div>
                <div>
                  <label className={labelCls} htmlFor="edit-phone">{t('Caller number')}</label>
                  <input id="edit-phone" className={cn(fieldCls, bad('phone', phone !== (call.caller_number ?? '')))} inputMode="tel"
                    value={phone} placeholder="+27 82 123 4567" onChange={(e) => setPhone(e.target.value)} />
                  <Problem k="phone" dirty={phone !== (call.caller_number ?? '')} />
                </div>
              </div>
              <div>
                <p className={labelCls}>{t('Location')}</p>
                <PlaceSearch value={address} onChange={setAddress} onPick={applyPlace} invalid={Boolean(problem('location', address !== call.location_address))} />
                <div className={cn('mt-2 overflow-hidden rounded-lg border', problem('location', false) ? 'border-severity-critical' : 'border-border')}>
                  <LocationPicker lat={lat} lng={lng} onPick={(p) => void onPickPoint(p)} height={240} />
                </div>
                <Problem k="location" dirty={address !== call.location_address} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelCls} htmlFor="edit-suburb">{t('Suburb')}</label>
                  <input id="edit-suburb" className={fieldCls} maxLength={100} value={suburb} onChange={(e) => setSuburb(e.target.value)} />
                </div>
                <div>
                  <label className={labelCls} htmlFor="edit-region">{t('Region')}</label>
                  <select id="edit-region" className={fieldCls} value={region} onChange={(e) => setRegion(e.target.value)}>
                    <option value="">{t('Select region…')}</option>
                    {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls} htmlFor="edit-city">{t('City')}</label>
                  <input id="edit-city" className={fieldCls} maxLength={100} value={city} onChange={(e) => setCity(e.target.value)} />
                </div>
                <div>
                  <label className={labelCls} htmlFor="edit-postal">{t('Postal code')}</label>
                  <input id="edit-postal" className={fieldCls} maxLength={20} value={postal} onChange={(e) => setPostal(e.target.value)} />
                </div>
              </div>

              {emsOnCall || call.is_caller_patient !== null || call.patients.length ? (
                <div className={cn('space-y-3 rounded-xl border p-3', problem('patients', false) ? 'border-severity-critical' : 'border-border bg-bg-soft/50')}>
                  <p className={labelCls}>{t('Patients')}</p>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="mr-1 font-semibold">{t('Is the caller the patient?')}</span>
                    {([[true, 'Yes'], [false, 'No']] as const).map(([v, label]) => (
                      <button key={label} type="button" aria-pressed={isPatient === v} onClick={() => setIsPatient(v)} className={chip(isPatient === v)}>{label}</button>
                    ))}
                  </div>
                  {isPatient === true ? (
                    <div>
                      <p className="mb-1 text-xs font-semibold">{t('How bad is the caller?')}</p>
                      <SeverityRow value={callerSeverity} onPick={setCallerSeverity} label={t('How bad is the caller?')} />
                    </div>
                  ) : null}
                  {isPatient === false ? (
                    <div className="space-y-2">
                      {patientRows.map((p, i) => (
                        <div key={`patient-${i}`} className="space-y-1.5 rounded-lg border border-border bg-bg-card/60 p-2">
                          <div className="flex gap-2">
                            <input className={cn(fieldCls, 'h-9 text-sm')} maxLength={200} placeholder={t('Patient name, if known')} aria-label={`Patient ${i + 1} name`}
                              value={p.name} onChange={(e) => setPatientRows((rows) => rows.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))} />
                            {patientRows.length > 1 ? (
                              <button type="button" aria-label={`Remove patient ${i + 1}`} onClick={() => setPatientRows((rows) => rows.filter((_, j) => j !== i))}
                                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-severity-critical/50 text-severity-critical-ink hover:bg-severity-critical/10">
                                <Trash2 className="h-4 w-4" />
                              </button>
                            ) : null}
                          </div>
                          <SeverityRow value={p.severity} label={`How bad is patient ${i + 1}?`}
                            onPick={(sev) => setPatientRows((rows) => rows.map((r, j) => (j === i ? { ...r, severity: sev } : r)))} />
                        </div>
                      ))}
                      {patientRows.length < 20 ? (
                        <button type="button" onClick={() => setPatientRows((rows) => [...rows, { name: '', severity: '' }])}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent hover:underline">
                          <Plus className="h-3.5 w-3.5" /> {' '}{t('Add another patient')}</button>
                      ) : null}
                    </div>
                  ) : null}
                  <Problem k="patients" dirty={false} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className={labelCls} htmlFor="edit-hurt">{t('People hurt')}</label>
                      <input id="edit-hurt" className={cn(fieldCls, bad('victims', victims !== String(call.number_of_victims ?? '')))} inputMode="numeric"
                        value={victims} onChange={(e) => setVictims(e.target.value.replace(/[^0-9]/g, ''))} />
                      <Problem k="victims" dirty={victims !== String(call.number_of_victims ?? '')} />
                    </div>
                    <div>
                      <label className={labelCls} htmlFor="edit-medical">{t('Medical code')}</label>
                      <select id="edit-medical" className={fieldCls} value={medical} onChange={(e) => setMedical(e.target.value)}>
                        <option value="">{t('Select priority…')}</option>
                        {MED_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div>
            <label className={labelCls} htmlFor="edit-reason">{t('Why it changed (optional)')}</label>
            <input id="edit-reason" className={cn(fieldCls, bad('reason', reason !== ''))} maxLength={500} value={reason}
              placeholder={t('For example: the caller rang back with the right address')} onChange={(e) => setReason(e.target.value)} />
            <Problem k="reason" dirty={reason !== ''} />
          </div>
        </Modal>
      ) : null}
    </>
  );
}
