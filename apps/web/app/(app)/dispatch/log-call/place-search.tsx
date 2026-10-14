'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Loader2, MapPin, Store } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fieldCls } from './intake-ui';

/** One place from /api/geocode (lib/geocode GeoResult). */
export type Place = {
  label: string;
  lat: number;
  lng: number;
  suburb: string | null;
  city: string;
  postalCode: string | null;
  place?: string | null;
  kind?: string | null;
  near?: string | null;
};

/**
 * The incident location: an address or a place the caller names ("Gateway",
 * "Engen near Pavilion", "South Beach taxi rank"). Looks up only what the call
 * taker types; an address filled in from the map pin is not searched again.
 */
export function PlaceSearch({
  value, onChange, onPick, onBlur, invalid,
}: {
  value: string;
  onChange: (text: string) => void;
  onPick: (p: Place) => void;
  onBlur?: () => void;
  invalid?: boolean;
}) {
  const id = useId();
  const [results, setResults] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState('');
  const [hi, setHi] = useState(0);
  // What the call taker last typed: anything else in the box came from a pick or the pin.
  const typed = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (value !== typed.current || value.trim().length < 3) {
      setResults([]);
      setSearched('');
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(value)}`, { signal: ctrl.signal });
        const data = (await res.json()) as { results?: Place[] };
        setResults(data.results ?? []);
        setSearched(value);
        setHi(0);
        // Only while the box still has the focus.
        setOpen(document.activeElement === inputRef.current);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setResults([]);
      } finally {
        setBusy(false);
      }
    }, 450);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [value]);

  const pick = (p: Place) => {
    typed.current = null;
    setResults([]);
    setOpen(false);
    onPick(p);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const p = results[hi]; if (p) pick(p); }
    else if (e.key === 'Escape') setOpen(false);
  };

  const nothing = open && !busy && searched !== '' && searched === value && results.length === 0;

  return (
    <div className="relative">
      <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={inputRef}
        id="address"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-invalid={invalid}
        autoComplete="off"
        className={cn(fieldCls, 'pl-9 pr-9', invalid && 'border-severity-critical')}
        placeholder="An address or a place, e.g. Gateway, Engen near Pavilion"
        value={value}
        onChange={(e) => { typed.current = e.target.value; onChange(e.target.value); }}
        onFocus={() => setOpen(true)}
        onBlur={() => { setOpen(false); onBlur?.(); }}
        onKeyDown={onKey}
      />
      {busy ? <Loader2 className="absolute right-3 top-3.5 h-4 w-4 animate-spin text-muted-foreground" /> : null}

      {open && results.length > 0 ? (
        <div
          id={`${id}-list`}
          // biome-ignore lint/a11y/useSemanticElements: ARIA combobox list; a <select> cannot show the place details
          role="listbox"
          tabIndex={-1}
          aria-label="Places found"
          className="absolute z-40 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-border bg-bg-card py-1 shadow-2xl"
        >
          {results.map((p, i) => {
            const name = p.place ?? p.label.split(',')[0]!;
            const rest = p.label.split(',').slice(1).map((s) => s.trim()).filter(Boolean).join(', ');
            return (
              <div
                key={`${p.lat},${p.lng}`}
                // biome-ignore lint/a11y/useSemanticElements: option of the ARIA combobox list above
                role="option"
                tabIndex={-1}
                aria-selected={i === hi}
                // On press, so the box keeps the focus and the list does not close first.
                onMouseDown={(e) => { e.preventDefault(); pick(p); }}
                onMouseEnter={() => setHi(i)}
                className={cn('flex w-full cursor-pointer items-start gap-2.5 px-3 py-2 text-left', i === hi ? 'bg-muted' : 'hover:bg-muted/60')}
              >
                {p.place
                  ? <Store className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  : <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-1.5 text-sm">
                    <span className="font-semibold">{name}</span>
                    {p.kind ? <span className="rounded bg-muted px-1.5 text-[10px] font-semibold text-muted-foreground">{p.kind}</span> : null}
                    {p.near ? <span className="text-[11px] text-muted-foreground">near {p.near}</span> : null}
                  </span>
                  {rest ? <span className="block truncate text-xs text-muted-foreground">{rest}</span> : null}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
      {nothing ? (
        <p className="absolute z-40 mt-1 w-full rounded-lg border border-border bg-bg-card px-3 py-2.5 text-xs text-muted-foreground shadow-2xl">
          Nothing found for “{value}”. Try a street or a nearby place, or click the map.
        </p>
      ) : null}
    </div>
  );
}
