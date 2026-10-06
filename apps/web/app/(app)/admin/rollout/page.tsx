import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { listRegister, registerStatus, rolloutGroups, type RegisterPerson } from '@criticom/api';
import { ADMIN_ROLES, DEPARTMENT_NAMES, type Silo } from '@criticom/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { invitationErrorMessage } from '@/lib/onboarding/errors';
import { getSession } from '@/lib/session';
import { ChaseList, type ChasePerson } from './chase-list';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Rollout · HikTech' };

function Bar({ active, invited, total }: { active: number; invited: number; total: number }) {
  const pct = (n: number) => (total ? (n / total) * 100 : 0);
  return (
    <div className="flex h-2.5 overflow-hidden rounded-full bg-muted" role="img"
      aria-label={`${active} of ${total} activated, ${invited} invited`}>
      <div className="h-full bg-success" style={{ width: `${pct(active)}%` }} />
      <div className="h-full bg-primary/40" style={{ width: `${pct(invited)}%` }} />
    </div>
  );
}

/**
 * How far the rollout has got: who has an account, who is invited, who has
 * not been reached yet, by department and station; and everyone invited who
 * still needs chasing.
 */
export default async function RolloutPage() {
  const { supabase, role, silo } = await getSession();
  if (!ADMIN_ROLES.includes(role)) redirect('/admin');

  let people: RegisterPerson[] = [];
  let loadError: string | null = null;
  try {
    people = await listRegister(supabase, { silo: role === 'Admin' ? silo : undefined });
  } catch (e) {
    loadError = invitationErrorMessage(e, 'The staff register could not be loaded.');
  }
  const groups = rolloutGroups(people);
  const sum = (key: 'total' | 'active' | 'invited' | 'notInvited', g = groups) => g.reduce((s, x) => s + x[key], 0);
  const departments = [...new Set(groups.map((g) => g.silo))] as Silo[];
  const current = people.filter((p) => !p.left_at && !p.user_id);
  const ready = current.filter((p) => registerStatus(p).key === 'ready').length;
  const toConfirm = current.filter((p) => ['suggested', 'no-role'].includes(registerStatus(p).key)).length;

  const chase: ChasePerson[] = people
    .filter((p) => !p.left_at && !p.user_id && p.invitation && p.invitation.status !== 'awaiting_approval'
      && p.invitation.channel !== 'direct')
    .map((p) => ({
      id: p.id, name: `${p.first_name} ${p.last_name}`, badge: p.badge_number, silo: p.silo,
      station: p.station?.trim() || 'No station', invitationId: p.invitation!.id,
      status: p.invitation!.status as ChasePerson['status'], channel: p.invitation!.channel as ChasePerson['channel'],
      failed: !!p.invitation!.delivery_error,
    }))
    .sort((a, b) => a.silo.localeCompare(b.silo) || a.station.localeCompare(b.station) || a.name.localeCompare(b.name));

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link href="/admin/personnel" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-fg">
          <ArrowLeft className="h-4 w-4" /> Personnel
        </Link>
        <h1 className="text-2xl font-bold">Rollout</h1>
        <p className="text-muted-foreground">Who has a working account, who is invited, and who has not been reached yet.</p>
      </header>

      {loadError ? (
        <p role="alert" className="rounded-lg border border-severity-critical/40 bg-severity-critical/10 px-4 py-3 text-sm text-severity-critical-ink">{loadError}</p>
      ) : (
        <>
          <Card>
            <CardContent className="space-y-3 p-5">
              <p className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-lg font-semibold">{sum('active')} of {sum('total')} activated</span>
                <span className="text-sm text-muted-foreground">
                  {sum('invited')} invited · {sum('notInvited')} not invited yet
                </span>
              </p>
              <Bar active={sum('active')} invited={sum('invited')} total={sum('total')} />
              <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-success" /> activated</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-primary/40" /> invited</span>
                {ready ? <Link href="/admin/personnel?status=ready" className="font-semibold text-primary hover:underline">{ready} ready to invite →</Link> : null}
                {toConfirm ? <Link href="/admin/personnel?status=to-confirm" className="font-semibold text-primary hover:underline">{toConfirm} need a role first →</Link> : null}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">By department and station</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {departments.length === 0 ? <p className="text-sm text-muted-foreground">The staff register is empty. Import HR’s staff list first.</p> : null}
              {departments.map((d) => {
                const rows = groups.filter((g) => g.silo === d);
                return (
                  <div key={d} className="space-y-2">
                    <p className="flex items-baseline justify-between text-sm font-semibold">
                      <span>{DEPARTMENT_NAMES[d]}</span>
                      <span className="text-muted-foreground">{sum('active', rows)} / {sum('total', rows)}</span>
                    </p>
                    <ul className="space-y-1.5">
                      {rows.map((g) => (
                        <li key={g.station} className="grid grid-cols-[minmax(8rem,14rem)_1fr_auto] items-center gap-3 text-sm">
                          <span className="truncate text-muted-foreground">{g.station}</span>
                          <Bar active={g.active} invited={g.invited} total={g.total} />
                          <span className="tabular-nums text-muted-foreground">{g.active} / {g.total}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Invited, not activated yet ({chase.length})</CardTitle>
              <CardDescription>Filter by station and share the list with its commander before shift briefing.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <ChaseList people={chase} canSend />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
