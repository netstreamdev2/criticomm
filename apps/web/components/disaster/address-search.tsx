'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, MapPin } from 'lucide-react';
import { useT } from '@/components/i18n';
import { cn } from '@/lib/utils';

type Hit = { label: string; lat: number; lng: number; suburb: string | null; ward?: string | null };
export type PickedPlace = { label: string; lat: number; lng: number; suburb: string | null; ward: string | null; municipality: string | null };

/**
 * The ward and municipality a point is in, from the ward boundaries on the
 * map (/api/geocode?area=1). Null when the map cannot be asked.
 */
export async function areaAt(lat: number, lng: number): Promise<{ ward: string | null; municipality: string | null } | null> {
  try {
    const r = await fetch(`/api/geocode?lat=${lat}&lng=${lng}&area=1`);
    const j = (await r.json()) as { area?: { ward: string | null; municipality: string | null } | null };
    return j.area ?? null;
  } catch {
    return null;
  }
}

/**
 * An address field that finds the place as it is typed. Picking one fills in
 * the address, then asks which ward and municipality the point falls inside,
 * and says what it found under the field. Typing over it afterwards keeps the
 * text and lets the place go.
 */
export function AddressSearch({ value, onText, onPlace, className, placeholder, label }: {
  value: string;
  onText: (text: string) => void;
  onPlace: (place: PickedPlace) => void;
  className?: string;
  placeholder?: string;
  /** What the field is, for screen readers. */
  label?: string;
}) {
  const { t } = useT();
  const [typed, setTyped] = useState(false);
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [found, setFound] = useState<{ state: 'finding' | 'found' | 'none'; ward?: string | null; municipality?: string | null } | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!typed || value.trim().length < 3) { setHits([]); return; }
    const timer = setTimeout(() => {
      fetch(`/api/geocode?q=${encodeURIComponent(value)}`).then((r) => r.json())
        .then((j: { results?: Hit[] }) => { setHits(j.results ?? []); setActive(-1); setOpen(true); })
        .catch(() => setHits([]));
    }, 350);
    return () => clearTimeout(timer);
  }, [value, typed]);

  const take = async (h: Hit) => {
    setTyped(false); setOpen(false); setHits([]);
    onText(h.label);
    const n = ++seq.current;
    setFound({ state: 'finding' });
    const area = await areaAt(h.lat, h.lng);
    if (n !== seq.current) return;
    const ward = area?.ward ?? h.ward ?? null;
    setFound(ward || area?.municipality ? { state: 'found', ward, municipality: area?.municipality ?? null } : { state: 'none' });
    onPlace({ label: h.label, lat: h.lat, lng: h.lng, suburb: h.suburb, ward, municipality: area?.municipality ?? null });
  };

  const keys = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || hits.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(hits.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); void take(hits[active]!); }
    else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div className="relative">
      <MapPin className="pointer-events-none absolute left-3 top-[1.65rem] h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input value={value} maxLength={300} placeholder={placeholder ?? t('Start typing the street or the hall’s name')}
        onChange={(e) => { setTyped(true); seq.current++; setFound(null); onText(e.target.value); }}
        onKeyDown={keys} onFocus={() => hits.length && setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        aria-label={label}
        className={cn(className, 'pl-9')} />
      {open && hits.length ? (
        <ul className="absolute z-[600] mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-border bg-bg-card shadow-lg">
          {hits.map((h, i) => (
            <li key={`${h.lat},${h.lng}`}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => void take(h)}
                className={cn('block w-full px-3 py-2.5 text-left text-sm hover:bg-muted', i === active && 'bg-muted')}>
                {h.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {found ? (
        <p className={cn('mt-1.5 flex items-center gap-1.5 text-xs', found.state === 'none' ? 'text-severity-medium-ink' : 'text-muted-foreground')} aria-live="polite">
          {found.state === 'finding' ? <><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />{t('Finding the ward…')}</> : null}
          {found.state === 'found' ? (
            <><Check className="h-3.5 w-3.5 text-severity-low-ink" aria-hidden />
              {[found.ward ? t('Ward {w}', { w: found.ward }) : null, found.municipality].filter(Boolean).join(' · ')}</>
          ) : null}
          {found.state === 'none' ? t('The map does not name the ward here. Type it in.') : null}
        </p>
      ) : null}
    </div>
  );
}
