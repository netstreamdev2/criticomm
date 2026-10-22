'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, Check, ChevronDown, Menu, PanelLeft, Target, X, Search } from 'lucide-react';
import { canAccess, type Silo, type UserRole } from '@criticom/db';
import type { DepartmentBranding } from '@criticom/api';
// The dependency-free case module only: this is a client component.
import { DEPARTMENT_LABELS } from '@criticom/api/cases';
import { DeptBadge } from '@/components/dept-badge';
import {
  ALL_NAV_ITEMS, NAV_GROUPS, POLICE_OPERATIONS, isDisasterDesk, isDoctor, isEmsAdmin, isFireCommand, isPoliceAdmin, type NavGroup, type NavItem,
} from '@/lib/nav';
import { cn } from '@/lib/utils';
import { SIDEBAR_MODES, SIDEBAR_MODE_KEY, columnWidth, isSidebarMode, type SidebarMode } from '@/lib/sidebar-mode';
import { useT } from '@/components/i18n';

/** Branding for the signed-in user's own department, resolved server-side. */
export type DeptIdentity = DepartmentBranding & { logoUrl: string | null };

const STORAGE_KEY = 'criticom:collapsed-nav-groups';
const EXPANDED_KEY = 'criticom:expanded-nav-items';

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
      adminLink('/police/report-centre', 'Police Reports'),
      adminLink('/shift/today'),
      adminLink('/cameras'),
      adminLink('/cameras/footage'),
      adminLink('/dispatch/ptt', 'Radio Desk'),
    ],
  },
  {
    id: 'organisation-cases', label: 'Incidents & Cases', items: [
      adminLink('/incidents', 'All Incidents'),
      adminLink('/case-manager', 'Case Management'),
      adminLink('/case-manager/review', 'Awaiting Review'),
    ],
  },
  {
    id: 'organisation-resources', label: 'People & Resources', items: [
      adminLink('/admin', 'Users & Roles'),
      adminLink('/modules/staff', 'Staff'),
      adminLink('/modules/duty-maintenance', 'Duty Roster'),
      adminLink('/modules', 'System Modules'),
      adminLink('/leave', 'Leave'),
      adminLink('/hr', 'HR Centre'),
      adminLink('/admin/vehicles', 'Fleet'),
      adminLink('/admin/devices', 'Devices'),
      adminLink('/admin/radios', 'Radios'),
    ],
  },
  { id: 'organisation-police', label: 'Police', items: [POLICE_OPERATIONS] },
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
      adminLink('/modules/duty-maintenance', 'Duty Roster'),
      adminLink('/modules', 'System Modules'),
      adminLink('/hr', 'Team Readiness'),
      adminLink('/attendance', 'Attendance'),
      adminLink('/leave', 'Leave Approvals'),
      adminLink('/roster/mine', 'My Schedule'),
      adminLink('/training', 'Training'),
    ],
  },
  {
    id: 'supervisor-operations', label: 'Operations', items: [
      adminLink('/dispatch/pending', 'Pending Dispatch'),
      adminLink('/incidents', 'Incidents'),
      adminLink('/incidents/map', 'Live Map'),
      adminLink('/responder/monitor', 'Active Responders'),
      adminLink('/case-manager/review', 'Reports to Review'),
      adminLink('/cameras'),
      adminLink('/duty-tasks', 'Station Tasks'),
      adminLink('/report-hub', 'Reports'),
    ],
  },
  { id: 'supervisor-police', label: 'Police', items: [POLICE_OPERATIONS] },
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
    adminLink('/modules/duty-maintenance', 'Duty Roster'),
    adminLink('/modules', 'System Modules'),
    adminLink('/hr', 'Team Readiness'),
    adminLink('/leave', 'Leave Approvals'),
    adminLink('/training', 'Training'),
  ] },
  { id: 'captain-operations', label: 'Operations', items: [
    POLICE_OPERATIONS,
    adminLink('/police/report-centre', 'Police Reports'),
    adminLink('/incidents', 'Incidents'),
    adminLink('/incidents/map', 'Live Map'),
    adminLink('/responder/monitor', 'Active Responders'),
    adminLink('/case-manager/review', 'Reports to Review'),
    adminLink('/cameras'),
    adminLink('/responder', 'My Incidents'),
    adminLink('/duty-tasks', 'Station Tasks'),
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
    adminLink('/modules', 'System Modules'),
    adminLink('/roster/allocation', 'Published Duty Board'),
  ] },
  { id: 'officer-shift', label: 'On Shift', items: [
    adminLink('/shift/mental-check', 'Start of Shift'),
    adminLink('/duty-tasks', 'My Duty Tasks'),
    adminLink('/incidents/map', 'Live Map'),
    adminLink('/responder/monitor', 'Active Responders'),
  ] },
  { id: 'officer-police', label: 'Police', items: [POLICE_OPERATIONS] },
  { id: 'officer-account', label: 'Account', items: [
    adminLink('/leave', 'Leave'),
    adminLink('/performance/mine', 'My Performance'),
    adminLink('/notifications', 'Notifications'),
    adminLink('/profile', 'My Profile'),
  ] },
];

