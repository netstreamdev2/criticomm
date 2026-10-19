import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, Info, UserPlus } from 'lucide-react';
import {
  countOpenInvitations, describeInvitation, invitationActions, listInvitations,
  type Invitation, type StatusTone,
} from '@criticom/api';
import { DEPARTMENT_NAMES, rolesInvitableBy } from '@criticom/db';
import { Card, CardContent } from '@/components/ui/card';
import { SimpleTable, Td, Tr } from '@/components/simple-table';
import { invitationErrorMessage } from '@/lib/onboarding/errors';
import { deliveryOptions, invitationTtlHours } from '@/lib/onboarding/server';
import { getSession } from '@/lib/session';
import { cn, formatSaTime, timeAgo } from '@/lib/utils';
import { InvitationRowActions } from './row-actions';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Invitations · HikTech' };

type View = 'open' | 'accepted' | 'closed';

const TONE: Record<StatusTone, string> = {
  ok: 'bg-success/15 text-success',
  info: 'bg-primary/15 text-primary',
  warn: 'bg-severity-medium/15 text-severity-medium-ink',
  crit: 'bg-severity-critical/15 text-severity-critical-ink',
  dim: 'bg-muted text-muted-foreground',
};

const CHANNEL: Record<Invitation['channel'], string> = {
  email: 'Email', sms: 'SMS', code: 'Printed code', direct: 'Password set by admin',
};

function deliveryLine(inv: Invitation) {
  if (inv.channel === 'email' || inv.channel === 'direct') return inv.email ?? '';
  if (inv.channel === 'sms') return inv.phone ?? '';
  return inv.sent_at ? `issued by ${inv.sent_by_name ?? 'an administrator'}` : 'not printed yet';
}

/**
 * Everyone invited, and where each invitation stands (migration 0049).
 * Nothing is ever deleted: opened, cancelled and refused invitations stay
 * listed, so there is always a record of who was invited, by whom, and how
 * it ended.
 */
