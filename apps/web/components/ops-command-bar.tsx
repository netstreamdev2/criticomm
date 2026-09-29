'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3, Camera, ChevronDown, ChevronUp, ExternalLink, Film, FolderClosed,
  Landmark, ListChecks, Map as MapIcon, Network, PhoneCall, Radio, RadioTower,
  Siren, Truck,
} from 'lucide-react';
import { canAccess, type Silo, type UserRole } from '@criticom/db';
import type { OpsLink } from '@criticom/api';
import { cn } from '@/lib/utils';

const COLLAPSE_KEY = 'criticom:ops-bar-collapsed';

/**
 * The internal module tier is code, not config — these are app routes and
 * their icons, filtered per role by the same matrix as the sidebar. The
 * external tier arrives from OpsLink config rows so the control room can
 * repoint or add systems without a deploy.
 */
const MODULES: Array<{
  href: string; label: string; icon: typeof Siren; tone?: string;
}> = [
  { href: '/dispatch/log-call', label: 'Dispatch', icon: Siren, tone: 'text-severity-medium-ink' },
  { href: '/dispatch/pending', label: 'Incoming', icon: PhoneCall, tone: 'text-severity-medium-ink' },
  { href: '/cameras', label: 'Surveillance', icon: Camera, tone: 'text-severity-medium-ink' },
  { href: '/cameras/footage', label: 'CCTV Footage', icon: Film, tone: 'text-accent' },
  { href: '/responder', label: 'Responder', icon: Truck, tone: 'text-severity-critical-ink' },
  { href: '/dispatch/kpi', label: 'KPI', icon: BarChart3, tone: 'text-accent' },
];

/** The OPERATIONS dropdown — command-and-control destinations. */
const OPERATIONS: Array<{ href: string; label: string; icon: typeof MapIcon }> = [
  { href: '/incidents/map', label: 'Live Map', icon: MapIcon },
  { href: '/incidents', label: 'All Incidents', icon: ListChecks },
  { href: '/case-manager', label: 'Case Manager', icon: FolderClosed },
  { href: '/dispatch/ptt', label: 'PTT Radio', icon: RadioTower },
  { href: '/hierarchy', label: 'Dept Hierarchy', icon: Network },
  { href: '/report-hub', label: 'Report Hub', icon: BarChart3 },
];

const CONTROLLER_SHORTCUTS = [
  { href: '/command', label: 'Command', icon: Radio },
  { href: '/dispatch/pending', label: 'Dispatch', icon: ListChecks },
  { href: '/incidents/map', label: 'Live Map', icon: MapIcon },
  { href: '/cameras', label: 'Surveillance', icon: Camera },
  { href: '/cameras/footage', label: 'CCTV Footage', icon: Film },
  { href: '/dispatch/ptt', label: 'PTT Radio', icon: RadioTower },
  { href: '/dispatch/kpi', label: 'KPIs', icon: BarChart3 },
];

const CAPTAIN_SHORTCUTS = [
  { href: '/dashboard', label: 'Overview', icon: Radio },
  { href: '/roster/allocation', label: 'Duty Board', icon: ListChecks },
  { href: '/incidents/map', label: 'Live Map', icon: MapIcon },
  { href: '/police', label: 'Police Ops', icon: Siren },
  { href: '/responder', label: 'My Incidents', icon: Truck },
  { href: '/shift/mental-check', label: 'Start Shift', icon: RadioTower },
];

const POLICE_OFFICER_SHORTCUTS = [
  { href: '/dashboard', label: 'Overview', icon: Radio },
  { href: '/responder', label: 'My Incidents', icon: Truck },
  { href: '/roster/mine', label: 'My Schedule', icon: ListChecks },
  { href: '/shift/mental-check', label: 'Start Shift', icon: Siren },
  { href: '/incidents/map', label: 'Live Map', icon: MapIcon },
  { href: '/police', label: 'Police Ops', icon: RadioTower },
];

