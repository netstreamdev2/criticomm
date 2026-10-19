import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Clock } from 'lucide-react';
import {
  ACCOUNT_REQUEST_DAYS, describeRequest, listAccountRequests, listInvitations, requestExpired,
} from '@criticom/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SimpleTable, Td, Tr } from '@/components/simple-table';
import { getSession } from '@/lib/session';
import { cn, formatSaTime, timeAgo } from '@/lib/utils';
import { RequestDecision } from '../users/request-decision';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Approvals · HikTech' };

/** Where a request's subject lives: the account, or the invitation for someone without one. */
const subjectHref = (req: { action: string; user_id: string | null }) =>
  req.action === 'invite' || !req.user_id ? '/admin/invitations' : `/admin/users/${req.user_id}`;

const STATUS_TONE: Record<string, string> = {
  approved: 'text-success',
  rejected: 'text-severity-critical-ink',
  cancelled: 'text-muted-foreground',
  expired: 'text-muted-foreground',
};

/**
 * The second pair of eyes. Every change that grants, removes or touches
 * SystemAdmin, Admin or SystemController waits here until a SystemAdmin
 * other than the requester — and other than the person it is about —
 * approves or rejects it (migration 0048).
 */
export default async function ApprovalsPage() {
  const { t } = await requestT();
  const { supabase, userId, role } = await getSession();
  if (role !== 'SystemAdmin' && role !== 'SuperAdmin') redirect('/admin');

  const [open, decided] = await Promise.all([
    listAccountRequests(supabase, { open: true }),
    listAccountRequests(supabase, { open: false, limit: 25 }),
  ]);
  // How each invitation waiting here would go out, so the button says what approving does.
  const channelOf = new Map(
    open.some((r) => r.invitation_id)
      ? (await listInvitations(supabase, 'open').catch(() => [])).map((i) => [i.id, i.channel] as const)
      : [],
  );
  const approveLabel = (req: { invitation_id: string | null }) => {
    if (!req.invitation_id) return 'Approve';
    const channel = channelOf.get(req.invitation_id);
    return channel === 'email' ? 'Approve and send by email' : channel === 'sms' ? 'Approve and send by SMS' : 'Approve';
  };

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link href="/admin" className="text-sm text-muted-foreground hover:text-fg">{t('← Users')}</Link>
        <h1 className="text-2xl font-bold">{t('Approvals')}</h1>
        <p className="text-muted-foreground">
          {t('Changes to powerful roles wait here for a second SystemAdmin. You cannot decide a request you made, or one about your own account. Requests close after {value} days.', { value: ACCOUNT_REQUEST_DAYS })}</p>
      </header>

      {open.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">{t('Nothing is waiting for approval.')}</CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {open.map((req) => {
            const mode = req.requested_by === userId ? 'withdraw' : req.user_id === userId ? 'about-you' : 'decide';
            const expired = requestExpired(req);
            return (
              <Card key={req.id} className={cn(expired && 'opacity-70')}>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    <Clock className="h-4 w-4 text-severity-medium-ink" />
                    <Link href={subjectHref(req)} className="hover:underline">{describeRequest(req)}</Link>
                  </CardTitle>
                  <CardDescription>
                    {t('Requested by {value} {timeAgo}{value2}', { value: req.requested_by_name ?? 'an administrator', timeAgo: timeAgo(req.requested_at), value2: expired ? ' · expired: deciding it will close it' : '' })}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="rounded-md bg-bg-soft px-3 py-2 text-sm">“{req.reason}”</p>
                  {req.invitation_id && channelOf.get(req.invitation_id) === 'code' ? (
                    <p className="text-sm text-muted-foreground">{t('Once approved, {value} prints the activation slip and hands it over in person.', { value: req.requested_by_name ?? 'the requester' })}</p>
                  ) : null}
                  <RequestDecision requestId={req.id} userId={req.user_id ?? ''} mode={mode} approveLabel={approveLabel(req)} />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('Recently decided')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable headers={['Request', 'Asked by', 'Outcome', 'Decided by', 'Note', 'When']} empty={t('Nothing decided yet.')}>
            {decided.map((req) => (
              <Tr key={req.id}>
                <Td>
                  <Link href={subjectHref(req)} className="hover:underline">{describeRequest(req)}</Link>
                </Td>
                <Td>{req.requested_by_name ?? '—'}</Td>
                <Td className={cn('font-semibold capitalize', STATUS_TONE[req.status])}>{req.status}</Td>
                <Td>{req.decided_by_name ?? '—'}</Td>
                <Td className="max-w-[18rem] truncate text-muted-foreground">{req.decision_note ?? '—'}</Td>
                <Td className="text-muted-foreground">{formatSaTime(req.decided_at)}</Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
