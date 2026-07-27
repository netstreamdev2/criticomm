import Link from 'next/link';
import {
  getMyPersonnel, listEndorsements, listLeaveEntries, listRosterEntries, getMyPerformance,
} from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { getSession } from '@/lib/session';
import { formatSaTime } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My HR · Criticom' };

export default async function MyHrPage() {
  const { supabase, userId, silo, role, fullName } = await getSession();

  const now = new Date();
  const cycleStart = now.getMonth() >= 6
    ? new Date(now.getFullYear(), 6, 1)
    : new Date(now.getFullYear() - 1, 6, 1);
  const from = cycleStart.toISOString().slice(0, 10);
  const to = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);

  const [me, myLeave, myEndorsements, allRoster, perf] = await Promise.all([
    getMyPersonnel(supabase, userId).catch(() => null),
    listLeaveEntries(supabase, userId).catch(() => []),
    listEndorsements(supabase, { userId }).catch(() => []),
    listRosterEntries(supabase).catch(() => []),
    getMyPerformance(supabase, { from, to, displayName: fullName, userId, silo }).catch(() => null),
  ]);

  const myShifts = allRoster.filter((r) => r.user_id === userId).slice(0, 8);
  const approvedLeave = myLeave.filter((l) => l.status === 'Approved').length;
  const pendingLeave = myLeave.filter((l) => l.status === 'Pending').length;

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();

  const initial = fullName.charAt(0).toUpperCase();

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/20 text-2xl font-bold text-primary">
            {initial}
          </div>
          <div>
            <h1 className="text-2xl font-bold">{fullName}</h1>
            <p className="text-muted-foreground">
              {profile?.rank ?? role} · {silo} · {profile?.call_sign ?? 'no call sign'}
            </p>
          </div>
        </div>
        <Link href="/profile" className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted">
          Edit profile →
        </Link>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card><CardContent className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Badge</p>
          <p className="mt-2 text-xl font-bold">{profile?.badge_number ?? me?.badge_number ?? '—'}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Station</p>
          <p className="mt-2 text-xl font-bold">{profile?.station ?? me?.station ?? '—'}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Leave (approved / pending)</p>
          <p className="mt-2 text-xl font-bold">{approvedLeave} / {pendingLeave}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs uppercase text-muted-foreground">On duty</p>
          <p className="mt-2 text-xl font-bold">{profile?.is_on_duty ? 'Yes' : 'No'}</p>
        </CardContent></Card>
      </section>

      {perf && (
        <Card>
          <CardHeader>
            <CardTitle>Performance snapshot — {perf.cycleLabel}</CardTitle>
            <CardDescription>
              {perf.hasPlan
                ? `Appraisal status ${perf.planStatus}. Mid-year ${perf.midYearAverage ?? '—'}, final ${perf.finalAverage ?? '—'} / 5.`
                : 'No appraisal plan yet this cycle.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-3 text-center">
            <div><p className="text-2xl font-bold">{perf.asCallTaker.total}</p><p className="text-xs text-muted-foreground">Calls taken</p></div>
            <div><p className="text-2xl font-bold">{perf.asDispatcher.dispatched}</p><p className="text-xs text-muted-foreground">Dispatched</p></div>
            <div><p className="text-2xl font-bold">{perf.asResponder.total}</p><p className="text-xs text-muted-foreground">Attended</p></div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>My upcoming duty</CardTitle></CardHeader>
          <CardContent className="p-0">
            <SimpleTable headers={['Shift', 'Station', 'Activity', 'Vehicle']} empty="No duty allocated.">
              {myShifts.map((r) => (
                <Tr key={r.id}>
                  <Td>{(r as { shift?: { shift_name?: string } }).shift?.shift_name ?? '—'}</Td>
                  <Td>{r.station}</Td>
                  <Td>{r.activity_type}</Td>
                  <Td>{r.vehicle ?? '—'}</Td>
                </Tr>
              ))}
            </SimpleTable>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>My endorsements</CardTitle></CardHeader>
          <CardContent className="p-0">
            <SimpleTable headers={['Type', 'Details', 'Period']} empty="No endorsements on file.">
              {myEndorsements.map((e) => (
                <Tr key={e.id}>
                  <Td className="font-semibold">{e.type}</Td>
                  <Td className="max-w-[220px] truncate">{e.details ?? '—'}</Td>
                  <Td className="font-mono text-xs">{e.start_date}{e.end_date ? ` → ${e.end_date}` : ' →'}</Td>
                </Tr>
              ))}
            </SimpleTable>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>My leave history</CardTitle></CardHeader>
        <CardContent className="p-0">
          <SimpleTable headers={['Type', 'From', 'To', 'Status', 'Applied']} empty="No leave requests.">
            {myLeave.map((l) => (
              <Tr key={l.id}>
                <Td>{l.absence ?? '—'}</Td>
                <Td className="font-mono">{l.eff_from}</Td>
                <Td className="font-mono">{l.eff_to}</Td>
                <Td>
                  <span className={
                    l.status === 'Approved' ? 'text-severity-low'
                    : l.status === 'Rejected' ? 'text-severity-critical' : 'text-severity-medium'
                  }>{l.status}</span>
                </Td>
                <Td className="text-muted-foreground">{formatSaTime(l.created_at)}</Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
