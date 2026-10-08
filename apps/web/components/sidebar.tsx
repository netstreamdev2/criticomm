'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, ChevronDown, Menu, Target, X, Search } from 'lucide-react';
import { canAccess, type Silo, type UserRole } from '@criticom/db';
import type { DepartmentBranding } from '@criticom/api';
import { DeptBadge } from '@/components/dept-badge';
import { ALL_NAV_ITEMS, NAV_GROUPS, type NavGroup } from '@/lib/nav';
import { cn } from '@/lib/utils';

/** Branding for the signed-in user's own department, resolved server-side. */
export type DeptIdentity = DepartmentBranding & { logoUrl: string | null };

const STORAGE_KEY = 'criticom:collapsed-nav-groups';

// Super Admin works at the platform level. Keep this navigation separate from
// the department and responder menu without changing their route permissions.
const adminLink = (href: string, label?: string) => {
  const item = ALL_NAV_ITEMS.find((entry) => entry.href === href);
  if (!item) throw new Error(`Missing administration navigation route: ${href}`);
  return { ...item, label: label ?? item.label };
};

const SUPER_ADMIN_GROUPS: NavGroup[] = [
  {
    id: 'platform-overview', label: 'Platform', items: [
      adminLink('/dashboard', 'Overview'),
      adminLink('/admin/tenants', 'Organisations'),
      adminLink('/admin/status', 'System Status'),
    ],
  },
  {
    id: 'platform-governance', label: 'Governance', items: [
      adminLink('/admin', 'Users & Roles'),
      adminLink('/admin/access', 'Access Control'),
      adminLink('/admin/features', 'Features'),
    ],
  },
  {
    id: 'platform-settings', label: 'Platform Settings', items: [
      adminLink('/admin/integrations', 'Integrations'),
      adminLink('/admin/automations', 'Automations'),
      adminLink('/admin/operations', 'Operations Settings'),
      adminLink('/admin/departments', 'Department Branding'),
    ],
  },
  { id: 'platform-monitoring', label: 'Monitoring', items: [adminLink('/cameras'), adminLink('/cameras/footage')] },
  { id: 'platform-fines', label: 'Fines', items: [
    adminLink('/police/fines', 'Fines Register'),
    adminLink('/police/fines/payments', 'Import Payments'),
    adminLink('/police/fines/account', 'Account Look-up'),
    adminLink('/police/fines/offences', 'Charge Book'),
  ] },
  { id: 'account', label: 'Account', items: [adminLink('/profile', 'My Profile')] },
];

const SYSTEM_ADMIN_GROUPS: NavGroup[] = [
  {
    id: 'organisation-overview', label: 'Organisation', items: [
      adminLink('/dashboard', 'Overview'),
      adminLink('/command', 'Command Centre'),
      adminLink('/analytics', 'Analytics'),
      adminLink('/report-hub', 'Reports'),
      adminLink('/shift/today'),
      adminLink('/cameras'),
      adminLink('/cameras/footage'),
    ],
  },
  {
    id: 'organisation-resources', label: 'People & Resources', items: [
      adminLink('/admin', 'Users & Roles'),
      adminLink('/admin/personnel', 'Personnel'),
      adminLink('/admin/vehicles', 'Fleet'),
      adminLink('/police/armoury'),
      adminLink('/police/bodycams'),
      adminLink('/admin/devices', 'Devices'),
    ],
  },
  { id: 'organisation-fines', label: 'Fines', items: [
    adminLink('/police/fines', 'Fines Register'),
    adminLink('/police/fines/payments', 'Import Payments'),
    adminLink('/police/fines/account', 'Account Look-up'),
    adminLink('/police/fines/offences', 'Charge Book'),
  ] },
  {
    id: 'organisation-settings', label: 'Organisation Settings', items: [
      adminLink('/admin/config', 'Configuration'),
      adminLink('/admin/departments', 'Department Branding'),
      adminLink('/admin/integrations', 'Integrations'),
      adminLink('/admin/operations', 'Operations Settings'),
      adminLink('/admin/automations', 'Automations'),
    ],
  },
  { id: 'organisation-health', label: 'Health', items: [adminLink('/admin/status', 'System Status')] },
  { id: 'organisation-account', label: 'Account', items: [adminLink('/profile', 'My Profile')] },
];

