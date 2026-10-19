import { getDutyBoard, getPersonDay, getScheduleSettings, listShiftTemplates } from '@criticom/api';
import { DEPARTMENT_NAMES, canManageRoster, isScheduleHr, type Silo } from '@criticom/db';
import { getSession } from '@/lib/session';
import { AllocationBoard } from './allocation-client';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Duty allocation · HikTech' };

/** Today in SA time — the board is a local-operations artefact, not a UTC one. */
function saToday() {
  return new Date(Date.now() + 2 * 3600_000).toISOString().slice(0, 10);
}

function shiftDate(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default async function AllocationPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; silo?: string }>;
}) {
  const { t } = await requestT();
  const { supabase, silo, role } = await getSession();
  const params = await searchParams;

  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? '') ? params.date! : saToday();

  // The control room and organisation HR may look at any department's board;
  // everyone else is pinned to their own.
  const asked = params.silo && params.silo in DEPARTMENT_NAMES ? (params.silo as Silo) : null;
  const target: Silo = asked && (silo === 'Ethekwini' || isScheduleHr(role)) ? asked : silo;
  const canManage = canManageRoster(role, silo, target);

  const [board, people, templates, settings] = await Promise.all([
    // Only those who roster the department see drafts — staff must not read
    // a half-built board as an instruction.
    getDutyBoard(supabase, { silo: target, date, includeDrafts: canManage }),
    getPersonDay(supabase, { silo: target, date, includeDrafts: canManage }),
    canManage ? listShiftTemplates(supabase, target).catch(() => []) : Promise.resolve([]),
    getScheduleSettings(supabase, target),
  ]);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">{t('Duty allocation')}</h1>
        <p className="text-muted-foreground">
          {canManage
            ? 'Fill every post, then publish the board to issue it to staff.'
            : 'The published duty board for your department.'}
        </p>
      </header>

      <AllocationBoard
        board={board}
        people={people}
        date={date}
        silo={target}
        canManage={canManage}
        prevDate={shiftDate(date, -1)}
        templates={templates.map((t) => ({ id: t.id, name: t.name, start: t.start_time.slice(0, 5) }))}
        settings={settings}
        isToday={date === saToday()}
      />
    </div>
  );
}
