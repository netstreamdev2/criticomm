'use client';

import { useEffect, useState } from 'react';
import { Palette, Check, Moon, Sun } from 'lucide-react';
import { THEMES, DEFAULT_THEME, THEME_STORAGE_KEY, type ThemeId } from '@/lib/themes';
import { cn } from '@/lib/utils';

function applyTheme(id: ThemeId) {
  document.documentElement.setAttribute('data-theme', id);
  try { localStorage.setItem(THEME_STORAGE_KEY, id); } catch { /* private mode */ }
}

/** Reads the theme the no-flash script already applied. */
function useCurrentTheme(): [ThemeId, (id: ThemeId) => void] {
  const [theme, setTheme] = useState<ThemeId>(DEFAULT_THEME);
  useEffect(() => {
    const current = document.documentElement.getAttribute('data-theme') as ThemeId | null;
    if (current) setTheme(current);
  }, []);
  const set = (id: ThemeId) => { applyTheme(id); setTheme(id); };
  return [theme, set];
}

/** Full grid of theme cards — used on the Profile/Settings page. */
export function ThemeGrid() {
  const [theme, setTheme] = useCurrentTheme();
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {THEMES.map((t) => {
        const selected = t.id === theme;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => setTheme(t.id)}
            aria-pressed={selected}
            className={cn(
              'group overflow-hidden rounded-xl border text-left transition-all hover:-translate-y-0.5',
              selected ? 'border-primary ring-2 ring-primary/40' : 'border-border hover:border-accent/50',
            )}
          >
            {/* Live swatch preview */}
            <div className="flex h-20" style={{ background: t.swatch[0] }} aria-hidden>
              <div className="m-3 flex flex-1 flex-col justify-between rounded-lg p-2" style={{ background: t.swatch[1] }}>
                <div className="flex gap-1">
                  <span className="h-2 w-8 rounded-full" style={{ background: t.swatch[2] }} />
                  <span className="h-2 w-5 rounded-full" style={{ background: t.swatch[3] }} />
                </div>
                <div className="flex gap-1">
                  <span className="h-1.5 w-12 rounded-full opacity-40" style={{ background: t.swatch[3] }} />
                </div>
              </div>
            </div>
            <div className="flex items-start justify-between gap-2 bg-bg-card p-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-semibold">
                  {t.mode === 'dark' ? <Moon className="h-3 w-3 text-muted-foreground" /> : <Sun className="h-3 w-3 text-muted-foreground" />}
                  {t.name}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{t.description}</p>
              </div>
              {selected && <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
            </div>
          </button>
        );
      })}
    </div>
  );
}

/** Compact dropdown for the topbar. */
export function ThemePicker() {
  const [theme, setTheme] = useCurrentTheme();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Change theme"
        aria-expanded={open}
        title="Change theme"
        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-fg"
      >
        <Palette className="h-4 w-4" />
      </button>

      {open && (
        <>
          <button type="button" aria-label="Close" className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-xl border border-border bg-bg-card shadow-2xl">
            <p className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Theme
            </p>
            <div className="max-h-80 overflow-y-auto p-1.5">
              {THEMES.map((t) => {
                const selected = t.id === theme;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => { setTheme(t.id); setOpen(false); }}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                      selected ? 'bg-primary/15 text-fg' : 'text-fg/80 hover:bg-muted',
                    )}
                  >
                    {/* mini swatch */}
                    <span className="flex h-5 w-5 shrink-0 overflow-hidden rounded-full border border-border" aria-hidden>
                      <span className="h-full w-1/2" style={{ background: t.swatch[0] }} />
                      <span className="h-full w-1/4" style={{ background: t.swatch[2] }} />
                      <span className="h-full w-1/4" style={{ background: t.swatch[3] }} />
                    </span>
                    <span className="flex-1 truncate">{t.name}</span>
                    {selected && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
