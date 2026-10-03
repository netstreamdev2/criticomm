'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, MapPin, Search, User, X } from 'lucide-react';
import type { OnDutyOfficer } from '@criticom/api';
import { cn, timeAgo } from '@/lib/utils';

export type RankedOfficer = {
  officer: OnDutyOfficer;
  km: number | null;
  minutes: number | null;
  fixAgeMin: number;
  stale: boolean;
};

/** Rendering 300 rows is fine; past this the dispatcher should type. */
const MAX_SHOWN = 100;

const clock = new Intl.DateTimeFormat('en-ZA', {
  hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Johannesburg',
});

function OfficerLine({ r, deptLabel }: { r: RankedOfficer; deptLabel: (s: string) => string }) {
  const o = r.officer;
  return (
    <span className="min-w-0 flex-1">
      <span className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-bold">{o.name || 'Officer'}{o.badge ? ` #${o.badge}` : ''}</span>
        {o.activeCalls > 0 ? (
          <span className="shrink-0 rounded bg-severity-high/15 px-1.5 py-0.5 text-[10px] font-bold text-severity-high-ink">
            {o.activeCalls} INCIDENT{o.activeCalls === 1 ? '' : 'S'}
          </span>
        ) : (
          <span className="shrink-0 rounded bg-severity-low/15 px-1.5 py-0.5 text-[10px] font-bold text-severity-low-ink">FREE</span>
        )}
      </span>
      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
        {deptLabel(o.silo)}{o.unitNumber ? ` · ${o.unitNumber}` : ''}{o.station ? ` · ${o.station}` : ''}
      </span>
      <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs">
        {r.km !== null ? (
          <span className="flex items-center gap-1 font-semibold">
            <MapPin className="h-3 w-3 text-accent" />
            {r.km < 1 ? `${Math.round(r.km * 1000)} m` : `${r.km.toFixed(1)} km`} · ≈{r.minutes} min
          </span>
        ) : (
          <span className="text-muted-foreground">No GPS fix</span>
        )}
        <span className={r.stale ? 'text-severity-medium-ink' : 'text-muted-foreground'}>
          seen {timeAgo(new Date(Date.now() - r.fixAgeMin * 60_000).toISOString())}
        </span>
        {o.onDutySince ? (
          <span className="text-muted-foreground">on since {clock.format(new Date(o.onDutySince))}</span>
        ) : null}
      </span>
    </span>
  );
}

/**
 * Searchable list of on-duty officers, nearest first — built for hundreds of
 * people, where a card grid stops working. Type to filter by name, badge,
 * unit, station or department; arrows + Enter to pick.
 */
export function OfficerPicker({
  ranked, selectedId, onSelect, deptLabel, placeholder, disabled,
}: {
  ranked: RankedOfficer[];
  selectedId: string | null;
  onSelect: (userId: string | null) => void;
  deptLabel: (silo: string) => string;
  placeholder: string;
  disabled?: boolean;
}) {
  const listId = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = ranked.find((r) => r.officer.userId === selectedId) ?? null;

  const matches = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return ranked;
    return ranked.filter((r) => {
      const o = r.officer;
      const hay = `${o.name} ${o.badge} ${o.unitNumber ?? ''} ${o.station ?? ''} ${deptLabel(o.silo)}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }, [ranked, query, deptLabel]);
  const shown = matches.slice(0, MAX_SHOWN);

  useEffect(() => { setActive(0); }, [query]);

  // Close on a click anywhere else.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Keep the highlighted option in view while arrowing.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const pick = (r: RankedOfficer) => {
    onSelect(r.officer.userId);
    setQuery('');
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, Math.max(0, shown.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && shown[active]) {
        e.preventDefault();
        pick(shown[active]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      <div
        className={cn(
          'flex h-11 items-center gap-2 rounded-lg border border-border bg-bg-soft px-3 focus-within:border-accent',
          disabled && 'opacity-60',
        )}
      >
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && shown[active] ? `${listId}-${active}` : undefined}
          disabled={disabled}
          value={query}
          placeholder={selected ? `${selected.officer.name} — type to change` : placeholder}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        <span className="shrink-0 text-xs text-muted-foreground">{matches.length}</span>
        <button
          type="button"
          tabIndex={-1}
          aria-label={open ? 'Close list' : 'Open list'}
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          className="text-muted-foreground hover:text-fg"
        >
          <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
        </button>
      </div>

      {open ? (
        <div
          ref={listRef}
          id={listId}
          // biome-ignore lint/a11y/useSemanticElements: ARIA combobox list; a <select> cannot filter or show rich rows
          role="listbox"
          tabIndex={-1}
          aria-label="Officers on duty"
          className="absolute z-30 mt-1 max-h-80 w-full overflow-y-auto rounded-lg border border-border bg-bg-card p-1 shadow-xl"
        >
          {shown.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {ranked.length === 0 ? 'No one on duty in the selected departments.' : `No officer matches “${query}”.`}
            </p>
          ) : shown.map((r, i) => (
            <div
              key={r.officer.userId}
              id={`${listId}-${i}`}
              data-index={i}
              // biome-ignore lint/a11y/useSemanticElements: option of the ARIA combobox list above
              role="option"
              tabIndex={-1}
              aria-selected={r.officer.userId === selectedId}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => { e.preventDefault(); pick(r); }}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-md px-2.5 py-2',
                i === active ? 'bg-muted' : 'hover:bg-muted/60',
              )}
            >
              <span className={cn(
                'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                r.officer.activeCalls > 0 ? 'bg-severity-high/15 text-severity-high-ink' : 'bg-severity-low/15 text-severity-low-ink',
              )}>
                {r.officer.userId === selectedId ? <Check className="h-4 w-4" /> : <User className="h-4 w-4" />}
              </span>
              <OfficerLine r={r} deptLabel={deptLabel} />
            </div>
          ))}
          {matches.length > shown.length ? (
            <p className="px-3 py-2 text-center text-xs text-muted-foreground">
              {matches.length - shown.length} more — keep typing to narrow down.
            </p>
          ) : null}
        </div>
      ) : null}

      {selected ? (
        <div className="mt-2 flex items-start gap-3 rounded-xl border border-accent/50 bg-accent/10 p-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/20 text-accent">
            <User className="h-4 w-4" />
          </span>
          <OfficerLine r={selected} deptLabel={deptLabel} />
          <button
            type="button"
            onClick={() => onSelect(null)}
            aria-label="Clear selected officer"
            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
