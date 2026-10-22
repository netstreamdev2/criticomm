import { OfficeMenuBar } from '@/components/office/office-menu-bar';
import { redirect } from 'next/navigation';
import {
  getScheduleSettings, listPublicHolidays, listRotations, listShiftTemplates, listTeamMembers, saDay,
} from '@criticom/api';
import { DEPARTMENT_NAMES, canAdminSchedule, canManageRoster, isScheduleHr, type Silo } from '@criticom/db';
import { getSession } from '@/lib/session';
import { SetupClient } from './setup-client';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Shift setup · HikTech' };

/**
 * A department's shift types, rotations and late minutes (its administrator),
 * the teams people are in (whoever rosters it), and public holidays
 * (organisation HR).
 */
export default async function ShiftSetupPage({ searchParams }: { searchParams: Promise<{ silo?: string }> }) {
  const { t } = await requestT();
  const { supabase, role, silo } = await getSession();
  const params = await searchParams;
  const asked = params.silo && params.silo in DEPARTMENT_NAMES ? (params.silo as Silo) : null;
  const target: Silo = asked && isScheduleHr(role) ? asked : silo;
  if (!canManageRoster(role, silo, target)) redirect('/roster/mine');

  const year = saDay().slice(0, 4);
  const [templates, rotations, settings, people, holidays] = await Promise.all([
    listShiftTemplates(supabase, target, { includeInactive: true }),
    listRotations(supabase, target, { includeInactive: true }),
    getScheduleSettings(supabase, target),
    listTeamMembers(supabase, target),
    listPublicHolidays(supabase, { from: `${year}-01-01`, to: `${Number(year) + 1}-12-31` }).catch(() => []),
  ]);

  return (
    <div className="space-y-4">
      <OfficeMenuBar />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('Shift Patterns')}</h1>
          <p className="text-muted-foreground">{DEPARTMENT_NAMES[target]}</p>
        </div>
        {isScheduleHr(role) ? (
          <form method="get" className="flex items-center gap-2">
            <select name="silo" defaultValue={target} className="h-9 rounded-md border border-border bg-bg-soft px-2 text-sm">
              {(Object.keys(DEPARTMENT_NAMES) as Silo[]).map((s) => <option key={s} value={s}>{DEPARTMENT_NAMES[s]}</option>)}
            </select>
            <button type="submit" className="h-9 rounded-md border border-border px-3 text-sm font-semibold hover:bg-muted">{t('Show')}</button>
          </form>
        ) : null}
      </header>
      <SetupClient
        silo={target}
        canAdmin={canAdminSchedule(role, silo, target)}
        isHr={isScheduleHr(role)}
        templates={templates}
        rotations={rotations}
        settings={settings}
        people={people}
        holidays={holidays}
      />
    </div>
  );
}
