import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  getDispatcherKpis, listActiveIncidents, listPendingIncidents,
  getMyPersonnel, listMyCalls, hasCompletedShiftStartToday, getMyPerformance,
  listPersonnel, getUnitCompliance, listAllProfiles, listApparatus, listDevices, listBookedOutBodycams, listPcrs,
} from '@criticom/api';
import {
  ADMIN_ROLES, DISPATCH_ROLES, RESPONDER_ROLES, canViewAllFines, canWatchBodycam, type Silo, type UserRole,
} from '@criticom/db';
import { featureEnabled } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { HourlyAreaChart, SeverityDonut } from '@/components/charts';
import { QuickLinks } from '@/components/quick-links';
import { FinesPanel } from '@/components/fines-panel';
import { getFeatures } from '@/lib/features';
import { DispatchBoard } from './dispatch-board';
import { BoardLive } from './board-live';
import { getSession, siloFilter } from '@/lib/session';
import { hasSidebar, isDisasterDesk, isEmsAdmin, isFireCommand } from '@/lib/nav';
import { timeAgo } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dashboard · HikTech' };

type Persona = 'admin' | 'command' | 'supervisor' | 'responder' | 'viewer';
const SUPERVISOR_ROLES: UserRole[] = ['Supervisor', 'Captain', 'FireChief'];

function resolvePersona(role: UserRole): Persona {
  if (ADMIN_ROLES.includes(role)) return 'admin';
  if (SUPERVISOR_ROLES.includes(role)) return 'supervisor';
  if (RESPONDER_ROLES.includes(role)) return 'responder';
  if (DISPATCH_ROLES.includes(role) || role === 'System') return 'command';
  return 'viewer';
}

const SILO_OPS: Record<Exclude<Silo, 'Ethekwini'>, { href: string; label: string; icon: string }> = {
  MetroPolice: { href: '/police', label: 'Police Operations', icon: 'ShieldAlert' },
  MetroFire: { href: '/fire', label: 'Fire & Rescue', icon: 'FlameKindling' },
  Medical: { href: '/medical', label: 'EMS / Medical', icon: 'Stethoscope' },
  EthekwiniDisaster: { href: '/disaster', label: 'Disaster Mgmt', icon: 'Mountain' },
};

type QuickLink = { href: string; label: string; desc: string; icon: string; tone?: string };

