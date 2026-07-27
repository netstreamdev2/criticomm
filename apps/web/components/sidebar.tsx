'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, PhoneCall, Radio, MapPinned, ShieldAlert, FlameKindling, Stethoscope,
  Mountain, FileText, Camera, Users, ClipboardCheck, BarChart3, Settings, ListChecks,
  CalendarClock, Bell, Briefcase, GraduationCap, Gauge, FolderClosed, Map, Bot, Menu, X,
  RadioTower, Filter, SlidersHorizontal, IdCard, Target,
} from 'lucide-react';
import { canAccess, type Silo, type UserRole } from '@criticom/db';
import { cn } from '@/lib/utils';

type Item = { href: string; label: string; icon: React.ComponentType<{ className?: string }> };
type Divider = { divider: string };

const ITEMS: Array<Item | Divider> = [
  { href: '/dashboard',             label: 'Dashboard',           icon: LayoutDashboard },
  { divider: 'Dispatch' },
  { href: '/dispatch/log-call',     label: 'Log Incoming Call',   icon: PhoneCall },
  { href: '/dispatch/pending',      label: 'Pending Queue',       icon: ListChecks },
  { href: '/dispatch/kpi',          label: 'KPI Dashboard',       icon: BarChart3 },
  { href: '/incidents',             label: 'All Incidents',       icon: MapPinned },
  { href: '/incidents/map',         label: 'Live Map',            icon: Map },
  { href: '/reports',               label: 'Reports Archive',     icon: FileText },
  { href: '/report-hub',            label: 'Report Hub',          icon: Filter },
  { href: '/case-manager',          label: 'Case Manager',        icon: FolderClosed },
  { href: '/dispatch/ptt',          label: 'PTT Radio',           icon: RadioTower },
  { href: '/notifications',         label: 'Notifications',       icon: Bell },
  { divider: 'Responder' },
  { href: '/responder',             label: 'My Incidents',        icon: Radio },
  { href: '/shift/mental-check',    label: 'Start of Shift',      icon: ClipboardCheck },
  { href: '/shift/unit-compliance', label: 'Unit Compliance',     icon: Gauge },
  { href: '/performance/mine',      label: 'My Performance',      icon: Target },
  { divider: 'Police' },
  { href: '/police',                label: 'Police Operations',   icon: ShieldAlert },
  { divider: 'Fire' },
  { href: '/fire',                  label: 'Fire & Rescue',       icon: FlameKindling },
  { divider: 'Medical' },
  { href: '/medical',               label: 'EMS',                 icon: Stethoscope },
  { divider: 'Disaster' },
  { href: '/disaster',              label: 'Disaster Mgmt',       icon: Mountain },
  { divider: 'Resources' },
  { href: '/roster',                label: 'Roster',              icon: CalendarClock },
  { href: '/roster/duty-sheet',     label: 'Duty Sheet',          icon: IdCard },
  { href: '/leave',                 label: 'Leave',               icon: Briefcase },
  { href: '/training',              label: 'Training',            icon: GraduationCap },
  { href: '/performance',           label: 'Performance',         icon: BarChart3 },
  { href: '/analytics',             label: 'Analytics',           icon: BarChart3 },
  { href: '/cameras',               label: 'Cameras & Feeds',     icon: Camera },
  { href: '/assistant',             label: 'Criti Assistant',     icon: Bot },
  { divider: 'Admin' },
  { href: '/admin',                 label: 'Admin',               icon: Users },
  { href: '/admin/config',          label: 'Configuration',       icon: SlidersHorizontal },
  { href: '/admin/personnel',       label: 'Personnel',           icon: IdCard },
  { href: '/profile',               label: 'Settings',            icon: Settings },
];

function NavList({ silo, role, onNavigate }: { silo: string; role: string; onNavigate?: () => void }) {
  const pathname = usePathname();

  // Same matrix the middleware enforces.
  const visible: Array<Item | Divider> = [];
  for (const item of ITEMS) {
    if ('divider' in item) { visible.push(item); continue; }
    if (canAccess(item.href, role as UserRole, silo as Silo)) visible.push(item);
  }
  const pruned = visible.filter((item, i) => {
    if (!('divider' in item)) return true;
    const next = visible[i + 1];
    return next !== undefined && !('divider' in next);
  });

  return (
    <nav className="flex-1 overflow-y-auto px-3 py-4">
      {pruned.map((item, i) => {
        if ('divider' in item) {
          return (
            <p key={`d-${i}`} className="mt-4 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {item.divider}
            </p>
          );
        }
        const Icon = item.icon;
        const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(`${item.href}/`));
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              'mt-1 flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
              active
                ? 'bg-primary/15 font-semibold text-white'
                : 'text-white/70 hover:bg-muted hover:text-white',
            )}
          >
            <Icon className={cn('h-4 w-4 shrink-0', active && 'text-primary')} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <div className="flex h-16 shrink-0 items-center border-b border-border px-5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/criticomm-logo.png" alt="CRITICOMM — All in One EMS Dispatch Software" className="max-h-9 w-auto" />
    </div>
  );
}

/** Desktop rail (lg+) + mobile drawer with hamburger trigger. */
export function Sidebar({ silo, role }: { silo: string; role: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Desktop rail */}
      <aside className="hidden h-screen flex-col border-r border-border bg-bg-soft lg:flex">
        <Brand />
        <NavList silo={silo} role={role} />
      </aside>

      {/* Mobile trigger — rendered into the top bar via fixed positioning */}
      <button
        type="button"
        aria-label="Open navigation"
        onClick={() => setOpen(true)}
        className="fixed left-3 top-3 z-40 inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-bg-soft lg:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/60"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-border bg-bg-soft shadow-2xl">
            <div className="flex h-16 items-center justify-between border-b border-border pl-5 pr-3">
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
