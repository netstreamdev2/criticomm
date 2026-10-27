'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { MapPin, Search } from 'lucide-react';
import { HAZARD_GROUPS, MUNICIPALITIES } from '@criticom/db/disaster-plan';
import { LocationPicker } from '@/components/location-picker';
import { areaAt } from '@/components/disaster/address-search';
import { useT } from '@/components/i18n';
import { FieldProblem, problemBorder } from '@/components/disaster/field-problem';
import { MAX_PEOPLE, anyProblem, checkCount, checkName, checkPhone, checkWard } from '@/lib/disaster-checks';
import { cn } from '@/lib/utils';
import { openIncidentAction } from '../actions';
import { incidentFromWarningAction } from '../../warnings/actions';

type Hit = { label: string; lat: number; lng: number; suburb: string | null; ward?: string | null };

const THROUGH = ['EMACC call', 'Field report', 'SA Weather Service warning', 'Site emergency plan (NKP or MHI)', 'Other'] as const;
const SEVERITY = ['Low', 'Medium', 'High', 'Critical'] as const;

/**
 * The desk's Open incident form: what, how serious, where (the address finds
 * the place, the suburb and the ward; a pin on the map does the same), how it
 * was reported, and the first report. Opened from a warning (0116), it starts
 * filled in from the warning and is linked to it.
 */
export type FromWarning = { id: string; label: string; hazard: string; title: string; report: string };

