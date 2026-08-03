'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import { canAccess, type Silo, type UserRole } from '@criticom/db';
import { NAV_GROUPS } from '@/lib/nav';
import { cn } from '@/lib/utils';

/**
 * Horizontal navigation for operational roles.
 *
 * The sidebar is reserved for the admin tier, who genuinely work across every
 * module at once. A dispatcher or a firefighter does not — they live on two or
 * three screens, and a permanent 264px column of links they cannot use costs
 * them map and queue width on the one view that matters.
 *
 * Groups collapse into menus so the whole of a role's reach fits one bar. What
 * appears is filtered by the same `canAccess` matrix the middleware enforces,
 * so this can never advertise a destination that would bounce to /403.
 */
export function TopNav({ role, silo }: { role: string; silo: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);

  // A menu left hanging over a live incident map is worse than one that closes
  // eagerly, so dismiss on any outside click, Escape, or route change.
  useEffect(() => setOpen(null), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!navRef.current?.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const groups = NAV_GROUPS
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => canAccess(i.href, role as UserRole, silo as Silo)),
    }))
    .filter((g) => g.items.length > 0);

  if (groups.length === 0) return null;

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav
      ref={navRef}
      aria-label="Main"
      className="relative z-40 flex flex-wrap items-center justify-center gap-1"
    >
      {groups.map((g) => {
        // A group with one destination is a link, not a menu — an extra click
        // to reach a single item is friction with nothing behind it.
        if (g.items.length === 1) {
          const only = g.items[0]!;
          const Icon = only.icon;
          return (
            <Link
              key={g.id}
              href={only.href}
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors',
                isActive(only.href)
                  ? 'bg-accent/15 text-accent'
                  : 'text-muted-foreground hover:bg-muted hover:text-fg',
              )}
            >
              <Icon aria-hidden className="h-3.5 w-3.5" />
              {only.label}
            </Link>
          );
        }

        const groupActive = g.items.some((i) => isActive(i.href));
        const expanded = open === g.id;

        return (
          <div key={g.id} className="relative shrink-0">
            <button
              type="button"
              aria-expanded={expanded}
              aria-haspopup="menu"
              onClick={() => setOpen(expanded ? null : g.id)}
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors',
                groupActive || expanded
                  ? 'bg-accent/15 text-accent'
                  : 'text-muted-foreground hover:bg-muted hover:text-fg',
              )}
            >
              {g.label}
              <ChevronDown aria-hidden className={cn('h-3 w-3 transition-transform', expanded && 'rotate-180')} />
            </button>

            {expanded ? (
              <div
                role="menu"
                // Above Leaflet's panes, which sit at 400 and would otherwise
                // swallow a menu opened over the incident map.
                className="absolute left-0 top-full z-[1200] mt-1 min-w-56 rounded-lg border border-border bg-bg-card p-1 shadow-2xl"
              >
                {g.items.map((i) => {
                  const Icon = i.icon;
                  return (
                    <Link
                      key={i.href}
                      href={i.href}
                      role="menuitem"
                      className={cn(
                        'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
                        isActive(i.href)
                          ? 'bg-accent/15 font-semibold text-accent'
                          : 'text-fg hover:bg-muted',
                      )}
                    >
                      <Icon aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
                      {i.label}
                    </Link>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
