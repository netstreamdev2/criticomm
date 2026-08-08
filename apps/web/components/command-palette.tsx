'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search, CornerDownLeft, FileText, Radio, Users, Truck, ShieldAlert, FlameKindling,
  Loader2, type LucideIcon,
} from 'lucide-react';
import {
  groupSearchHits, searchEverything, MIN_SEARCH_LENGTH, SEARCH_KIND_LABELS,
  type SearchHit, type SearchKind,
} from '@criticom/api';
import { canAccess, type Silo, type UserRole } from '@criticom/db';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { NAV_GROUPS } from '@/lib/nav';
import { cn } from '@/lib/utils';

const KIND_ICON: Record<SearchKind, LucideIcon> = {
  incident: Radio,
  person: Users,
  vehicle: Truck,
  'police-report': ShieldAlert,
  'fire-report': FlameKindling,
  'security-report': FileText,
};

/**
 * Global ⌘K / Ctrl+K palette — pages *and* records.
 *
 * Pages are matched locally against the route matrix, so they appear on the
 * first keystroke with no round trip. Records come from `search_everything`,
 * which is RLS-scoped in the database: this component never filters results for
 * security, it only renders what the caller was allowed to see.
 *
 * Pages are listed first regardless of how many records match. Someone typing
 * "dispatch" almost always means the screen, and a navigator that buries the
 * destination under twelve incidents stops being a navigator.
 */
export function CommandPalette({ silo, role, hiddenHrefs = [], searchEnabled = true }: { silo: string; role: string; hiddenHrefs?: string[]; searchEnabled?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Flatten to the routes this user can actually reach.
  const commands = useMemo(
    () =>
      NAV_GROUPS.flatMap((g) =>
        g.items
          .filter((i) => canAccess(i.href, role as UserRole, silo as Silo) && !hiddenHrefs.includes(i.href))
          .map((i) => ({ ...i, group: g.label })),
      ),
    [role, silo],
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands.slice(0, 12);
    return commands
      .map((c) => {
        const label = c.label.toLowerCase();
        const hay = `${label} ${c.group.toLowerCase()} ${c.keywords ?? ''}`;
        if (!hay.includes(q)) return null;
        // Rank: label prefix > label contains > keyword match
        const score = label.startsWith(q) ? 0 : label.includes(q) ? 1 : 2;
        return { c, score };
      })
      .filter((x): x is { c: (typeof commands)[number]; score: number } => x !== null)
      .sort((a, b) => a.score - b.score)
      .slice(0, 10)
      .map((x) => x.c);
  }, [query, commands]);

  /**
   * Record search, debounced.
   *
   * 220ms is long enough that typing an incident number does not fire six
   * queries and short enough to feel immediate. The generation counter drops
   * responses that arrive out of order — a slow query for "IN" must never
   * overwrite the results for "INC-2026".
   */
  useEffect(() => {
    const trimmed = query.trim();
    if (!open || !searchEnabled || trimmed.length < MIN_SEARCH_LENGTH) {
      setHits([]);
      setSearching(false);
      return;
    }

    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      searchEverything(getBrowserSupabase(), trimmed, 18)
        .then((rows) => { if (!cancelled) setHits(rows); })
        .catch(() => { if (!cancelled) setHits([]); })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 220);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, open]);

  // Keyboard navigation runs over one flat list, so pages and records are
  // reachable with the same arrow keys.
  const flat = useMemo(
    () => [
      ...results.map((r) => ({ href: r.href, key: `page:${r.href}` })),
      ...hits.map((h) => ({ href: h.href, key: `hit:${h.kind}:${h.id}` })),
    ],
    [results, hits],
  );

  const grouped = useMemo(() => groupSearchHits(hits), [hits]);

  // Global hotkey
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Let the topbar button open it too
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener('criticom:open-palette', onOpen);
    return () => window.removeEventListener('criticom:open-palette', onOpen);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      // focus after paint
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => setActive(0), [query]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center pt-[12vh]" role="dialog" aria-modal="true" aria-label="Command palette">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setOpen(false)} />
      <div className="relative w-full max-w-xl overflow-hidden rounded-xl border border-border bg-bg-card shadow-2xl">
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, flat.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              if (e.key === 'Enter' && flat[active]) { e.preventDefault(); go(flat[active]!.href); }
            }}
            placeholder="Search pages, incidents, people, vehicles…"
            className="h-14 w-full bg-transparent text-sm text-fg outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden shrink-0 rounded border border-border bg-bg-soft px-1.5 py-0.5 text-[10px] text-muted-foreground sm:block">ESC</kbd>
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
          {flat.length === 0 && !searching && (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              {query.trim().length < MIN_SEARCH_LENGTH
                ? 'Type to search pages, incidents, people and vehicles.'
                : `Nothing matches “${query}”.`}
            </p>
          )}

          {results.length > 0 && (
            <p className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Pages
            </p>
          )}
          {results.map((c, i) => {
            const Icon = c.icon;
            return (
              <button
                key={c.href}
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => go(c.href)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors',
                  i === active ? 'bg-primary/15 text-fg' : 'text-fg/80 hover:bg-muted',
                )}
              >
                <Icon className={cn('h-4 w-4 shrink-0', i === active ? 'text-primary' : 'text-muted-foreground')} />
                <span className="flex-1 truncate">{c.label}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{c.group}</span>
                {i === active && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
              </button>
            );
          })}

          {searching && hits.length === 0 && (
            <p className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching records…
            </p>
          )}

          {grouped.map(([kind, group]) => {
            const Icon = KIND_ICON[kind];
            return (
              <div key={kind}>
                <p className="px-3 pb-1 pt-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {SEARCH_KIND_LABELS[kind]}
                </p>
                {group.map((hit) => {
                  // Index within the flat list, so hover and arrow keys agree.
                  const i = results.length + hits.indexOf(hit);
                  return (
                    <button
                      key={`${hit.kind}:${hit.id}`}
                      type="button"
                      onMouseEnter={() => setActive(i)}
                      onClick={() => go(hit.href)}
                      className={cn(
                        'flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors',
                        i === active ? 'bg-primary/15 text-fg' : 'text-fg/80 hover:bg-muted',
                      )}
                    >
                      <Icon
                        className={cn(
                          'mt-0.5 h-4 w-4 shrink-0',
                          i === active ? 'text-primary' : 'text-muted-foreground',
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{hit.title}</span>
                        {hit.subtitle ? (
                          <span className="block truncate text-xs text-muted-foreground">
                            {hit.subtitle}
                          </span>
                        ) : null}
                      </span>
                      {hit.meta ? (
                        <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                          {hit.meta}
                        </span>
                      ) : null}
                      {i === active && <CornerDownLeft className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-4 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          <span><kbd className="rounded border border-border px-1">↑</kbd> <kbd className="rounded border border-border px-1">↓</kbd> navigate</span>
          <span><kbd className="rounded border border-border px-1">↵</kbd> open</span>
          <span className="ml-auto">
            {results.length} page{results.length === 1 ? '' : 's'}
            {hits.length > 0 ? ` · ${hits.length} record${hits.length === 1 ? '' : 's'}` : ''}
          </span>
        </div>
      </div>
    </div>
  );
}
