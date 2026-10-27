import { listDisasterOfficers, listDuty, listForumMeetings, listScgChairs, listTaskTeams } from '@criticom/api';
import { MDMC_ADDRESS, MDMC_ALTERNATE } from '@criticom/db/disaster-plan';
import { getSession } from '@/lib/session';
import { requestT } from '@/lib/i18n';
import { PageGuide } from '@/components/office/page-guide';
import { DutyBoard } from './board';
import { ForumBoard } from './forum';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Duty and Forum · HikTech' };

/**
 * Disaster Management's duty roster (0112): who is on duty or on standby,
 * their duty (the Plan's DOC core team: Principal Disaster Management
 * Stand-by Officer, MDMC Duty Officer, Stand-by Incident Logger …), and the
 * SCG duty chairperson, the City Manager or a Deputy City Manager, for each
 * calendar month. The Advisory Forum's five task teams and its meetings
 * (0120) follow.
 */
export default async function DutyPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const { t } = await requestT();
  const { supabase, role } = await getSession();
  const now = new Date();
  const asked = Number((await searchParams).year);
  const year = Number.isInteger(asked) && asked >= 2020 && asked <= 2100 ? asked : now.getFullYear();
  const [duty, officers, chairs, teams, meetings] = await Promise.all([
    listDuty(supabase), listDisasterOfficers(supabase), listScgChairs(supabase, year), listTaskTeams(supabase), listForumMeetings(supabase),
  ]);
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">{t('Duty and forum')}</h1>
        <p className="text-muted-foreground">{t('MDMC: {a}. Alternate centre: {b}.', { a: MDMC_ADDRESS, b: MDMC_ALTERNATE })}</p>
      </header>
      <PageGuide id="disaster.duty" steps={[
        t('Put each person on duty or on standby, with their duty and their times. The JOC Commander and the stand-by officer are the ones the desk phones first.'),
        t('Choose the JOC duty chair for each month: the City Manager or a Deputy City Manager.'),
        t('Below: the chair of each of the Advisory Forum’s task teams, and its meetings.'),
      ]} />
      <DutyBoard
        canEdit={role !== 'Viewer'}
        nowIso={now.toISOString()}
        year={year}
        thisMonth={now.getFullYear() === year ? now.getMonth() + 1 : null}
        duty={duty.map((d) => ({ id: d.id, name: d.name, phone: d.phone, duty: d.duty, status: d.status, startsAt: d.starts_at, endsAt: d.ends_at, note: d.note }))}
        officers={officers.map((o) => ({ id: o.id, name: o.name, phone: o.phone }))}
        chairs={chairs.map((c) => ({ month: c.month, name: c.name, phone: c.phone }))}
      />
      <ForumBoard canEdit={role !== 'Viewer'}
        teams={teams.map((x) => ({ team: x.team, chair: x.chair, phone: x.chair_phone }))}
        meetings={meetings.map((m) => ({ id: m.id, body: m.body, heldOn: m.held_on, attended: m.attended, notes: m.notes, by: m.created_by_name }))} />
    </div>
  );
}
