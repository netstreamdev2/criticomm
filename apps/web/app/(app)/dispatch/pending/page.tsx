import Link from 'next/link';
import { getServerSupabase } from '@/lib/supabase';
import { listPendingIncidents } from '@criticom/api';
import { Card, CardContent } from '@/components/ui/card';
import { timeAgo } from '@/lib/utils';
import { PendingRealtimeBridge } from './realtime-bridge';
import { IncidentRow, StopClick } from './incident-row';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Pending queue · Criticom' };

export default async function PendingPage() {
  const supabase = await getServerSupabase();
  const pending = await listPendingIncidents(supabase);

  return (
    <div className="space-y-4">
      {/* One bar instead of a page header plus a card header. A dispatcher
          reads this screen continuously, so the queue depth belongs at the
          top as a figure they can glance at — not buried under two lines of
          text explaining what the screen is. */}
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-bg-card px-4 py-2.5">
        <div className="flex items-baseline gap-2.5">
          <span
            className={`text-2xl font-bold leading-none tabular-nums ${
              pending.length === 0 ? 'text-success' : 'text-severity-critical stat-glow'
            }`}
          >
            {pending.length}
          </span>
          <h1 className="font-semibold">awaiting dispatch</h1>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            severity, then call time · live
          </span>
        </div>
        <Link
          href="/dispatch/log-call"
          className="inline-flex h-9 items-center rounded-md bg-primary px-3.5 text-sm font-semibold"
        >
          + Log new call
        </Link>
      </header>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left">Incident #</th>
                <th className="px-4 py-3 text-left">Severity</th>
                <th className="px-4 py-3 text-left">Type</th>
                <th className="px-4 py-3 text-left">Caller</th>
                <th className="px-4 py-3 text-left">Location</th>
                <th className="px-4 py-3 text-left">Waiting</th>
                <th className="px-4 py-3 text-left"></th>
              </tr>
            </thead>
            <tbody>
              {pending.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    Queue is clear. All calls have been dispatched.
                  </td>
                </tr>
              )}
              {pending.map((i) => (
                <IncidentRow key={i.id} incidentId={i.id}>
                  <td className="px-4 py-3 font-mono text-accent">{i.incident_number}</td>
                  <td className="px-4 py-3">
                    <span className="severity-pill" data-sev={i.incident_severity}>{i.incident_severity}</span>
                  </td>
                  <td className="px-4 py-3">{i.incident_type}</td>
                  <td className="px-4 py-3">
                    <div>{i.caller_name}</div>
                    <div className="text-xs text-muted-foreground">{i.caller_number}</div>
                  </td>
                  <td className="px-4 py-3 max-w-[280px] truncate">{i.location_address}</td>
                  <td className="px-4 py-3 text-muted-foreground">{timeAgo(i.call_timestamp)}</td>
                  <td className="px-4 py-3 text-right">
                    <StopClick>
                      <Link
                        href={`/dispatch/assign/${i.id}`}
                        className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-xs font-semibold"
                      >
                        Assign
                      </Link>
                    </StopClick>
                  </td>
                </IncidentRow>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <PendingRealtimeBridge />
    </div>
  );
}