export default async function InvitationsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { t } = await requestT();
  const { supabase, userId, role } = await getSession();
  if (rolesInvitableBy(role).length === 0) redirect('/admin');

  const { view: raw } = await searchParams;
  const view: View = raw === 'accepted' || raw === 'closed' ? raw : 'open';
  const [listed, openCount] = await Promise.all([
    listInvitations(supabase, view).then(
      (rows) => ({ rows, error: null }),
      (e: unknown) => ({ rows: [] as Invitation[], error: invitationErrorMessage(e, 'The invitations could not be loaded.') }),
    ),
    countOpenInvitations(supabase).catch(() => null),
  ]);
  const { rows, error: loadError } = listed;
  const delivery = deliveryOptions();
  const approver = role === 'SystemAdmin' || role === 'SuperAdmin';
  const now = Date.now();

  const tabs: Array<{ id: View; label: string }> = [
    { id: 'open', label: `Open${openCount ? ` (${openCount})` : ''}` },
    { id: 'accepted', label: 'Accepted' },
    { id: 'closed', label: 'Closed' },
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <Link href="/admin" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-fg">
            <ArrowLeft className="h-4 w-4" /> {' '}{t('Users')}</Link>
          <h1 className="text-2xl font-bold">{t('Invitations')}</h1>
          <p className="text-muted-foreground">
            {t('Each link or code works once and expires after {invitationTtlHours} hours. Sending again cancels the old one.', { invitationTtlHours: invitationTtlHours() })}</p>
        </div>
        <Link href="/admin/invitations/new"
          className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
          <UserPlus className="h-4 w-4" /> {' '}{t('Invite someone')}</Link>
      </header>

      {!delivery.sms || delivery.emailIsLinkOnly ? (
        <p className="flex items-start gap-2 rounded-lg border border-border bg-bg-soft px-4 py-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            {delivery.emailIsLinkOnly
              ? delivery.email
                ? 'Email is not set up on this development server: when you send an invitation, you are shown the link to pass on. '
                : 'Email is not set up on this server yet. '
              : ''}
            {!delivery.sms ? 'SMS switches on once the BulkSMS account details are added.' : ''}
          </span>
        </p>
      ) : null}

      <nav className="flex gap-1 border-b border-border" aria-label={t('Invitations')}>
        {tabs.map((t) => (
          <Link key={t.id} href={t.id === 'open' ? '/admin/invitations' : `/admin/invitations?view=${t.id}`}
            aria-current={view === t.id ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-2 px-4 py-2 text-sm font-semibold',
              view === t.id ? 'border-primary text-fg' : 'border-transparent text-muted-foreground hover:text-fg',
            )}>
            {t.label}
          </Link>
        ))}
      </nav>

      {loadError ? (
        <p role="alert" className="rounded-lg border border-severity-critical/40 bg-severity-critical/10 px-4 py-3 text-sm text-severity-critical-ink">
          {loadError}
        </p>
      ) : (
      <Card>
        <CardContent className="p-0">
          <SimpleTable
            headers={['Person', 'Role', 'Delivery', view === 'accepted' ? 'Accepted' : view === 'closed' ? 'Outcome' : 'Status', '']}
            empty={view === 'open' ? 'No open invitations.' : view === 'accepted' ? 'Nobody has accepted an invitation yet.' : 'Nothing closed yet.'}
          >
            {rows.map((inv) => {
              const state = describeInvitation(inv, now);
              const can = invitationActions(inv.status, inv.channel);
              const first = inv.full_name.trim().split(/\s+/)[0] ?? inv.full_name;
              const reinvite = view === 'closed' && !can.send && inv.personnel_id
                ? `/admin/invitations/new?person=${inv.personnel_id}` : null;
              return (
                <Tr key={inv.id}>
                  <Td>
                    <span className="font-semibold">{inv.full_name}</span>
                    <div className="font-mono text-xs text-muted-foreground">{inv.badge_number}</div>
                    <div className="text-xs text-muted-foreground">
                      {t('invited by {value} {timeAgo}{value2}', { value: inv.invited_by_name ?? 'an administrator', timeAgo: timeAgo(inv.created_at), value2: inv.approved_by_name ? ` · approved by ${inv.approved_by_name}` : '' })}
                    </div>
                  </Td>
                  <Td>
                    {inv.role}
                    <div className="text-xs text-muted-foreground">{DEPARTMENT_NAMES[inv.silo]}</div>
                  </Td>
                  <Td>
                    {CHANNEL[inv.channel]}
                    <div className="max-w-[16rem] truncate text-xs text-muted-foreground">{deliveryLine(inv)}</div>
                  </Td>
                  <Td>
                    {view === 'accepted' ? (
                      <>
                        {formatSaTime(inv.accepted_at)}
                        <div className="text-xs text-muted-foreground">{t('POPIA notice v{value} accepted', { value: inv.policy_version ?? '—' })}</div>
                      </>
                    ) : (
                      <>
                        <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', TONE[state.tone])}>{state.label}</span>
                        <div className="mt-1 max-w-[18rem] text-xs text-muted-foreground">
                          {state.detail}
                          {inv.send_count > 1 ? ` · sent ${inv.send_count} times` : ''}
                          {view === 'closed' && inv.closed_at
                            ? ` · ${inv.closed_by_name ? `${inv.closed_by_name}, ` : ''}${formatSaTime(inv.closed_at)}` : ''}
                        </div>
                      </>
                    )}
                  </Td>
                  <Td className="text-right">
                    {view === 'accepted' ? (
                      inv.accepted_user_id ? (
                        <Link href={`/admin/users/${inv.accepted_user_id}`} className="text-sm font-semibold text-primary hover:underline">
                          {t('Account →')}</Link>
                      ) : null
                    ) : (
                      <InvitationRowActions
                        id={inv.id}
                        firstName={first}
                        channel={inv.channel}
                        send={can.send}
                        sendLabel={can.sendLabel}
                        firstSend={inv.status === 'ready'}
                        cancel={can.cancel}
                        awaitingApproval={inv.status === 'awaiting_approval'}
                        mine={inv.invited_by === userId}
                        approver={approver}
                        reinviteHref={reinvite}
                      />
                    )}
                  </Td>
                </Tr>
              );
            })}
          </SimpleTable>
        </CardContent>
      </Card>
      )}

      <p className="text-xs text-muted-foreground">
        {t('Invitations as SystemAdmin, Admin or SystemController wait for a second SystemAdmin')}{approver ? <> {' '}{t('on the')}{' '}<Link href="/admin/approvals" className="font-semibold text-primary hover:underline">{t('Approvals')}</Link> {' '}{t('page')}</> : ''}{t('. Someone who reports an invitation as “not me” closes it, and whoever sent it is told.')}</p>
    </div>
  );
}
