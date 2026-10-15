'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight, Search, LogOut, User } from 'lucide-react';
import { breadcrumbsFor } from '@/lib/nav';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { ThemePicker } from '@/components/theme-picker';
import { LanguageMenu } from '@/components/language-menu';
import { AlertBell } from '@/components/alert-bell';
import { cn } from '@/lib/utils';

function openPalette() {
  window.dispatchEvent(new Event('criticom:open-palette'));
}

export function Topbar({
  fullName, role, silo, hasSidebar = true, canTranslate = false,
}: {
  fullName: string; role: string; silo: string;
  /** A translator or administrator: the language menu links to Translations. */
  canTranslate?: boolean;
  /** When false there is no sidebar trigger, so the left gutter is reclaimed. */
  hasSidebar?: boolean;
}) {
  const pathname = usePathname();
  const crumbs = breadcrumbsFor(pathname);
  const initials = fullName.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();

  const signOut = async () => {
    try {
      await getBrowserSupabase().auth.signOut();
    } catch { /* fall through to redirect */ }
    window.location.href = '/login';
  };

  return (
    <header className={cn(
        'sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-bg-soft/95 pr-3 backdrop-blur supports-[backdrop-filter]:bg-bg-soft/80 sm:pr-4',
        // The gutter exists only to clear the sidebar's mobile hamburger.
        hasSidebar ? 'pl-14 lg:pl-6' : 'pl-3 sm:pl-4',
      )}>
      {/* Breadcrumbs */}
      <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
        <ol className="flex items-center gap-1 text-sm">
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return (
              <li key={c.href} className="flex min-w-0 items-center gap-1">
                {i > 0 && <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />}
                {last ? (
                  <span className="truncate font-semibold text-fg" aria-current="page">{c.label}</span>
                ) : (
                  <Link
                    href={c.href}
                    className="hidden truncate text-muted-foreground transition-colors hover:text-fg sm:block"
                  >
                    {c.label}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Global search trigger */}
      <button
        type="button"
        onClick={openPalette}
        className="hidden items-center gap-2 rounded-md border border-border bg-bg/60 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-accent/50 hover:text-fg md:flex"
        aria-label="Search pages"
      >
        <Search className="h-3.5 w-3.5" />
        <span>Jump to…</span>
        <kbd className="ml-2 rounded border border-border bg-bg-soft px-1.5 py-0.5 text-[10px]">⌘K</kbd>
      </button>
      <button
        type="button"
        onClick={openPalette}
        aria-label="Search pages"
        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-fg md:hidden"
      >
        <Search className="h-4 w-4" />
      </button>

      <LanguageMenu canTranslate={canTranslate} />

      <ThemePicker />

      <AlertBell silo={silo} role={role} />

      {/* User */}
      <div className="flex items-center gap-2 border-l border-border pl-3">
        <Link href="/profile" className="group flex items-center gap-2" aria-label="Profile">
          {/* Solid fill rather than a tint — guarantees legible initials in every theme */}
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold">
            {initials || <User className="h-4 w-4" />}
          </span>
          <span className="hidden min-w-0 leading-tight sm:block">
            <span className="block truncate text-sm font-semibold text-fg group-hover:text-fg">{fullName}</span>
            <span className="block truncate text-[11px] text-muted-foreground">{role} · {silo}</span>
          </span>
        </Link>
        <button
          type="button"
          onClick={signOut}
          aria-label="Sign out"
          title="Sign out"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-severity-critical/15 hover:text-severity-critical-ink"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
