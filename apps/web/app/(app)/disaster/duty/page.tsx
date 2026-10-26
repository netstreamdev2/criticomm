import { listDisasterOfficers, listDuty, listScgChairs } from '@criticom/api';
import { MDMC_ADDRESS, MDMC_ALTERNATE } from '@criticom/db/disaster-plan';
import { getSession } from '@/lib/session';
import { requestT } from '@/lib/i18n';
import { DutyBoard } from './board';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Duty Roster · HikTech' };

/**
 * Disaster Management's duty roster (0112): who is on duty or on standby,
 * their duty (the Plan's DOC core team: Principal Disaster Management
 * Stand-by Officer, MDMC Duty Officer, Stand-by Incident Logger …), and the
 * SCG duty chairperson, the City Manager or a Deputy City Manager, for each
 * calendar month.
 */
export default async function DutyPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const { t } = await requestT();
  const { supabase, role } = await getSession();
  const now = new Date();
  const asked = Number((await searchParams).year);
  const year = Number.isInteger(asked) && asked >= 2020 && asked <= 2100 ? asked : now.getFullYear();
  const [duty, officers, chairs] = await Promise.all([listDuty(supabase), listDisasterOfficers(supabase), listScgChairs(supabase, year)]);
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">{t('Duty roster')}</h1>
        <p className="text-muted-foreground">{t('MDMC: {a}. Alternate centre: {b}.', { a: MDMC_ADDRESS, b: MDMC_ALTERNATE })}</p>
      </header>
      <DutyBoard
        canEdit={role !== 'Viewer'}
        nowIso={now.toISOString()}
        year={year}
        thisMonth={now.getFullYear() === year ? now.getMonth() + 1 : null}
        duty={duty.map((d) => ({ id: d.id, name: d.name, phone: d.phone, duty: d.duty, status: d.status, startsAt: d.starts_at, endsAt: d.ends_at, note: d.note }))}
        officers={officers.map((o) => ({ id: o.id, name: o.name, phone: o.phone }))}
        chairs={chairs.map((c) => ({ month: c.month, name: c.name, phone: c.phone }))}
      />
    </div>
  );
}
