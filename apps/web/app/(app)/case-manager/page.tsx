import Link from 'next/link';
import { listActiveIncidents, listClosedIncidents } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { getSession, siloFilter } from '@/lib/session';
import { formatSaTime, timeAgo } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Case Manager · Criticom' };

export default async function CaseManagerPage() {
  const { supabase, silo } = await getSession();
  const [active, closed] = await Promise.all([
    listActiveIncidents(supabase, siloFilter(silo)),
    listClosedIncidents(supabase, siloFilter(silo)),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Case manager</h1>
        <p className="text-muted-foreground">
          Review open cases, close them with a reason, and audit the trail. Open a case to act on it.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Open cases ({active.length})</CardTitle>
          <CardDescription>Everything not yet closed or resolved.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable headers={['Incident #', 'Silo', 'Status', 'Severity', 'Age', '']} empty="No open cases.">
            {active.map((i) => (
              <Tr key={i.id}>
                <Td className="font-mono">{i.incident_number}</Td>
                <Td>{i.silo}</Td>
                <Td>{i.status}</Td>
                <Td><span className="severity-pill" data-sev={i.incident_severity}>{i.incident_severity}</span></Td>
                <Td className="text-muted-foreground">{timeAgo(i.incident_created_at)}</Td>
                <Td>
                  <Link href={`/incidents/${i.id}`} className="text-accent hover:underline">Review & close</Link>
                </Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Closed cases ({closed.length})</CardTitle>
          <CardDescription>PDF case-report export lands with the Edge Function phase.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable headers={['Incident #', 'Silo', 'Type', 'Closed', '']} empty="No closed cases.">
            {closed.slice(0, 50).map((i) => (
              <Tr key={i.id}>
                <Td className="font-mono">{i.incident_number}</Td>
                <Td>{i.silo}</Td>
                <Td>{i.incident_type}</Td>
                <Td className="text-muted-foreground">{formatSaTime(i.closed_at)}</Td>
                <Td className="whitespace-nowrap">
                  <Link href={`/incidents/${i.id}`} className="text-accent hover:underline">Open</Link>
                  <span className="mx-1 text-muted-foreground">·</span>
                  <Link href={`/case-manager/audit?incident=${i.id}`} className="text-accent hover:underline">Audit</Link>
                  <span className="mx-1 text-muted-foreground">·</span>
                  <a href={`/api/pdf/incident/${i.id}`} className="text-accent hover:underline">PDF</a>
                </Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
