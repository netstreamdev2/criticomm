'use client';

import { useMemo, useState, useTransition } from 'react';
import { Loader2, Search } from 'lucide-react';
import { TARGET_LANGS, languageName } from '@criticom/db/i18n';
import { useT } from '@/components/i18n';
import { cn } from '@/lib/utils';
import { setTranslatorLangsAction } from './actions';

export type Person = { id: string; name: string; role: string; langs: string[] };

/** Administrators: who translates and approves which language. */
export function TranslatorsCard({ people }: { people: Person[] }) {
  const { t } = useT();
  const [list, setList] = useState(people);
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const w = q.trim().toLowerCase();
    const found = w ? list.filter((p) => p.name.toLowerCase().includes(w)) : list.filter((p) => p.langs.length > 0);
    return found.slice(0, 30);
  }, [list, q]);

  return (
    <section className="space-y-3 rounded-xl border border-border bg-bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold">{t('Translators')}</h2>
        <label className="relative ml-auto">
          <span className="sr-only">{t('Find a person')}</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('Find a person')}
            className="h-8 w-56 rounded-md border border-border bg-bg-soft pl-8 pr-2 text-xs"
          />
        </label>
      </div>
      {shown.length === 0 ? (
        <p className="text-xs text-muted-foreground">{q ? t('No one by that name.') : t('No translators yet. Find a person to add one.')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {shown.map((p) => (
            <PersonRow key={p.id} person={p} onSaved={(langs) => setList((cur) => cur.map((x) => (x.id === p.id ? { ...x, langs } : x)))} />
          ))}
        </ul>
      )}
    </section>
  );
}

function PersonRow({ person, onSaved }: { person: Person; onSaved: (langs: string[]) => void }) {
  const { t } = useT();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const toggle = (lang: string) => {
    const next = person.langs.includes(lang) ? person.langs.filter((l) => l !== lang) : [...person.langs, lang];
    setError(null);
    start(async () => {
      const r = await setTranslatorLangsAction(person.id, next);
      if (r.ok) onSaved(r.value); else setError(r.error);
    });
  };
  return (
    <li className="flex flex-wrap items-center gap-2 py-2 text-sm">
      <span className="min-w-[10rem] font-medium">{person.name}<span className="ml-1.5 text-[11px] text-muted-foreground">{person.role}</span></span>
      <span className="flex flex-wrap gap-1">
        {TARGET_LANGS.map((l) => (
          <button
            key={l}
            type="button"
            disabled={busy}
            aria-pressed={person.langs.includes(l)}
            onClick={() => toggle(l)}
            className={cn('rounded-full border px-2 py-0.5 text-[11px] font-semibold disabled:opacity-60',
              person.langs.includes(l) ? 'border-primary bg-primary/15 text-fg' : 'border-border text-muted-foreground hover:text-fg')}
          >
            {languageName(l)}
          </button>
        ))}
      </span>
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : null}
      {error ? <span className="w-full text-[11px] text-severity-critical-ink">{error}</span> : null}
    </li>
  );
}