// Case management (0061): the end of a call's life. A resolved call waits
// here for its report to be read; the case manager closes it. Live calls and
// the archive are for context: cancelling a live call is the desk's job.
const CASE_MANAGER_GROUPS: NavGroup[] = [
  { id: 'cases-work', label: 'Case Management', items: [
    adminLink('/case-manager', 'Case Dashboard'),
    adminLink('/case-manager/review'),
    adminLink('/case-manager/open'),
    adminLink('/case-manager/closed'),
    adminLink('/case-manager/audit'),
    adminLink('/police/report-centre', 'Police Reports'),
  ] },
  { id: 'cases-incidents', label: 'Incidents', items: [
    adminLink('/incidents', 'All Incidents'),
    adminLink('/incidents/map', 'Live Map'),
    adminLink('/responder/monitor', 'Active Responders'),
  ] },
  { id: 'cases-evidence', label: 'Evidence & Exports', items: [
    adminLink('/cameras/footage'),
    adminLink('/report-hub', 'Report Hub'),
  ] },
  { id: 'cases-account', label: 'Account', items: [
    adminLink('/notifications', 'Notifications'),
    adminLink('/roster/mine', 'My Schedule'),
    adminLink('/leave', 'Leave'),
    adminLink('/profile', 'My Profile'),
  ] },
];

// The EMS administrator: their department's calls, patient records, ambulances,
// crews and settings, and nothing from the other services.
const EMS_ADMIN_GROUPS: NavGroup[] = [
  { id: 'ems-overview', label: 'Overview', items: [
    adminLink('/dashboard', 'EMS Dashboard'),
    adminLink('/medical', 'EMS Operations'),
  ] },
  { id: 'ems-patients', label: 'Patient Care', items: [
    adminLink('/medical/pcr'),
    adminLink('/medical/handovers'),
    adminLink('/incidents', 'EMS Incidents'),
    adminLink('/incidents/map', 'Live Map'),
    adminLink('/responder/monitor', 'Active Responders'),
  ] },
  { id: 'ems-fleet', label: 'Ambulances & Shift', items: [
    adminLink('/admin/vehicles', 'Ambulances'),
    adminLink('/medical/restock'),
    adminLink('/shift/today'),
    adminLink('/shift/unit-compliance'),
    adminLink('/shift/readiness-review'),
    adminLink('/admin/devices', 'Devices'),
    adminLink('/admin/radios', 'Radios'),
  ] },
  { id: 'ems-people', label: 'Crews', items: [
    adminLink('/admin', 'Users & Roles'),
    adminLink('/modules/staff', 'Staff'),
    adminLink('/modules/duty-maintenance', 'Duty Roster'),
    adminLink('/modules', 'System Modules'),
    adminLink('/leave', 'Leave'),
    adminLink('/training', 'Training'),
    adminLink('/attendance', 'Attendance'),
  ] },
  { id: 'ems-reports', label: 'Reports', items: [
    adminLink('/report-hub', 'Report Hub'),
    adminLink('/analytics', 'Analytics'),
  ] },
  { id: 'ems-account', label: 'Settings & Account', items: [
    adminLink('/admin/config', 'Configuration'),
    adminLink('/notifications', 'Notifications'),
    adminLink('/profile', 'My Profile'),
  ] },
];

// The Metro Police (or Control Room) administrator: their department's
// operations, people, fleet and settings.
const POLICE_ADMIN_GROUPS: NavGroup[] = [
  { id: 'padmin-overview', label: 'Overview', items: [
    adminLink('/dashboard', 'Dashboard'),
    adminLink('/command', 'Command Board'),
    adminLink('/analytics', 'Analytics'),
  ] },
  { id: 'padmin-operations', label: 'Operations', items: [
    POLICE_OPERATIONS,
    adminLink('/incidents', 'Incidents'),
    adminLink('/incidents/map', 'Live Map'),
    adminLink('/responder/monitor', 'Active Responders'),
    adminLink('/case-manager/review', 'Reports to Review'),
    adminLink('/cameras'),
    adminLink('/report-hub', 'Reports'),
    adminLink('/police/report-centre', 'Police Reports'),
    adminLink('/dispatch/ptt', 'Radio Desk'),
  ] },
  { id: 'padmin-people', label: 'People & Duty', items: [
    adminLink('/admin', 'Users & Roles'),
    adminLink('/modules/staff', 'Staff'),
    adminLink('/shift/today'),
    adminLink('/modules/duty-maintenance', 'Duty Roster'),
    adminLink('/modules', 'System Modules'),
    adminLink('/leave', 'Leave'),
    adminLink('/hr', 'HR Centre'),
    adminLink('/training', 'Training'),
    adminLink('/attendance', 'Attendance'),
  ] },
  { id: 'padmin-fleet', label: 'Fleet & Devices', items: [
    adminLink('/admin/vehicles', 'Fleet'),
    adminLink('/admin/devices', 'Devices'),
    adminLink('/admin/radios', 'Radios'),
  ] },
  { id: 'padmin-account', label: 'Settings & Account', items: [
    adminLink('/admin/config', 'Configuration'),
    adminLink('/notifications', 'Notifications'),
    adminLink('/profile', 'My Profile'),
  ] },
];