const SUPERVISOR_GROUPS: NavGroup[] = [
  {
    id: 'supervisor-overview', label: 'Overview', items: [
      adminLink('/dashboard', 'Team Dashboard'),
      adminLink('/command', 'Command Board'),
    ],
  },
  {
    id: 'supervisor-team', label: 'Team & Duty', items: [
      adminLink('/shift/today'),
      adminLink('/roster/allocation', 'Duty Allocation'),
      adminLink('/roster', 'Roster'),
      adminLink('/roster/duty-sheet', 'Duty Sheet'),
      adminLink('/hr', 'Team Readiness'),
      adminLink('/attendance', 'Attendance'),
      adminLink('/leave', 'Leave Approvals'),
      adminLink('/training', 'Training'),
    ],
  },
  {
    id: 'supervisor-operations', label: 'Operations', items: [
      adminLink('/dispatch/pending', 'Pending Dispatch'),
      adminLink('/incidents', 'Incidents'),
      adminLink('/incidents/map', 'Live Map'),
      adminLink('/cameras'),
      adminLink('/duty-tasks', 'Duty Maintenance'),
      adminLink('/police/armoury'),
      adminLink('/police/bodycams'),
      adminLink('/report-hub', 'Reports'),
    ],
  },
  { id: 'supervisor-fines', label: 'Fines', items: [
    adminLink('/police/fines', 'Fines Register'),
    adminLink('/police/fines/payments', 'Import Payments'),
    adminLink('/police/fines/account', 'Account Look-up'),
    adminLink('/police/fines/offences', 'Charge Book'),
  ] },
  {
    id: 'supervisor-performance', label: 'Performance', items: [
      { href: '/performance/operational', label: 'Operational KPIs', icon: BarChart3 },
      { href: '/performance/plans', label: 'Appraisals', icon: Target },
      adminLink('/performance/reports', 'Performance Reports'),
    ],
  },
  {
    id: 'supervisor-account', label: 'Account', items: [
      adminLink('/notifications', 'Notifications'),
      adminLink('/profile', 'My Profile'),
    ],
  },
];

const CAPTAIN_GROUPS: NavGroup[] = [
  { id: 'captain-overview', label: 'Overview', items: [
    adminLink('/dashboard', 'Captain Dashboard'),
    adminLink('/command', 'Command Board'),
  ] },
  { id: 'captain-team', label: 'Team & Duty', items: [
    adminLink('/shift/today'),
    adminLink('/roster/allocation', 'Duty Allocation'),
    adminLink('/roster', 'Roster'),
    adminLink('/roster/duty-sheet', 'Duty Sheet'),
    adminLink('/hr', 'Team Readiness'),
    adminLink('/leave', 'Leave'),
    adminLink('/training', 'Training'),
  ] },
  { id: 'captain-operations', label: 'Police Operations', items: [
    adminLink('/police', 'Police Overview'),
    adminLink('/police/armoury'),
    adminLink('/police/bodycams'),
    adminLink('/incidents', 'Incidents'),
    adminLink('/incidents/map', 'Live Map'),
    adminLink('/cameras'),
    adminLink('/responder', 'My Incidents'),
    adminLink('/duty-tasks', 'Duty Maintenance'),
  ] },
  { id: 'captain-fines', label: 'Fines', items: [
    adminLink('/police/fines', 'Fines Register'),
    adminLink('/police/fines/payments', 'Import Payments'),
    adminLink('/police/fines/account', 'Account Look-up'),
    adminLink('/police/fines/offences', 'Charge Book'),
  ] },
  { id: 'captain-account', label: 'My Work', items: [
    adminLink('/roster/mine', 'My Schedule'),
    adminLink('/shift/mental-check', 'Start of Shift'),
    adminLink('/notifications', 'Notifications'),
    adminLink('/profile', 'My Profile'),
  ] },
];