export function OpenIncidentForm({ fromWarning = null }: { fromWarning?: FromWarning | null }) {
  const { t } = useT();
  const router = useRouter();
  const ref = useRef(crypto.randomUUID());
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [v, setV] = useState({
    short_title: fromWarning?.title ?? '', hazard: fromWarning?.hazard ?? '', severity: 'Medium', municipality: 'eThekwini Metro', ward: '',
    location_address: '', suburb: '', reported_through: fromWarning ? 'SA Weather Service warning' : 'EMACC call', caller_name: '',
    caller_number: '', people_affected: '', first_report: fromWarning?.report ?? '',
  });
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const set = (k: keyof typeof v, x: string) => setV((cur) => ({ ...cur, [k]: x }));

  // The address search: places as the desk types, the first pick sets everything.
  useEffect(() => {
    if (q.trim().length < 3) { setHits([]); return; }
    const timer = setTimeout(() => {
      fetch(`/api/geocode?q=${encodeURIComponent(q)}`).then((r) => r.json()).then((j: { results?: Hit[] }) => setHits(j.results ?? [])).catch(() => setHits([]));
    }, 350);
    return () => clearTimeout(timer);
  }, [q]);
  // The ward and municipality the point falls inside, from the ward boundaries on the map.
  const fillArea = (p: { lat: number; lng: number }) => {
    void areaAt(p.lat, p.lng).then((a) => {
      if (!a) return;
      setV((cur) => ({
        ...cur, ward: a.ward ?? cur.ward,
        municipality: a.municipality && (MUNICIPALITIES as readonly string[]).includes(a.municipality) ? a.municipality : cur.municipality,
      }));
    });
  };
  const take = (h: Hit) => {
    setPin({ lat: h.lat, lng: h.lng });
    setV((cur) => ({ ...cur, location_address: h.label, suburb: h.suburb ?? cur.suburb, ward: h.ward ?? cur.ward }));
    setQ(''); setHits([]);
    fillArea(h);
  };
  // A pin dropped by hand: look the place up to fill in the address, suburb and ward.
  const pick = (p: { lat: number; lng: number }) => {
    setPin(p);
    fetch(`/api/geocode?lat=${p.lat}&lng=${p.lng}`).then((r) => r.json()).then((j: { results?: Hit[] }) => {
      const h = j.results?.[0];
      if (h) setV((cur) => ({ ...cur, location_address: cur.location_address || h.label, suburb: h.suburb ?? cur.suburb, ward: h.ward ?? cur.ward }));
    }).catch(() => undefined);
    fillArea(p);
  };

  const bad = {
    ward: checkWard(v.ward, v.municipality), affected: checkCount(v.people_affected, MAX_PEOPLE),
    caller: checkName(v.caller_name), number: checkPhone(v.caller_number),
  };
  const blocked = anyProblem(bad.ward, bad.affected, bad.caller, bad.number);
  const submit = () => start(async () => {
    setError(null);
    const fields = { ...v, lat: pin?.lat ?? null, lng: pin?.lng ?? null };
    const res = fromWarning ? await incidentFromWarningAction(fromWarning.id, ref.current, fields) : await openIncidentAction(ref.current, fields);
    if ('error' in res) { setError(res.error); return; }
    router.push(`/disaster/desk/${res.id}`);
  });

  const field = 'mt-1 h-11 w-full rounded-md border border-border bg-bg-soft px-3 text-[15px]';
  const label = 'block text-sm font-medium';
  return (
    <div className="space-y-6">
      {fromWarning ? (
        <p className="rounded-xl border border-accent/40 bg-accent/10 px-5 py-3 font-semibold">{t('From the warning: {label}', { label: fromWarning.label })}</p>
      ) : null}
      <section className="space-y-4 rounded-xl border border-border bg-bg-card p-6 shadow-sm">
        <label className={label}>{t('Short title')}
          <input value={v.short_title} onChange={(e) => set('short_title', e.target.value)} maxLength={80}
            placeholder={t('For example: Flooding along the uMngeni River')} className={field} />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={label}>{t('Hazard')}
            <select value={v.hazard} onChange={(e) => set('hazard', e.target.value)} className={field}>
              <option value="">{t('Choose the hazard')}</option>
              {HAZARD_GROUPS.map((g) => (
                <optgroup key={g.group} label={t(g.group)}>{g.hazards.map((h) => <option key={h} value={h}>{t(h)}</option>)}</optgroup>
              ))}
            </select>
          </label>
          <div className={label}>{t('Severity')}
            <div className="mt-1 grid grid-cols-4 gap-2">
              {SEVERITY.map((s) => (
                <button key={s} type="button" aria-pressed={v.severity === s} onClick={() => set('severity', s)}
                  className={cn('h-11 rounded-md border text-sm font-semibold', v.severity === s ? 'border-accent bg-accent/15 text-accent' : 'border-border text-muted-foreground hover:bg-muted')}>
                  {t(s)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-border bg-bg-card p-6 shadow-sm">
        <h2 className="flex items-center gap-2 font-semibold"><MapPin className="h-4 w-4 text-accent" aria-hidden />{t('Where')}</h2>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Find the street, suburb or landmark')}
            aria-label={t('Find the place')} className="h-11 w-full rounded-md border border-border bg-bg-soft pl-9 pr-3 text-[15px]" />
          {hits.length ? (
            <ul className="absolute z-[600] mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-border bg-bg-card shadow-lg">
              {hits.map((h) => (
                <li key={`${h.lat},${h.lng}`}>
                  <button type="button" onClick={() => take(h)} className="block w-full px-3 py-2 text-left text-sm hover:bg-muted">
                    {h.label}{h.ward ? <span className="ml-2 text-xs text-muted-foreground">{t('Ward {w}', { w: h.ward })}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <LocationPicker lat={pin?.lat ?? null} lng={pin?.lng ?? null} onPick={pick} height={300} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className={cn(label, 'sm:col-span-2')}>{t('Location')}
            <input value={v.location_address} onChange={(e) => set('location_address', e.target.value)} maxLength={200} className={field} />
          </label>
          <label className={label}>{t('Suburb')}<input value={v.suburb} onChange={(e) => set('suburb', e.target.value)} maxLength={100} className={field} /></label>
          <label className={label}>{t('Ward')}<input value={v.ward} onChange={(e) => set('ward', e.target.value)} maxLength={40} inputMode="numeric" className={cn(field, problemBorder(bad.ward))} /><FieldProblem problem={bad.ward} /></label>
          <label className={cn(label, 'sm:col-span-2')}>{t('Municipality')}
            <select value={v.municipality} onChange={(e) => set('municipality', e.target.value)} className={field}>
              {MUNICIPALITIES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-border bg-bg-card p-6 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className={cn(label, 'sm:col-span-2')}>{t('Reported through')}
            <select value={v.reported_through} onChange={(e) => set('reported_through', e.target.value)} disabled={Boolean(fromWarning)} className={field}>
              {THROUGH.map((x) => <option key={x} value={x}>{t(x)}</option>)}
            </select>
          </label>
          <label className={label}>{t('People affected')}
            <input value={v.people_affected} onChange={(e) => set('people_affected', e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" className={cn(field, problemBorder(bad.affected))} />
            <FieldProblem problem={bad.affected} />
          </label>
          <div />
          <label className={cn(label, 'sm:col-span-2')}>{t('Reported by (if known)')}
            <input value={v.caller_name} onChange={(e) => set('caller_name', e.target.value)} maxLength={100} className={cn(field, problemBorder(bad.caller))} />
            <FieldProblem problem={bad.caller} />
          </label>
          <label className={cn(label, 'sm:col-span-2')}>{t('Their number (for an SMS back)')}
            <input value={v.caller_number} onChange={(e) => set('caller_number', e.target.value)} maxLength={30} inputMode="tel" placeholder="082 123 4567" className={cn(field, problemBorder(bad.number))} />
            <FieldProblem problem={bad.number} />
          </label>
        </div>
        <label className={label}>{t('First report')}
          <textarea value={v.first_report} onChange={(e) => set('first_report', e.target.value)} rows={4} maxLength={2000}
            placeholder={t('What has happened, who is on scene, what is needed')} className="mt-1 w-full rounded-md border border-border bg-bg-soft px-3 py-2 text-[15px]" />
        </label>
      </section>

      {error ? <p role="alert" className="rounded-lg border border-severity-critical bg-bg-card px-4 py-3 text-sm font-medium text-severity-critical-ink">{error}</p> : null}
      <div className="flex justify-end gap-3">
        <button type="button" onClick={() => router.push('/disaster/desk')} className="h-12 rounded-md border border-border px-6 text-sm hover:bg-muted">{t('Cancel')}</button>
        <button type="button" onClick={submit} disabled={pending || blocked}
          className="h-12 rounded-md bg-primary px-8 text-base font-semibold text-primary-foreground disabled:opacity-60">
          {pending ? t('Adding…') : t('Add the incident')}
        </button>
      </div>
    </div>
  );
}
