import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FIREARM_OUT_LIMIT_HOURS, getShiftBoard, type ShiftBoard, type ShiftBoardRow } from '@criticom/api';
import { DEPARTMENT_NAMES } from '@criticom/db/onboarding';
import { canAccess, SUPERVISORY_ROLES } from '@criticom/db/roles';
import { fleetRolesFor } from '@/lib/assets/roles';
import { invitationErrorMessage } from '@/lib/onboarding/errors';
import { getSession } from '@/lib/session';
import { cn, formatSaTime } from '@/lib/utils';
import { ShiftBoardLive } from './board-live';
import { ReturnToService } from './off-road';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Today’s shift · HikTech' };

const FLAG: Record<ShiftBoardRow['flags'][number], [string, string]> = {
  'firearm-out-after-end': ['Shift ended, firearm not handed back', 'border-severity-critical/50 bg-severity-critical/10 text-severity-critical-ink'],
  'firearm-overdue': [`Firearm out over ${FIREARM_OUT_LIMIT_HOURS} hours`, 'border-severity-high/50 bg-severity-high/10 text-severity-high-ink'],
  'bodycam-out-after-end': ['Shift ended, bodycam not handed back', 'border-severity-critical/50 bg-severity-critical/10 text-severity-critical-ink'],
  'bodycam-overdue': [`Bodycam out over ${FIREARM_OUT_LIMIT_HOURS} hours`, 'border-severity-high/50 bg-severity-high/10 text-severity-high-ink'],
  'failed-readiness': ['Failed readiness check', 'border-severity-medium/50 bg-severity-medium/10 text-severity-medium-ink'],
  'vehicle-failed': ['Vehicle failed inspection', 'border-severity-medium/50 bg-severity-medium/10 text-severity-medium-ink'],
};
const ENDED: Record<NonNullable<ShiftBoardRow['ended']>['source'], string> = {
  app: 'Ended in the app', sign_out: 'Signed out', firearm_out: 'Signed out holding a firearm',
};
const INSPECTION = { pass: ['passed', 'text-success'], faults: ['passed with faults', 'text-severity-medium-ink'], fail: ['failed', 'text-severity-high-ink'] } as const;
const time = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '';

/**
 * Today's shift (migrations 0051 and 0054): who has started, with which
 * vehicle, firearm and bodycam, who is on duty, who has ended, and what needs a
 * supervisor now. Anyone still holding a firearm or bodycam is on the board,
 * whatever day they took it, and flagged once it has been out longer than a
 * shift or kept after the shift ended.
 */