const POLICE_OFFICER_GROUPS: NavGroup[] = [
  { id: 'officer-overview', label: 'My Work', items: [
    adminLink('/dashboard', 'Overview'),
    adminLink('/responder', 'My Incidents'),
    adminLink('/roster/mine', 'My Schedule'),
    adminLink('/roster/allocation', 'Published Duty Board'),
  ] },
  { id: 'officer-shift', label: 'On Shift', items: [
    adminLink('/shift/mental-check', 'Start of Shift'),
    adminLink('/duty-tasks', 'My Duty Tasks'),
    adminLink('/incidents/map', 'Live Map'),
  ] },
  { id: 'officer-police', label: 'Police', items: [
    adminLink('/police', 'Police Operations'),
    adminLink('/police/fines', 'Fines'),
    adminLink('/police/warrants', 'Warrants'),
    adminLink('/police/summons', 'Summons'),
    adminLink('/police/firearm-checks', 'Firearm Checks'),
  ] },
  { id: 'officer-account', label: 'Account', items: [
    adminLink('/leave', 'Leave'),
    adminLink('/performance/mine', 'My Performance'),
    adminLink('/notifications', 'Notifications'),
    adminLink('/profile', 'My Profile'),
  ] },
];

const DISPATCHER_GROUPS: NavGroup[] = [
  {
    id: 'dispatcher-overview', label: 'Overview', items: [
      adminLink('/dashboard', 'Dispatch Dashboard'),
    ],
  },
  {
    id: 'dispatcher-live', label: 'Live Dispatch', items: [
      adminLink('/dispatch/pending', 'Pending Queue'),
      adminLink('/incidents', 'Incidents'),
      adminLink('/incidents/map', 'Live Map'),
      adminLink('/cameras'),
      adminLink('/dispatch/ptt', 'PTT Radio'),
    ],
  },
  {
    id: 'dispatcher-support', label: 'Duty & Reporting', items: [
      adminLink('/roster/allocation', 'Duty Board'),
      adminLink('/dispatch/kpi', 'Dispatch KPIs'),
      adminLink('/report-hub', 'Reports'),
      adminLink('/cameras/footage'),
      adminLink('/sanral'),
    ],
  },
  {
    id: 'dispatcher-account', label: 'Account', items: [
      adminLink('/notifications', 'Notifications'),
      adminLink('/profile', 'My Profile'),
    ],
  },
];

// The intake desk (Operations Manual ch. 10): Log Incoming Call is the primary
// screen, everything else is look-up and self-service. No dispatch queue —
// routing is the dispatch desk's job.
const INCIDENT_LOGGER_GROUPS: NavGroup[] = [
  { id: 'logger-intake', label: 'Call Intake', items: [
    adminLink('/dispatch/log-call', 'Log Incoming Call'),
    adminLink('/dashboard', 'Intake Dashboard'),
  ] },
  { id: 'logger-incidents', label: 'Incidents', items: [
    adminLink('/incidents', 'Incidents'),
    adminLink('/incidents/map', 'Live Map'),
    adminLink('/case-manager', 'Case Manager'),
  ] },
  { id: 'logger-monitoring', label: 'Monitoring', items: [
    adminLink('/sanral'),
  ] },
  { id: 'logger-reports', label: 'Reports', items: [
    adminLink('/report-hub', 'Report Hub'),
    adminLink('/reports', 'Reports'),
    adminLink('/reports/builder', 'Report Builder'),
  ] },
  { id: 'logger-account', label: 'My Work', items: [
    adminLink('/roster/mine', 'My Schedule'),
    adminLink('/roster/allocation', 'Duty Board'),
    adminLink('/leave', 'Leave'),
    adminLink('/performance/mine', 'My Performance'),
    adminLink('/hierarchy', 'Hierarchy'),
    adminLink('/notifications', 'Notifications'),
    adminLink('/profile', 'My Profile'),
  ] },
];

