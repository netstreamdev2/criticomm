import Link from 'next/link';
import { ChevronDown, Radio } from 'lucide-react';
import { arrivalWords, partOpen, partWords, sortParts, type DepartmentPart } from '@criticom/api';
import {
  DEPARTMENT_NAMES, DISPATCH_DESK_ROLES, dispositionLabel, PART_STATUS_ROLES, STATUS_OVERRIDE_STEPS, canDirectDepartment, canFileByRadio, commandsDepartment,
  type Silo, type UserRole,
} from '@criticom/db';
import { Card, CardContent } from '@/components/ui/card';
import { formatSaTime } from '@/lib/utils';
import { ConfirmArrival, StandDown, StatusOverride } from './case-forms';
import { CloseOnSceneButton } from './radio/close-button';
import { requestT } from '@/lib/i18n';

const AT_SCENE = ['Arrived', 'On Scene', 'Transporting'];

/**
 * Each department's part of the call (0073): who dispatched it, who leads
 * it, where its crew is, and whether its report is in. Each department acts
 * on its own part only; the database has the final word.
 *
 * Folds to one line of department chips; it opens by itself when this person
 * has something to do in it (dispatch, mark, stand down, file by radio).
 */
export async function DepartmentsCard({
  incidentId, incidentSilo, parts, role, silo, live, caseClosed = false,
}: {
  incidentId: string;
  incidentSilo: Silo;
  parts: DepartmentPart[];
  role: UserRole;
  silo: Silo;
  /** The call is still live (not resolved or closed). */
  live: boolean;
  /** Case review has closed it: nothing more to file or close. */
  caseClosed?: boolean;
}) {
  const { t } = await requestT();
  const open = parts.filter((p) => partOpen(p.status)).length;
  // Filed and not yet closed on scene by their lead (0074).
  const toClose = sortParts(parts).filter((p) => p.status === 'Resolved' && !p.closed_at).map((p) => DEPARTMENT_NAMES[p.silo]);
  const chip = (p: DepartmentPart) => `rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
    p.status === 'Waiting' ? 'border-severity-medium/40 bg-severity-medium/10 text-severity-medium-ink'
      : p.status === 'Resolved' ? 'border-severity-low/40 bg-severity-low/10 text-severity-low-ink'
      : !partOpen(p.status) ? 'border-border bg-bg-soft text-muted-foreground'
      : 'border-accent/40 bg-accent/10 text-accent'
  }`;
  const rows = sortParts(parts).map((p) => {
    const directs = live && canDirectDepartment(role, silo, p.silo);
    const mayDispatch = directs && DISPATCH_DESK_ROLES.includes(role) && partOpen(p.status) && !p.lead_id;
    const mayMark = directs && PART_STATUS_ROLES.includes(role) && partOpen(p.status) && p.status !== 'Waiting';
    const mayStandDown = directs && partOpen(p.status)
      && (!AT_SCENE.includes(p.status) || commandsDepartment(role, silo, p.silo));
    const radio = !caseClosed && canFileByRadio(role, silo, p.silo);
    const mayFileByRadio = radio && partOpen(p.status) && p.status !== 'Waiting' && !p.report_filed_at;
    const mayCloseForCrew = radio && p.status === 'Resolved' && Boolean(p.report_filed_at) && !p.closed_at;
    // Pressed on scene away from it (0099): no report until dispatch confirms (0102).
    const mayConfirm = directs && p.arrived_verified === false && !p.report_filed_at;
    return { p, mayDispatch, mayMark, mayStandDown, mayFileByRadio, mayCloseForCrew, mayConfirm };
  });
  // Open when there is something here for this person to do.
  const actionable = rows.some((r) => r.mayDispatch || r.mayMark || r.mayStandDown || r.mayFileByRadio || r.mayCloseForCrew || r.mayConfirm);
  return (
    <Card>
      <details open={actionable} className="group">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
          <h2 className="text-base font-semibold">{t('Departments on this call')}</h2>
          {/* Folded, each department's status still shows. */}
          <span className="flex flex-wrap gap-1.5 group-open:hidden">
            {sortParts(parts).map((p) => (
              <span key={p.silo} className={chip(p)}>{DEPARTMENT_NAMES[p.silo]} · {partWords(p)}</span>
            ))}
          </span>
          <ChevronDown className="ml-auto h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
          <p className="hidden w-full text-sm text-muted-foreground group-open:block">
            {open > 0
              ? `Each department dispatches, works and reports its own part. The call is resolved when all ${parts.length} have finished.`
              : toClose.length
                ? `Every department has finished. Still to close on scene: ${toClose.join(', ')}.`
                : 'Every department has closed.'}
          </p>
        </summary>
      <CardContent className="border-t border-border p-0">
        <ul className="divide-y divide-border">
          {rows.map(({ p, mayDispatch, mayMark, mayStandDown, mayFileByRadio, mayCloseForCrew, mayConfirm }) => {
            return (
              <li key={p.silo} className="space-y-2 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{DEPARTMENT_NAMES[p.silo]}</p>
                  <span className={chip(p)}>{partWords(p)}</span>
                </div>
                <dl className="grid gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
                  {p.dispatched_at ? (
                    <div><dt className="inline">{t('Dispatched')}{' '}</dt><dd className="inline">{formatSaTime(p.dispatched_at)}{p.dispatched_by_name ? ` by ${p.dispatched_by_name}` : ''}</dd></div>
                  ) : null}
                  {p.lead_name ? (
                    <div><dt className="inline">{t('Lead')}{' '}</dt><dd className="inline">{p.lead_name}{p.accepted_at ? ` · ${formatSaTime(p.accepted_at)}` : ''}</dd></div>
                  ) : null}
                  {p.arrived_at ? (
                    <div>
                      <dt className="inline">{t('On scene')}{' '}</dt>
                      <dd className="inline">
                        {formatSaTime(p.arrived_at)}
                        {/* How it was recorded (0099): GPS, the officer (checked against their phone), or the desk. */}
                        {(() => {
                          const a = arrivalWords(p);
                          return a ? <span className={a.tone === 'warn' ? ' font-bold text-severity-high-ink' : a.tone === 'ok' ? ' text-severity-low-ink' : ''}> · {t(a.text)}</span> : null;
                        })()}
                      </dd>
                    </div>
                  ) : null}
                  {p.report_filed_at ? <div><dt className="inline">{t('Report filed')}{' '}</dt><dd className="inline">{formatSaTime(p.report_filed_at)}</dd></div> : null}
                  {p.closed_at ? (
                    <div><dt className="inline">{t('Closed on scene')}{' '}</dt><dd className="inline">{formatSaTime(p.closed_at)}{p.closed_by_name ? ` by ${p.closed_by_name}` : ''}</dd></div>
                  ) : null}
                  {p.disposition ? (
                    <div><dt className="inline">{t('Outcome')}{' '}</dt><dd className="inline font-semibold">{t(dispositionLabel(p.disposition) ?? '')}</dd></div>
                  ) : null}
                  {p.close_note ? (
                    <div className="sm:col-span-2"><dt className="inline">{t('Closing note')}{' '}</dt><dd className="inline">{p.close_note}</dd></div>
                  ) : null}
                  {p.finish_reason && p.status !== 'Resolved' ? (
                    <div className="sm:col-span-2"><dt className="inline">{t('Why')}{' '}</dt><dd className="inline">{p.finish_reason}{p.finished_by_name ? ` (${p.finished_by_name})` : ''}</dd></div>
                  ) : null}
                </dl>
                {p.radio_filed_by_name ? (
                  <p className="text-xs text-muted-foreground">{t('Filed from the desk by {value}{value2}.', { value: p.radio_filed_by_name, value2: p.radioed_by_name ? `, as radioed in by ${p.radioed_by_name}` : '' })}</p>
                ) : null}
                {mayDispatch || mayMark || mayStandDown || mayFileByRadio || mayCloseForCrew || mayConfirm ? (
                  <div className="flex flex-wrap items-start gap-3">
                    {mayConfirm ? <ConfirmArrival incidentId={incidentId} department={p.silo} /> : null}
                    {mayDispatch ? (
                      <Link href={`/dispatch/assign/${incidentId}`} className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-xs font-semibold">
                        {p.status === 'Waiting' ? `Dispatch ${DEPARTMENT_NAMES[p.silo]}` : 'Dispatch again'}
                      </Link>
                    ) : null}
                    {mayMark ? (
                      <StatusOverride incidentId={incidentId} silo={incidentSilo} department={p.silo} steps={STATUS_OVERRIDE_STEPS} current={p.status} />
                    ) : null}
                    {mayFileByRadio ? (
                      <Link href={`/incidents/${incidentId}/radio?dept=${p.silo}`} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-accent/50 px-3 text-xs font-semibold text-accent hover:bg-accent/10">
                        <Radio className="h-3.5 w-3.5" aria-hidden /> {' '}{t('Report by radio')}</Link>
                    ) : null}
                    {mayCloseForCrew ? <CloseOnSceneButton incidentId={incidentId} silo={p.silo} label={DEPARTMENT_NAMES[p.silo]} /> : null}
                    {mayStandDown ? <StandDown incidentId={incidentId} department={p.silo} label={DEPARTMENT_NAMES[p.silo]} /> : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </CardContent>
      </details>
    </Card>
  );
}
