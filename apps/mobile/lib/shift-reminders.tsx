import { useEffect } from 'react';
import { tNow } from './translator';
import { AppState } from 'react-native';
import { addDays, getMyLines, listShiftTemplates, saDay, type ScheduleLine } from '@criticom/api';
import { useAuth } from '@/lib/auth';
import { useDuty } from '@/lib/duty';
import { getSupabase } from '@/lib/supabase';
import { cancelScheduled, scheduleAt, scheduledIds } from '@/lib/push';
import { PREFIX, reminderPlan, type ReminderLine } from './shift-reminders-policy.ts';

/**
 * Keeps the phone's own shift reminders in step with the issued roster
 * (shift-reminders-policy.ts says which). Reads the saved roster when there
 * is no signal, so reminders are rebuilt offline too. Draws nothing.
 */

const listeners = new Set<() => void>();
/** Ask for the reminders to be rebuilt now (after the schedule changes on screen). */
export function refreshShiftReminders() {
  for (const l of listeners) l();
}

/** Turn the roster into what the reminders need. */
export function reminderLines(
  lines: readonly ScheduleLine[],
  names: ReadonlyMap<string, string>,
  opts: { onDuty: boolean; now?: number },
): ReminderLine[] {
  const now = opts.now ?? Date.now();
  return lines
    .filter((l) => l.start_at && l.end_at)
    .map((l) => {
      const start = Date.parse(l.start_at!);
      // On duty during the shift's window counts as started, even before the
      // server has recorded it.
      const running = start - 3 * 3_600_000 <= now && Date.parse(l.end_at!) > now;
      return {
        id: l.id,
        start_at: l.start_at!,
        end_at: l.end_at!,
        name: (l.template_id && names.get(l.template_id)) || l.activity_type || tNow('Shift'),
        place: [l.post, l.station].filter(Boolean).join(' · ') || null,
        status: l.status,
        cancelled_at: l.cancelled_at,
        started: Boolean(l.attendance?.checked_in_at) || (opts.onDuty && running),
      };
    });
}

/** Schedule exactly the plan: what is no longer wanted is cancelled. */
export async function applyReminders(lines: ReminderLine[]) {
  const plan = reminderPlan(lines, Date.now(), tNow);
  // The time is in the identifier, so a shift moved to another time is a new reminder.
  const wanted = new Map(plan.map((r) => [`${r.id}:${r.at}`, r]));
  const existing = await scheduledIds(PREFIX);
  await cancelScheduled(existing.filter((id) => !wanted.has(id)));
  const have = new Set(existing);
  for (const [identifier, r] of wanted) {
    if (have.has(identifier)) continue;
    await scheduleAt({ identifier, at: r.at, title: r.title, body: r.body, data: { screen: 'schedule', rosterId: r.lineId } });
  }
}

export function ShiftReminders() {
  const { session, silo } = useAuth();
  const { onDuty } = useDuty();
  const userId = session?.user.id ?? null;

  useEffect(() => {
    if (!userId) {
      // Signed out: nobody else's shifts ring on this phone.
      void scheduledIds(PREFIX).then(cancelScheduled);
      return;
    }
    let busy = false;
    const sync = async () => {
      if (busy) return;
      busy = true;
      try {
        const sb = getSupabase();
        const today = saDay();
        const [lines, templates] = await Promise.all([
          getMyLines(sb, { userId, from: addDays(today, -1), to: addDays(today, 15) }),
          listShiftTemplates(sb, silo, { includeInactive: true }).catch(() => []),
        ]);
        const names = new Map(templates.map((t) => [t.id, t.name]));
        await applyReminders(reminderLines(lines, names, { onDuty: onDuty === true }));
      } catch {
        // No roster to read: what was scheduled stays as it was.
      } finally {
        busy = false;
      }
    };
    void sync();
    listeners.add(sync);
    const timer = setInterval(() => { void sync(); }, 30 * 60_000);
    const app = AppState.addEventListener('change', (s) => { if (s === 'active') void sync(); });
    return () => {
      listeners.delete(sync);
      clearInterval(timer);
      app.remove();
    };
  }, [userId, silo, onDuty]);

  return null;
}
