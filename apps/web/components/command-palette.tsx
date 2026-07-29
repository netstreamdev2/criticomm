'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, CornerDownLeft } from 'lucide-react';
import { canAccess, type Silo, type UserRole } from '@criticom/db';
import { NAV_GROUPS } from '@/lib/nav';
import { cn } from '@/lib/utils';

/** Global ⌘K / Ctrl+K navigator. Only surfaces routes the role may open. */
export function CommandPalette({ silo, role }: { silo: string; role: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Flatten to the routes this user can actually reach.
  const commands = useMemo(
    () =>
      NAV_GROUPS.flatMap((g) =>
        g.items
          .filter((i) => canAccess(i.href, role as UserRole, silo as Silo))
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
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              if (e.key === 'Enter' && results[active]) { e.preventDefault(); go(results[active]!.href); }
            }}
            placeholder="Jump to a page…"
            className="h-14 w-full bg-transparent text-sm text-fg outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden shrink-0 rounded border border-border bg-bg-soft px-1.5 py-0.5 text-[10px] text-muted-foreground sm:block">ESC</kbd>
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
          {results.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              No pages match “{query}”.
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
        </div>

        <div className="flex items-center gap-4 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          <span><kbd className="rounded border border-border px-1">↑</kbd> <kbd className="rounded border border-border px-1">↓</kbd> navigate</span>
          <span><kbd className="rounded border border-border px-1">↵</kbd> open</span>
          <span className="ml-auto">{results.length} result{results.length === 1 ? '' : 's'}</span>
        </div>
      </div>
    </div>
  );
}