export default async function TodayShiftPage() {
  const { t } = await requestT();
  const { supabase, role, silo } = await getSession();
  if (!SUPERVISORY_ROLES.includes(role) && role !== 'SystemController') notFound();
  const global = role === 'SystemAdmin' || role === 'SuperAdmin' || role === 'SystemController' || role === 'System';
  const fleet = fleetRolesFor(role, silo);

  let board: ShiftBoard | null = null;
  let loadError: string | null = null;
  try {
    board = await getShiftBoard(supabase, { silo: global ? undefined : silo });
  } catch (e) {
    loadError = invitationErrorMessage(e, 'Today’s shift could not be loaded.');
  }
  const flagged = board?.rows.filter((r) => r.flags.length).length ?? 0;

  return (
    <div className="space-y-6">
      <ShiftBoardLive />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('Today’s shift')}</h1>
          <p className="max-w-2xl text-muted-foreground">
            {t('Who has started{value}, with which vehicle, firearm and bodycam, and who has ended. Problems come first. Updates by itself.', { value: global ? '' : ` in ${DEPARTMENT_NAMES[silo]}` })}</p>
        </div>
        <nav className="flex flex-wrap gap-2 text-sm" aria-label={t('Related')}>
          <Link href="/shift/readiness-review" className="rounded-md border border-border px-4 py-2 hover:bg-muted">{t('Readiness checks')}</Link>
          <Link href="/shift/unit-compliance" className="rounded-md border border-border px-4 py-2 hover:bg-muted">{t('Unit compliance')}</Link>
          {canAccess('/police/armoury', role, silo) ? <Link href="/police/armoury" className="rounded-md border border-border px-4 py-2 hover:bg-muted">{t('Armoury')}</Link> : null}
          {canAccess('/police/bodycams', role, silo) ? <Link href="/police/bodycams" className="rounded-md border border-border px-4 py-2 hover:bg-muted">{t('Bodycams')}</Link> : null}
          {canAccess('/admin/vehicles', role, silo) ? (
            <Link href="/admin/vehicles" className="rounded-md border border-border px-4 py-2 hover:bg-muted">{t('Fleet')}</Link>
          ) : null}
        </nav>
      </header>

      {loadError || !board ? (
        <p role="alert" className="rounded-lg border border-severity-critical/40 bg-severity-critical/10 px-4 py-3 text-sm text-severity-critical-ink">{loadError}</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            {([
              ['Started today', board.totals.started, ''],
              ['On duty now', board.totals.onDuty, ''],
              ['Ended', board.totals.ended, ''],
              ['Firearms out', board.totals.firearmsOut, ''],
              ['Bodycams out', board.totals.bodycamsOut, ''],
              [`Out over ${FIREARM_OUT_LIMIT_HOURS} hours`, board.totals.overdue, board.totals.overdue ? 'text-severity-high-ink' : ''],
              ['Vehicles in use', board.totals.vehiclesInUse, ''],
              ['Vehicles off the road', board.totals.offRoad, board.totals.offRoad ? 'text-severity-medium-ink' : ''],
            ] as const).map(([label, n, tone]) => (
              <div key={label} className="rounded-lg border border-border bg-bg-card px-3 py-2">
                <dd className={cn('text-2xl font-bold tabular-nums', tone)}>{n}</dd>
                <dt className="text-xs text-muted-foreground">{label}</dt>
              </div>
            ))}
          </dl>

          {flagged ? (
            <p className="rounded-lg border border-severity-high/50 bg-severity-high/10 px-4 py-3 text-sm">
              <b>{t('{flagged} {value} attention', { flagged, value: flagged === 1 ? 'person needs' : 'people need' })}</b>{t(': they are at the top of the list.')}</p>
          ) : null}

          <section className="space-y-2">
            <h2 className="text-base font-semibold">{t('People')}</h2>
            <div className="overflow-x-auto rounded-xl border border-border bg-bg-card">
              <table className="w-full min-w-[64rem] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2">{t('Officer')}</th>
                    <th className="px-3 py-2">{t('Readiness')}</th>
                    <th className="px-3 py-2">{t('Vehicle')}</th>
                    <th className="px-3 py-2">{t('Firearm')}</th>
                    <th className="px-3 py-2">{t('Bodycam')}</th>
                    <th className="px-3 py-2">{t('Shift')}</th>
                  </tr>
                </thead>
                <tbody>
                  {board.rows.length === 0 ? (
                    <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">{t('Nobody has started a shift today yet.')}</td></tr>
                  ) : board.rows.map((r) => (
                    <tr key={r.userId} className={cn('border-b border-border align-top last:border-0', r.flags.length && 'bg-severity-high/[0.04]')}>
                      <td className="px-3 py-2">
                        <span className="font-medium">{r.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {r.badge}{r.station ? ` · ${r.station}` : ''}{global ? ` · ${DEPARTMENT_NAMES[r.silo]}` : ''}
                        </span>
                        {r.flags.length ? (
                          <span className="mt-1 flex flex-wrap gap-1">
                            {r.flags.map((f) => (
                              <span key={f} className={cn('rounded-full border px-2 py-0.5 text-[11px] font-semibold', FLAG[f][1])}>{FLAG[f][0]}</span>
                            ))}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        {r.readiness === 'passed' ? <span className="text-success">{t('Passed')}</span>
                          : r.readiness === 'failed' ? <span className="font-semibold text-severity-high-ink">{t('Failed')}</span>
                            : <span className="text-muted-foreground">{t('Not today')}</span>}
                      </td>
                      <td className="px-3 py-2">
                        {r.vehicle ? (
                          <>
                            <span className="font-mono font-semibold">{r.vehicle.unit}</span>
                            {r.vehicle.result ? <span className={cn('block text-xs', INSPECTION[r.vehicle.result][1])}>{t('Inspection {value}', { value: INSPECTION[r.vehicle.result][0] })}</span> : null}
                          </>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        {r.firearm ? (
                          <>
                            <span className="font-mono font-semibold">{r.firearm.serial}</span>
                            <span className="block text-xs text-muted-foreground">{t('{label} · since {saTime}', { label: r.firearm.label, saTime: formatSaTime(r.firearm.since) })}</span>
                          </>
                        ) : r.noFirearm !== undefined ? (
                          <span className="text-muted-foreground">{t('None drawn{value}', { value: r.noFirearm ? `: ${r.noFirearm}` : '' })}</span>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        {r.bodycam ? (
                          <>
                            <span className="font-mono font-semibold">{r.bodycam.serial}</span>
                            <span className="block text-xs text-muted-foreground">{t('since {saTime}', { saTime: formatSaTime(r.bodycam.since) })}</span>
                          </>
                        ) : r.noBodycam !== undefined ? (
                          <span className="text-severity-medium-ink">{t('None: {noBodycam}', { noBodycam: r.noBodycam })}</span>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        {r.onDuty ? (
                          <span className="font-semibold text-success">{t('On duty{value}', { value: r.dutySince ? ` since ${time(r.dutySince)}` : '' })}</span>
                        ) : r.ended ? (
                          <span>{t('{value} at {time}', { value: ENDED[r.ended.source], time: time(r.ended.at) })}</span>
                        ) : <span className="text-muted-foreground">{t('Off duty')}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold">{t('Vehicles off the road')}</h2>
            {board.offRoad.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('Every vehicle is on the road.')}</p>
            ) : (
              <ul className="divide-y divide-border rounded-xl border border-border bg-bg-card text-sm">
                {board.offRoad.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                    <span>
                      <span className="font-mono font-semibold">{v.unit_number}</span> {v.name}
                      <span className={cn('ml-2 rounded-full border px-2 py-0.5 text-xs font-semibold',
                        v.status === 'Out of Service' ? 'border-severity-high/50 text-severity-high-ink' : 'border-severity-medium/50 text-severity-medium-ink')}>
                        {v.status}
                      </span>
                      {v.status_note ? <span className="block text-xs text-muted-foreground">{v.status_note}</span> : null}
                    </span>
                    {fleet.canManage ? <ReturnToService vehicle={v} /> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
