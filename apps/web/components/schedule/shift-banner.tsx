import Link from 'next/link';
import { getMyShiftNow, getScheduleSettings, listShiftTemplates, saTime, shiftState, stateWords } from '@criticom/api';
import { RESPONDER_ROLES, type Silo, type UserRole } from '@criticom/db';
import { getServerSupabase } from '@/lib/supabase';
import { StartShiftButton } from './start-shift-button';

/**
 * For desk staff (control room, call takers, dispatchers, supervisors at the
 * console): their shift is about to start or has started and they have not
 * started it here. Field crews start theirs in the app. Renders nothing
 * otherwise — and never holds up the page (it is suspended in the layout).
 */
export async function ShiftBanner({ userId, role, silo }: { userId: string; role: UserRole; silo: Silo }) {
  if (RESPONDER_ROLES.includes(role)) return null;
  const supabase = await getServerSupabase();
  const line = await getMyShiftNow(supabase, userId).catch(() => null);
  if (!line || !line.start_at || !line.end_at || line.attendance?.checked_in_at) return null;
  const startsIn = Date.parse(line.start_at) - Date.now();
  if (startsIn > 30 * 60_000) return null;

  const [settings, templates] = await Promise.all([
    getScheduleSettings(supabase, silo),
    listShiftTemplates(supabase, line.silo, { includeInactive: true }).catch(() => []),
  ]);
  const state = shiftState({ start_at: line.start_at, end_at: line.end_at, status: line.status, cancelled_at: line.cancelled_at }, line.attendance, settings);
  const late = state === 'late' || state === 'not_started';
  const name = templates.find((t) => t.id === line.template_id)?.name ?? line.activity_type ?? 'Your shift';

  return (
    <div className={`mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${late ? 'border-danger/60 bg-danger/10' : 'border-primary/40 bg-primary/10'}`}>
      <p>
        <span className="font-semibold">{name} · {saTime(line.start_at)}–{saTime(line.end_at)}</span>
        <span className="ml-2 text-muted-foreground">
          {startsIn > 0 ? `starts in ${Math.ceil(startsIn / 60_000)} min` : stateWords(state, line.attendance)}
        </span>
      </p>
      <div className="flex items-center gap-2">
        <Link href="/roster/mine" className="text-xs font-semibold text-accent hover:underline">My schedule</Link>
        <StartShiftButton />
      </div>
    </div>
  );
}
