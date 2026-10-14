'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { searchTypes, type DeskSilo, type IncidentSeverity } from '@criticom/db';
import { cn } from '@/lib/utils';
import { CritiMark, DeptDots, deskList, fieldCls } from './intake-ui';

export type TypeOption = {
  id: string;
  code: string | null;
  name: string;
  group: string;
  prompts: string[];
  departments: DeskSilo[];
  severity: IncidentSeverity | null;
};

/**
 * The incident type: type a word ("gun", "crash", "chest") and pick. Each type
 * shows the departments it goes to as coloured dots. Arrow keys and Enter work.
 */
export function TypePicker({
  types, value, onChange, byCriti, invalid,
}: {
  types: TypeOption[];
  value: string;
  onChange: (name: string) => void;
  /** Criti chose it: marked until the call taker changes it. */
  byCriti?: boolean;
  invalid?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hi, setHi] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => searchTypes(types, query), [types, query]);
  const chosen = types.find((t) => t.name === value) ?? null;

  useEffect(() => setHi(0), [query]);
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-i="${hi}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [hi, open]);

  const pick = (t: TypeOption) => {
    onChange(t.name);
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') {
      // Never submits the form from here.
      e.preventDefault();
      const t = results[hi];
      if (open && t) pick(t);
    } else if (e.key === 'Escape') { setOpen(false); setQuery(''); }
  };

  // With nothing typed the list is grouped; a search lists the best first.
  const grouped = query.trim() === '';
  let lastGroup = '';

  return (
    <div className="relative">
      <div className="relative">
        {chosen && !open
          ? <DeptDots departments={chosen.departments} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" />
          : <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />}
        <input
          ref={inputRef}
          id="incidentType"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-invalid={invalid}
          autoComplete="off"
          className={cn(fieldCls, 'pl-9 pr-9 font-medium', invalid && 'border-severity-critical')}
          placeholder="Search: gun, crash, fire, chest pain…"
          value={open ? query : chosen ? `${chosen.code ? `${chosen.code} · ` : ''}${chosen.name}` : value}
          onFocus={() => { setOpen(true); setQuery(''); }}
          onBlur={() => setOpen(false)}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onKeyDown={onKey}
        />
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      </div>

      {open ? (
        <div
          ref={listRef}
          id={`${id}-list`}
          // biome-ignore lint/a11y/useSemanticElements: ARIA combobox list; a <select> cannot filter or show the department dots
          role="listbox"
          tabIndex={-1}
          aria-label="Incident types"
          className="absolute z-40 mt-1 max-h-80 w-full overflow-y-auto rounded-lg border border-border bg-bg-card py-1 shadow-2xl"
        >
          {results.length === 0 ? (
            <p className="px-3 py-2.5 text-xs text-muted-foreground">No type matches “{query}”. Try another word.</p>
          ) : results.map((t, i) => {
            const header = grouped && t.group !== lastGroup ? t.group : null;
            lastGroup = t.group;
            return (
              <div key={t.id} role="presentation">
                {header ? (
                  <p className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{header}</p>
                ) : null}
                <div
                  // biome-ignore lint/a11y/useSemanticElements: option of the ARIA combobox list above
                  role="option"
                  tabIndex={-1}
                  aria-selected={t.name === value}
                  data-i={i}
                  // On press, so the box keeps the focus and the list does not close first.
                  onMouseDown={(e) => { e.preventDefault(); pick(t); }}
                  onMouseEnter={() => setHi(i)}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-sm',
                    i === hi ? 'bg-muted' : 'hover:bg-muted/60',
                    t.name === value && 'font-semibold',
                  )}
                >
                  <DeptDots departments={t.departments} className="w-9 justify-start" />
                  <span className="min-w-0 flex-1 truncate">{t.name}</span>
                  {!grouped ? <span className="shrink-0 text-[11px] text-muted-foreground">{t.group}</span> : null}
                  {t.code ? <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{t.code}</span> : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {chosen ? (
        <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
          {byCriti ? <CritiMark /> : null}
          <span>{chosen.group}</span>
          <span aria-hidden>·</span>
          <span>Goes to <span className="font-semibold text-fg">{deskList(chosen.departments) || 'the department you choose'}</span></span>
          {chosen.severity ? <><span aria-hidden>·</span><span>Usually {chosen.severity}</span></> : null}
        </p>
      ) : null}
    </div>
  );
}
