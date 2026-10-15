'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { searchTypes, type DeskSilo, type IncidentSeverity } from '@criticom/db';
import { useT } from '@/components/i18n';
import { cn } from '@/lib/utils';
import { CritiMark, DeptDots, deskList, fieldCls, severityWord } from './intake-ui';

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
 * shows its code and the departments it goes to as coloured dots. Arrow keys
 * and Enter work. A name translated into the reader's language is searched too.
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
  const { t } = useT();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hi, setHi] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const found = searchTypes(types, query);
    const words = query.trim().toLowerCase();
    if (!words) return found;
    // The reader's own language: a translated name that holds the words typed.
    const translated = types.filter((ty) => !found.includes(ty) && t(ty.name).toLowerCase().includes(words));
    return [...found, ...translated];
  }, [types, query, t]);
  const chosen = types.find((ty) => ty.name === value) ?? null;

  useEffect(() => setHi(0), [query]);
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-i="${hi}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [hi, open]);

  const pick = (ty: TypeOption) => {
    onChange(ty.name);
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
      const ty = results[hi];
      if (open && ty) pick(ty);
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
          className={cn(fieldCls, 'pr-9 font-medium', invalid && 'border-severity-critical')}
          // Room for the dots: up to four departments.
          style={{ paddingLeft: chosen && !open ? `${1.25 + chosen.departments.length * 0.625}rem` : '2.25rem' }}
          placeholder={t('Search: gun, crash, fire, chest pain…')}
          value={open ? query : chosen ? `${chosen.code ? `${chosen.code} · ` : ''}${t(chosen.name)}` : value}
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
          aria-label={t('Incident types')}
          className="absolute z-40 mt-1 max-h-80 w-full overflow-y-auto rounded-lg border border-border bg-bg-card py-1 shadow-2xl"
        >
          {results.length === 0 ? (
            <p className="px-3 py-2.5 text-xs text-muted-foreground">{t('No type matches “{query}”. Try another word.', { query })}</p>
          ) : results.map((ty, i) => {
            const header = grouped && ty.group !== lastGroup ? ty.group : null;
            lastGroup = ty.group;
            return (
              <div key={ty.id} role="presentation">
                {header ? (
                  <p className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t(header)}</p>
                ) : null}
                <div
                  // biome-ignore lint/a11y/useSemanticElements: option of the ARIA combobox list above
                  role="option"
                  tabIndex={-1}
                  aria-selected={ty.name === value}
                  data-i={i}
                  // On press, so the box keeps the focus and the list does not close first.
                  onMouseDown={(e) => { e.preventDefault(); pick(ty); }}
                  onMouseEnter={() => setHi(i)}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-sm',
                    i === hi ? 'bg-muted' : 'hover:bg-muted/60',
                    ty.name === value && 'font-semibold',
                  )}
                >
                  <DeptDots departments={ty.departments} className="w-9 justify-start" />
                  <span className="min-w-0 flex-1 truncate">{t(ty.name)}</span>
                  {!grouped ? <span className="shrink-0 text-[11px] text-muted-foreground">{t(ty.group)}</span> : null}
                  {ty.code ? <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{ty.code}</span> : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {chosen ? (
        <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
          {byCriti ? <CritiMark /> : null}
          <span>{t(chosen.group)}</span>
          <span aria-hidden>·</span>
          <span>{t('Goes to')} <span className="font-semibold text-fg">{deskList(chosen.departments, t) || t('the department you choose')}</span></span>
          {chosen.severity ? <><span aria-hidden>·</span><span>{t('Usually {severity}', { severity: severityWord(chosen.severity, t) })}</span></> : null}
        </p>
      ) : null}
    </div>
  );
}
