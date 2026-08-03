import {
  LayoutDashboard, PhoneCall, Radio, MapPinned, ShieldAlert, FlameKindling, Stethoscope,
  Mountain, FileText, Camera, Users, ClipboardCheck, BarChart3, Settings, ListChecks,
  CalendarClock, Bell, Briefcase, GraduationCap, Gauge, FolderClosed, Map, Bot,
  RadioTower, Filter, SlidersHorizontal, IdCard, Target, Network, PlugZap, type LucideIcon,
} from 'lucide-react';

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Extra words that should match this item in search. */
  keywords?: string;
};
export type NavGroup = { id: string; label: string; items: NavItem[] };

/**
 * Single source of truth for navigation — consumed by the sidebar, the
 * command palette and the breadcrumb builder so they can never drift.
 * Visibility is filtered per role/silo by `canAccess` at render time.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, keywords: 'home start overview' },
    ],
  },
  {
    id: 'dispatch',
    label: 'Dispatch',
    items: [
      { href: '/dispatch/log-call', label: 'Log Incoming Call', icon: PhoneCall, keywords: 'new 911 call create incident' },
      { href: '/dispatch/pending', label: 'Pending Queue', icon: ListChecks, keywords: 'queue awaiting assign' },
      { href: '/dispatch/kpi', label: 'KPI Dashboard', icon: BarChart3, keywords: 'metrics stats' },
      { href: '/incidents', label: 'All Incidents', icon: MapPinned, keywords: 'search log history' },
      { href: '/incidents/map', label: 'Live Map', icon: Map, keywords: 'gis geography units' },
      { href: '/reports', label: 'Reports Archive', icon: FileText, keywords: 'closed resolved' },
      { href: '/reports/builder', label: 'Report Builder', icon: BarChart3, keywords: 'custom report build query group chart export analytics pivot' },
      { href: '/report-hub', label: 'Report Hub', icon: Filter, keywords: 'export csv filters templates' },
      { href: '/case-manager', label: 'Case Manager', icon: FolderClosed, keywords: 'close cases review' },
      { href: '/hierarchy', label: 'Dept Hierarchy', icon: Network, keywords: 'org chart chain of command' },
      { href: '/dispatch/ptt', label: 'PTT Radio', icon: RadioTower, keywords: 'push to talk audio' },
      { href: '/notifications', label: 'Notifications', icon: Bell, keywords: 'alerts' },
    ],
  },
  {
    id: 'responder',
    label: 'Responder',
    items: [
      { href: '/responder', label: 'My Incidents', icon: Radio, keywords: 'assigned jobs my unit' },
      { href: '/shift/mental-check', label: 'Start of Shift', icon: ClipboardCheck, keywords: 'readiness vehicle check on duty' },
      { href: '/shift/unit-compliance', label: 'Unit Compliance', icon: Gauge, keywords: 'checks today' },
      { href: '/performance/mine', label: 'My Performance', icon: Target, keywords: 'kpi appraisal score' },
    ],
  },
  {
    id: 'departments',
    label: 'Departments',
    items: [
      { href: '/police', label: 'Police Operations', icon: ShieldAlert, keywords: 'metro reports firearms armoury security' },
      { href: '/fire', label: 'Fire & Rescue', icon: FlameKindling, keywords: 'hydrants pir firefighter' },
      { href: '/medical', label: 'EMS', icon: Stethoscope, keywords: 'medical pcr paramedic patient' },
      { href: '/disaster', label: 'Disaster Mgmt', icon: Mountain, keywords: 'flood relief mutual aid' },
    ],
  },
  {
    id: 'workforce',
    label: 'Workforce',
    items: [
      { href: '/roster/mine', label: 'My Schedule', icon: CalendarClock, keywords: 'my shifts roster duty leave balances endorsements when am i working' },
      { href: '/hr', label: 'HR Command Centre', icon: Users, keywords: 'hr hub people approvals coverage certifications expiring' },
      { href: '/roster/allocation', label: 'Duty Allocation', icon: ClipboardCheck, keywords: 'post board coverage gaps unmanned assign crew sector vehicle establishment publish' },
      { href: '/roster', label: 'Roster', icon: CalendarClock, keywords: 'duty shifts allocation endorsements schedule board' },
      { href: '/roster/duty-sheet', label: 'Duty Sheet', icon: IdCard, keywords: 'parade print dcp' },
      { href: '/leave', label: 'Leave', icon: Briefcase, keywords: 'time off absence balances calendar approvals' },
      { href: '/training', label: 'Training', icon: GraduationCap, keywords: 'certifications courses' },
      { href: '/performance', label: 'Performance', icon: BarChart3, keywords: 'appraisals kpis operational' },
      { href: '/performance/reports', label: 'Performance Reports', icon: Target, keywords: 'reports member department incident csv export' },
    ],
  },
  {
    id: 'insights',
    label: 'Insights & Tools',
    items: [
      { href: '/analytics', label: 'Analytics', icon: BarChart3, keywords: 'trends statistics charts' },
      { href: '/cameras', label: 'Surveillance', icon: Camera, keywords: 'cctv cameras matrix sanral hikvision wall traffic' },
      { href: '/cameras/footage', label: 'CCTV Footage', icon: Camera, keywords: 'playback recorded video evidence hikvision' },
      { href: '/assistant', label: 'Criti Assistant', icon: Bot, keywords: 'ai chat help' },
    ],
  },
  {
    id: 'admin',
    label: 'Administration',
    items: [
      { href: '/admin', label: 'Users & Roles', icon: Users, keywords: 'accounts permissions' },
      { href: '/admin/config', label: 'Configuration', icon: SlidersHorizontal, keywords: 'categories leave shift types' },
      { href: '/admin/personnel', label: 'Personnel', icon: IdCard, keywords: 'staff register' },
      { href: '/admin/operators', label: 'Operators', icon: Users, keywords: 'control room call signs' },
      { href: '/admin/vehicles', label: 'Fleet', icon: RadioTower, keywords: 'apparatus vehicles' },
      { href: '/admin/devices', label: 'Devices', icon: Radio, keywords: 'mdt radios tablets' },
      { href: '/admin/integrations', label: 'Integrations', icon: PlugZap, keywords: 'api keys gemini bulksms realptt tomtom feeds connections' },
      { href: '/admin/operations', label: 'Operations Settings', icon: Gauge, keywords: 'sla clocks eta alert sound thresholds tuning knobs' },
      { href: '/admin/automations', label: 'Automations', icon: Bot, keywords: 'rules escalation sla breach expiry reminders digest scheduler cron background' },
      { href: '/admin/departments', label: 'Departments', icon: ShieldAlert, keywords: 'branding logo crest colours identity metro police fire ems disaster' },
      { href: '/profile', label: 'Settings', icon: Settings, keywords: 'profile account my hr' },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/** Human labels for path segments that aren't top-level nav entries. */
