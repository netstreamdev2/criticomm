import { OfficeMenuBar } from '@/components/office/office-menu-bar';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  addDays, getRosterRange, getScheduleSettings, listEndorsements, listPublicHolidays, listRotations,
  listShiftTemplates, listSwaps, listTeamMembers, monthLabel, monthRange, saDay, shiftMonth,
} from '@criticom/api';
import { DEPARTMENT_NAMES, canAdminSchedule, canManageRoster, isScheduleHr, type Silo } from '@criticom/db';
import { getSession } from '@/lib/session';
import { RosterPlanner } from './planner';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Roster · HikTech' };

/**
 * The month roster: everyone in the department down the side, the days
 * across. Built from a rotation as drafts, adjusted, then issued — each
 * person is told once and confirms. Clashes (leave, court, another shift)
 * are refused by the database and shown here.
 */
export default async function RosterPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string; silo?: string }>;
}) {
  const { t } = await requestT();
  const { supabase, role, silo } = await getSession();
  const params = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(params.m ?? '') ? params.m! : saDay().slice(0, 7);
  // Organisation HR picks the department; everyone else rosters their own.
  const asked = params.silo && params.silo in DEPARTMENT_NAMES ? (params.silo as Silo) : null;
  const target: Silo = asked && isScheduleHr(role) ? asked : silo;
  if (!canManageRoster(role, silo, target)) redirect('/roster/mine');

  const { from, to } = monthRange(month);
  const [templates, rotations, people, lines, holidays, settings, swaps, endorsements] = await Promise.all([
    listShiftTemplates(supabase, target, { includeInactive: true }),
    listRotations(supabase, target),
    listTeamMembers(supabase, target),
    getRosterRange(supabase, { silo: target, from: addDays(from, -1), to }),
    listPublicHolidays(supabase, { from, to }).catch(() => []),
    getScheduleSettings(supabase, target),
    listSwaps(supabase, { silo: target, open: true }).catch(() => []),
    listEndorsements(supabase, { silo: target }).catch(() => []),
  ]);

  const q = (m: string) => `/roster?m=${m}${target !== silo ? `&silo=${target}` : ''}`;

  return (
    <div className="space-y-4">
      <OfficeMenuBar />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('Plan Repeating Shifts · {monthLabel}', { monthLabel: monthLabel(month) })}</h1>
          <p className="text-muted-foreground">{DEPARTMENT_NAMES[target]}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isScheduleHr(role) ? (
            <form method="get" className="flex items-center gap-2">
              <input type="hidden" name="m" value={month} />
              <select name="silo" defaultValue={target} className="h-9 rounded-md border border-border bg-bg-soft px-2 text-sm">
                {(Object.keys(DEPARTMENT_NAMES) as Silo[]).map((s) => <option key={s} value={s}>{DEPARTMENT_NAMES[s]}</option>)}
              </select>
              <button type="submit" className="h-9 rounded-md border border-border px-3 text-sm font-semibold hover:bg-muted">{t('Show')}</button>
            </form>
          ) : null}
          <Link href={q(shiftMonth(month, -1))} className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm font-semibold hover:bg-muted">← {monthLabel(shiftMonth(month, -1)).split(' ')[0]}</Link>
          <Link href={q(shiftMonth(month, 1))} className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm font-semibold hover:bg-muted">{monthLabel(shiftMonth(month, 1)).split(' ')[0]} →</Link>
          <Link href={`/roster/allocation${target !== silo ? `?silo=${target}` : ''}`} className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm font-semibold hover:bg-muted">{t('Duty board')}</Link>
        </div>
      </header>

      <RosterPlanner
        silo={target}
        month={month}
        today={saDay()}
        templates={templates}
        rotations={rotations}
        people={people}
        lines={lines}
        holidays={holidays}
        settings={settings}
        swaps={swaps.filter((s) => s.status === 'Accepted')}
        endorsements={endorsements}
      />
    </div>
  );
}
