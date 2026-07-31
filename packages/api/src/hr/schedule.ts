import type { CriticomClient, Database, Silo } from '@criticom/db';
import { getLeaveBalances, inclusiveDays, type LeaveBalance } from './analytics';

type Shift = Database['public']['Tables']['shifts']['Row'];
type RosterEntry = Database['public']['Tables']['rosters']['Row'];
type LeaveEntry = Database['public']['Tables']['leave_entries']['Row'];
type Endorsement = Database['public']['Tables']['endorsements']['Row'];

/**
 * "What am I working, and when?" — the one question every member of the
 * service asks, answered in a single call for both web and mobile.
 *
 * Everything is scoped to the signed-in user by RLS and by explicit filters,
 * and each section fails independently: a missing endorsements table must not
 * blank out someone's shifts.
 */

export type ScheduledDuty = {
  rosterId: string;
  shiftId: string | null;
  shiftName: string;
  activityType: string;
  station: string;
  /** ISO datetimes from the parent shift; null for unscheduled roster rows. */
  startTime: string | null;
  endTime: string | null;
  callSign: string | null;
  vehicle: string | null;
  sector: string | null;
  specialInstructions: string | null;
  status: string;
};

export type MySchedule = {
  duties: ScheduledDuty[];
  /** Approved or pending leave that has not finished yet. */
  leave: LeaveEntry[];
  balances: LeaveBalance[];
  endorsements: Endorsement[];
  /** The duty happening right now, if any. */
  onDutyNow: ScheduledDuty | null;
  nextDuty: ScheduledDuty | null;
};

export async function getMySchedule(
  client: CriticomClient,
  args: { userId: string; silo: Silo; daysAhead?: number },
): Promise<MySchedule> {
  const days = args.daysAhead ?? 30;
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const horizonIso = new Date(now.getTime() + days * 86_400_000).toISOString();

  const [rosterRes, leaveRes, balances, endorsementsRes] = await Promise.all([
    client
      .from('rosters')
      .select('*, shifts:shift_id (id, shift_name, activity_type, start_time, end_time, description)')
      .eq('user_id', args.userId)
      .order('created_at', { ascending: false })
      .limit(60),
    client
      .from('leave_entries')
      .select('*')
      .eq('user_id', args.userId)
      .gte('eff_to', todayIso)
      .neq('status', 'Rejected')
      .order('eff_from'),
    getLeaveBalances(client, { userId: args.userId }).catch(() => [] as LeaveBalance[]),
    client
      .from('endorsements')
      .select('*')
      .eq('user_id', args.userId)
      .eq('is_active', true)
      .order('start_date', { ascending: false })
      .limit(20),
  ]);

  type RosterWithShift = RosterEntry & {
    shifts: Pick<Shift, 'id' | 'shift_name' | 'activity_type' | 'start_time' | 'end_time'> | null;
  };

  const duties: ScheduledDuty[] = ((rosterRes.data ?? []) as RosterWithShift[])
    .map((r) => ({
      rosterId: r.id,
      shiftId: r.shift_id,
      shiftName: r.shifts?.shift_name ?? 'Unscheduled duty',
      activityType: r.shifts?.activity_type ?? r.activity_type,
      station: r.station,
      startTime: r.shifts?.start_time ?? null,
      endTime: r.shifts?.end_time ?? null,
      callSign: r.call_sign,
      vehicle: r.vehicle,
      sector: r.sector,
      specialInstructions: r.special_instructions,
      status: r.status,
    }))
    // Keep anything still running or upcoming inside the horizon; rows with
    // no shift attached are kept so a member can see an open allocation.
    .filter((d) => !d.endTime || (d.endTime >= now.toISOString() && d.startTime! <= horizonIso))
    .sort((a, b) => (a.startTime ?? '9999').localeCompare(b.startTime ?? '9999'));

  const nowIso = now.toISOString();
  const onDutyNow = duties.find(
    (d) => d.startTime && d.endTime && d.startTime <= nowIso && d.endTime >= nowIso,
  ) ?? null;
  const nextDuty = duties.find((d) => d.startTime && d.startTime > nowIso) ?? null;

  return {
    duties,
    leave: leaveRes.data ?? [],
    balances,
    endorsements: endorsementsRes.data ?? [],
    onDutyNow,
    nextDuty,
  };
}

/** Days a leave entry covers — re-exported so UIs don't reach into analytics. */
export { inclusiveDays };
