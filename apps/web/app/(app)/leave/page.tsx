import Link from 'next/link';
import { ChevronLeft, ChevronRight, Umbrella } from 'lucide-react';
import {
  getCoverageImpact, getLeaveBalances, getLeaveMonth, inclusiveDays,
  listActiveConfig, listLeaveEntries,
} from '@criticom/api';
import { ADMIN_ROLES, type Silo } from '@criticom/db';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { FormSection, TextField, TextAreaField, SelectField } from '@/components/fields';
import { getSession, siloFilter } from '@/lib/session';
import { cn } from '@/lib/utils';
import { applyLeaveAction, setLeaveStatusAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Leave · Criticom' };

const FALLBACK_TYPES = ['Annual', 'Sick', 'Family Responsibility', 'Study', 'Maternity/Paternity', 'Unpaid', 'Special'];

const STATUS_TONE: Record<string, string> = {
  Approved: 'text-severity-low-ink',
  Rejected: 'text-severity-critical-ink',
  Pending: 'text-severity-medium-ink',
};

export default async function LeavePage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const { supabase, role, silo, userId } = await getSession();
  const isApprover = ADMIN_ROLES.includes(role) || role === 'Supervisor';
  const sf = siloFilter(silo);

  // ?m=YYYY-MM drives the calendar; default to the current month.
  const { m } = await searchParams;
  const now = new Date();
  const [year, month] = /^\d{4}-\d{2}$/.test(m ?? '')
    ? [Number(m!.slice(0, 4)), Number(m!.slice(5, 7)) - 1]
    : [now.getFullYear(), now.getMonth()];
  const monthFirst = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const monthLabel = new Date(year, month, 1).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' });
  const prev = `${month === 0 ? year - 1 : year}-${String((month === 0 ? 12 : month)).padStart(2, '0')}`;
  const next = `${month === 11 ? year + 1 : year}-${String((month === 11 ? 1 : month + 2)).padStart(2, '0')}`;

  const [entries, leaveTypes, balances, calendar] = await Promise.all([
    listLeaveEntries(supabase, isApprover ? undefined : userId),
    listActiveConfig(supabase, 'LeaveType').catch(() => []),
    getLeaveBalances(supabase, { userId }).catch(() => []),
    getLeaveMonth(supabase, { monthFirstDayIso: monthFirst, silo: sf }).catch(() => []),
  ]);
  const absenceTypes = leaveTypes.length > 0
    ? leaveTypes.map((t) => t.name ?? '').filter(Boolean)
    : FALLBACK_TYPES;

  // Coverage impact for the pending rows an approver is about to decide on.
  const pending = isApprover ? entries.filter((e) => e.status === 'Pending').slice(0, 12) : [];
  const coverage = new Map(
    await Promise.all(
      pending.map(async (e) => {
        const impact = await getCoverageImpact(supabase, {
          silo: e.silo as Silo, from: e.eff_from, to: e.eff_to,
        }).catch(() => null);
        return [e.id, impact] as const;
      }),
    ),
  );

  // Calendar grid: which entries touch each day of the month.
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7; // Monday-first
  const dayEntries = (day: number) => {
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return calendar.filter((c) => c.eff_from.slice(0, 10) <= iso && c.eff_to.slice(0, 10) >= iso);
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Leave</h1>
        <p className="text-muted-foreground">
          {isApprover
            ? 'Balances, the department calendar, and pending approvals with coverage impact.'
            : 'Your balances, the department calendar, and your requests.'}
        </p>
      </header>

      {/* ── My balances ── */}
      {balances.length > 0 ? (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {balances.filter((b) => b.entitlement > 0).map((b) => {
            const used = Math.min(100, Math.round(((b.taken + b.pending) / b.entitlement) * 100));
            return (
              <Card key={b.type}>
                <CardContent className="p-4">
                  <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    <Umbrella className="h-3.5 w-3.5" /> {b.type}
                  </p>
                  <p className="mt-2 text-2xl font-bold">
                    {b.remaining}
                    <span className="text-sm font-normal text-muted-foreground"> / {b.entitlement} days left</span>
                  </p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn('h-full rounded-full', used >= 90 ? 'bg-severity-critical' : used >= 65 ? 'bg-severity-medium' : 'bg-severity-low')}
                      style={{ width: `${used}%` }}
                    />
                  </div>
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    {b.taken} taken{b.pending > 0 ? ` · ${b.pending} pending` : ''}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </section>
      ) : null}

      {/* ── Apply ── */}
      <form action={applyLeaveAction} className="space-y-4">
        <FormSection title="Apply for leave">
          <SelectField name="absence" label="Type" options={absenceTypes} required />
          <TextField name="eff_from" label="From" type="date" required />
          <TextField name="eff_to" label="To" type="date" required />
          <TextField name="rank" label="Rank" />
          <TextField name="service_no" label="Service number" />
          <TextAreaField name="reason" label="Reason (helps your approver)" className="sm:col-span-2 lg:col-span-3" />
        </FormSection>
        <button type="submit" className="h-10 w-full rounded-md bg-primary text-sm font-semibold">Submit request</button>
      </form>

      {/* ── Department calendar ── */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Who&apos;s away — {monthLabel}</CardTitle>
            <CardDescription>Solid chips are approved; outlined are still pending.</CardDescription>
          </div>
          <div className="flex items-center gap-1">
            <Link href={`/leave?m=${prev}`} aria-label="Previous month" className="rounded-md border border-border p-1.5 hover:bg-muted"><ChevronLeft className="h-4 w-4" /></Link>
            <Link href={`/leave?m=${next}`} aria-label="Next month" className="rounded-md border border-border p-1.5 hover:bg-muted"><ChevronRight className="h-4 w-4" /></Link>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border text-xs">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
              <div key={d} className="bg-bg-soft px-2 py-1.5 text-center font-bold uppercase tracking-wider text-muted-foreground">{d}</div>
            ))}
            {Array.from({ length: firstWeekday }, (_, i) => (
              <div key={`pad-${i}`} className="min-h-20 bg-bg-card/50" />
            ))}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1;
              const off = dayEntries(day);
              return (
                <div key={day} className="min-h-20 space-y-1 bg-bg-card p-1.5">
                  <p className="text-[10px] font-bold text-muted-foreground">{day}</p>
                  {off.slice(0, 3).map((e) => (
                    <p
                      key={`${e.id}-${day}`}
                      title={`${e.name} · ${e.absence ?? 'Leave'} (${e.status})`}
                      className={cn(
                        'truncate rounded px-1 py-0.5 text-[10px] font-semibold leading-tight',
                        e.status === 'Approved'
                          ? 'bg-accent/20 text-fg'
                          : 'border border-severity-medium/50 text-severity-medium-ink',
                      )}
                    >
                      {e.name.split(' ')[0]}
                    </p>
                  ))}
                  {off.length > 3 ? (
                    <p className="text-[10px] text-muted-foreground">+{off.length - 3} more</p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ── Requests ── */}
      <Card>
        <CardHeader>
          <CardTitle>{entries.length} requests</CardTitle>
          <CardDescription>
            {isApprover
              ? 'Pending rows show how thin the department runs if granted.'
              : 'Your full request history with the approval trail.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable
            headers={['Type', 'From', 'To', 'Days', 'Reason', 'Status', 'Decided by', isApprover ? 'Action' : '']}
            empty="No leave requests."
          >
            {entries.map((l) => {
              const impact = coverage.get(l.id);
              return (
                <Tr key={l.id}>
                  <Td>{l.absence ?? '—'}</Td>
                  <Td className="font-mono">{l.eff_from}</Td>
                  <Td className="font-mono">{l.eff_to}</Td>
                  <Td className="font-mono">{inclusiveDays(l.eff_from, l.eff_to)}</Td>
                  <Td className="max-w-[220px] truncate">{l.reason ?? '—'}</Td>
                  <Td><span className={STATUS_TONE[l.status] ?? ''}>{l.status}</span></Td>
                  <Td className="text-muted-foreground">{l.approved_by ?? '—'}</Td>
                  <Td>
                    {isApprover && l.status === 'Pending' ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {impact ? (
                          <span
                            title={`${impact.onLeave} of ${impact.headcount} away in this window`}
                            className={cn(
                              'rounded-full px-2 py-0.5 text-[10px] font-bold',
                              impact.pct >= 25
                                ? 'bg-severity-critical/15 text-severity-critical-ink'
                                : impact.pct >= 15
                                  ? 'bg-severity-medium/15 text-severity-medium-ink'
                                  : 'bg-severity-low/15 text-severity-low-ink',
                            )}
                          >
                            {impact.pct}% away
                          </span>
                        ) : null}
                        <form action={setLeaveStatusAction}>
                          <input type="hidden" name="id" value={l.id} />
                          <input type="hidden" name="status" value="Approved" />
                          <button type="submit" className="rounded bg-severity-low/20 px-2 py-1 text-xs text-severity-low-ink hover:bg-severity-low/30">Approve</button>
                        </form>
                        <form action={setLeaveStatusAction}>
                          <input type="hidden" name="id" value={l.id} />
                          <input type="hidden" name="status" value="Rejected" />
                          <button type="submit" className="rounded bg-severity-critical/20 px-2 py-1 text-xs text-severity-critical-ink hover:bg-severity-critical/30">Reject</button>
                        </form>
                      </div>
                    ) : null}
                  </Td>
                </Tr>
              );
            })}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
