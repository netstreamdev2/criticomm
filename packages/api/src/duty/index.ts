import type { CriticomClient, Database, Silo } from '@criticom/db';

/**
 * Duty allocation.
 *
 * Built post-first: the establishment (`duty_posts`) says what a department is
 * supposed to man, and allocations fill those posts. That ordering is what
 * makes the board answer the handover question — "what is not covered" — which
 * a person-first list structurally cannot, because an unmanned post has no row
 * to show.
 *
 * The same data is also served per-person (`getPersonDay`, `getMyAllocations`)
 * so a member sees their own duty without reading the whole board.
 */

export type DutyPost = Database['public']['Tables']['duty_posts']['Row'];
export type Roster = Database['public']['Tables']['rosters']['Row'];
type ShiftAttendance = Database['public']['Tables']['shift_attendance']['Row'];

export type Allocation = Roster & {
  /** Set when the member is on approved leave for this date. */
  leaveConflict?: { absence: string; from: string; to: string } | null;
  /** Whether they have started (0072); only those who roster the department read it. */
  attendance?: ShiftAttendance | null;
};

/** A day's lines with their attendance, cancelled ones left out. */
const DAY_COLUMNS = '*, attendance:shift_attendance(*)';
function flatten(rows: unknown[]): Roster[] {
  return (rows as Array<Roster & { attendance?: ShiftAttendance | ShiftAttendance[] | null }>)
    .filter((r) => !r.cancelled_at)
    .map((r) => ({ ...r, attendance: Array.isArray(r.attendance) ? (r.attendance[0] ?? null) : (r.attendance ?? null) })) as Roster[];
}

export type PostCoverage = {
  post: DutyPost;
  allocations: Allocation[];
  assigned: number;
  required: number;
  /** unmanned → nobody · short → below min_staff · manned → at or above */
  state: 'unmanned' | 'short' | 'manned';
  /** True when any allocation on this post is still a draft. */
  hasDraft: boolean;
};

export type DutyBoard = {
  date: string;
  silo: Silo;
  posts: PostCoverage[];
  /** Allocations for the day that fill no standing post. */
  adHoc: Allocation[];
  summary: {
    postsTotal: number;
    postsUnmanned: number;
    postsShort: number;
    peopleAllocated: number;
    slotsRequired: number;
    slotsFilled: number;
    drafts: number;
    unacknowledged: number;
    conflicts: number;
  };
};

/* ── Leave conflicts ─────────────────────────────────────────────── */

type LeaveWindow = { user_id: string; absence: string; eff_from: string; eff_to: string };

/**
 * Approved leave overlapping a date, keyed by user.
 *
 * Allocating someone who is on leave is the single most common rostering
 * mistake and the most expensive — it looks covered right up until nobody
 * arrives. So the board surfaces it rather than silently allowing it.
 */
async function leaveOn(client: CriticomClient, silo: Silo, date: string) {
  const { data } = await client
    .from('leave_entries')
    .select('user_id, absence, eff_from, eff_to, status')
    .eq('silo', silo)
    .lte('eff_from', date)
    .gte('eff_to', date);

  const map = new Map<string, LeaveWindow>();
  for (const row of (data ?? []) as Array<LeaveWindow & { status: string }>) {
    // Pending leave is not yet a conflict; refused leave never was.
    if (!/apprv|approved/i.test(row.status ?? '')) continue;
    if (row.user_id) map.set(row.user_id, row);
  }
  return map;
}

function decorate(rows: Roster[], leave: Map<string, LeaveWindow>): Allocation[] {
  return rows.map((r) => {
    const l = r.user_id ? leave.get(r.user_id) : undefined;
    return {
      ...r,
      // Those who roster the department see the leave itself; everyone else
      // sees only that the person is off (0072 marks their shift 'Leave').
      leaveConflict: l
        ? { absence: l.absence, from: l.eff_from, to: l.eff_to }
        : r.status === 'Leave' ? { absence: 'leave', from: r.duty_date ?? '', to: r.duty_date ?? '' } : null,
    };
  });
}

/* ── The board ───────────────────────────────────────────────────── */

