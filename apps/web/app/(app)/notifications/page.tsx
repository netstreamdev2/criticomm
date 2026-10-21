import {
  AUDIENCE_TONE, audienceGroup, audienceLabel, getNotificationReach, listAllProfiles, listMyAlerts,
  listMySentNotifications, listNotifications, type NotificationReach,
} from '@criticom/api';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { MarkAllRead } from './mark-all-read';
import { NotificationFeed, type FeedItem } from './feed';
import { SendNotificationForm, WithdrawButton, type Person } from './send-form';
import { canAccess } from '@criticom/db';
import { getSession, siloFilter } from '@/lib/session';
import { formatSaTime, timeAgo } from '@/lib/utils';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Notifications · HikTech' };

const NO_REACH: NotificationReach = { groups: false, anyDepartment: false, organisation: false, silo: null };

/**
 * Notifications: what was sent to you, to a few people with you, to your
 * role, to your department and to everyone (0084). Each bubble says which.
 * Sending sits beside it, limited to whom you may reach.
 */
export default async function NotificationsPage() {
  const { t } = await requestT();
  const { supabase, silo, role, userId } = await getSession();
  // The call logger opens no call pages (CALL_LOGGER_PAGES): no links into them.
  const canOpenCalls = canAccess('/incidents/x', role, silo);

  const [alerts, reach, sent, profiles, arrivals] = await Promise.all([
    listMyAlerts(supabase, { limit: 80 }).catch(() => []),
    getNotificationReach(supabase).catch(() => NO_REACH),
    listMySentNotifications(supabase).catch(() => []),
    listAllProfiles(supabase).catch(() => []),
    listNotifications(supabase, siloFilter(silo)).catch(() => []),
  ]);

  const items: FeedItem[] = alerts.map((a) => {
    const group = audienceGroup(a);
    return {
      id: a.id,
      title: a.title,
      body: a.body,
      link: a.link && (canOpenCalls || !a.link.startsWith('/incidents')) ? a.link : null,
      kind: a.kind,
      severity: a.severity,
      createdAt: a.created_at,
      from: a.created_by && a.created_by !== userId ? a.created_by_name : a.created_by ? null : a.created_by_name,
      read: a.read,
      acknowledged: a.acknowledged,
      audience: audienceLabel(a),
      group,
      accent: AUDIENCE_TONE[group],
    };
  });
  const unread = items.filter((i) => !i.read).length;

  const people: Person[] = profiles
    .filter((p) => !p.deactivated_at)
    .map((p) => ({ id: p.id, name: p.full_name ?? p.email ?? t('Unnamed'), silo: p.silo }));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('Notifications')}</h1>
          <p className="text-muted-foreground">{t('For you, your role, your department and everyone.')}</p>
        </div>
        {unread > 0 ? <MarkAllRead count={unread} /> : null}
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <NotificationFeed items={items} />

        <aside className="space-y-4 lg:sticky lg:top-4">
          <section className="frost-white rounded-[22px] p-5">
            <h2 className="text-base font-bold">{t('Send a notification')}</h2>
            <p className="mb-4 mt-0.5 text-xs text-muted-foreground">
              {reach.groups ? t('To a person, a group, a role or your department.') : t('To one person at a time.')}
            </p>
            <SendNotificationForm reach={reach} people={people} meId={userId} />
          </section>

          <section className="frost-white rounded-[22px] p-5">
            <h2 className="text-base font-bold">{t('What I sent')}</h2>
            {sent.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">{t('Nothing sent yet.')}</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {sent.slice(0, 12).map((s) => {
                  const tone = AUDIENCE_TONE[audienceGroup(s)];
                  return (
                    <li key={s.id} className="rounded-2xl border border-border/60 px-3 py-2.5">
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="rounded-full px-2 py-0.5 font-semibold" style={{ backgroundColor: `${tone}1f`, color: tone }}>
                          {s.audience === 'person' ? (people.find((p) => p.id === s.target_user_id)?.name ?? t('One person')) : audienceLabel(s)}
                        </span>
                        <span suppressHydrationWarning>{timeAgo(s.created_at)}</span>
                        <span className="ml-auto">
                          {s.withdrawn_at ? <span className="font-semibold">{t('Taken back')}</span> : <WithdrawButton id={s.id} />}
                        </span>
                      </div>
                      <p className={s.withdrawn_at ? 'mt-1 truncate text-sm text-muted-foreground line-through' : 'mt-1 truncate text-sm font-medium'}>
                        {s.title}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </aside>
      </div>

      {/* The V4 arrival log, kept: V4's NotificationsController wrote here. */}
      {arrivals.length > 0 ? (
        <details className="frost-white rounded-[22px]">
          <summary className="cursor-pointer px-5 py-4 text-sm font-semibold">
            {t('Unit arrivals')} <span className="font-normal text-muted-foreground">· {arrivals.length}</span>
          </summary>
          <div className="px-2 pb-3">
            <SimpleTable headers={['When', 'Silo', 'Unit', 'Responder', 'Location', 'Status']} empty={t('No arrival confirmations.')}>
              {arrivals.map((n) => (
                <Tr key={n.id}>
                  <Td className="whitespace-nowrap text-muted-foreground">{formatSaTime(n.created_at)}</Td>
                  <Td>{n.silo}</Td>
                  <Td>{n.unit_type ?? '—'}</Td>
                  <Td>{n.responder_name ?? '—'}</Td>
                  <Td className="max-w-[260px] truncate">{n.location ?? '—'}</Td>
                  <Td>{n.arrived ?? '—'}</Td>
                </Tr>
              ))}
            </SimpleTable>
          </div>
        </details>
      ) : null}
    </div>
  );
}
