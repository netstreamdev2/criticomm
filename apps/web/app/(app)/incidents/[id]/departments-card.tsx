import Link from 'next/link';
import { partOpen, partWords, sortParts, type DepartmentPart } from '@criticom/api';
import {
  DEPARTMENT_NAMES, DISPATCH_DESK_ROLES, STATUS_OVERRIDE_ROLES, STATUS_OVERRIDE_STEPS, canDirectDepartment, commandsDepartment,
  type Silo, type UserRole,
} from '@criticom/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatSaTime } from '@/lib/utils';
import { StandDown, StatusOverride } from './case-forms';

const AT_SCENE = ['Arrived', 'On Scene', 'Transporting'];

/**
 * Each department's part of the call (0073): who dispatched it, who leads
 * it, where its crew is, and whether its report is in. Each department acts
 * on its own part only; the database has the final word.
 */
export function DepartmentsCard({
  incidentId, incidentSilo, parts, role, silo, live,
}: {
  incidentId: string;
  incidentSilo: Silo;
  parts: DepartmentPart[];
  role: UserRole;
  silo: Silo;
  /** The call is still live (not resolved or closed). */
  live: boolean;
}) {
  const open = parts.filter((p) => partOpen(p.status)).length;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Departments on this call</CardTitle>
        <CardDescription>
          {open === 0
            ? 'Every department has finished.'
            : `Each department dispatches, works and reports its own part. The call is resolved when all ${parts.length} have finished.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y divide-border">
          {sortParts(parts).map((p) => {
            const directs = live && canDirectDepartment(role, silo, p.silo);
            const mayDispatch = directs && DISPATCH_DESK_ROLES.includes(role) && partOpen(p.status) && !p.lead_id;
            const mayMark = directs && STATUS_OVERRIDE_ROLES.includes(role) && partOpen(p.status) && p.status !== 'Waiting';
            const mayStandDown = directs && partOpen(p.status)
              && (!AT_SCENE.includes(p.status) || commandsDepartment(role, silo, p.silo));
            const finished = !partOpen(p.status);
            return (
              <li key={p.silo} className="space-y-2 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{DEPARTMENT_NAMES[p.silo]}</p>
                  <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                    p.status === 'Waiting' ? 'border-severity-medium/40 bg-severity-medium/10 text-severity-medium-ink'
                      : p.status === 'Resolved' ? 'border-severity-low/40 bg-severity-low/10 text-severity-low-ink'
                      : finished ? 'border-border bg-bg-soft text-muted-foreground'
                      : 'border-accent/40 bg-accent/10 text-accent'
                  }`}>
                    {partWords(p)}
                  </span>
                </div>
                <dl className="grid gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
                  {p.dispatched_at ? (
                    <div><dt className="inline">Dispatched </dt><dd className="inline">{formatSaTime(p.dispatched_at)}{p.dispatched_by_name ? ` by ${p.dispatched_by_name}` : ''}</dd></div>
                  ) : null}
                  {p.lead_name ? (
                    <div><dt className="inline">Lead </dt><dd className="inline">{p.lead_name}{p.accepted_at ? ` · ${formatSaTime(p.accepted_at)}` : ''}</dd></div>
                  ) : null}
                  {p.arrived_at ? <div><dt className="inline">On scene </dt><dd className="inline">{formatSaTime(p.arrived_at)}</dd></div> : null}
                  {p.report_filed_at ? <div><dt className="inline">Report filed </dt><dd className="inline">{formatSaTime(p.report_filed_at)}</dd></div> : null}
                  {p.finish_reason && p.status !== 'Resolved' ? (
                    <div className="sm:col-span-2"><dt className="inline">Why </dt><dd className="inline">{p.finish_reason}{p.finished_by_name ? ` (${p.finished_by_name})` : ''}</dd></div>
                  ) : null}
                </dl>
                {mayDispatch || mayMark || mayStandDown ? (
                  <div className="flex flex-wrap items-start gap-3">
                    {mayDispatch ? (
                      <Link href={`/dispatch/assign/${incidentId}`} className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-xs font-semibold">
                        {p.status === 'Waiting' ? `Dispatch ${DEPARTMENT_NAMES[p.silo]}` : 'Dispatch again'}
                      </Link>
                    ) : null}
                    {mayMark ? (
                      <StatusOverride incidentId={incidentId} silo={incidentSilo} department={p.silo} steps={STATUS_OVERRIDE_STEPS} current={p.status} />
                    ) : null}
                    {mayStandDown ? <StandDown incidentId={incidentId} department={p.silo} label={DEPARTMENT_NAMES[p.silo]} /> : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
