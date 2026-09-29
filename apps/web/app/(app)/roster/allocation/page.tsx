import { getDutyBoard, getPersonDay } from '@criticom/api';
import { SUPERVISORY_ROLES, type Silo } from '@criticom/db';
import { getSession } from '@/lib/session';
import { AllocationBoard } from './allocation-client';

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
  const { supabase, silo, role } = await getSession();
  const params = await searchParams;

  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? '') ? params.date! : saToday();
  const canManage = SUPERVISORY_ROLES.includes(role);

  // Global roles may inspect a specific department's board; everyone else is
  // pinned to their own.
  const target: Silo = silo === 'Ethekwini' && params.silo ? (params.silo as Silo) : silo;

  const [board, people] = await Promise.all([
    // Only duty officers see drafts — staff must not read a half-built board
    // as an instruction.
    getDutyBoard(supabase, { silo: target, date, includeDrafts: canManage }),
    getPersonDay(supabase, { silo: target, date, includeDrafts: canManage }),
  ]);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Duty allocation</h1>
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
      />
    </div>
  );
}
