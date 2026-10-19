import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Clock, ShieldAlert } from 'lucide-react';
import {
  describeRequest, getAccount, listAccountHistory, listAccountRequests, requestExpired,
  type AccountHistoryEntry,
} from '@criticom/api';
import {
  confirmWordFor, departmentName, needsSecondApproval, roleName, rolesAssignableBy, type Silo,
} from '@criticom/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getSession } from '@/lib/session';
import { cn, formatSaTime, timeAgo } from '@/lib/utils';
import { AccountStatusForm } from '../account-status-form';
import { ChangeRoleForm } from '../change-role-form';
import { RequestDecision } from '../request-decision';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Account · HikTech' };

const SILOS: Silo[] = ['Ethekwini', 'MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster'];

/** One line of the permanent history, as an auditor would read it. */
function historyLine(h: AccountHistoryEntry): string {
  switch (h.change) {
    case 'baseline': return `Held ${h.to_value} when account history began`;
    case 'created': return `Account created as ${h.to_value}`;
    case 'role': return `Role changed from ${h.from_value} to ${h.to_value}`;
    case 'department': return `Moved from ${h.from_value} to ${h.to_value}`;
    case 'deactivated': return 'Account deactivated';
    case 'reactivated': return 'Account reactivated';
    case 'removed': return `Account removed (held ${h.from_value})`;
  }
}

export default async function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = await requestT();
  const { id } = await params;
  const { supabase, userId, role, silo } = await getSession();

  const account = await getAccount(supabase, id);
  if (!account) notFound();
  const { profile, personnelBadge } = account;

  const [history, [open]] = await Promise.all([
    listAccountHistory(supabase, id).catch(() => []),
    listAccountRequests(supabase, { open: true, userId: id, limit: 1 }).catch(() => []),
  ]);

  const me = { id: userId, role, silo };
  const target = { id: profile.id, role: profile.role, silo: profile.silo };
  const name = profile.full_name ?? profile.email ?? 'This account';
  const isSelf = userId === profile.id;
  const active = profile.deactivated_at === null;
  const options = rolesAssignableBy(me, target);
  const canManage = options.length > 0;
  const confirm = confirmWordFor(profile, personnelBadge);
  const isApprover = role === 'SystemAdmin' || role === 'SuperAdmin';
  const requestMode = !open ? null
    : open.requested_by === userId ? 'withdraw'
      : open.user_id === userId ? 'about-you'
        : isApprover ? 'decide' : 'view';

  return (
    <div className="space-y-6">
      <Link href="/admin" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> {' '}{t('Users')}</Link>

      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">{name}</h1>
          <span className={cn(
            'rounded-full px-2.5 py-0.5 text-xs font-semibold',
            !active ? 'bg-severity-critical/15 text-severity-critical-ink'
              : open ? 'bg-severity-medium/15 text-severity-medium-ink'
                : 'bg-success/15 text-success',
          )}>
            {!active ? 'Deactivated' : open ? 'Change waiting for approval' : 'Active'}
          </span>
        </div>
        <p className="text-muted-foreground">
          {roleName(profile.role)} · {departmentName(profile.silo)}
          {confirm.kind === 'badge number' ? ` · Badge ${confirm.word}` : ''}
          {profile.email ? ` · ${profile.email}` : ''}
        </p>
      </header>

      {!active ? (
        <div className="rounded-lg border border-severity-critical/40 bg-severity-critical/10 px-4 py-3 text-sm">
          <p className="font-semibold">{t('Deactivated {saTime}', { saTime: formatSaTime(profile.deactivated_at) })}</p>
          {profile.deactivated_reason ? <p className="mt-1 text-muted-foreground">“{profile.deactivated_reason}”</p> : null}
        </div>
      ) : null}

      {open ? (
        <Card className="border-severity-medium/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-4 w-4 text-severity-medium-ink" /> {describeRequest(open)}
            </CardTitle>
            <CardDescription>
              {t('Requested by {value} {timeAgo}{value2}. Reason: “{reason}”. The account is frozen until this is decided.', { value: open.requested_by_name ?? 'an administrator', timeAgo: timeAgo(open.requested_at), value2: requestExpired(open) ? ' · expired (older than 7 days)' : '', reason: open.reason })}</CardDescription>
          </CardHeader>
          <CardContent>
            <RequestDecision requestId={open.id} userId={profile.id} mode={requestMode ?? 'view'} />
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('Role and department')}</CardTitle>
              <CardDescription>
                {t('Every change needs a reason and the {kind} typed back. Changes to SystemAdmin, Admin or SystemController also need a second SystemAdmin.', { kind: confirm.kind })}</CardDescription>
            </CardHeader>
            <CardContent>
              {isSelf ? (
                <p className="text-sm text-muted-foreground">{t('You cannot change your own account. Ask another administrator.')}</p>
              ) : !canManage ? (
                <p className="text-sm text-muted-foreground">
                  {t('Your role cannot change this account.{value}', { value: role === 'Admin' ? ' A department administrator manages department roles in their own department only.' : '' })}
                </p>
              ) : !active ? (
                <p className="text-sm text-muted-foreground">{t('Reactivate the account before changing its role.')}</p>
              ) : open ? (
                <p className="text-sm text-muted-foreground">{t('Frozen while a change waits for approval.')}</p>
              ) : (
                <ChangeRoleForm
                  userId={profile.id}
                  name={name}
                  actorRole={role}
                  currentRole={profile.role}
                  currentSilo={profile.silo}
                  roleOptions={options}
                  departments={role === 'SystemAdmin' || role === 'SuperAdmin' ? SILOS : null}
                  confirm={confirm}
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('Account status')}</CardTitle>
              <CardDescription>{t('Accounts are deactivated, never deleted, so their records stay intact.')}</CardDescription>
            </CardHeader>
            <CardContent>
              {isSelf ? (
                <p className="text-sm text-muted-foreground">{t('You cannot deactivate your own account.')}</p>
              ) : !canManage ? (
                <p className="text-sm text-muted-foreground">{t('Your role cannot change this account.')}</p>
              ) : open ? (
                <p className="text-sm text-muted-foreground">{t('Frozen while a change waits for approval.')}</p>
              ) : (
                <AccountStatusForm
                  userId={profile.id}
                  name={name}
                  active={active}
                  needsApproval={needsSecondApproval(role, profile.role, profile.role)}
                  confirm={confirm}
                />
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('History')}</CardTitle>
            <CardDescription>{t('Permanent. It cannot be edited or deleted, by anyone.')}</CardDescription>
          </CardHeader>
          <CardContent>
            {history.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('No changes recorded yet.')}</p>
            ) : (
              <ol className="space-y-4">
                {history.map((h) => (
                  <li key={h.id} className="border-l-2 border-border pl-4">
                    <p className="text-sm font-semibold">{historyLine(h)}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatSaTime(h.at)}
                      {h.change === 'baseline' ? '' : h.outside_app
                        ? ' · made outside the app (platform tools)'
                        : ` · by ${h.actor_name ?? 'an administrator'}`}
                      {h.approved_by_name ? ` · approved by ${h.approved_by_name}` : ''}
                    </p>
                    {h.reason && h.change !== 'baseline' ? (
                      <p className="mt-1 text-sm text-muted-foreground">“{h.reason}”</p>
                    ) : null}
                    {h.outside_app && !h.reason && h.change !== 'baseline' ? (
                      <p className="mt-1 flex items-center gap-1.5 text-xs text-severity-medium-ink">
                        <ShieldAlert className="h-3.5 w-3.5" /> {' '}{t('No reason was recorded for this change.')}</p>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
