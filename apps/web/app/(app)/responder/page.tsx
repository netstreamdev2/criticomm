import Link from 'next/link';
import { getMyPersonnel, listMyAssignedIncidents, hasCompletedShiftStartToday } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { getSession } from '@/lib/session';
import { timeAgo } from '@/lib/utils';
import { responderStatusAction, uploadEvidenceAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My Incidents · HikTech' };

const FLOW: Array<{ from: string[]; next: string }> = [
  { from: ['Dispatched'], next: 'En Route' },
  { from: ['En Route'], next: 'Arrived' },
  { from: ['Arrived'], next: 'On Scene' },
  { from: ['On Scene'], next: 'Transporting' },
  { from: ['Transporting', 'On Scene'], next: 'Resolved' },
];

export default async function ResponderPage() {
  const { supabase, userId } = await getSession();

  const [me, shiftDone] = await Promise.all([
    getMyPersonnel(supabase, userId),
    hasCompletedShiftStartToday(supabase).catch(() => false),
  ]);
  const incidents = await listMyAssignedIncidents(supabase, me?.assigned_apparatus_id ?? null);

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">My incidents</h1>
          <p className="text-muted-foreground">
            {me
              ? `Unit ${me.apparatus?.unit_number ?? '—'} · ${me.is_on_duty ? 'On duty' : 'Off duty'}`
              : 'No personnel record linked to your account yet — contact your supervisor.'}
          </p>
        </div>
        {!shiftDone && (
          <Link
            href="/shift/mental-check"
            className="inline-flex h-10 items-center rounded-md bg-severity-medium px-4 text-sm font-semibold"
          >
            Start-of-shift checks pending →
          </Link>
        )}
      </header>

      {incidents.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            No incidents assigned to your unit. Stay ready.
          </CardContent>
        </Card>
      )}

      {incidents.map((i) => {
        const next = FLOW.find((f) => f.from.includes(i.status))?.next;
        return (
          <Card key={i.id}>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="font-mono">{i.incident_number}</CardTitle>
                  <CardDescription>
                    {i.incident_type} · <span className="severity-pill" data-sev={i.incident_severity}>{i.incident_severity}</span> · dispatched {timeAgo(i.dispatch_time)}
                  </CardDescription>
                </div>
                <span className="rounded-md border border-border bg-bg-soft px-3 py-1 text-sm font-semibold">{i.status}</span>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <p><span className="text-muted-foreground">Location:</span> {i.location_address}</p>
              <p><span className="text-muted-foreground">Description:</span> {i.call_description}</p>

              <div className="flex flex-wrap items-center gap-2">
                {next && (
                  <form action={responderStatusAction}>
                    <input type="hidden" name="incident_id" value={i.id} />
                    <input type="hidden" name="silo" value={i.silo} />
                    <input type="hidden" name="status" value={next} />
                    <button type="submit" className="rounded-md bg-primary px-4 py-2 text-sm font-semibold">
                      Mark {next}
                    </button>
                  </form>
                )}
                <Link href={`/incidents/${i.id}`} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted">
                  Full details
                </Link>
              </div>

              <form action={uploadEvidenceAction} className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                <input type="hidden" name="incident_id" value={i.id} />
                <input type="hidden" name="silo" value={i.silo} />
                <input type="file" name="file" accept="image/*,audio/*,video/*" className="text-xs" />
                <input
                  name="caption" placeholder="Caption (optional)"
                  className="h-9 w-48 rounded-md border border-border bg-bg-soft px-3 text-xs"
                />
                <button type="submit" className="h-9 rounded-md bg-accent px-3 text-xs font-semibold">
                  Upload evidence
                </button>
              </form>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
