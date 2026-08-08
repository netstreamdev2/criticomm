import Link from 'next/link';
import {
  dutyTaskCounts, featureEnabled, getDutySheet, listAllProfiles, listDutyTasks, listLeaveEntries,
} from '@criticom/api';
import { canAccess, type Silo } from '@criticom/db';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { getFeatures, hiddenHrefs, requireFeaturePage } from '@/lib/features';
import { getSession, siloFilter } from '@/lib/session';
import { cn, formatSaTime } from '@/lib/utils';
import { setLeaveStatusAction } from '../leave/actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Command · Criticomm' };

/**
 * The command dashboard — one screen with the operational day on it: who is
 * on duty, what leave is waiting, how today's allocation stands shift by
 * shift, what station tasks are due, and a launcher for every module.
 */

const QUICK_TABS = [
  { href: '/roster', label: 'Duty Roster' },
  { href: '/case-manager/audit', label: 'Audit Trail' },
  { href: '/leave', label: 'Maintain Leave' },
  { href: '/performance', label: 'Performance' },
  { href: '/attendance', label: 'Time & Attendance' },
];

/** The launcher — every module of the platform, grouped as on the wall. */
const MODULE_GROUPS: { label: string; items: { href: string; label: string }[] }[] = [
  {
    label: 'Staff & Personnel',
    items: [
      { href: '/admin/personnel', label: 'Staff Maintenance' },
      { href: '/admin/operators', label: 'Call Signs' },
      { href: '/admin/sections', label: 'Sections' },
      { href: '/roster', label: 'Endorsements' },
    ],
  },
  {
    label: 'Duty Management',
    items: [
      { href: '/roster/allocation', label: 'Duty Allocation' },
      { href: '/duty-tasks', label: 'Duty Maintenance' },
      { href: '/roster/duty-sheet', label: 'Duty Operations' },
      { href: '/attendance', label: 'Absence' },
      { href: '/leave', label: 'Leave' },
    ],
  },
  {
    label: 'Enforcement',
    items: [
      { href: '/police/fines', label: 'Fines' },
      { href: '/police/charges', label: 'Charges' },
      { href: '/police/transactions', label: 'Charge Transactions' },
      { href: '/police/warrants', label: 'Warrants' },
      { href: '/police/summons', label: 'Summons' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/dispatch/pending', label: 'Dispatch' },
      { href: '/mail', label: 'Mail' },
    ],
  },
];

function chipClass(status: string) {
  switch (status) {
    case 'CONFIRMED': return 'bg-severity-low/15 text-severity-low-ink';
    case 'ON LEAVE': return 'bg-severity-medium/15 text-severity-medium-ink';
    case 'ABSENT': return 'bg-severity-critical/15 text-severity-critical-ink';
    default: return 'bg-muted text-muted-foreground';
  }
}

export default async function CommandPage({
  searchParams,
}: {
  searchParams: Promise<{ silo?: string }>;
}) {
  await requireFeaturePage('web.command');
  const { supabase, silo, role } = await getSession();
  const params = await searchParams;

  // The controller and the global tier watch any department; a supervisor
  // lands on their own. Ethekwini-silo seats default to Metro Police —
  // the busiest board.
  const own = siloFilter(silo);
  const board = ((params.silo as Silo | undefined) ?? own ?? 'MetroPolice') as Silo;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' });

  const [features, profiles, leave, sheet, tasks] = await Promise.all([
    getFeatures(),
    listAllProfiles(supabase, own),
    listLeaveEntries(supabase),
    getDutySheet(supabase, { silo: board, date: today }),
    listDutyTasks(supabase, { silo: board }),
  ]);

  const onDuty = profiles.filter((p) => p.is_on_duty).length;
  const pending = leave.filter((l) => l.status === 'Pending');
  const weekOut = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const urgent = pending.filter((l) => l.eff_from <= weekOut);
  const approved = leave.filter((l) => l.status === 'Approved').length;
  const rejected = leave.filter((l) => l.status === 'Rejected').length;

  const onLeaveIds = new Set(sheet.onLeave.map((l) => l.user_id));
  const allocated = new Set(sheet.shifts.flatMap((b) => b.members.map((m) => m.user_id)));
  const strength = profiles.length || 1;
  const coverage = Math.round((allocated.size / strength) * 1000) / 10;
  const counts = dutyTaskCounts(tasks);
  const openTasks = tasks.filter((t) => t.status !== 'Completed' && t.status !== 'Cancelled');

  const hidden = hiddenHrefs(features);
  const mayApprove = ['SystemAdmin', 'SuperAdmin', 'Admin', 'Supervisor', 'SystemController'].includes(role);

  const memberStatus = (m: { user_id: string; status: string; acknowledged_at: string | null }) => {
    if (onLeaveIds.has(m.user_id)) return 'ON LEAVE';
    if (m.status === 'Absent') return 'ABSENT';
    return m.acknowledged_at ? 'CONFIRMED' : 'PENDING';
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Command</h1>
          <p className="text-muted-foreground">
            {new Date().toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Johannesburg' })}
            {' · '}{board} board
          </p>
        </div>
        <nav className="flex flex-wrap gap-2">
          {QUICK_TABS.filter((t) => !hidden.includes(t.href) && canAccess(t.href, role, silo)).map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className="inline-flex h-9 items-center rounded-md border border-border bg-bg-soft px-3 text-xs font-semibold uppercase tracking-wide transition-colors hover:bg-muted"
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </header>

      {/* ── Top stats ── */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Responders on duty</p>
            <p className="mt-1 text-4xl font-bold">{onDuty}</p>
            <p className="text-xs text-muted-foreground">of {profiles.length} personnel</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Leave for approval</p>
            <div className="mt-1 flex items-baseline gap-4">
              <span><span className="text-4xl font-bold">{pending.length}</span> <span className="text-xs text-severity-medium-ink">pending</span></span>
              <span><span className="text-4xl font-bold">{urgent.length}</span> <span className="text-xs text-severity-critical-ink">urgent</span></span>
            </div>
            <p className="text-xs text-muted-foreground">urgent = starts within 7 days</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Decisions to date</p>
            <div className="mt-1 flex items-baseline gap-4">
              <span><span className="text-4xl font-bold">{approved}</span> <span className="text-xs text-severity-low-ink">approved</span></span>
              <span><span className="text-4xl font-bold">{rejected}</span> <span className="text-xs text-severity-critical-ink">rejected</span></span>
            </div>
            <p className="text-xs text-muted-foreground">across all leave on record</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* ── Duty allocation ── */}
        <Card className="xl:col-span-1">
          <CardHeader>
            <CardTitle>Duty allocation</CardTitle>
            <CardDescription>Today&apos;s shift assignments — {board}.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {sheet.shifts.length === 0 && (
              <p className="text-sm text-muted-foreground">No allocations for today. Build the board in Duty Allocation.</p>
            )}
            {sheet.shifts.map((block) => (
              <div key={block.shiftName}>
                <div className="flex items-baseline justify-between rounded-md bg-muted px-3 py-1.5">
                  <span className="text-xs font-bold uppercase tracking-wide">{block.shiftName}</span>
                  <span className="text-[11px] text-muted-foreground">{block.members.length} member{block.members.length === 1 ? '' : 's'}</span>
                </div>
                <ul className="mt-1 space-y-1">
                  {block.members.slice(0, 8).map((m) => {
                    const st = memberStatus(m);
                    return (
                      <li key={m.id} className="flex items-center justify-between gap-2 px-2 py-1 text-sm">
                        <span className="min-w-0">
                          <span className="font-medium">{m.user_name}</span>
                          <span className="ml-2 text-xs text-muted-foreground">
                            {[m.sector, m.station].filter(Boolean).join(' — ')}
                          </span>
                        </span>
                        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase', chipClass(st))}>{st}</span>
                      </li>
                    );
                  })}
                  {block.members.length > 8 && (
                    <li className="px-2 text-xs text-muted-foreground">+ {block.members.length - 8} more on the duty sheet</li>
                  )}
                </ul>
              </div>
            ))}
            <div className="border-t border-border pt-3">
              <div className="flex items-baseline justify-between text-xs">
                <span className="text-muted-foreground">Allocation coverage</span>
                <span className="font-bold">{coverage}% · {allocated.size}/{profiles.length}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, coverage)}%` }} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Duty maintenance ── */}
        <Card className="xl:col-span-1">
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle>Duty maintenance</CardTitle>
              <CardDescription>Scheduled station tasks and their status.</CardDescription>
            </div>
            <Link href="/duty-tasks" className="text-xs font-semibold text-accent hover:underline">Open board →</Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {openTasks.length === 0 && <p className="text-sm text-muted-foreground">Nothing outstanding.</p>}
            {openTasks.slice(0, 5).map((t) => (
              <div key={t.id} className="rounded-md border border-border p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold">{t.title}</span>
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{t.task_number}</span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {[t.assigned_name, t.unit_ref, t.section_code, t.due_date ? `due ${t.due_date}` : null]
                    .filter(Boolean).join(' · ') || 'Unassigned'}
                </p>
                {t.progress > 0 && t.status !== 'Completed' && (
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-severity-medium" style={{ width: `${t.progress}%` }} />
                  </div>
                )}
              </div>
            ))}
            <div className="grid grid-cols-4 gap-2 border-t border-border pt-3 text-center">
              {([['Overdue', counts.overdue, 'text-severity-critical-ink'],
                 ['In progress', counts.inProgress, 'text-severity-medium-ink'],
                 ['Pending', counts.pending, 'text-muted-foreground'],
                 ['Done', counts.done, 'text-severity-low-ink']] as const).map(([label, n, tone]) => (
                <div key={label}>
                  <p className={cn('text-xl font-bold', tone)}>{n}</p>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* ── Leave approvals ── */}
        <Card className="xl:col-span-1">
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle>Leave approvals</CardTitle>
              <CardDescription>{pending.length} awaiting a decision.</CardDescription>
            </div>
            <Link href="/leave" className="text-xs font-semibold text-accent hover:underline">All leave →</Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {pending.length === 0 && <p className="text-sm text-muted-foreground">The queue is clear.</p>}
            {pending.slice(0, 6).map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-2 rounded-md border border-border p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{l.rank ? `${l.rank} ` : ''}{l.service_no ?? ''}</p>
                  <p className="text-xs text-muted-foreground">{l.absence} · {formatSaTime(l.eff_from)} → {formatSaTime(l.eff_to)}</p>
                </div>
                {mayApprove ? (
                  <div className="flex shrink-0 gap-1.5">
                    <form action={setLeaveStatusAction}>
                      <input type="hidden" name="id" value={l.id} />
                      <input type="hidden" name="status" value="Approved" />
                      <button type="submit" className="h-8 rounded-md bg-severity-low/20 px-3 text-xs font-semibold text-severity-low-ink transition-colors hover:bg-severity-low/30">
                        Approve
                      </button>
                    </form>
                    <form action={setLeaveStatusAction}>
                      <input type="hidden" name="id" value={l.id} />
                      <input type="hidden" name="status" value="Rejected" />
                      <button type="submit" aria-label="Reject" className="h-8 rounded-md bg-severity-critical/15 px-3 text-xs font-semibold text-severity-critical-ink transition-colors hover:bg-severity-critical/25">
                        ✕
                      </button>
                    </form>
                  </div>
                ) : (
                  <span className="text-[10px] uppercase text-muted-foreground">Pending</span>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* ── Module launcher ── */}
      <Card>
        <CardHeader>
          <CardTitle>System modules</CardTitle>
          <CardDescription>Every module on the platform — what your role and your organisation&apos;s switches allow.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {MODULE_GROUPS.map((g) => {
              const items = g.items.filter(
                (i) => canAccess(i.href, role, silo) && !hidden.includes(i.href)
                  && (g.label !== 'Enforcement' || featureEnabled(features, 'web.enforcement')),
              );
              if (items.length === 0) return null;
              return (
                <div key={g.label}>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">— {g.label}</p>
                  <ul className="space-y-1">
                    {items.map((i) => (
                      <li key={`${g.label}:${i.href}`}>
                        <Link href={i.href} className="block rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-muted">
                          {i.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
