import Link from 'next/link';
import { ChevronLeft, ChevronRight, Umbrella } from 'lucide-react';
import {
  getCoverageImpact, getLeaveBalances, getLeaveMonth, inclusiveDays, listActiveConfig, listLeaveEntries, saDay,
} from '@criticom/api';
import { canManageRoster, type Silo } from '@criticom/db';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { ApplyLeaveForm, LeaveCancel, LeaveDecision } from '@/components/schedule/leave-actions';
import { getSession, siloFilter } from '@/lib/session';
import { cn } from '@/lib/utils';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Leave · HikTech' };

const FALLBACK_TYPES = ['Annual', 'Sick', 'Family Responsibility', 'Study', 'Maternity/Paternity', 'Unpaid', 'Special'];

const STATUS_TONE: Record<string, string> = {
  Approved: 'text-severity-low-ink',
  Rejected: 'text-severity-critical-ink',
  Pending: 'text-severity-medium-ink',
  Cancelled: 'text-muted-foreground',
};
const STATUS_WORD: Record<string, string> = { Rejected: 'Not approved' };

export default async function LeavePage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const { t } = await requestT();
  const { supabase, role, silo, userId } = await getSession();
  // Those who roster a department decide its leave (0072); the database
  // checks each decision against the person asking.
  const isApprover = canManageRoster(role, silo);
  const sf = siloFilter(silo);
  const today = saDay();

  const { m } = await searchParams;
  const now = new Date();
  const [year, month] = /^\d{4}-\d{2}$/.test(m ?? '')
    ? [Number(m!.slice(0, 4)), Number(m!.slice(5, 7)) - 1]
    : [now.getFullYear(), now.getMonth()];
  const monthFirst = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const monthName = new Date(year, month, 1).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' });
  const prev = `${month === 0 ? year - 1 : year}-${String((month === 0 ? 12 : month)).padStart(2, '0')}`;
  const next = `${month === 11 ? year + 1 : year}-${String((month === 11 ? 1 : month + 2)).padStart(2, '0')}`;

  const [entries, leaveTypes, balances, calendar] = await Promise.all([
    // The row rules decide what comes back: your own, and your department's
    // for those who roster it.
    listLeaveEntries(supabase, isApprover ? undefined : userId),
    listActiveConfig(supabase, 'LeaveType').catch(() => []),
    getLeaveBalances(supabase, { userId }).catch(() => []),
    isApprover ? getLeaveMonth(supabase, { monthFirstDayIso: monthFirst, silo: sf }).catch(() => []) : Promise.resolve([]),
  ]);
  const absenceTypes = leaveTypes.length > 0
    ? leaveTypes.filter((t) => t.detail2 !== 'Office').map((t) => t.name ?? '').filter(Boolean)
    : FALLBACK_TYPES;

  const mine = entries.filter((e) => e.user_id === userId);
  const toDecide = isApprover ? entries.filter((e) => e.user_id !== userId && e.status === 'Pending') : [];
  const othersApproved = isApprover
    ? entries.filter((e) => e.user_id !== userId && e.status === 'Approved' && e.eff_to >= today).slice(0, 30)
    : [];

  const coverage = new Map(
    await Promise.all(
      toDecide.slice(0, 12).map(async (e) => {
        const impact = await getCoverageImpact(supabase, {
          silo: e.silo as Silo, from: e.eff_from, to: e.eff_to,
        }).catch(() => null);
        return [e.id, impact] as const;
      }),
    ),
  );

  const daysOf = (l: { days: number | null; eff_from: string; eff_to: string }) =>
    l.days != null ? Number(l.days) : inclusiveDays(l.eff_from, l.eff_to);

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7; // Monday-first
  const dayEntries = (day: number) => {
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return calendar.filter((c) => c.eff_from.slice(0, 10) <= iso && c.eff_to.slice(0, 10) >= iso);
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">{t('Leave')}</h1>
        <p className="text-muted-foreground">
          {isApprover ? 'Your leave, and the requests waiting for you.' : 'Your balances and your requests.'}
        </p>
      </header>

      {balances.some((b) => b.entitlement > 0) ? (
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
                    <span className="text-sm font-normal text-muted-foreground"> {' '}{t('/ {entitlement} days left', { entitlement: b.entitlement })}</span>
                  </p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn('h-full rounded-full', used >= 90 ? 'bg-severity-critical' : used >= 65 ? 'bg-severity-medium' : 'bg-severity-low')}
                      style={{ width: `${used}%` }}
                    />
                  </div>
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    {t('{taken} taken{value}', { taken: b.taken, value: b.pending > 0 ? ` · ${b.pending} pending` : '' })}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t('Ask for leave')}</h2>
        <ApplyLeaveForm types={absenceTypes} />
        <p className="text-xs text-muted-foreground">
          {t('Days are counted from your roster: the shifts the leave covers, and working days after it.')}</p>
      </section>

      {isApprover ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('Waiting for you ({length})', { length: toDecide.length })}</CardTitle>
            <CardDescription>{t('Shows how many in the department would be away if granted.')}</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <SimpleTable headers={['Who', 'Type', 'From', 'To', 'Days', 'Reason', '']} empty={t('Nothing waiting.')}>
              {toDecide.map((l) => {
                const impact = coverage.get(l.id);
                return (
                  <Tr key={l.id}>
                    <Td className="font-medium">{l.applicant_name ?? 'Member'}</Td>
                    <Td>{l.absence ?? '—'}</Td>
                    <Td className="font-mono">{l.eff_from}</Td>
                    <Td className="font-mono">{l.eff_to}</Td>
                    <Td className="font-mono">{daysOf(l)}</Td>
                    <Td className="max-w-[220px] truncate">{l.reason ?? '—'}</Td>
                    <Td>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {impact ? (
                          <span
                            title={`${impact.onLeave} of ${impact.headcount} away in this window`}
                            className={cn(
                              'rounded-full px-2 py-0.5 text-[10px] font-bold',
                              impact.pct >= 25 ? 'bg-severity-critical/15 text-severity-critical-ink'
                                : impact.pct >= 15 ? 'bg-severity-medium/15 text-severity-medium-ink'
                                  : 'bg-severity-low/15 text-severity-low-ink',
                            )}
                          >
                            {t('{pct}% away', { pct: impact.pct })}</span>
                        ) : null}
                        <LeaveDecision id={l.id} />
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </SimpleTable>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('My leave')}</CardTitle>
          <CardDescription>{t('Cancel a request any time before your leave starts.')}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable headers={['Type', 'From', 'To', 'Days', 'Status', 'Decided by', '']} empty={t('No leave requests.')}>
            {mine.map((l) => (
              <Tr key={l.id}>
                <Td>{l.absence ?? '—'}</Td>
                <Td className="font-mono">{l.eff_from}</Td>
                <Td className="font-mono">{l.eff_to}</Td>
                <Td className="font-mono">{daysOf(l)}</Td>
                <Td>
                  <span className={STATUS_TONE[l.status] ?? ''}>{STATUS_WORD[l.status] ?? l.status}</span>
                  {l.review_comments ? <div className="max-w-[240px] truncate text-xs text-muted-foreground">{l.review_comments}</div> : null}
                </Td>
                <Td className="text-muted-foreground">{l.approved_by ?? '—'}</Td>
                <Td>
                  {l.status === 'Pending' || (l.status === 'Approved' && l.eff_from > today)
                    ? <LeaveCancel id={l.id} own /> : null}
                </Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>

      {isApprover ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t('Approved leave ahead')}</CardTitle>
              <CardDescription>{t('Cancelling gives the person their shifts back. Say why; they are told.')}</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <SimpleTable headers={['Who', 'Type', 'From', 'To', 'Days', 'Decided by', '']} empty={t('No approved leave ahead.')}>
                {othersApproved.map((l) => (
                  <Tr key={l.id}>
                    <Td className="font-medium">{l.applicant_name ?? 'Member'}</Td>
                    <Td>{l.absence ?? '—'}</Td>
                    <Td className="font-mono">{l.eff_from}</Td>
                    <Td className="font-mono">{l.eff_to}</Td>
                    <Td className="font-mono">{daysOf(l)}</Td>
                    <Td className="text-muted-foreground">{l.approved_by ?? '—'}</Td>
                    <Td><LeaveCancel id={l.id} own={false} /></Td>
                  </Tr>
                ))}
              </SimpleTable>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>{t('Who\'s away · {monthName}', { monthName })}</CardTitle>
                <CardDescription>{t('Solid: approved. Outlined: waiting for a decision.')}</CardDescription>
              </div>
              <div className="flex items-center gap-1">
                <Link href={`/leave?m=${prev}`} aria-label={t('Previous month')} className="rounded-md border border-border p-1.5 hover:bg-muted"><ChevronLeft className="h-4 w-4" /></Link>
                <Link href={`/leave?m=${next}`} aria-label={t('Next month')} className="rounded-md border border-border p-1.5 hover:bg-muted"><ChevronRight className="h-4 w-4" /></Link>
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
                      {off.length > 3 ? <p className="text-[10px] text-muted-foreground">{t('+{value} more', { value: off.length - 3 })}</p> : null}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
