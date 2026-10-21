import {
  LayoutDashboard, PhoneCall, Radio, MapPinned, ShieldAlert, FlameKindling, Stethoscope,
  Mountain, FileText, Camera, Users, ClipboardCheck, BarChart3, Settings, ListChecks,
  CalendarClock, Bell, Briefcase, GraduationCap, Gauge, FolderClosed, Map, Bot,
  RadioTower, Filter, SlidersHorizontal, IdCard, Target, Network, PlugZap, Activity,
  ToggleRight, Building2, LayoutGrid, Wrench, Timer, Mail, Receipt, Scale, Landmark,
  ScrollText, FileWarning, Grid3x3, Crosshair, Warehouse, ClipboardList, Video, Film, Cctv, BookOpen,
  FileCheck, Siren, Archive, History, PieChart,
  type LucideIcon,
} from 'lucide-react';

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Extra words that should match this item in search. */
  keywords?: string;
  /** Pages under this one, shown when it is expanded in the sidebar. */
  children?: NavItem[];
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
      { href: '/command', label: 'Command', icon: LayoutGrid, keywords: 'controller modules launcher duty board approvals system modules' },
    ],
  },
  {
    id: 'dispatch',
    label: 'Dispatch',
    items: [
      { href: '/dispatch/log-call', label: 'Log Incoming Call', icon: PhoneCall, keywords: 'new call capture create incident 10111 112' },
      { href: '/dispatch/log-history', label: 'Log History', icon: History, keywords: 'calls i logged my calls status pending dispatch' },
      { href: '/dispatch/pending', label: 'Pending Queue', icon: ListChecks, keywords: 'queue awaiting assign' },
      { href: '/dispatch/kpi', label: 'KPI Dashboard', icon: BarChart3, keywords: 'metrics stats' },
      { href: '/incidents', label: 'All Incidents', icon: MapPinned, keywords: 'search log history' },
      { href: '/incidents/map', label: 'Live Map', icon: Map, keywords: 'gis geography units' },
      { href: '/responder/monitor', label: 'Active Responders', icon: Siren, keywords: 'responders units crews out en route on scene time on scene terminal monitor' },
      { href: '/reports', label: 'Reports Archive', icon: FileText, keywords: 'closed resolved' },
      { href: '/reports/builder', label: 'Report Builder', icon: BarChart3, keywords: 'custom report build query group chart export analytics pivot' },
      { href: '/report-hub', label: 'Report Hub', icon: Filter, keywords: 'export csv filters templates' },
      { href: '/hierarchy', label: 'Dept Hierarchy', icon: Network, keywords: 'org chart chain of command' },
      { href: '/dispatch/ptt', label: 'Radio Desk', icon: RadioTower, keywords: 'push to talk ptt radio walkie talkie hard hat talk map battery' },
      { href: '/notifications', label: 'Notifications', icon: Bell, keywords: 'alerts' },
    ],
  },
  {
    // The end of a call's life (0061): resolved cases are read and closed here.
    id: 'cases',
    label: 'Case Management',
    items: [
      { href: '/case-manager', label: 'Case Dashboard', icon: FolderClosed, keywords: 'case manager cases review close overview' },
      { href: '/case-manager/review', label: 'Awaiting Review', icon: FileCheck, keywords: 'cases resolved report filed review close queue' },
      { href: '/case-manager/open', label: 'Live Cases', icon: Siren, keywords: 'open cases active calls cancel close without report' },
      { href: '/case-manager/closed', label: 'Closed Cases', icon: Archive, keywords: 'closed cases archive reviewed cancelled' },
      { href: '/case-manager/audit', label: 'Case Audit Trail', icon: History, keywords: 'audit history trail case who changed what' },
    ],
  },
  {
    id: 'responder',
    label: 'Responder',
    items: [
      { href: '/responder', label: 'My Incidents', icon: Radio, keywords: 'assigned jobs my unit' },
      { href: '/shift/mental-check', label: 'Start of Shift', icon: ClipboardCheck, keywords: 'readiness vehicle check on duty' },
      { href: '/shift/unit-compliance', label: 'Unit Compliance', icon: Gauge, keywords: 'checks today' },
      { href: '/shift/today', label: 'Today’s Shift', icon: ClipboardList, keywords: 'who is on duty firearms vehicles booked out end of shift board' },
      { href: '/shift/readiness-review', label: 'Readiness Review', icon: ClipboardCheck, keywords: 'officer mental check answers audit history' },
      { href: '/performance/mine', label: 'My Performance', icon: Target, keywords: 'kpi appraisal score' },
    ],
  },
  {
    id: 'departments',
    label: 'Departments',
    items: [
      { href: '/police', label: 'Police Operations', icon: ShieldAlert, keywords: 'metro reports firearms armoury security' },
      { href: '/police/reports/incident', label: 'Incident Reports', icon: FileCheck, keywords: 'police case reports filed on calls dispatched incident officer forms' },
      { href: '/police/reports', label: 'Police Reports', icon: FileText, keywords: 'police reports console arrest crash tow dog firearm vehicle inspection sanral dmps forms' },
      { href: '/police/report-centre', label: 'Reports Centre', icon: PieChart, keywords: 'police reports management graphs dashboard records recent activity specialised pdf csv arrest crash tow dog firearm vehicle inspection sanral dmps 12a cr1 211a 216e' },
      { href: '/police/firearms', label: 'Issue Register', icon: ClipboardList, keywords: 'firearm authorisations issued returned rounds' },
      { href: '/police/security', label: 'Security Reports', icon: ShieldAlert, keywords: 'sira security register guards' },
      { href: '/police/crime-hotspots', label: 'Crime Hotspots', icon: Map, keywords: 'crime map hotspots stations statistics' },
      { href: '/police/armoury', label: 'Armoury', icon: Warehouse, keywords: 'firearms guns weapons register serial booked out import' },
      { href: '/police/bodycams', label: 'Bodycam Register', icon: Video, keywords: 'bodycam body worn camera register serial sim booked out import hikvision' },
      { href: '/police/fines', label: 'Fines', icon: Receipt, keywords: 'enforcement traffic bylaw ticket offender fn aarto section 56 341 notice infringement' },
      { href: '/police/fines/account', label: 'Fines Account', icon: IdCard, keywords: 'fines account statement owing id number registration vehicle payments history' },
      { href: '/police/fines/payments', label: 'Fine Payments', icon: Landmark, keywords: 'fines payments import receipts bank cashier file reconcile' },
      { href: '/police/fines/offences', label: 'Charge Book', icon: BookOpen, keywords: 'fines offences charge codes penalty amounts aarto schedule 3 bylaw demerit' },
      { href: '/police/charges', label: 'Charges', icon: Scale, keywords: 'enforcement criminal accused court ch' },
      { href: '/police/transactions', label: 'Charge Transactions', icon: Landmark, keywords: 'enforcement bail payment court fee ledger money' },
      { href: '/police/warrants', label: 'Warrants', icon: FileWarning, keywords: 'enforcement arrest search execute wa' },
      { href: '/police/summons', label: 'Summons', icon: ScrollText, keywords: 'enforcement court serve recipient sm' },
      { href: '/police/firearm-checks', label: 'Firearm Checks', icon: Crosshair, keywords: 'armoury checklist gun weapon inspection safety phone' },
      { href: '/fire', label: 'Fire & Rescue', icon: FlameKindling, keywords: 'hydrants pir firefighter' },
      { href: '/fire/reports', label: 'Fire Reports', icon: FileText, keywords: 'fire incident reports filed firefighter' },
      { href: '/fire/inspections', label: 'Fire Safety Inspections', icon: ClipboardCheck, keywords: 'inspection business premises extinguishers exits compliance' },
      { href: '/fire/hydrants', label: 'Hydrants', icon: Map, keywords: 'hydrant register gis water' },
      { href: '/fire/pir', label: 'Public Reports', icon: FileCheck, keywords: 'pir public incident report publish' },
      { href: '/medical', label: 'EMS', icon: Stethoscope, keywords: 'medical pcr paramedic patient' },
      { href: '/medical/pcr', label: 'Clinical Archive', icon: FileText, keywords: 'pcr patient care reports epcr medical records paramedic' },
      { href: '/medical/handovers', label: 'Hospital Handovers', icon: Building2, keywords: 'handover hospital doctor receiving patient transfer of care' },
      { href: '/medical/restock', label: 'Ambulance Restock', icon: Archive, keywords: 'ambulance stock drugs inventory restock medical' },
      { href: '/disaster', label: 'Disaster Mgmt', icon: Mountain, keywords: 'flood relief mutual aid' },
      { href: '/disaster/dispatch', label: 'Dispatch Resources', icon: Siren, keywords: 'deploy resources disaster log' },
      { href: '/disaster/post-mortem', label: 'Post-Mortems', icon: FileCheck, keywords: 'after action report aar post mortem lessons' },
      { href: '/disaster/partners', label: 'Mutual-Aid Partners', icon: Network, keywords: 'partners mutual aid agencies resources' },
    ],
  },
  {
    id: 'workforce',
    label: 'Workforce',
    items: [
      { href: '/roster/mine', label: 'My Schedule', icon: CalendarClock, keywords: 'my shifts roster duty leave balances endorsements when am i working' },
      { href: '/hr', label: 'HR Command Centre', icon: Users, keywords: 'hr hub people approvals coverage certifications expiring' },
      { href: '/modules', label: 'System Modules', icon: LayoutGrid, keywords: 'duty office staff maintenance call signs sections endorsements duty allocation duty maintenance duty operations parade sheet absence codes maintain leave oracle dcp' },
      { href: '/roster/allocation', label: 'Duty Board', icon: ClipboardCheck, keywords: 'post board coverage gaps unmanned assign crew sector vehicle establishment publish' },
      { href: '/roster', label: 'Duty Roster', icon: CalendarClock, keywords: 'duty shifts month planner rotation 224 24-48 platoon team publish issue swap endorsements court schedule board' },
      { href: '/roster/setup', label: 'Shift Setup', icon: SlidersHorizontal, keywords: 'shift types rotations teams platoons late grace no-show minutes public holidays' },
      { href: '/leave', label: 'Leave', icon: Briefcase, keywords: 'time off absence balances calendar approvals' },
      { href: '/duty-tasks', label: 'Station Tasks', icon: Wrench, keywords: 'dm tasks station inspection calibration restock due progress' },
      { href: '/attendance', label: 'Time & Attendance', icon: Timer, keywords: 'clock in out punches register hours absence' },
      { href: '/mail', label: 'Mail', icon: Mail, keywords: 'internal messages inbox compose operator' },
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
      { href: '/cameras', label: 'Body Cams', icon: Video, keywords: 'bodycam body worn camera live video officer feed hikvision' },
      { href: '/cameras/footage', label: 'Body Cam Footage', icon: Film, keywords: 'bodycam recorded video evidence playback footage hikvision' },
      { href: '/sanral', label: 'SANRAL Cameras', icon: Cctv, keywords: 'cctv freeway cameras matrix sanral i-traffic wall traffic surveillance' },
      { href: '/assistant', label: 'Criti Assistant', icon: Bot, keywords: 'ai chat help' },
    ],
  },
  {
    id: 'admin',
    label: 'Administration',
    items: [
      { href: '/admin', label: 'Users & Roles', icon: Users, keywords: 'accounts permissions' },
      { href: '/admin/config', label: 'Configuration', icon: SlidersHorizontal, keywords: 'categories leave shift types' },
      { href: '/modules/staff', label: 'Staff Maintenance', icon: IdCard, keywords: 'personnel staff register records import hr staff list invite logins roles leavers' },
      { href: '/admin/operators', label: 'Operators', icon: Users, keywords: 'control room call signs' },
      { href: '/admin/vehicles', label: 'Fleet', icon: RadioTower, keywords: 'apparatus vehicles' },
      { href: '/admin/devices', label: 'Devices', icon: Radio, keywords: 'mdt radios tablets' },
      { href: '/admin/radios', label: 'Radios', icon: RadioTower, keywords: 'radio register push to talk ptt walkie talkie hard hat account whose radio' },
      { href: '/admin/integrations', label: 'Integrations', icon: PlugZap, keywords: 'api keys gemini bulksms tomtom feeds connections' },
      { href: '/admin/operations', label: 'Operations Settings', icon: Gauge, keywords: 'sla clocks eta alert sound thresholds tuning knobs' },
      { href: '/admin/automations', label: 'Automations', icon: Bot, keywords: 'rules escalation sla breach expiry reminders digest scheduler cron background' },
      { href: '/admin/status', label: 'System Status', icon: Activity, keywords: 'health uptime diagnostics is it working down degraded checks' },
      { href: '/admin/features', label: 'Features', icon: ToggleRight, keywords: 'flags toggles switches modules enable disable superadmin' },
      { href: '/admin/access', label: 'Access Control', icon: ToggleRight, keywords: 'visibility hide modules per tenant per role deny command bar launcher superadmin' },
      { href: '/admin/tenants', label: 'Tenants', icon: Building2, keywords: 'organisations municipalities multi-tenant provisioning' },
      { href: '/admin/departments', label: 'Departments', icon: ShieldAlert, keywords: 'branding logo crest colours identity metro police fire ems disaster' },
      { href: '/profile', label: 'Settings', icon: Settings, keywords: 'profile account my hr' },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

const navItem = (href: string, label?: string): NavItem => {
  const item = ALL_NAV_ITEMS.find((i) => i.href === href);
  if (!item) throw new Error(`Missing navigation route: ${href}`);
  return { ...item, label: label ?? item.label };
};

/**
 * Police Operations as one expandable entry: every police page under it, and
 * the reports under their own Reports entry. Each page is still checked
 * against the viewer's role and department when the menu is drawn.
 */
export const POLICE_OPERATIONS: NavItem = {
  ...navItem('/police'),
  children: [
    navItem('/police', 'Overview'),
    {
      href: '/police/reports', label: 'Reports', icon: FileText, keywords: 'incident police reports',
      children: [navItem('/police/reports/incident'), navItem('/police/reports')],
    },
    navItem('/police/fines'),
    navItem('/police/fines/account'),
    navItem('/police/fines/payments'),
    navItem('/police/fines/offences'),
    navItem('/police/charges'),
    navItem('/police/transactions'),
    navItem('/police/warrants'),
    navItem('/police/summons'),
    navItem('/police/armoury'),
    navItem('/police/firearm-checks'),
    navItem('/police/firearms'),
    navItem('/police/bodycams'),
    navItem('/police/security'),
    navItem('/police/crime-hotspots'),
  ],
};

/** Human labels for path segments that aren't top-level nav entries. */
const SEGMENT_LABELS: Record<string, string> = {
  dispatch: 'Dispatch', incidents: 'Incidents', 'log-call': 'Log Call', 'log-history': 'Log History', pending: 'Pending Queue',
  kpi: 'KPI', map: 'Live Map', assign: 'Assign', ptt: 'PTT Radio',
  reports: 'Reports', builder: 'Report Builder', 'report-hub': 'Report Hub', 'case-manager': 'Case Manager', audit: 'Audit',
  hierarchy: 'Hierarchy', person: 'Personnel Record', responder: 'My Incidents',
  shift: 'Shift', 'mental-check': 'Readiness Check', 'vehicle-selection': 'Vehicle Selection',
  'vehicle-checklist': 'Vehicle Checklist', 'unit-compliance': 'Unit Compliance', reason: 'Not Passed',
  police: 'Police', fire: 'Fire & Rescue', medical: 'EMS', disaster: 'Disaster Mgmt',
  command: 'Command', 'duty-tasks': 'Duty Maintenance', attendance: 'Time & Attendance',
  mail: 'Mail', fines: 'Fines', charges: 'Charges', transactions: 'Charge Transactions',
  warrants: 'Warrants', summons: 'Summons', 'firearm-checks': 'Firearm Checks', sections: 'Sections',
  firearms: 'Issue Register', armoury: 'Armoury', today: 'Today’s Shift', template: 'Template', security: 'Security Reports', 'crime-hotspots': 'Crime Hotspots',
  hydrants: 'Hydrants', pir: 'Public Reports', publish: 'Publish', pcr: 'Patient Care Reports',
  restock: 'Restock', 'post-mortem': 'Post-Mortem', partners: 'Mutual Aid',
  roster: 'Duty Roster', allocation: 'Duty Board', setup: 'Shift Setup', 'duty-sheet': 'Duty Sheet', leave: 'Leave', training: 'Training',
  modules: 'System Modules', staff: 'Staff Maintenance', 'call-signs': 'Call Signs', 'duty-allocation': 'Duty Allocation',
  'duty-maintenance': 'Duty Maintenance', 'duty-operations': 'Duty Operations', absence: 'Absence Codes', endorsements: 'Endorsements',
  hr: 'HR Command Centre', departments: 'Departments',
  performance: 'Performance', mine: 'My Performance', operational: 'Operational KPIs',
  'role-kpis': 'Role KPIs', rollup: 'KPI Rollup', plans: 'Appraisal Plans', kpis: 'KPI Config',
  analytics: 'Analytics', cameras: 'Body Cams', assistant: 'Assistant', sanral: 'SANRAL Cameras', bodycams: 'Bodycam Register',
  admin: 'Administration', config: 'Configuration', personnel: 'Personnel', access: 'Access Control',
  operators: 'Operators', vehicles: 'Fleet', devices: 'Devices', integrations: 'Integrations',
  operations: 'Operations Settings', footage: 'Body Cam Footage',
  invitations: 'Invitations', approvals: 'Approvals', handbook: 'Handbook', users: 'Users',
  import: 'Import', rollout: 'Rollout',
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

/**
 * Roles whose console has a curated sidebar rather than the top navigation.
 * The layout and the dashboard both read this, so they cannot disagree about
 * whether a page has room for its own logo.
 */
export const SIDEBAR_ROLES: string[] = [
  'SystemAdmin', 'SuperAdmin', 'Supervisor', 'Captain', 'Dispatcher', 'IncidentLogger', 'ControlRoom',
  'SystemController', 'Police', 'CaseManager',
];

/** The EMS administrator has the EMS sidebar. */
export const isEmsAdmin = (role: string, silo: string) => role === 'Admin' && silo === 'Medical';

/** The receiving doctor: a small read-only EMS role. */
export const isDoctor = (role: string) => role === 'Doctor';

/** Fire command: the Fire Chief and the Fire & Rescue administrator. */
export const isFireCommand = (role: string, silo: string) => role === 'FireChief' || (role === 'Admin' && silo === 'MetroFire');

/** The Disaster Management desk: its officers and its administrator. */
export const isDisasterDesk = (role: string, silo: string) => role === 'Disaster' || (role === 'Admin' && silo === 'EthekwiniDisaster');

/** The Metro Police (or Control Room) administrator. */
export const isPoliceAdmin = (role: string, silo: string) => role === 'Admin'
  && !['Medical', 'MetroFire', 'EthekwiniDisaster'].includes(silo);

/** Whether this console has a sidebar rather than the top navigation. */
export const hasSidebar = (role: string, silo: string) => SIDEBAR_ROLES.includes(role) || isEmsAdmin(role, silo) || isDoctor(role)
  || isFireCommand(role, silo) || isDisasterDesk(role, silo) || isPoliceAdmin(role, silo);
