import Link from 'next/link';
import {
  BadgeCheck, BarChart3, Briefcase, CalendarClock, GraduationCap, IdCard,
  ShieldAlert, Users,
} from 'lucide-react';
import { getCoverageImpact, inclusiveDays, listLeaveEntries, listPersonnel } from '@criticom/api';
import type { Silo } from '@criticom/db';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { getSession, siloFilter } from '@/lib/session';
import { cn } from '@/lib/utils';
import { setLeaveStatusAction } from '../leave/actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'HR Command Centre · HikTech' };

const QUICK = [
  { href: '/leave', label: 'Leave', desc: 'Balances, calendar, approvals', icon: Briefcase },
  { href: '/roster', label: 'Roster', desc: 'Shifts, generators, endorsements', icon: CalendarClock },
  { href: '/roster/duty-sheet', label: 'Duty Sheet', desc: 'Printable parade sheet', icon: IdCard },
  { href: '/training', label: 'Training', desc: 'Records & certifications', icon: GraduationCap },
  { href: '/performance/reports', label: 'Performance Reports', desc: 'By member, department, incident', icon: BarChart3 },
  { href: '/hierarchy', label: 'Hierarchy', desc: 'Chain of command', icon: Users },
];

export default async function HrHubPage() {
  const { supabase, silo } = await getSession();
  const sf = siloFilter(silo);
  const todayIso = new Date().toISOString().slice(0, 10);
  const soonIso = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

  const certsQ = supabase
    .from('certifications')
    .select('id, name, expiry_date, personnel_id, personnel:personnel_id (first_name, last_name, silo)')
    .lte('expiry_date', soonIso)
    .gte('expiry_date', todayIso)
    .order('expiry_date')
    .limit(10);

  const [personnel, leave, certs] = await Promise.all([
    listPersonnel(supabase, sf).catch(() => []),
    listLeaveEntries(supabase).catch(() => []),
    certsQ,
  ]);

  const onDuty = personnel.filter((p) => p.is_on_duty).length;
  const onLeaveToday = leave.filter(
    (l) => l.status === 'Approved' && l.eff_from <= todayIso && l.eff_to >= todayIso,
  ).length;
  const pending = leave.filter((l) => l.status === 'Pending').slice(0, 8);

  // Coverage chip per pending request, same signal the leave page shows.
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

  const expiring = (certs.data ?? []) as unknown as Array<{
    id: string; name: string; expiry_date: string;
    personnel: { first_name: string; last_name: string; silo: string } | null;
  }>;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">HR Command Centre</h1>
        <p className="text-muted-foreground">
          People readiness at a glance — coverage, approvals waiting, and what expires next.
        </p>
      </header>

      {/* ── Headline ── */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Headcount', value: personnel.length, tone: '' },
          { label: 'On duty now', value: onDuty, tone: 'text-severity-low-ink' },
          { label: 'On leave today', value: onLeaveToday, tone: 'text-severity-medium-ink' },
          { label: 'Approvals waiting', value: pending.length, tone: pending.length > 0 ? 'text-severity-critical-ink' : '' },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{s.label}</p>
              <p className={cn('mt-2 text-3xl font-bold', s.tone)}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      {/* ── Quick links ── */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {QUICK.map((q) => {
          const Icon = q.icon;
          return (
            <Link
              key={q.href}
              href={q.href}
              className="group flex items-center gap-3 rounded-xl border border-border bg-bg-card p-4 transition-colors hover:border-accent/50"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
                <Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-bold group-hover:text-fg">{q.label}</span>
                <span className="block truncate text-xs text-muted-foreground">{q.desc}</span>
              </span>
            </Link>
          );
        })}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── Approvals waiting ── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-severity-medium-ink" /> Approvals waiting
            </CardTitle>
            <CardDescription>Decide here — the member is alerted the moment you do.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {pending.length === 0 ? (
              <p className="px-6 py-10 text-center text-sm text-muted-foreground">Nothing waiting. 🎉</p>
            ) : (
              <ul className="divide-y divide-border">
                {pending.map((l) => {
                  const impact = coverage.get(l.id);
                  return (
                    <li key={l.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">
                          {l.absence ?? 'Leave'} · {inclusiveDays(l.eff_from, l.eff_to)} day{inclusiveDays(l.eff_from, l.eff_to) === 1 ? '' : 's'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {l.eff_from} → {l.eff_to} · {l.silo}{l.reason ? ` · ${l.reason}` : ''}
                        </p>
                      </div>
                      {impact ? (
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 text-[10px] font-bold',
                            impact.pct >= 25 ? 'bg-severity-critical/15 text-severity-critical-ink'
                            : impact.pct >= 15 ? 'bg-severity-medium/15 text-severity-medium-ink'
                            : 'bg-severity-low/15 text-severity-low-ink',
                          )}
                        >
                          {impact.pct}% away
                        </span>
                      ) : null}
                      <div className="flex gap-1.5">
                        <form action={setLeaveStatusAction}>
                          <input type="hidden" name="id" value={l.id} />
                          <input type="hidden" name="status" value="Approved" />
                          <button type="submit" className="rounded bg-severity-low/20 px-2.5 py-1 text-xs font-semibold text-severity-low-ink hover:bg-severity-low/30">Approve</button>
                        </form>
                        <form action={setLeaveStatusAction}>
                          <input type="hidden" name="id" value={l.id} />
                          <input type="hidden" name="status" value="Rejected" />
                          <button type="submit" className="rounded bg-severity-critical/20 px-2.5 py-1 text-xs font-semibold text-severity-critical-ink hover:bg-severity-critical/30">Reject</button>
                        </form>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* ── Expiring certifications ── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BadgeCheck className="h-4 w-4 text-accent" /> Certifications expiring in 30 days
            </CardTitle>
            <CardDescription>Book renewals before a member becomes non-deployable.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {expiring.length === 0 ? (
              <p className="px-6 py-10 text-center text-sm text-muted-foreground">Nothing expiring this month.</p>
            ) : (
              <ul className="divide-y divide-border">
                {expiring.map((c) => {
                  const days = inclusiveDays(todayIso, c.expiry_date) - 1;
                  return (
                    <li key={c.id} className="flex items-center gap-3 px-5 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{c.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {c.personnel ? `${c.personnel.first_name} ${c.personnel.last_name} · ${c.personnel.silo}` : 'Unassigned'}
                        </p>
                      </div>
                      <span
                        className={cn(
                          'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold',
                          days <= 7 ? 'bg-severity-critical/15 text-severity-critical-ink' : 'bg-severity-medium/15 text-severity-medium-ink',
                        )}
                      >
                        {days <= 0 ? 'today' : `${days}d`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