// Fire command (Fire Chief, Fire & Rescue admin): fire operations, appliances,
// crews and settings. Admin-only pages drop out for the Chief by access rule.
const FIRE_COMMAND_GROUPS: NavGroup[] = [
  { id: 'fire-overview', label: 'Overview', items: [adminLink('/fire', 'Fire Dashboard')] },
  { id: 'fire-operations', label: 'Fire Operations', items: [
    adminLink('/fire/reports'),
    adminLink('/fire/inspections'),
    adminLink('/fire/hydrants'),
    adminLink('/fire/pir'),
    adminLink('/incidents', 'Fire Incidents'),
    adminLink('/incidents/map', 'Live Map'),
    adminLink('/responder/monitor', 'Active Responders'),
  ] },
  { id: 'fire-fleet', label: 'Appliances & Shift', items: [
    adminLink('/admin/vehicles', 'Appliances'),
    adminLink('/shift/today'),
    adminLink('/shift/unit-compliance'),
    adminLink('/shift/readiness-review'),
    adminLink('/admin/devices', 'Devices'),
    adminLink('/admin/radios', 'Radios'),
  ] },
  { id: 'fire-people', label: 'Crews', items: [
    adminLink('/admin', 'Users & Roles'),
    adminLink('/modules/staff', 'Staff'),
    adminLink('/modules/duty-maintenance', 'Duty Roster'),
    adminLink('/modules', 'System Modules'),
    adminLink('/leave', 'Leave'),
    adminLink('/training', 'Training'),
    adminLink('/attendance', 'Attendance'),
  ] },
  { id: 'fire-reports', label: 'Reports', items: [adminLink('/report-hub', 'Report Hub'), adminLink('/analytics', 'Analytics')] },
  { id: 'fire-account', label: 'Settings & Account', items: [
    adminLink('/admin/config', 'Configuration'),
    adminLink('/notifications', 'Notifications'),
    adminLink('/profile', 'My Profile'),
  ] },
];

// The Disaster Management desk (officers and admin): deployments, after-action
// reports, partners, crews and settings.
const DISASTER_GROUPS: NavGroup[] = [
  { id: 'disaster-overview', label: 'Overview', items: [adminLink('/disaster', 'Disaster Dashboard')] },
  { id: 'disaster-operations', label: 'Operations', items: [
    adminLink('/disaster/dispatch'),
    adminLink('/disaster/post-mortem'),
    adminLink('/disaster/partners'),
    adminLink('/incidents', 'Disaster Incidents'),
    adminLink('/incidents/map', 'Live Map'),
    adminLink('/responder/monitor', 'Active Responders'),
  ] },
  { id: 'disaster-people', label: 'Shift & Crews', items: [
    adminLink('/shift/today'),
    adminLink('/shift/readiness-review'),
    adminLink('/admin', 'Users & Roles'),
    adminLink('/modules/staff', 'Staff'),
    adminLink('/modules/duty-maintenance', 'Duty Roster'),
    adminLink('/modules', 'System Modules'),
    adminLink('/leave', 'Leave'),
    adminLink('/training', 'Training'),
    adminLink('/attendance', 'Attendance'),
  ] },
  { id: 'disaster-reports', label: 'Reports', items: [adminLink('/report-hub', 'Report Hub'), adminLink('/analytics', 'Analytics')] },
  { id: 'disaster-account', label: 'Settings & Account', items: [
    adminLink('/admin/config', 'Configuration'),
    adminLink('/notifications', 'Notifications'),
    adminLink('/profile', 'My Profile'),
  ] },
];

// The receiving doctor: the patients EMS handed over, and their reports.
const DOCTOR_GROUPS: NavGroup[] = [
  { id: 'doctor-patients', label: 'Patients', items: [
    adminLink('/medical/handovers'),
    adminLink('/medical/pcr'),
  ] },
  { id: 'doctor-account', label: 'Account', items: [
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
      adminLink('/responder/monitor', 'Active Responders'),
      adminLink('/cameras'),
      adminLink('/dispatch/ptt', 'Radio Desk'),
    ],
  },
  {
    id: 'dispatcher-support', label: 'Duty & Reporting', items: [
      adminLink('/roster/allocation', 'Duty Board'),
      adminLink('/dispatch/kpi', 'Dispatch KPIs'),
      adminLink('/report-hub', 'Reports'),
      adminLink('/police/report-centre', 'Police Reports'),
      adminLink('/cameras/footage'),
      adminLink('/sanral'),
    ],
  },
  {
    id: 'dispatcher-account', label: 'Account', items: [
      adminLink('/roster/mine', 'My Schedule'),
      adminLink('/leave', 'Leave'),
      adminLink('/notifications', 'Notifications'),
      adminLink('/profile', 'My Profile'),
    ],
  },
];

