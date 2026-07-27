import { listNotifications } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { getSession, siloFilter } from '@/lib/session';
import { formatSaTime } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Notifications · Criticom' };

export default async function NotificationsPage() {
  const { supabase, silo } = await getSession();
  const notifications = await listNotifications(supabase, siloFilter(silo));

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Notifications</h1>
        <p className="text-muted-foreground">Arrival confirmations and unit alerts.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{notifications.length} notifications</CardTitle>
          <CardDescription>Realtime toasts fire on new dispatches; this is the historical feed.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable headers={['When', 'Silo', 'Unit', 'Responder', 'Location', 'Status']} empty="No notifications.">
            {notifications.map((n) => (
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