const SEGMENT_LABELS: Record<string, string> = {
  dispatch: 'Dispatch', incidents: 'Incidents', 'log-call': 'Log Call', pending: 'Pending Queue',
  kpi: 'KPI', map: 'Live Map', assign: 'Assign', ptt: 'PTT Radio',
  reports: 'Reports', builder: 'Report Builder', 'report-hub': 'Report Hub', 'case-manager': 'Case Manager', audit: 'Audit',
  hierarchy: 'Hierarchy', person: 'Personnel Record', responder: 'My Incidents',
  shift: 'Shift', 'mental-check': 'Readiness Check', 'vehicle-selection': 'Vehicle Selection',
  'vehicle-checklist': 'Vehicle Checklist', 'unit-compliance': 'Unit Compliance', reason: 'Not Passed',
  police: 'Police', fire: 'Fire & Rescue', medical: 'EMS', disaster: 'Disaster Mgmt',
  firearms: 'Armoury', security: 'Security Reports', 'crime-hotspots': 'Crime Hotspots',
  hydrants: 'Hydrants', pir: 'Public Reports', publish: 'Publish', pcr: 'Patient Care Reports',
  restock: 'Restock', 'post-mortem': 'Post-Mortem', partners: 'Mutual Aid',
  roster: 'Roster', allocation: 'Duty Allocation', 'duty-sheet': 'Duty Sheet', leave: 'Leave', training: 'Training',
  hr: 'HR Command Centre', departments: 'Departments',
  performance: 'Performance', mine: 'My Performance', operational: 'Operational KPIs',
  'role-kpis': 'Role KPIs', rollup: 'KPI Rollup', plans: 'Appraisal Plans', kpis: 'KPI Config',
  analytics: 'Analytics', cameras: 'Surveillance', assistant: 'Assistant',
  admin: 'Administration', config: 'Configuration', personnel: 'Personnel',
  operators: 'Operators', vehicles: 'Fleet', devices: 'Devices', integrations: 'Integrations',
  operations: 'Operations Settings', footage: 'CCTV Footage',
  profile: 'Profile', 'my-hr': 'My HR', notifications: 'Notifications', dashboard: 'Dashboard',
  new: 'New',
};

const isId = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s) || /^\d+$/.test(s);

/** Breadcrumb trail for a pathname, e.g. /medical/pcr/new → EMS › PCRs › New. */
export function breadcrumbsFor(pathname: string): { label: string; href: string }[] {
  const parts = pathname.split('/').filter(Boolean);
  const crumbs: { label: string; href: string }[] = [];
  let acc = '';
  for (const part of parts) {
    acc += `/${part}`;
    if (isId(part)) {
      crumbs.push({ label: 'Detail', href: acc });
      continue;
    }
    const navMatch = ALL_NAV_ITEMS.find((i) => i.href === acc);
    crumbs.push({ label: navMatch?.label ?? SEGMENT_LABELS[part] ?? part.replace(/-/g, ' '), href: acc });
  }
  return crumbs;
}
