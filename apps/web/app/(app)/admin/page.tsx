import Link from 'next/link';
import { ShieldAlert, ShieldCheck, UserPlus } from 'lucide-react';
import { countActiveSystemAdmins, countOpenInvitations, listAccountRequests, listAllProfiles } from '@criticom/api';
import { MIN_SYSTEM_ADMINS, departmentName, roleName, rolesAssignableBy, rolesInvitableBy, type Silo } from '@criticom/db';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { getSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Admin · HikTech' };

const SILOS: Silo[] = ['Ethekwini', 'MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster'];

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ silo?: string }>;
}) {
  const { t } = await requestT();
  const { supabase, userId, role, silo } = await getSession();
  const me = { id: userId, role, silo };
  const params = await searchParams;
  const isApprover = role === 'SystemAdmin' || role === 'SuperAdmin';
  const canInvite = rolesInvitableBy(role).length > 0;

  const [profiles, openRequests, systemAdmins, openInvitations] = await Promise.all([
    listAllProfiles(supabase, params.silo as Silo | undefined),
    listAccountRequests(supabase, { open: true }).catch(() => []),
    isApprover ? countActiveSystemAdmins(supabase).catch(() => null) : Promise.resolve(null),
    canInvite ? countOpenInvitations(supabase).catch(() => 0) : Promise.resolve(0),
  ]);
  const waitingFor = new Set(openRequests.map((r) => r.user_id));
  // Requests someone other than me can decide — the ones worth a banner.
  const toDecide = openRequests.filter((r) => r.requested_by !== userId && r.user_id !== userId);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('Administration')}</h1>
          <p className="text-muted-foreground">{t('Users, vehicles, devices and the audit trail.')}</p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          {canInvite ? (
            <>
              <Link href="/admin/invitations/new"
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 font-semibold text-primary-foreground hover:bg-primary/90">
                <UserPlus className="h-4 w-4" /> {' '}{t('Invite someone')}</Link>
              <Link href="/admin/invitations" className="rounded-md border border-border px-4 py-2 hover:bg-muted">
                {t('Invitations{value}', { value: openInvitations ? ` (${openInvitations})` : '' })}
              </Link>
              <Link href="/admin/rollout" className="rounded-md border border-border px-4 py-2 hover:bg-muted">{t('Rollout')}</Link>
            </>
          ) : null}
          {isApprover ? (
            <Link href="/admin/approvals" className="rounded-md border border-border px-4 py-2 hover:bg-muted">
              {t('Approvals{value}', { value: openRequests.length ? ` (${openRequests.length})` : '' })}
            </Link>
          ) : null}
          <Link href="/admin/handbook" className="rounded-md border border-border px-4 py-2 hover:bg-muted">{t('Handbook')}</Link>
          <Link href="/modules/staff" className="rounded-md border border-border px-4 py-2 hover:bg-muted">{t('Staff Maintenance')}</Link>
          <Link href="/admin/operators" className="rounded-md border border-border px-4 py-2 hover:bg-muted">{t('Operators')}</Link>
          <Link href="/admin/vehicles" className="rounded-md border border-border px-4 py-2 hover:bg-muted">{t('Vehicles')}</Link>
          <Link href="/admin/devices" className="rounded-md border border-border px-4 py-2 hover:bg-muted">{t('Devices')}</Link>
          <Link href="/case-manager/audit" className="rounded-md border border-border px-4 py-2 hover:bg-muted">{t('Audit log')}</Link>
        </div>
      </header>

      {systemAdmins !== null && systemAdmins < MIN_SYSTEM_ADMINS ? (
        <div role="alert" className="flex items-start gap-3 rounded-lg border border-severity-high/50 bg-severity-high/10 px-4 py-3 text-sm">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-severity-high-ink" />
          <div>
            <p className="font-semibold">
              {t('{value} Appoint{value2}.', { value: systemAdmins === 1 ? 'Only one SystemAdmin.' : `${systemAdmins} SystemAdmins.`, value2: systemAdmins === 0 ? ' two' : ' a second' })}</p>
            <p className="text-muted-foreground">
              {t('The organisation must keep at least {value}. Until it has them, the current SystemAdmin cannot be demoted or deactivated, and if they are unavailable nobody can manage accounts. A new SystemAdmin needs a second approval; with nobody else to give it, the SuperAdmin decides.', { value: MIN_SYSTEM_ADMINS })}</p>
          </div>
        </div>
      ) : null}

      {isApprover && toDecide.length > 0 ? (
        <Link href="/admin/approvals"
          className="flex items-center gap-3 rounded-lg border border-severity-medium/50 bg-severity-medium/10 px-4 py-3 text-sm hover:bg-severity-medium/15">
          <ShieldCheck className="h-5 w-5 shrink-0 text-severity-medium-ink" />
          <span>
            <b>{t('{length} account {value} waiting for your approval.', { length: toDecide.length, value: toDecide.length === 1 ? 'change is' : 'changes are' })}</b>{' '}{t('Review →')}</span>
        </Link>
      ) : null}

      <form method="get" className="flex items-end gap-3">
        <div>
          <label className="text-xs uppercase text-muted-foreground" htmlFor="silo">{t('Department')}</label>
          <select id="silo" name="silo" defaultValue={params.silo ?? ''} className="mt-1 block h-10 rounded-md border border-border bg-bg-soft px-3 text-sm">
            <option value="">{t('All')}</option>
            {SILOS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <button type="submit" className="h-10 rounded-md bg-primary px-4 text-sm font-semibold">{t('Filter')}</button>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>{t('{length} users', { length: profiles.length })}</CardTitle>
          <CardDescription>
            {t('Open an account to change its role or deactivate it. Every change needs a reason, is recorded permanently, and reaches the person straight away. New people join by invitation.')}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable headers={['Name', 'Department', 'Role', 'Badge', 'Status', '']} empty={t('No users.')}>
            {profiles.map((p) => {
              const deactivated = p.deactivated_at !== null;
              const waiting = waitingFor.has(p.id);
              const manageable = rolesAssignableBy(me, p).length > 0;
              return (
                <Tr key={p.id} className={cn(deactivated && 'opacity-60')}>
                  <Td>
                    {p.full_name ?? '—'}
                    <div className="text-xs text-muted-foreground">{p.email ?? ''}</div>
                  </Td>
                  <Td>{departmentName(p.silo)}</Td>
                  <Td>{roleName(p.role)}</Td>
                  <Td className="font-mono">{p.badge_number ?? '—'}</Td>
                  <Td>
                    <span className={cn(
                      'rounded-full px-2 py-0.5 text-xs font-semibold',
                      deactivated ? 'bg-severity-critical/15 text-severity-critical-ink'
                        : waiting ? 'bg-severity-medium/15 text-severity-medium-ink'
                          : 'bg-success/15 text-success',
                    )}>
                      {deactivated ? 'Deactivated' : waiting ? 'Awaiting approval' : 'Active'}
                    </span>
                  </Td>
                  <Td className="text-right">
                    <Link href={`/admin/users/${p.id}`} className="text-sm font-semibold text-primary hover:underline">
                      {manageable ? 'Manage →' : 'View →'}
                    </Link>
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
