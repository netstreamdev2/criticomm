'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, Menu, X, Search } from 'lucide-react';
import { canAccess, type Silo, type UserRole } from '@criticom/db';
import type { DepartmentBranding } from '@criticom/api';
import { DeptBadge } from '@/components/dept-badge';
import { NAV_GROUPS } from '@/lib/nav';
import { cn } from '@/lib/utils';

/** Branding for the signed-in user's own department, resolved server-side. */
export type DeptIdentity = DepartmentBranding & { logoUrl: string | null };

const STORAGE_KEY = 'criticom:collapsed-nav-groups';

function NavList({
  silo, role, onNavigate,
}: {
  silo: string; role: string; onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState<string[]>([]);

  // Restore collapsed groups
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setCollapsed(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  const toggle = (id: string) => {
    setCollapsed((cur) => {
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  // Filter to what this role may access, then apply the search box.
  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return NAV_GROUPS.map((g) => ({
      ...g,
      items: g.items.filter(
        (i) =>
          canAccess(i.href, role as UserRole, silo as Silo) &&
          (!q || i.label.toLowerCase().includes(q) || (i.keywords ?? '').includes(q)),
      ),
    })).filter((g) => g.items.length > 0);
  }, [role, silo, filter]);

  const isActive = (href: string) =>
    pathname === href || (href !== '/dashboard' && pathname.startsWith(`${href}/`));

  return (
    <>
      <div className="px-3 pb-2 pt-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter menu…"
            aria-label="Filter navigation"
            className="h-8 w-full rounded-md border border-border bg-bg/60 pl-8 pr-2 text-xs text-fg placeholder:text-muted-foreground focus:border-accent focus:outline-none"
          />
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        {groups.length === 0 && (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">No matching pages.</p>
        )}
        {groups.map((g) => {
          // While filtering, always show results expanded.
          const isCollapsed = !filter && collapsed.includes(g.id);
          return (
            <div key={g.id} className="mb-1">
              <button
                type="button"
                onClick={() => toggle(g.id)}
                aria-expanded={!isCollapsed}
                className="flex w-full items-center justify-between rounded-md px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-fg"
              >
                {g.label}
                <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', isCollapsed && '-rotate-90')} />
              </button>

              {!isCollapsed && (
                <ul className="mt-0.5 space-y-0.5">
                  {g.items.map((item) => {
                    const Icon = item.icon;
                    const active = isActive(item.href);
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          onClick={onNavigate}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            'group relative flex items-center gap-3 rounded-md py-2 pl-3 pr-2 text-sm transition-all',
                            active
                              ? 'bg-primary/15 font-semibold text-fg'
                              : 'text-fg/70 hover:bg-muted hover:text-fg',
                          )}
                        >
                          {active && (
                            <span aria-hidden className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-primary" />
                          )}
                          <Icon className={cn('h-4 w-4 shrink-0 transition-colors', active ? 'text-primary' : 'text-muted-foreground group-hover:text-fg')} />
                          <span className="truncate">{item.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>
    </>
  );
}

function Brand({ dept }: { dept?: DeptIdentity }) {
  return (
    <div className="shrink-0 border-b border-border">
      <div className="flex h-16 items-center px-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/criticomm-logo.png"
          alt="CRITICOMM — All in One EMS Dispatch Software"
          className="max-h-9 w-auto"
        />
      </div>
      {/* Whose service this screen belongs to, in that service's own colour. */}
      {dept ? (
        <div
          className="flex items-center gap-2.5 px-5 py-2.5"
          style={{ background: `linear-gradient(90deg, ${dept.primary_color}1f, transparent 80%)` }}
        >
          <DeptBadge branding={dept} logoUrl={dept.logoUrl} size="xs" />
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-xs font-bold">{dept.short_name}</span>
            <span className="block truncate text-[10px] text-muted-foreground">{dept.official_name}</span>
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** Desktop rail (lg+) + mobile drawer. */
export function Sidebar({
  silo, role, dept,
}: {
  silo: string; role: string; dept?: DeptIdentity;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close the drawer whenever the route changes
  useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      <aside className="hidden h-screen flex-col border-r border-border bg-bg-soft lg:sticky lg:top-0 lg:flex">
        <Brand dept={dept} />
        <NavList silo={silo} role={role} />
      </aside>

      <button
        type="button"
        aria-label="Open navigation"
        onClick={() => setOpen(true)}
        className="fixed left-3 top-3 z-40 inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-bg-soft transition-colors hover:bg-muted lg:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button type="button" aria-label="Close navigation" className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-border bg-bg-soft shadow-2xl">
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-border pl-5 pr-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/criticomm-logo.png" alt="CRITICOMM" className="max-h-8 w-auto" />
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-muted"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <NavList silo={silo} role={role} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