export async function getDutyBoard(
  client: CriticomClient,
  args: { silo: Silo; date: string; includeDrafts?: boolean },
): Promise<DutyBoard> {
  const [postsRes, rostersRes, leave] = await Promise.all([
    client
      .from('duty_posts')
      .select('*')
      .eq('silo', args.silo)
      .eq('active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    (() => {
      let q = client.from('rosters').select(DAY_COLUMNS).eq('silo', args.silo).eq('duty_date', args.date);
      // Members see only what has been issued; supervisors see drafts too.
      if (!args.includeDrafts) q = q.eq('published', true);
      return q.order('user_name', { ascending: true });
    })(),
    leaveOn(client, args.silo, args.date),
  ]);

  if (postsRes.error) throw new Error(postsRes.error.message);
  if (rostersRes.error) throw new Error(rostersRes.error.message);

  const posts = (postsRes.data ?? []) as DutyPost[];
  const allocations = decorate(flatten(rostersRes.data ?? []), leave);

  const byPost = new Map<string, Allocation[]>();
  const adHoc: Allocation[] = [];
  for (const a of allocations) {
    if (a.post_id) {
      const list = byPost.get(a.post_id) ?? [];
      list.push(a);
      byPost.set(a.post_id, list);
    } else {
      adHoc.push(a);
    }
  }

  const coverage: PostCoverage[] = posts.map((post) => {
    const list = byPost.get(post.id) ?? [];
    // Someone on leave is not cover, so they do not count towards the crew.
    const effective = list.filter((a) => !a.leaveConflict).length;
    const required = post.min_staff;
    return {
      post,
      allocations: list,
      assigned: list.length,
      required,
      state: effective === 0 ? 'unmanned' : effective < required ? 'short' : 'manned',
      hasDraft: list.some((a) => !a.published),
    };
  });

  return {
    date: args.date,
    silo: args.silo,
    posts: coverage,
    adHoc,
    summary: {
      postsTotal: coverage.length,
      postsUnmanned: coverage.filter((c) => c.state === 'unmanned').length,
      postsShort: coverage.filter((c) => c.state === 'short').length,
      peopleAllocated: new Set(allocations.map((a) => a.user_id)).size,
      slotsRequired: coverage.reduce((n, c) => n + c.required, 0),
      slotsFilled: coverage.reduce((n, c) => n + Math.min(c.assigned, c.required), 0),
      drafts: allocations.filter((a) => !a.published).length,
      unacknowledged: allocations.filter((a) => a.published && !a.acknowledged_at).length,
      conflicts: allocations.filter((a) => a.leaveConflict).length,
    },
  };
}

/* ── Person view ─────────────────────────────────────────────────── */

export type PersonRow = {
  userId: string;
  name: string;
  badge: string | null;
  rank: string | null;
  station: string | null;
  allocations: Allocation[];
  onLeave: { absence: string; from: string; to: string } | null;
};

/**
 * The same day from the members' side: everyone in the department, what they
 * are on, and who has nothing. Deliberately includes the unallocated — that
 * list is how a duty officer finds someone to plug a gap.
 */
export async function getPersonDay(
  client: CriticomClient,
  args: { silo: Silo; date: string; includeDrafts?: boolean },
): Promise<PersonRow[]> {
  const [profilesRes, rostersRes, leave] = await Promise.all([
    client
      .from('profiles')
      .select('id, full_name, badge_number, rank, station, status')
      .eq('silo', args.silo)
      .order('full_name', { ascending: true }),
    (() => {
      let q = client.from('rosters').select(DAY_COLUMNS).eq('silo', args.silo).eq('duty_date', args.date);
      if (!args.includeDrafts) q = q.eq('published', true);
      return q;
    })(),
    leaveOn(client, args.silo, args.date),
  ]);

  if (profilesRes.error) throw new Error(profilesRes.error.message);
  const allocations = decorate(flatten(rostersRes.data ?? []), leave);

  const byUser = new Map<string, Allocation[]>();
  for (const a of allocations) {
    if (!a.user_id) continue;
    const list = byUser.get(a.user_id) ?? [];
    list.push(a);
    byUser.set(a.user_id, list);
  }

  type P = { id: string; full_name: string; badge_number: string | null; rank: string | null; station: string | null; status: string | null };
  return ((profilesRes.data ?? []) as P[])
    .filter((p) => !p.status || /active/i.test(p.status))
    .map((p) => {
      const l = leave.get(p.id);
      return {
        userId: p.id,
        name: p.full_name,
        badge: p.badge_number,
        rank: p.rank,
        station: p.station,
        allocations: byUser.get(p.id) ?? [],
        onLeave: l ? { absence: l.absence, from: l.eff_from, to: l.eff_to } : null,
      };
    });
}

