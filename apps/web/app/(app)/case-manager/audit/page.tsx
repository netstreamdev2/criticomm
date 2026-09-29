import { listAuditLogs } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { getSession, siloFilter } from '@/lib/session';
import { formatSaTime } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Audit History · HikTech' };

export default async function AuditHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ incident?: string }>;
}) {
  const { supabase, silo } = await getSession();
  const { incident } = await searchParams;

  const logs = await listAuditLogs(supabase, {
    silo: siloFilter(silo),
    entityType: incident ? 'incident' : undefined,
    entityId: incident,
  });

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Audit history</h1>
        <p className="text-muted-foreground">
          {incident ? 'Trail for the selected incident.' : 'Latest 200 audit events across your visible silos.'}
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{logs.length} events</CardTitle>
          <CardDescription>Every state change writes an immutable row.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable headers={['Time', 'Action', 'User', 'Silo', 'Entity', 'Details']} empty="No audit events.">
            {logs.map((l) => (
              <Tr key={l.id}>
                <Td className="whitespace-nowrap text-muted-foreground">{formatSaTime(l.timestamp)}</Td>
                <Td className="font-semibold">{l.action_type}</Td>
                <Td>{l.user_name ?? '—'}</Td>
                <Td>{l.silo}</Td>
                <Td className="font-mono text-xs">{l.entity_type ?? '—'}</Td>
                <Td className="max-w-[320px] truncate">{l.details ?? '—'}</Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