const SYSTEM_CONTROLLER_GROUPS: NavGroup[] = [
  { id: 'controller-command', label: 'Command', items: [
    adminLink('/command', 'Command Centre'),
    adminLink('/dispatch/pending', 'Pending Dispatch'),
    adminLink('/incidents', 'Incidents'),
    adminLink('/incidents/map', 'Live Map'),
  ] },
  { id: 'controller-monitoring', label: 'Monitoring', items: [
    adminLink('/cameras'),
    adminLink('/cameras/footage'),
    adminLink('/sanral'),
    adminLink('/dispatch/ptt', 'PTT Radio'),
    adminLink('/dispatch/kpi', 'Dispatch KPIs'),
  ] },
  { id: 'controller-duty', label: 'Duty & People', items: [
    adminLink('/shift/today'),
    adminLink('/roster/allocation', 'Duty Allocation'),
    adminLink('/roster', 'Roster'),
    adminLink('/duty-tasks', 'Duty Maintenance'),
    adminLink('/attendance', 'Attendance'),
    adminLink('/leave', 'Leave'),
  ] },
  { id: 'controller-fines', label: 'Fines', items: [
    adminLink('/police/fines', 'Fines Register'),
    adminLink('/police/fines/payments', 'Import Payments'),
    adminLink('/police/fines/account', 'Account Look-up'),
    adminLink('/police/fines/offences', 'Charge Book'),
  ] },
  { id: 'controller-reports', label: 'Reports', items: [
    adminLink('/report-hub', 'Report Hub'),
    adminLink('/analytics', 'Analytics'),
  ] },
  { id: 'controller-systems', label: 'Operational Systems', items: [
    adminLink('/admin/personnel', 'Personnel'),
    adminLink('/admin/vehicles', 'Fleet'),
    adminLink('/police/armoury'),
    adminLink('/admin/devices', 'Devices'),
    adminLink('/admin/integrations', 'Integrations'),
    adminLink('/admin/status', 'System Status'),
  ] },
  { id: 'controller-account', label: 'Account', items: [
    adminLink('/notifications', 'Notifications'),
    adminLink('/profile', 'My Profile'),
  ] },
];

function NavList({
  silo, role, onNavigate, hiddenHrefs = [],
}: {
  silo: string; role: string; onNavigate?: () => void; hiddenHrefs?: string[];
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
    const sourceGroups = role === 'SuperAdmin' ? SUPER_ADMIN_GROUPS
      : role === 'SystemAdmin' ? SYSTEM_ADMIN_GROUPS
      : role === 'Supervisor' ? SUPERVISOR_GROUPS
      : role === 'Captain' ? CAPTAIN_GROUPS
      : role === 'Police' ? POLICE_OFFICER_GROUPS
      : role === 'Dispatcher' ? DISPATCHER_GROUPS
      : role === 'IncidentLogger' ? INCIDENT_LOGGER_GROUPS
      : role === 'SystemController' ? SYSTEM_CONTROLLER_GROUPS : NAV_GROUPS;
    return sourceGroups.map((g) => ({
      ...g,
      items: g.items.filter(
        (i) =>
          canAccess(i.href, role as UserRole, silo as Silo) && !hiddenHrefs.includes(i.href) &&
          (!q || i.label.toLowerCase().includes(q) || (i.keywords ?? '').includes(q)),
      ),
    })).filter((g) => g.items.length > 0);
  }, [role, silo, filter]);

  const activeHref = groups
    .flatMap((group) => group.items)
    .map((item) => item.href)
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];
  const isActive = (href: string) => href === activeHref;

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