/** A member's own upcoming duties. */
export async function getMyAllocations(
  client: CriticomClient,
  args: { userId: string; fromDate: string; days?: number },
) {
  const to = new Date(`${args.fromDate}T00:00:00Z`);
  to.setUTCDate(to.getUTCDate() + (args.days ?? 14));
  const { data, error } = await client
    .from('rosters')
    .select('*, duty_posts(name, station, sector, vehicle, call_sign)')
    .eq('user_id', args.userId)
    .eq('published', true)
    .is('cancelled_at', null)
    .neq('status', 'Leave')
    .gte('duty_date', args.fromDate)
    .lte('duty_date', to.toISOString().slice(0, 10))
    .order('duty_date', { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/* ── Mutations ───────────────────────────────────────────────────── */

/**
 * Put someone on a post for a day (assign_post). Their shift that day carries
 * the post; with no shift that day, one is added from the shift type given.
 * Leave, court, another shift and a vehicle already out are refused.
 */
export async function assignToPost(
  client: CriticomClient,
  input: { postId: string; date: string; userId: string; templateId?: string | null },
) {
  const { data, error } = await client.rpc('assign_post', {
    p_post: input.postId, p_day: input.date, p_user: input.userId, p_template: input.templateId ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/** Take someone off a post; a shift from the roster stays (clear_post). */
export async function unassign(client: CriticomClient, rosterId: string) {
  const { error } = await client.rpc('clear_post', { p_roster: rosterId });
  if (error) throw new Error(error.message);
}

/** Issue every draft for a day — the moment the board becomes real to staff. */
export async function publishDay(
  client: CriticomClient,
  args: { silo: Silo; date: string },
): Promise<number> {
  const { data, error } = await client.rpc('publish_roster', { p_silo: args.silo, p_from: args.date, p_to: args.date });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

/** A member confirming they have seen their duty. */
export async function acknowledgeAllocation(client: CriticomClient, rosterId: string) {
  const { error } = await client
    .from('rosters')
    .update({ acknowledged_at: new Date().toISOString() })
    .eq('id', rosterId);
  if (error) throw new Error(error.message);
}

/**
 * Copy a day's shifts and posts onto another day, as drafts (copy_roster_day).
 *
 * Rostering is overwhelmingly repetitive — the same crews on the same posts —
 * so building each day from scratch is where mistakes come from. Anyone who
 * cannot work the new day (leave, court, another shift) is left out with the
 * reason, and anyone already on that day is not copied twice.
 */
export async function copyDayForward(
  client: CriticomClient,
  args: { silo: Silo; from: string; to: string },
): Promise<{ copied: number; skipped: number; reasons: Array<{ name: string; reason: string }> }> {
  const { data, error } = await client.rpc('copy_roster_day', { p_silo: args.silo, p_from: args.from, p_to: args.to });
  if (error) throw new Error(error.message);
  return data as { copied: number; skipped: number; reasons: Array<{ name: string; reason: string }> };
}

/* ── Establishment (posts) ───────────────────────────────────────── */

export async function listDutyPosts(client: CriticomClient, silo: Silo, includeInactive = false) {
  let q = client.from('duty_posts').select('*').eq('silo', silo);
  if (!includeInactive) q = q.eq('active', true);
  const { data, error } = await q
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as DutyPost[];
}

export async function upsertDutyPost(
  client: CriticomClient,
  input: Partial<DutyPost> & { silo: Silo; name: string },
) {
  const { data, error } = await client
    .from('duty_posts')
    .upsert({ ...input }, { onConflict: 'id' })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as DutyPost;
}

export async function setDutyPostActive(client: CriticomClient, id: string, active: boolean) {
  const { error } = await client.from('duty_posts').update({ active }).eq('id', id);
  if (error) throw new Error(error.message);
}