export function OpsCommandBar({
  role, silo, links, hiddenHrefs = [],
}: {
  role: string; silo: string; links: OpsLink[]; hiddenHrefs?: string[];
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [opsOpen, setOpsOpen] = useState(false);
  const opsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      if (localStorage.getItem(COLLAPSE_KEY) === '1') setCollapsed(true);
    } catch { /* private mode */ }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try { localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1'); } catch { /* private mode */ }
      return !c;
    });
  };

  // The dropdown closes on outside click or route change.
  useEffect(() => {
    if (!opsOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!opsRef.current?.contains(e.target as Node)) setOpsOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [opsOpen]);
  useEffect(() => { setOpsOpen(false); }, [pathname]);

  const r = role as UserRole;
  const s = silo as Silo;
  const modules = MODULES.filter((m) => canAccess(m.href, r, s));
  const operations = OPERATIONS.filter((o) => canAccess(o.href, r, s));

  if (role === 'SystemController' || role === 'Captain' || ['Police', 'Officer', 'Metro'].includes(role)) {
    const shortcutItems = role === 'Captain' ? CAPTAIN_SHORTCUTS
      : role === 'SystemController' ? CONTROLLER_SHORTCUTS : POLICE_OFFICER_SHORTCUTS;
    const shortcuts = shortcutItems.filter((item) =>
      canAccess(item.href, r, s) && !hiddenHrefs.includes(item.href));
    return (
      <nav aria-label={role === 'Captain' ? 'Captain shortcuts' : role === 'SystemController' ? 'Controller shortcuts' : 'Officer shortcuts'} className="flex flex-wrap items-center justify-center gap-x-1 gap-y-0.5">
        {shortcuts.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'group relative inline-flex min-h-9 items-center gap-2 rounded-md px-3 text-[11px] font-bold uppercase tracking-[0.12em] text-fg/65 transition-colors hover:bg-accent/5 hover:text-fg',
                active && 'bg-accent/5 text-fg',
              )}
            >
              <Icon className={cn('h-4 w-4 text-accent/75 transition-colors group-hover:text-accent', active && 'text-accent')} aria-hidden />
              {item.label}
              {active && <span aria-hidden className="absolute inset-x-3 bottom-0 h-px bg-accent shadow-[0_0_9px_var(--accent)]" />}
            </Link>
          );
        })}
      </nav>
    );
  }

  // Nothing this role can use → no bar at all (e.g. a citizen account).
  if (modules.length === 0 && operations.length === 0 && links.length === 0) return null;

  return (
    <div className="min-w-0 flex-1">
      {!collapsed && (
        <div className="space-y-1">
          {/* ── External resources ── */}
          {links.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              {links.map((l) =>
                l.href ? (
                  l.external ? (
                    <a
                      key={l.id}
                      href={l.href}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-bg-card px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-fg/80 transition-colors hover:border-accent/50 hover:text-fg"
                    >
                      {l.glyph ? <span aria-hidden>{l.glyph}</span> : null}
                      {l.label}
                      <ExternalLink className="h-3 w-3 opacity-50" aria-hidden />
                    </a>
                  ) : (
                    <Link
                      key={l.id}
                      href={l.href}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-bg-card px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-fg/80 transition-colors hover:border-accent/50 hover:text-fg"
                    >
                      {l.glyph ? <span aria-hidden>{l.glyph}</span> : null}
                      {l.label}
                    </Link>
                  )
                ) : (
                  <span
                    key={l.id}
                    title="Awaiting its endpoint — set the URL under Admin → Configuration → OpsLink"
                    className="inline-flex cursor-not-allowed items-center rounded-lg border border-border/60 bg-bg-card/50 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground/60"
                  >
                    {l.label}
                  </span>
                ),
              )}
            </div>
          )}

          {/* ── Internal modules ── */}
          {(modules.length > 0 || operations.length > 0) && (
            <div className="flex flex-wrap items-center justify-center gap-2">
              {modules.map((m) => {
                const Icon = m.icon;
                const active = pathname.startsWith(m.href);
                return (
                  <Link
                    key={m.href}
                    href={m.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors',
                      active
                        ? 'border-accent/60 bg-accent/10 text-fg'
                        : 'border-border bg-bg-card text-fg/85 hover:border-accent/50 hover:text-fg',
                    )}
                  >
                    <Icon className={cn('h-4 w-4', m.tone)} aria-hidden />
                    {m.label}
                  </Link>
                );
              })}

              {operations.length > 0 && (
                <div className="relative" ref={opsRef}>
                  <button
                    type="button"
                    onClick={() => setOpsOpen((o) => !o)}
                    aria-expanded={opsOpen}
                    aria-haspopup="menu"
                    className="inline-flex items-center gap-2 rounded-lg border border-border bg-bg-card px-4 py-2 text-xs font-bold uppercase tracking-wider text-fg/85 transition-colors hover:border-accent/50 hover:text-fg"
                  >
                    <Landmark className="h-4 w-4 text-accent" aria-hidden />
                    Operations
                    <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', opsOpen && 'rotate-180')} aria-hidden />
                  </button>
                  {opsOpen && (
                    <div
                      role="menu"
                      className="absolute right-0 z-40 mt-1.5 w-52 overflow-hidden rounded-xl border border-border bg-bg-card shadow-2xl"
                    >
                      {operations.map((o) => {
                        const Icon = o.icon;
                        return (
                          <Link
                            key={o.href}
                            role="menuitem"
                            href={o.href}
                            className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm transition-colors hover:bg-muted"
                          >
                            <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
                            {o.label}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Collapse handle — a control room that wants the pixels back gets them. */}
      <button
        type="button"
        onClick={toggleCollapsed}
        aria-expanded={!collapsed}
        aria-label={collapsed ? 'Show command bar' : 'Hide command bar'}
        className="mx-auto flex w-full items-center justify-center gap-1 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 transition-colors hover:text-muted-foreground"
      >
        {collapsed
          ? <><ChevronDown className="h-3 w-3" aria-hidden /> Command bar <Radio className="h-3 w-3" aria-hidden /></>
          : <ChevronUp className="h-3 w-3" aria-hidden />}
      </button>
    </div>
  );
}