function Brand({ dept, role, tenantName }: { dept?: DeptIdentity; role: string; tenantName?: string }) {
  return (
    <div className="shrink-0 border-b border-border">
      <div className="flex h-16 items-center px-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/hiktech-brand.svg"
          alt="HIKTECH"
          className="h-auto w-[190px] max-w-full rounded-md bg-white p-2"
        />
      </div>
      {/* Whose service this screen belongs to, in that service's own colour. */}
      {role === 'SuperAdmin' ? (
        <div className="border-t border-border px-5 py-3">
          <span className="block text-xs font-bold text-fg">Platform Administration</span>
          <span className="block text-[10px] text-muted-foreground">All organisations</span>
        </div>
      ) : role === 'SystemAdmin' ? (
        <div className="border-t border-border px-5 py-3">
          <span className="block text-xs font-bold text-fg">Organisation Administration</span>
          <span className="block truncate text-[10px] text-muted-foreground">{tenantName ?? 'Your organisation'}</span>
        </div>
      ) : role === 'Supervisor' ? (
        <div className="border-t border-border px-5 py-3">
          <span className="block text-xs font-bold text-fg">Team Supervision</span>
          <span className="block truncate text-[10px] text-muted-foreground">{tenantName ?? 'Your organisation'}</span>
        </div>
      ) : role === 'Captain' ? (
        <div className="border-t border-border px-5 py-3">
          <span className="block text-xs font-bold text-fg">Metro Police Captain</span>
          <span className="block truncate text-[10px] text-muted-foreground">{tenantName ?? 'Your organisation'}</span>
        </div>
      ) : role === 'SystemController' ? (
        <div className="border-t border-border px-5 py-3">
          <span className="block text-xs font-bold text-fg">System Controller</span>
          <span className="block truncate text-[10px] text-muted-foreground">All departments · {tenantName ?? 'Your organisation'}</span>
        </div>
      ) : dept ? (
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
  silo, role, dept, tenantName, hiddenHrefs = [],
}: {
  silo: string; role: string; dept?: DeptIdentity; tenantName?: string; hiddenHrefs?: string[];
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close the drawer whenever the route changes
  useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      <aside className="hidden h-screen flex-col border-r border-border bg-bg-soft lg:sticky lg:top-0 lg:flex">
        <Brand dept={dept} role={role} tenantName={tenantName} />
        <NavList silo={silo} role={role} hiddenHrefs={hiddenHrefs} />
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
              <img src="/hiktech-brand.svg" alt="HIKTECH" className="h-auto w-[190px] max-w-full rounded-md bg-white p-2" />
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-muted"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {role === 'SuperAdmin' && (
              <div className="border-b border-border px-5 py-3">
                <span className="block text-xs font-bold text-fg">Platform Administration</span>
                <span className="block text-[10px] text-muted-foreground">All organisations</span>
              </div>
            )}
            {role === 'SystemAdmin' && (
              <div className="border-b border-border px-5 py-3">
                <span className="block text-xs font-bold text-fg">Organisation Administration</span>
                <span className="block truncate text-[10px] text-muted-foreground">{tenantName ?? 'Your organisation'}</span>
              </div>
            )}
            {role === 'Supervisor' && (
              <div className="border-b border-border px-5 py-3">
                <span className="block text-xs font-bold text-fg">Team Supervision</span>
                <span className="block truncate text-[10px] text-muted-foreground">{tenantName ?? 'Your organisation'}</span>
              </div>
            )}
            {role === 'Captain' && (
              <div className="border-b border-border px-5 py-3">
                <span className="block text-xs font-bold text-fg">Metro Police Captain</span>
                <span className="block truncate text-[10px] text-muted-foreground">{tenantName ?? 'Your organisation'}</span>
              </div>
            )}
            {role === 'SystemController' && (
              <div className="border-b border-border px-5 py-3">
                <span className="block text-xs font-bold text-fg">System Controller</span>
                <span className="block truncate text-[10px] text-muted-foreground">All departments · {tenantName ?? 'Your organisation'}</span>
              </div>
            )}
            <NavList silo={silo} role={role} hiddenHrefs={hiddenHrefs} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
