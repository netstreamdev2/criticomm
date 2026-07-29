import Link from 'next/link';
import { Radio, Megaphone, Siren, Info, Bell, ArrowUpRight } from 'lucide-react';
import { listMyAlerts, listNotifications } from '@criticom/api';
import type { AlertKind } from '@criticom/db';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { MarkAllRead } from './mark-all-read';
import { getSession, siloFilter } from '@/lib/session';
import { formatSaTime } from '@/lib/utils';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Notifications · Criticom' };

const KIND_META: Record<AlertKind, { label: string; icon: typeof Info; tone: string }> = {
  assignment: { label: 'Dispatch', icon: Radio, tone: 'text-primary' },
  incident_new: { label: 'New call', icon: Siren, tone: 'text-severity-high-ink' },
  incident_update: { label: 'Update', icon: Info, tone: 'text-accent' },
  broadcast: { label: 'Broadcast', icon: Megaphone, tone: 'text-severity-medium-ink' },
  system: { label: 'System', icon: Bell, tone: 'text-muted-foreground' },
  info: { label: 'Info', icon: Info, tone: 'text-muted-foreground' },
};

export default async function NotificationsPage() {
  const { supabase, silo } = await getSession();

  const [alerts, arrivals] = await Promise.all([
    listMyAlerts(supabase, { limit: 60 }).catch(() => []),
    listNotifications(supabase, siloFilter(silo)).catch(() => []),
  ]);

  const unread = alerts.filter((a) => !a.read).length;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Notifications</h1>
          <p className="text-muted-foreground">
            Everything that popped on your screen, kept in one place.
          </p>
        </div>
        {unread > 0 ? <MarkAllRead count={unread} /> : null}
      </header>

      {/* Alert feed */}
      <Card>
        <CardHeader>
          <CardTitle>
            Alerts{unread > 0 ? <span className="ml-2 text-sm font-normal text-severity-critical-ink">{unread} unread</span> : null}
          </CardTitle>
          <CardDescription>
            Dispatch assignments, broadcasts and escalations addressed to you or your department.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {alerts.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-muted-foreground">
              Nothing yet. Alerts appear here the moment a call is routed to your department.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {alerts.map((a) => {
                const meta = KIND_META[a.kind] ?? KIND_META.info;
                const Icon = meta.icon;
                const row = (
                  <div className="flex items-start gap-3 px-6 py-3.5">
                    <span className={cn('mt-0.5 shrink-0', meta.tone)}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                        {!a.read ? (
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-label="Unread" />
                        ) : null}
                        <span className="severity-pill" data-sev={a.severity}>{a.severity}</span>
                        <span className="min-w-0 break-words">{a.title}</span>
                      </p>
                      {a.body ? (
                        <p className="mt-1 break-words text-xs text-muted-foreground">{a.body}</p>
                      ) : null}
                      <p className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                        <span>{meta.label}</span>
                        <span>{a.silo}</span>
                        <span>{formatSaTime(a.created_at)}</span>
                        {a.created_by_name ? <span>by {a.created_by_name}</span> : null}
                        {a.acknowledged ? <span className="text-severity-low-ink">acknowledged</span> : null}
                      </p>
                    </div>
                    {a.link ? (
                      <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : null}
                  </div>
                );
                return (
                  <li key={a.id} className={cn(!a.read && 'bg-accent/5')}>
                    {a.link ? (
                      <Link href={a.link} className="block transition-colors hover:bg-muted/50">{row}</Link>
                    ) : row}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Legacy arrival log — kept because V4's NotificationsController wrote here */}
      <Card>
        <CardHeader>
          <CardTitle>Unit arrivals</CardTitle>
          <CardDescription>Arrival confirmations logged by responding units.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable
            headers={['When', 'Silo', 'Unit', 'Responder', 'Location', 'Status']}
            empty="No arrival confirmations."
          >
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
        </CardContent>
      </Card>
    </div>
  );
}