const LINKS: Record<Persona, QuickLink[]> = {
  command: [
    { href: '/dispatch/log-call', label: 'Log Incoming Call', desc: 'Capture a new 911 call', icon: 'PhoneCall', tone: 'bg-severity-critical/15 text-severity-critical-ink' },
    { href: '/dispatch/pending', label: 'Pending Queue', desc: 'Calls awaiting dispatch', icon: 'ListChecks' },
    { href: '/incidents/map', label: 'Live Map', desc: 'Incidents + units in realtime', icon: 'Map' },
    { href: '/dispatch/kpi', label: 'KPI Dashboard', desc: 'Operational metrics', icon: 'BarChart3' },
    { href: '/incidents', label: 'All Incidents', desc: 'Search the full log', icon: 'MapPinned' },
    { href: '/report-hub', label: 'Report Hub', desc: 'Filtered reporting + export', icon: 'Filter' },
    { href: '/dispatch/ptt', label: 'PTT Radio', desc: 'Text-to-radio + audio log', icon: 'RadioTower' },
    { href: '/case-manager', label: 'Case Management', desc: 'Review reports, close cases', icon: 'FolderClosed' },
  ],
  responder: [
    { href: '/responder', label: 'My Incidents', desc: 'Jobs assigned to my unit', icon: 'Radio', tone: 'bg-accent/15 text-accent' },
    { href: '/shift/mental-check', label: 'Start of Shift', desc: 'Readiness + vehicle check', icon: 'ClipboardCheck' },
    { href: '/shift/unit-compliance', label: 'Unit Compliance', desc: 'Today’s checks', icon: 'Gauge' },
    { href: '/performance/mine', label: 'My Performance', desc: 'My throughput + appraisal', icon: 'Target' },
    { href: '/roster', label: 'Roster', desc: 'My duty allocation', icon: 'CalendarClock' },
    { href: '/leave', label: 'Leave', desc: 'Apply / view requests', icon: 'Briefcase' },
    { href: '/profile/my-hr', label: 'My HR', desc: 'Personal HR portal', icon: 'IdCard' },
  ],
  supervisor: [
    { href: '/roster', label: 'Roster', desc: 'Allocate duty + endorsements', icon: 'CalendarClock', tone: 'bg-severity-medium/15 text-severity-medium-ink' },
    { href: '/roster/duty-sheet', label: 'Duty Sheet', desc: 'Printable parade sheet', icon: 'IdCard' },
    { href: '/shift/unit-compliance', label: 'Unit Compliance', desc: 'Team readiness today', icon: 'Gauge' },
    { href: '/performance/operational', label: 'Operational KPIs', desc: 'Team throughput', icon: 'BarChart3' },
    { href: '/performance/plans', label: 'Appraisals', desc: 'Mid-year & final scoring', icon: 'Target' },
    { href: '/leave', label: 'Leave Approvals', desc: 'Approve / reject requests', icon: 'Briefcase' },
    { href: '/hierarchy', label: 'Dept Hierarchy', desc: 'Chain of command', icon: 'Network' },
    { href: '/training', label: 'Training', desc: 'Records & certifications', icon: 'GraduationCap' },
  ],
  admin: [
    { href: '/admin', label: 'Administration', desc: 'Users & roles', icon: 'Users', tone: 'bg-primary/15 text-primary' },
    { href: '/admin/config', label: 'Configuration', desc: 'Categories, leave & shift types', icon: 'SlidersHorizontal' },
    { href: '/admin/personnel', label: 'Personnel', desc: 'Operational staff register', icon: 'IdCard' },
    { href: '/admin/vehicles', label: 'Fleet', desc: 'Apparatus register', icon: 'RadioTower' },
    { href: '/admin/devices', label: 'Devices', desc: 'MDTs, radios, tablets', icon: 'Radio' },
    { href: '/analytics', label: 'Analytics', desc: 'System-wide trends', icon: 'BarChart3' },
    { href: '/dispatch/kpi', label: 'KPI Dashboard', desc: 'Live operational metrics', icon: 'BarChart3' },
    { href: '/case-manager/audit', label: 'Audit Log', desc: 'System audit trail', icon: 'Activity' },
  ],
  viewer: [
    { href: '/incidents', label: 'All Incidents', desc: 'Read-only incident log', icon: 'MapPinned' },
    { href: '/incidents/map', label: 'Live Map', desc: 'Incidents + units', icon: 'Map' },
    { href: '/reports', label: 'Reports Archive', desc: 'Closed & resolved', icon: 'FileText' },
    { href: '/analytics', label: 'Analytics', desc: 'Trends & statistics', icon: 'BarChart3' },
  ],
};

const PERSONA_TITLE: Record<Persona, string> = {
  admin: 'System Administration', command: 'Command Centre', supervisor: 'Supervisor Console',
  responder: 'Responder Portal', viewer: 'Operations Overview',
};

function DashboardLogo() {
  return (
    <div className="flex justify-end">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/hiktech-brand.svg" alt="HIKTECH" className="h-auto w-[160px] max-w-full rounded-md bg-white p-2" />
    </div>
  );
}

