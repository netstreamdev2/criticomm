import Link from 'next/link';
import { getServerSupabase } from '@/lib/supabase';
import { listPendingIncidents } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { timeAgo } from '@/lib/utils';
import { PendingRealtimeBridge } from './realtime-bridge';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Pending queue · Criticom' };

export default async function PendingPage() {
  const supabase = await getServerSupabase();
  const pending = await listPendingIncidents(supabase);

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Pending dispatch queue</h1>
          <p className="text-muted-foreground">
            Sorted by severity then call time. Updates in real time.
          </p>
        </div>
        <Link
          href="/dispatch/log-call"
          className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold"
        >
          + Log new call
        </Link>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{pending.length} pending</CardTitle>
          <CardDescription>Click an incident to assign units.</CardDescription>
        </CardHeader>
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
                <tr key={i.id} className="border-b border-border/50 hover:bg-muted/40">
                  <td className="px-4 py-3 font-mono">{i.incident_number}</td>
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
                    <Link
                      href={`/dispatch/assign/${i.id}`}
                      className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-xs font-semibold"
                    >
                      Assign
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <PendingRealtimeBridge />
    </div>
  );
}