// The call logger (the intake desk, Operations Manual ch. 10): four things and
// no more — the dashboard, logging a call, the history of the calls they
// logged, and My work. Every other page is refused by the server
// (CALL_LOGGER_PAGES in @criticom/db/roles).
const INCIDENT_LOGGER_GROUPS: NavGroup[] = [
  { id: 'logger-intake', label: 'Calls', items: [
    adminLink('/dashboard', 'Dashboard'),
    adminLink('/dispatch/log-call', 'Log Incoming Call'),
    adminLink('/dispatch/log-history', 'Log History'),
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

// The control room: the chair that both takes calls and dispatches them, for
// every department (a department's control room, for its own). Its work is
// live calls; administration, HR and department records are not on it.
const CONTROL_ROOM_GROUPS: NavGroup[] = [
  { id: 'control-overview', label: 'Overview', items: [
    adminLink('/dashboard', 'Control Room Dashboard'),
  ] },
  { id: 'control-calls', label: 'Calls', items: [
    adminLink('/dispatch/log-call', 'Log Incoming Call'),
    adminLink('/dispatch/pending', 'Pending Queue'),
    adminLink('/incidents', 'Incidents'),
    adminLink('/incidents/map', 'Live Map'),
    adminLink('/responder/monitor', 'Active Responders'),
  ] },
  { id: 'control-monitoring', label: 'Monitoring', items: [
    adminLink('/cameras'),
    adminLink('/sanral'),
    adminLink('/dispatch/ptt', 'Radio Desk'),
  ] },
  { id: 'control-reporting', label: 'Duty & Reporting', items: [
    adminLink('/roster/allocation', 'Duty Board'),
    adminLink('/dispatch/kpi', 'Dispatch KPIs'),
    adminLink('/report-hub', 'Reports'),
    adminLink('/cameras/footage'),
  ] },
  { id: 'control-account', label: 'My Work', items: [
    adminLink('/roster/mine', 'My Schedule'),
    adminLink('/leave', 'Leave'),
    adminLink('/performance/mine', 'My Performance'),
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
    adminLink('/responder/monitor', 'Active Responders'),
    adminLink('/case-manager', 'Case Management'),
  ] },
  { id: 'controller-monitoring', label: 'Monitoring', items: [
    adminLink('/cameras'),
    adminLink('/cameras/footage'),
    adminLink('/sanral'),
    adminLink('/dispatch/ptt', 'Radio Desk'),
    adminLink('/dispatch/kpi', 'Dispatch KPIs'),
  ] },
  { id: 'controller-duty', label: 'Duty & People', items: [
    adminLink('/shift/today'),
    adminLink('/modules', 'System Modules'),
    adminLink('/modules/duty-maintenance', 'Duty Roster'),
    adminLink('/duty-tasks', 'Station Tasks'),
    adminLink('/attendance', 'Attendance'),
    adminLink('/leave', 'Leave'),
  ] },
  { id: 'controller-police', label: 'Police', items: [POLICE_OPERATIONS] },
  { id: 'controller-reports', label: 'Reports', items: [
    adminLink('/report-hub', 'Report Hub'),
    adminLink('/police/report-centre', 'Police Reports'),
    adminLink('/analytics', 'Analytics'),
  ] },
  { id: 'controller-systems', label: 'Operational Systems', items: [
    adminLink('/modules/staff', 'Staff'),
    adminLink('/admin/vehicles', 'Fleet'),
    adminLink('/admin/devices', 'Devices'),
    adminLink('/admin/radios', 'Radios'),
    adminLink('/admin/integrations', 'Integrations'),
    adminLink('/admin/status', 'System Status'),
  ] },
  { id: 'controller-account', label: 'Account', items: [
    adminLink('/notifications', 'Notifications'),
    adminLink('/profile', 'My Profile'),
  ] },
];

/** Every page in a menu entry and the entries under it. */
const hrefsOf = (item: NavItem): string[] => [item.href, ...(item.children ?? []).flatMap(hrefsOf)];

/**
 * The part of an entry this viewer may open and that matches the menu filter.
 * A parent stays when any page under it does; a parent whose own name matches
 * keeps all of its pages.
 */
function visibleItem(item: NavItem, allowed: (i: NavItem) => boolean, q: string): NavItem | null {
  const matches = (i: NavItem) => !q || i.label.toLowerCase().includes(q) || (i.keywords ?? '').includes(q);
  if (!item.children) return allowed(item) && matches(item) ? item : null;
  const childQuery = matches(item) ? '' : q;
  const children = item.children.map((c) => visibleItem(c, allowed, childQuery)).filter((c): c is NavItem => c !== null);
  return children.length ? { ...item, children } : null;
}

function NavList({
  silo, role, onNavigate, hiddenHrefs = [], narrow = false,
}: {
  silo: string; role: string; onNavigate?: () => void; hiddenHrefs?: string[];
  /** The collapsed rail: icons only, each named on hover. */
  narrow?: boolean;
}) {
  const { t } = useT();
  const pathname = usePathname();
  const [filter, setFilter] = useState('');
  // On the rail, an entry with pages under it opens them beside the rail.
  const [fly, setFly] = useState<{ key: string; top: number; item: NavItem } | null>(null);
  useEffect(() => setFly(null), [pathname, narrow]);
  useEffect(() => {
    if (!fly) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFly(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fly]);
  const [collapsed, setCollapsed] = useState<string[]>([]);

  // Restore collapsed groups
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setCollapsed(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  // Expandable entries (Police Operations, its Reports): open while a page
  // inside is showing, unless the officer closed it; remembered per browser.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try {
      const raw = localStorage.getItem(EXPANDED_KEY);
      if (raw) setExpanded(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);
  const toggleItem = (key: string, open: boolean) => {
    setExpanded((cur) => {
      const next = { ...cur, [key]: !open };
      try { localStorage.setItem(EXPANDED_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

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
    const sourceGroups = isEmsAdmin(role, silo) ? EMS_ADMIN_GROUPS
      : isDoctor(role) ? DOCTOR_GROUPS
      : isFireCommand(role, silo) ? FIRE_COMMAND_GROUPS
      : isDisasterDesk(role, silo) ? DISASTER_GROUPS
      : isPoliceAdmin(role, silo) ? POLICE_ADMIN_GROUPS
      : role === 'SuperAdmin' ? SUPER_ADMIN_GROUPS
      : role === 'SystemAdmin' ? SYSTEM_ADMIN_GROUPS
      : role === 'Supervisor' ? SUPERVISOR_GROUPS
      : role === 'Captain' ? CAPTAIN_GROUPS
      : role === 'Police' ? POLICE_OFFICER_GROUPS
      : role === 'Dispatcher' ? DISPATCHER_GROUPS
      : role === 'IncidentLogger' ? INCIDENT_LOGGER_GROUPS
      : role === 'ControlRoom' ? CONTROL_ROOM_GROUPS
      : role === 'CaseManager' ? CASE_MANAGER_GROUPS
      : role === 'SystemController' ? SYSTEM_CONTROLLER_GROUPS : NAV_GROUPS;
    const allowed = (i: NavItem) => canAccess(i.href, role as UserRole, silo as Silo) && !hiddenHrefs.includes(i.href);
    // The menu in the person's language (the labels are in the word list:
    // packages/db/src/i18n/extract.ts reads them from this file and lib/nav.ts).
    const say = (i: NavItem): NavItem => ({ ...i, label: t(i.label), children: i.children?.map(say) });
    return sourceGroups.map((g) => ({
      ...g,
      label: t(g.label),
      items: g.items.map((i) => visibleItem(say(i), allowed, q)).filter((i): i is NavItem => i !== null),
    })).filter((g) => g.items.length > 0);
  }, [role, silo, filter, hiddenHrefs, t]);

  const activeHref = groups
    .flatMap((group) => group.items.flatMap(hrefsOf))
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];
  const isActive = (href: string) => href === activeHref;

  const railCls = 'group relative mx-auto flex h-9 w-9 items-center justify-center rounded-md transition-colors';
  const renderRail = (item: NavItem, key: string): React.ReactNode => {
    const Icon = item.icon;
    if (item.children) {
      const inside = item.children.some((c) => activeHref !== undefined && hrefsOf(c).includes(activeHref));
      return (
        <li key={key}>
          <button
            type="button"
            title={item.label}
            aria-label={item.label}
            aria-haspopup="menu"
            aria-expanded={fly?.key === key}
            onClick={(e) => {
              if (fly?.key === key) { setFly(null); return; }
              const top = Math.max(8, Math.min(e.currentTarget.getBoundingClientRect().top, window.innerHeight - 360));
              setFly({ key, top, item });
            }}
            className={cn(railCls, inside || fly?.key === key ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-fg')}
          >
            <Icon className="h-4 w-4" />
            <span aria-hidden className="absolute bottom-1 right-1 h-1 w-1 rounded-full bg-current opacity-60" />
          </button>
        </li>
      );
    }
    const active = isActive(item.href);
    return (
      <li key={key}>
        <Link
          href={item.href}
          onClick={onNavigate}
          title={item.label}
          aria-label={item.label}
          aria-current={active ? 'page' : undefined}
          className={cn(railCls, active ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-fg')}
        >
          {active && <span aria-hidden className="absolute -left-1.5 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-primary" />}
          <Icon className="h-4 w-4" />
        </Link>
      </li>
    );
  };

  /** An entry's pages, beside the rail: the pages, and any pages under those, named. */
  const flyLinks = (item: NavItem, depth = 0): React.ReactNode[] => (item.children ?? []).flatMap((c) => {
    if (c.children) {
      return [
        <p key={`h:${c.label}`} className="px-2.5 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground" style={{ paddingLeft: `${0.625 + depth * 0.75}rem` }}>{c.label}</p>,
        ...flyLinks(c, depth + 1),
      ];
    }
    const CIcon = c.icon;
    const active = isActive(c.href);
    return [
      <Link
        key={c.href}
        href={c.href}
        role="menuitem"
        onClick={() => { setFly(null); onNavigate?.(); }}
        aria-current={active ? 'page' : undefined}
        style={{ paddingLeft: `${0.625 + depth * 0.75}rem` }}
        className={cn('flex items-center gap-2.5 rounded-md py-1.5 pr-2 text-sm', active ? 'bg-primary/15 font-semibold text-fg' : 'text-fg/80 hover:bg-muted hover:text-fg')}
      >
        <CIcon className={cn('h-4 w-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground')} />
        <span className="truncate">{c.label}</span>
      </Link>,
    ];
  });

  const renderItem = (item: NavItem, key: string, depth: number): React.ReactNode => {
    if (narrow && depth === 0) return renderRail(item, key);
    const Icon = item.icon;
    const indent = { paddingLeft: `${0.75 + depth * 0.9}rem` };
    if (item.children) {
      const inside = item.children.some((c) => activeHref !== undefined && hrefsOf(c).includes(activeHref));
      const open = Boolean(filter) || (expanded[key] ?? inside);
      return (
        <li key={key}>
          <button
            type="button"
            onClick={() => toggleItem(key, open)}
            aria-expanded={open}
            style={indent}
            className={cn(
              'group flex w-full items-center gap-3 rounded-md py-2 pr-2 text-left text-sm transition-all hover:bg-muted hover:text-fg',
              inside ? 'font-semibold text-fg' : 'text-fg/70',
            )}
          >
            <Icon className={cn('h-4 w-4 shrink-0', inside ? 'text-primary' : 'text-muted-foreground group-hover:text-fg')} />
            <span className="flex-1 truncate">{item.label}</span>
            <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', !open && '-rotate-90')} />
          </button>
          {open ? (
            <ul className="mt-0.5 space-y-0.5 border-l border-border/60" style={{ marginLeft: `${1.25 + depth * 0.9}rem` }}>
              {item.children.map((c) => renderItem(c, `${key}>${c.label}`, depth + 1))}
            </ul>
          ) : null}
        </li>
      );
    }
    const active = isActive(item.href);
    return (
      <li key={key}>
        <Link
          href={item.href}
          onClick={onNavigate}
          aria-current={active ? 'page' : undefined}
          style={depth ? { paddingLeft: '0.75rem' } : undefined}
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
  };

  if (narrow) {
    return (
      <>
        <nav className="flex-1 overflow-y-auto px-1.5 py-3" aria-label={t('Main')}>
          {groups.map((g, i) => (
            <div key={g.id} className={cn('mb-1', i > 0 && 'border-t border-border/60 pt-1')}>
              <ul className="space-y-0.5" aria-label={g.label}>
                {g.items.map((item) => renderItem(item, `${g.id}:${item.href}`, 0))}
              </ul>
            </div>
          ))}
        </nav>
        {fly ? (
          <>
            <button type="button" aria-label={t('Close')} className="fixed inset-0 z-40 cursor-default" onClick={() => setFly(null)} />
            <div role="menu" aria-label={fly.item.label} style={{ top: fly.top }}
              className="fixed left-[72px] z-50 max-h-[350px] w-64 overflow-y-auto rounded-lg border border-border bg-bg-card p-1.5 shadow-2xl">
              <p className="px-2.5 pb-1 pt-1 text-xs font-bold text-fg">{fly.item.label}</p>
              {flyLinks(fly.item)}
            </div>
          </>
        ) : null}
      </>
    );
  }

  return (
    <>
      <div className="px-3 pb-2 pt-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('Filter menu…')}
            aria-label={t('Filter navigation')}
            className="h-8 w-full rounded-md border border-border bg-bg/60 pl-8 pr-2 text-xs text-fg placeholder:text-muted-foreground focus:border-accent focus:outline-none"
          />
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        {groups.length === 0 && (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">{t('No matching pages.')}</p>
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
                  {g.items.map((item) => renderItem(item, `${g.id}:${item.href}`, 0))}
                </ul>
              )}
            </div>
          );
        })}
      </nav>
    </>
  );
}

/**
 * The seat this console belongs to, for the roles whose menu is their own
 * rather than one department's. Shared by the desktop rail and the drawer.
 */
function roleHeading(role: string, silo: string, tenantName?: string): { title: string; subtitle: string } | null {
  const org = tenantName ?? 'Your organisation';
  switch (role) {
    case 'SuperAdmin': return { title: 'Platform Administration', subtitle: 'All organisations' };
    case 'SystemAdmin': return { title: 'Organisation Administration', subtitle: org };
    case 'Supervisor': return { title: 'Team Supervision', subtitle: org };
    case 'Captain': return { title: 'Metro Police Captain', subtitle: org };
    case 'Doctor': return { title: 'Receiving Doctor', subtitle: `Emergency Medical Services · ${org}` };
    case 'FireChief': return { title: 'Fire Command', subtitle: `Fire & Rescue · ${org}` };
    case 'Disaster': return { title: 'Disaster Management', subtitle: org };
    case 'Admin':
      if (silo === 'Medical') return { title: 'EMS Administration', subtitle: `Emergency Medical Services · ${org}` };
      if (silo === 'MetroFire') return { title: 'Fire & Rescue Administration', subtitle: org };
      if (silo === 'EthekwiniDisaster') return { title: 'Disaster Management Administration', subtitle: org };
      if (silo === 'Ethekwini') return { title: 'Control Room Administration', subtitle: org };
      return { title: 'Metro Police Administration', subtitle: org };
    case 'SystemController': return { title: 'System Controller', subtitle: `All departments · ${org}` };
    case 'ControlRoom':
      return {
        title: 'Control Room',
        subtitle: silo === 'Ethekwini' ? `All departments · ${org}` : `${DEPARTMENT_LABELS[silo] ?? silo} · ${org}`,
      };
    case 'CaseManager':
      return {
        title: 'Case Management',
        subtitle: silo === 'Ethekwini' ? `All departments · ${org}` : `${DEPARTMENT_LABELS[silo] ?? silo} · ${org}`,
      };
    default: return null;
  }
}

function Brand({ dept, role, silo, tenantName, narrow = false }: { dept?: DeptIdentity; role: string; silo: string; tenantName?: string; narrow?: boolean }) {
  const { t } = useT();
  const heading = roleHeading(role, silo, tenantName);
  // On the police side the DMPS badge sits beside HikTech's mark, as in V4; never in its place.
  const police = silo === 'MetroPolice';
  if (narrow) {
    return (
      <div className="flex h-16 shrink-0 items-center justify-center border-b border-border" title={heading?.title ?? dept?.short_name ?? 'HIKTECH'}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/hiktech-icon.svg" alt="HIKTECH" className="h-9 w-9 rounded-md bg-white p-1" />
      </div>
    );
  }
  return (
    <div className="shrink-0 border-b border-border">
      <div className="flex h-16 items-center gap-2.5 px-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/hiktech-brand.svg"
          alt="HIKTECH"
          className={`h-auto max-w-full rounded-md bg-white p-2 ${police ? 'w-[160px] min-w-0' : 'w-[190px]'}`}
        />
        {police ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/images/dmps-badge.png" alt={t('Durban Metropolitan Police Service')} title={t('Durban Metropolitan Police Service')} className="h-11 w-11 shrink-0 object-contain" />
        ) : null}
      </div>
      {/* Whose service this screen belongs to, in that service's own colour. */}
      {heading ? (
        <div className="border-t border-border px-5 py-3">
          <span className="block text-xs font-bold text-fg">{heading.title}</span>
          <span className="block truncate text-[10px] text-muted-foreground">{heading.subtitle}</span>
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

/**
 * The municipality the platform serves (eThekwini), quiet at the foot of the
 * menu: its crest when an administrator has uploaded one, and its name.
 * HikTech's mark at the top is untouched.
 */
function OrgFooter({ org, narrow = false }: { org?: DeptIdentity; narrow?: boolean }) {
  const { t } = useT();
  if (!org) return null;
  if (narrow) {
    return (
      <div className="flex shrink-0 justify-center border-t border-border py-3 opacity-80" title={`Serving ${org.official_name}`}>
        <DeptBadge branding={org} logoUrl={org.logoUrl} size="xs" />
      </div>
    );
  }
  return (
    <div className="flex shrink-0 items-center gap-2.5 border-t border-border px-5 py-3 opacity-80">
      <DeptBadge branding={org} logoUrl={org.logoUrl} size="xs" />
      <span className="min-w-0 leading-tight">
        <span className="block text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">{t('Serving')}</span>
        <span className="block truncate text-[11px] font-semibold text-fg">{org.official_name}</span>
      </span>
    </div>
  );
}

/** How the sidebar shows, at its foot (as Supabase). */
function ModeControl({ mode, onMode, narrow }: { mode: SidebarMode; onMode: (m: SidebarMode) => void; narrow: boolean }) {
  const { t } = useT();
  // Placed on the page, not in the sidebar, so the narrow rail never cuts it off.
  const [open, setOpen] = useState<{ left: number; bottom: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <div className={cn('relative shrink-0 border-t border-border', narrow ? 'flex justify-center py-2' : 'px-3 py-2')}>
      <button
        type="button"
        onClick={(e) => {
          if (open) { setOpen(null); return; }
          const r = e.currentTarget.getBoundingClientRect();
          setOpen({ left: narrow ? r.right + 8 : r.left, bottom: window.innerHeight - (narrow ? r.bottom : r.top - 4) });
        }}
        aria-haspopup="menu"
        aria-expanded={Boolean(open)}
        title={t('Sidebar')}
        aria-label={t('Sidebar: how it shows')}
        className={cn('inline-flex items-center gap-2 rounded-md text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-fg',
          narrow ? 'h-9 w-9 justify-center' : 'h-8 w-full px-2')}
      >
        <PanelLeft className="h-4 w-4 shrink-0" />
        {narrow ? null : <span className="truncate">{t('Sidebar · {label}', { label: SIDEBAR_MODES.find((m) => m.mode === mode)?.label })}</span>}
      </button>
      {open ? (
        <>
          <button type="button" aria-label={t('Close')} className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(null)} />
          <div role="menu" aria-label={t('Sidebar')} style={{ left: open.left, bottom: open.bottom }}
            className="fixed z-50 w-52 rounded-lg border border-border bg-bg-card p-1.5 shadow-2xl">
            <p className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t('Sidebar')}</p>
            {SIDEBAR_MODES.map((m) => (
              <button key={m.mode} type="button" role="menuitemradio" aria-checked={mode === m.mode}
                onClick={() => { onMode(m.mode); setOpen(null); }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted">
                <span className="flex h-4 w-4 items-center justify-center">{mode === m.mode ? <Check className="h-3.5 w-3.5 text-primary" /> : null}</span>
                {m.label}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Desktop rail (lg+) + mobile drawer. */
export function Sidebar({
  silo, role, dept, org, tenantName, hiddenHrefs = [],
}: {
  silo: string; role: string; dept?: DeptIdentity; org?: DeptIdentity; tenantName?: string; hiddenHrefs?: string[];
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const drawerHeading = roleHeading(role, silo, tenantName);

  // Close the drawer whenever the route changes
  useEffect(() => setOpen(false), [pathname]);

  // Expanded, collapsed, or open while the pointer is over it; remembered in this browser.
  const [mode, setModeState] = useState<SidebarMode>('expanded');
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_MODE_KEY);
      if (isSidebarMode(saved)) setModeState(saved);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    // The page's column (app layout) follows: the rail on hover never pushes the page.
    document.documentElement.style.setProperty('--sidebar-w', `${columnWidth(mode)}px`);
    document.documentElement.setAttribute('data-sidebar', mode);
  }, [mode]);
  const setMode = (m: SidebarMode) => {
    setModeState(m);
    setHovered(false);
    try { localStorage.setItem(SIDEBAR_MODE_KEY, m); } catch { /* ignore */ }
  };
  const [hovered, setHovered] = useState(false);
  const wait = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A short pause, so passing the pointer across the rail does not throw it open.
  const enter = () => { if (mode === 'hover') wait.current = setTimeout(() => setHovered(true), 150); };
  const leave = () => { if (wait.current) clearTimeout(wait.current); setHovered(false); };
  useEffect(() => () => { if (wait.current) clearTimeout(wait.current); }, []);
  const narrow = mode === 'collapsed' || (mode === 'hover' && !hovered);

  return (
    <>
      {/* The column holds the rail; on hover the sidebar opens over the page, not beside it. */}
      <div className="relative z-30 hidden h-screen lg:sticky lg:top-0 lg:block">
        <aside
          onMouseEnter={enter}
          onMouseLeave={leave}
          onFocus={() => { if (mode === 'hover') setHovered(true); }}
          onBlur={(e) => { if (mode === 'hover' && !e.currentTarget.contains(e.relatedTarget as Node | null)) setHovered(false); }}
          className={cn(
            'absolute inset-y-0 left-0 flex flex-col overflow-hidden border-r border-border bg-bg-soft transition-[width] duration-200 ease-out',
            narrow ? 'w-16' : 'w-[264px]',
            mode === 'hover' && hovered && 'shadow-2xl',
          )}
        >
          <Brand dept={dept} role={role} silo={silo} tenantName={tenantName} narrow={narrow} />
          <NavList silo={silo} role={role} hiddenHrefs={hiddenHrefs} narrow={narrow} />
          <ModeControl mode={mode} onMode={setMode} narrow={narrow} />
          <OrgFooter org={org} narrow={narrow} />
        </aside>
      </div>

      <button
        type="button"
        aria-label={t('Open navigation')}
        onClick={() => setOpen(true)}
        className="fixed left-3 top-3 z-40 inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-bg-soft transition-colors hover:bg-muted lg:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label={t('Navigation')}>
          <button type="button" aria-label={t('Close navigation')} className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-border bg-bg-soft shadow-2xl">
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-border pl-5 pr-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/hiktech-brand.svg" alt="HIKTECH" className="h-auto w-[190px] max-w-full rounded-md bg-white p-2" />
              <button
                type="button"
                aria-label={t('Close')}
                onClick={() => setOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-muted"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {drawerHeading && (
              <div className="border-b border-border px-5 py-3">
                <span className="block text-xs font-bold text-fg">{drawerHeading.title}</span>
                <span className="block truncate text-[10px] text-muted-foreground">{drawerHeading.subtitle}</span>
              </div>
            )}
            <NavList silo={silo} role={role} hiddenHrefs={hiddenHrefs} onNavigate={() => setOpen(false)} />
            <OrgFooter org={org} />
          </div>
        </div>
      )}
    </>
  );
}