function Tile({ label, value, accent = 'text-fg' }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={`mt-2 text-3xl font-bold ${accent}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

function ActiveIncidentsPanel({ rows }: { rows: Awaited<ReturnType<typeof listActiveIncidents>> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Active incidents ({rows.length})</CardTitle>
        <CardDescription>Dispatched, en route, on scene or transporting — updates in realtime.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <SimpleTable headers={['Incident', 'Type', 'Severity', 'Status', 'Location', 'Logged', '']} empty="No active incidents.">
          {rows.slice(0, 10).map((i) => (
            <Tr key={i.id}>
              <Td className="font-mono">{i.incident_number}</Td>
              <Td>{i.incident_type}</Td>
              <Td><span className="severity-pill" data-sev={i.incident_severity}>{i.incident_severity}</span></Td>
              <Td><span className="status-badge" data-status={i.status}>{i.status}</span></Td>
              <Td className="max-w-[240px] truncate">{i.location_address}</Td>
              <Td className="text-muted-foreground">{timeAgo(i.incident_created_at)}</Td>
              <Td><Link href={`/incidents/${i.id}`} className="text-accent hover:underline">Open</Link></Td>
            </Tr>
          ))}
        </SimpleTable>
      </CardContent>
    </Card>
  );
}

type SearchParams = Record<string, string | string[] | undefined>;

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { supabase, silo, role, fullName, userId } = await getSession();
  if (role === 'SystemController') redirect('/command');
  // The case manager's dashboard is Case Management (0061); one place, not two.
  if (role === 'CaseManager') redirect('/case-manager');
  // The receiving doctor's console is the handovers list.
  if (role === 'Doctor') redirect('/medical/handovers');
  // As V4: fire command opens on the fire board, the disaster desk on its dashboard.
  if (isFireCommand(role, silo)) redirect('/fire');
  if (isDisasterDesk(role, silo)) redirect('/disaster');
  const params = await searchParams;
  // Fines (0057): for those who see the whole register, when enforcement is on.
  const showFines = canViewAllFines({ role, silo })
    && featureEnabled(await getFeatures().catch(() => ({})), 'web.enforcement');
  if (role === 'Captain') {
    return <CaptainDashboard supabase={supabase} silo={silo} fullName={fullName} userId={userId} params={params} showFines={showFines} />;
  }
  if (isEmsAdmin(role, silo)) return <EmsAdminDashboard supabase={supabase} fullName={fullName} />;
  const persona = resolvePersona(role);
  const sf = siloFilter(silo);
  const first = fullName.split(' ')[0];
  const usesSidebar = hasSidebar(role, silo);

  // Dispatchers get the V4-style ops board: stats above the fold, feed +
  // critical wait, the live map, throughput. Quick actions follow below.
  if (persona === 'command') {
    return (
      <div className="space-y-4">
        {!usesSidebar && <DashboardLogo />}
        <DispatchBoard supabase={supabase} sf={sf} role={role} silo={silo} userId={userId} />
        <section className="space-y-3 pt-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Quick actions</h2>
          <QuickLinks links={LINKS.command} role={role} silo={silo} />
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Live: on-duty and incident figures move without a refresh. */}
      <BoardLive />
      {!usesSidebar && <DashboardLogo />}
      {/* Hero */}
      <section className="overflow-hidden rounded-2xl border border-border bg-gradient-to-r from-primary/15 via-bg-card to-bg-soft p-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">{PERSONA_TITLE[persona]}</p>
        <h1 className="mt-1 text-2xl font-bold">Welcome back, {first}</h1>
        <p className="text-sm text-muted-foreground">
          {role} · {silo} · live operations for your role.
        </p>
      </section>

      {/* Quick links — "all those links and so forth", tailored per role */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Quick actions</h2>
        <QuickLinks links={LINKS[persona]} role={role} silo={silo} />
      </section>

      {/* Persona-specific body */}
      {(persona === 'admin' || persona === 'viewer') && (
        <CommandBody supabase={supabase} sf={sf} persona={persona} />
      )}
      {persona === 'supervisor' && <SupervisorBody supabase={supabase} sf={sf} />}
      {persona === 'responder' && (
        <ResponderBody supabase={supabase} userId={userId} silo={silo} fullName={fullName} />
      )}
      {showFines && <FinesPanel supabase={supabase} params={params} userId={userId} />}
    </div>
  );
}

async function CaptainDashboard({
  supabase, silo, fullName, userId, params, showFines,
}: {
  supabase: Awaited<ReturnType<typeof getSession>>['supabase'];
  silo: Silo; fullName: string; userId: string; params: SearchParams; showFines: boolean;
}) {
  const sf = siloFilter(silo);
  const me = await getMyPersonnel(supabase, userId).catch(() => null);
  const [personnel, active, compliance, mine, cams] = await Promise.all([
    listPersonnel(supabase, sf),
    listActiveIncidents(supabase, sf),
    getUnitCompliance(supabase, sf).catch(() => ({ mentalChecks: [], vehicleChecklists: [] })),
    listMyCalls(supabase, userId).catch(() => []),
    // Bodycams (0054): none until that migration is run.
    listBookedOutBodycams(supabase).catch(() => []),
  ]);
  const onDuty = personnel.filter((person) => person.is_on_duty).length;
  const camsOn = cams.filter((c) => c.holder?.onDuty && canWatchBodycam({ role: 'Captain', silo }, c.bodycam.silo, 'live')).length;

  return (
    <div className="space-y-5">
      <BoardLive />
      <section className="relative overflow-hidden rounded-2xl border border-accent/25 bg-gradient-to-br from-accent/20 via-bg-card to-bg-soft p-5 shadow-[0_12px_40px_-30px_var(--accent)] sm:p-7">
        <div aria-hidden className="pointer-events-none absolute -right-10 -top-20 h-56 w-56 rounded-full bg-accent/10 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-accent">Metro Police · Captain</p>
            <h1 className="mt-2 text-2xl font-bold text-fg sm:text-3xl">Your team, at a glance</h1>
            <p className="mt-1 text-sm text-muted-foreground">{fullName} · Crew readiness, live incidents and your own assignments.</p>
          </div>
          <Link href="/roster/allocation" className="inline-flex min-h-10 items-center rounded-lg bg-accent px-4 text-sm font-bold text-bg shadow-sm transition-opacity hover:opacity-90">
            Open duty board →
          </Link>
        </div>
      </section>

      <section aria-label="Team status" className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
        <Tile label="Team members" value={personnel.length} />
        <Tile label="On duty now" value={onDuty} accent="text-severity-low-ink" />
        <Tile label="Readiness checks today" value={compliance.mentalChecks.length} accent="text-accent" />
        <Tile label="Active police incidents" value={active.length} accent="text-severity-medium-ink" />
        <Tile label="Team bodycams on" value={camsOn} accent="text-severity-critical-ink" />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { href: '/responder', label: 'My incidents', detail: `${mine.length} assigned to your unit` },
          { href: '/cameras', label: 'Body cams', detail: `${camsOn} on duty wearing one now` },
          { href: '/police', label: 'Police operations', detail: 'Department tools and reports' },
          ...(showFines ? [{ href: '/police/fines', label: 'Fines register', detail: 'Every notice your officers served' }] : []),
          { href: '/roster/mine', label: 'My schedule', detail: 'Your upcoming duty' },
        ].map((item) => (
          <Link key={item.href} href={item.href} className="group rounded-xl border border-border bg-bg-card p-4 transition-colors hover:border-accent/50 hover:bg-accent/5">
            <span className="block text-sm font-bold text-fg group-hover:text-accent">{item.label} →</span>
            <span className="mt-1 block text-xs text-muted-foreground">{item.detail}</span>
          </Link>
        ))}
      </section>

      {showFines && <FinesPanel supabase={supabase} params={params} userId={userId} />}

      <ActiveIncidentsPanel rows={active} />
    </div>
  );
}

// ── EMS administrator ────────────────────────────────────────────────
async function EmsAdminDashboard({
  supabase, fullName,
}: {
  supabase: Awaited<ReturnType<typeof getSession>>['supabase']; fullName: string;
}) {
  const [personnel, ambulances, active, compliance, pcrs] = await Promise.all([
    listPersonnel(supabase, 'Medical').catch(() => []),
    listApparatus(supabase, 'Medical').catch(() => []),
    listActiveIncidents(supabase, 'Medical').catch(() => []),
    getUnitCompliance(supabase, 'Medical').catch(() => ({ mentalChecks: [], vehicleChecklists: [] })),
    listPcrs(supabase).catch(() => []),
  ]);
  const onDuty = personnel.filter((p) => p.is_on_duty).length;
  const fleet = ambulances.filter((a) => a.status !== 'Decommissioned');
  const inService = fleet.filter((a) => ['Available', 'In Use', 'En Route', 'On Scene'].includes(a.status)).length;
  const offRoad = fleet.filter((a) => a.status === 'Out of Service' || a.status === 'Maintenance').length;
  const live = active.filter((i) => !['New', 'Pending', 'Pending Dispatch', 'Pending Analysis'].includes(i.status));
  const saDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(d);
  const today = saDay(new Date());
  const filedToday = pcrs.filter((p) => saDay(new Date(p.filed_at ?? p.created_at)) === today).length;

  return (
    <div className="space-y-5">
      <BoardLive />
      <section className="relative overflow-hidden rounded-2xl border border-accent/25 bg-gradient-to-br from-accent/20 via-bg-card to-bg-soft p-5 shadow-[0_12px_40px_-30px_var(--accent)] sm:p-7">
        <div aria-hidden className="pointer-events-none absolute -right-10 -top-20 h-56 w-56 rounded-full bg-accent/10 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-accent">Emergency Medical Services · Administration</p>
            <h1 className="mt-2 text-2xl font-bold text-fg sm:text-3xl">EMS at a glance</h1>
            <p className="mt-1 text-sm text-muted-foreground">{fullName} · Crews, ambulances, live calls and patient reports.</p>
          </div>
          <Link href="/medical" className="inline-flex min-h-10 items-center rounded-lg bg-accent px-4 text-sm font-bold text-bg shadow-sm transition-opacity hover:opacity-90">
            Open EMS operations →
          </Link>
        </div>
      </section>

      <section aria-label="EMS status" className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Tile label="Crew on duty" value={onDuty} accent="text-severity-low-ink" />
        <Tile label="Readiness checks today" value={compliance.mentalChecks.length} accent="text-accent" />
        <Tile label="Ambulances in service" value={`${inService}/${fleet.length}`} />
        <Tile label="Ambulances off road" value={offRoad} accent="text-severity-high-ink" />
        <Tile label="Live EMS calls" value={live.length} accent="text-severity-medium-ink" />
        <Tile label="Patient reports today" value={filedToday} />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { href: '/medical/pcr', label: 'Clinical Archive', detail: `${pcrs.length} patient care reports` },
          { href: '/shift/today', label: 'Today’s shift', detail: 'Crews, ambulances and checks' },
          { href: '/admin/vehicles', label: 'Ambulances', detail: `${offRoad} off road` },
          { href: '/roster/allocation', label: 'Duty allocation', detail: 'Crews on each post' },
        ].map((item) => (
          <Link key={item.href} href={item.href} className="group rounded-xl border border-border bg-bg-card p-4 transition-colors hover:border-accent/50 hover:bg-accent/5">
            <span className="block text-sm font-bold text-fg group-hover:text-accent">{item.label} →</span>
            <span className="mt-1 block text-xs text-muted-foreground">{item.detail}</span>
          </Link>
        ))}
      </section>

      <ActiveIncidentsPanel rows={active} />
    </div>
  );
}

// ── Command / Admin / Viewer body ────────────────────────────────────
async function CommandBody({
  supabase, sf, persona,
}: {
  supabase: Awaited<ReturnType<typeof getSession>>['supabase']; sf: Silo | undefined; persona: Persona;
}) {
  const [kpi, active, pending, adminCounts] = await Promise.all([
    getDispatcherKpis(supabase, sf),
    listActiveIncidents(supabase, sf),
    listPendingIncidents(supabase, sf),
    persona === 'admin'
      ? Promise.all([
          listAllProfiles(supabase, sf).then((r) => r.length),
          listApparatus(supabase, sf).then((r) => r.length),
          listDevices(supabase, sf).then((r) => r.length),
        ])
      : Promise.resolve(null),
  ]);

  const hourly = Array.from({ length: 24 }, (_, h) => ({ hour: `${String(h).padStart(2, '0')}:00`, calls: kpi.hourlyDistribution?.[h] ?? 0 }));
  const severity = (['Low', 'Medium', 'High', 'Critical'] as const).map((name, i) => ({ name, value: kpi.priorityData?.[i] ?? 0 }));

  return (
    <>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile label="Active deployments" value={kpi.activeDeployments} accent="text-accent" />
        <Tile label="Pending dispatch" value={pending.length} accent="text-severity-medium-ink" />
        <Tile label="Critical today" value={kpi.criticalAlertsToday} accent="text-severity-critical-ink" />
        <Tile label="Total calls today" value={kpi.totalIncidentsToday} />
        <Tile label="Personnel on duty" value={kpi.personnelOnDuty} accent="text-severity-low-ink" />
      </section>

      {adminCounts && (
        <section className="grid grid-cols-3 gap-3">
          <Tile label="Users" value={adminCounts[0]} />
          <Tile label="Fleet vehicles" value={adminCounts[1]} />
          <Tile label="Devices" value={adminCounts[2]} />
        </section>
      )}

      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Call volume — today</CardTitle><CardDescription>Hourly distribution.</CardDescription></CardHeader>
          <CardContent><HourlyAreaChart data={hourly} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Severity mix</CardTitle><CardDescription>All calls by priority.</CardDescription></CardHeader>
          <CardContent><SeverityDonut data={severity} /></CardContent>
        </Card>
      </section>

      <ActiveIncidentsPanel rows={active} />
    </>
  );
}

// ── Supervisor body ──────────────────────────────────────────────────
async function SupervisorBody({
  supabase, sf,
}: {
  supabase: Awaited<ReturnType<typeof getSession>>['supabase']; sf: Silo | undefined;
}) {
  const [kpi, active, personnel, compliance] = await Promise.all([
    getDispatcherKpis(supabase, sf),
    listActiveIncidents(supabase, sf),
    listPersonnel(supabase, sf),
    getUnitCompliance(supabase, sf).catch(() => ({ mentalChecks: [], vehicleChecklists: [] })),
  ]);
  const onDuty = personnel.filter((p) => p.is_on_duty).length;

  return (
    <>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Team members" value={personnel.length} />
        <Tile label="On duty now" value={onDuty} accent="text-severity-low-ink" />
        <Tile label="Readiness checks today" value={compliance.mentalChecks.length} accent="text-accent" />
        <Tile label="Active incidents" value={active.length} accent="text-severity-medium-ink" />
      </section>
      <ActiveIncidentsPanel rows={active} />
    </>
  );
}

// ── Responder body ───────────────────────────────────────────────────
async function ResponderBody({
  supabase, userId, silo, fullName,
}: {
  supabase: Awaited<ReturnType<typeof getSession>>['supabase']; userId: string; silo: Silo; fullName: string;
}) {
  const now = new Date();
  const cycleStart = now.getMonth() >= 6 ? new Date(now.getFullYear(), 6, 1) : new Date(now.getFullYear() - 1, 6, 1);

  const me = await getMyPersonnel(supabase, userId).catch(() => null);
  const [mine, shiftDone, perf] = await Promise.all([
    listMyCalls(supabase, userId).catch(() => []),
    hasCompletedShiftStartToday(supabase).catch(() => false),
    getMyPerformance(supabase, {
      from: cycleStart.toISOString().slice(0, 10),
      to: new Date(now.getTime() + 86400000).toISOString().slice(0, 10),
      displayName: fullName, userId, silo,
    }).catch(() => null),
  ]);

  return (
    <>
      {!shiftDone && (
        <Link href="/shift/mental-check" className="block rounded-xl border border-severity-medium/40 bg-severity-medium/10 p-4 text-sm font-semibold text-severity-medium-ink hover:bg-severity-medium/20">
          ⚠ Start-of-shift checks pending — complete your readiness & vehicle inspection to go on duty →
        </Link>
      )}

      {perf && (
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile label="My open calls" value={mine.length} accent="text-accent" />
          <Tile label="Attended (cycle)" value={perf.asResponder.total} />
          <Tile label="Closed" value={perf.asResponder.closed} accent="text-severity-low-ink" />
          <Tile label="Appraisal /5" value={perf.finalAverage ?? perf.midYearAverage ?? '—'} accent="text-severity-medium-ink" />
        </section>
      )}

      <Card>
        <CardHeader>
          <CardTitle>My incidents ({mine.length})</CardTitle>
          <CardDescription>
            {me ? `Unit ${me.apparatus?.unit_number ?? '—'} · ${me.is_on_duty ? 'On duty' : 'Off duty'}` : 'No personnel record linked to your account.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable headers={['Incident', 'Type', 'Severity', 'Status', 'Location', '']} empty="No open calls. Calls sent to you appear here and in the HikTech app.">
            {mine.map((i) => (
              <Tr key={i.id}>
                <Td className="font-mono">{i.incident_number}</Td>
                <Td>{i.incident_type}</Td>
                <Td><span className="severity-pill" data-sev={i.incident_severity}>{i.incident_severity}</span></Td>
                <Td><span className="status-badge" data-status={i.status}>{i.status}</span></Td>
                <Td className="max-w-[240px] truncate">{i.location_address}</Td>
                <Td><Link href={`/incidents/${i.id}`} className="text-accent hover:underline">Open</Link></Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </>
  );
}

