import Link from 'next/link';
import { listSecurityReports } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { getSession } from '@/lib/session';
import { formatSaTime } from '@/lib/utils';
import { resolveSecurityReportAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Security Reports · HikTech' };

export default async function SecurityReportsPage() {
  const { supabase } = await getSession();
  const reports = await listSecurityReports(supabase);
  const open = reports.filter((r) => !r.is_incident_resolved);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Private security reports</h1>
          <p className="text-muted-foreground">
            Guard incident register (SIRA) — {open.length} unresolved.
          </p>
        </div>
        <Link href="/police/security/new" className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold">
          + New guard report
        </Link>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{reports.length} reports</CardTitle>
          <CardDescription>Emergency-flagged rows are highlighted. Resolve inline once handled.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable
            headers={['Guard', 'Type', 'Location', 'Started', 'Severity', 'Status']}
            empty="No security reports filed."
          >
            {reports.map((r) => (
              <Tr key={r.id}>
                <Td>
                  <span className={r.is_emergency ? 'font-semibold text-severity-critical-ink' : ''}>
                    {r.guard_name}
                  </span>
                  <div className="text-xs text-muted-foreground">
                    {r.sira_number ? `SIRA ${r.sira_number}` : r.badge_number ?? ''}
                  </div>
                </Td>
                <Td>{r.incident_type}</Td>
                <Td className="max-w-[220px] truncate">{r.location ?? '—'}{r.zone_code ? ` (${r.zone_code})` : ''}</Td>
                <Td className="whitespace-nowrap text-muted-foreground">{formatSaTime(r.incident_start_time)}</Td>
                <Td>{r.severity_level ?? '—'}</Td>
                <Td>
                  {r.is_incident_resolved ? (
                    <span className="text-severity-low-ink">Resolved {formatSaTime(r.resolution_time)}</span>
                  ) : (
                    <form action={resolveSecurityReportAction} className="flex items-center gap-2">
                      <input type="hidden" name="id" value={r.id} />
                      <input
                        name="resolution_summary" placeholder="Resolution…"
                        className="h-8 w-40 rounded-md border border-border bg-bg-soft px-2 text-xs"
                      />
                      <button type="submit" className="h-8 rounded-md bg-accent px-3 text-xs font-semibold">
                        Resolve
                      </button>
                    </form>
                  )}
                </Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
