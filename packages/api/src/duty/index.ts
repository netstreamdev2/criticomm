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

export type Allocation = Roster & {
  /** Set when the member is on approved leave for this date. */
  leaveConflict?: { absence: string; from: string; to: string } | null;
};

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
      leaveConflict: l ? { absence: l.absence, from: l.eff_from, to: l.eff_to } : null,
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
      let q = client.from('rosters').select('*').eq('silo', args.silo).eq('duty_date', args.date);
      // Members see only what has been issued; supervisors see drafts too.
      if (!args.includeDrafts) q = q.eq('published', true);
      return q.order('user_name', { ascending: true });
    })(),
    leaveOn(client, args.silo, args.date),
  ]);

  if (postsRes.error) throw new Error(postsRes.error.message);
  if (rostersRes.error) throw new Error(rostersRes.error.message);

  const posts = (postsRes.data ?? []) as DutyPost[];
  const allocations = decorate((rostersRes.data ?? []) as Roster[], leave);

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
      let q = client.from('rosters').select('*').eq('silo', args.silo).eq('duty_date', args.date);
      if (!args.includeDrafts) q = q.eq('published', true);
      return q;
    })(),
    leaveOn(client, args.silo, args.date),
  ]);

  if (profilesRes.error) throw new Error(profilesRes.error.message);
  const allocations = decorate((rostersRes.data ?? []) as Roster[], leave);

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
    .gte('duty_date', args.fromDate)
    .lte('duty_date', to.toISOString().slice(0, 10))
    .order('duty_date', { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/* ── Mutations ───────────────────────────────────────────────────── */

export async function assignToPost(
  client: CriticomClient,
  input: {
    silo: Silo;
    date: string;
    postId: string | null;
    userId: string;
    userName: string;
    badgeNumber?: string | null;
    station?: string | null;
    activityType?: string | null;
    vehicle?: string | null;
    sector?: string | null;
    callSign?: string | null;
    startAt?: string | null;
    endAt?: string | null;
    specialInstructions?: string | null;
    /** New allocations start as drafts so a half-built board is not issued. */
    published?: boolean;
    bySupervisorName?: string | null;
  },
) {
  const published = input.published ?? false;
  const { data, error } = await client
    .from('rosters')
    .insert({
      silo: input.silo,
      duty_date: input.date,
      post_id: input.postId,
      user_id: input.userId,
      user_name: input.userName,
      badge_number: input.badgeNumber ?? null,
      station: input.station ?? '',
      activity_type: input.activityType ?? '',
      vehicle: input.vehicle ?? null,
      sector: input.sector ?? null,
      call_sign: input.callSign ?? null,
      start_at: input.startAt ?? null,
      end_at: input.endAt ?? null,
      special_instructions: input.specialInstructions ?? null,
      published,
      published_at: published ? new Date().toISOString() : null,
      status: 'Allocated',
      created_by_supervisor_name: input.bySupervisorName ?? null,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as Roster;
}

export async function unassign(client: CriticomClient, rosterId: string) {
  const { error } = await client.from('rosters').delete().eq('id', rosterId);
  if (error) throw new Error(error.message);
}

/** Issue every draft for a day — the moment the board becomes real to staff. */
export async function publishDay(
  client: CriticomClient,
  args: { silo: Silo; date: string },
): Promise<number> {
  const { data, error } = await client
    .from('rosters')
    .update({ published: true, published_at: new Date().toISOString() })
    .eq('silo', args.silo)
    .eq('duty_date', args.date)
    .eq('published', false)
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length;
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
 * Copy a day's allocations forward as drafts.
 *
 * Rostering is overwhelmingly repetitive — the same crews on the same posts —
 * so building each day from scratch is where mistakes come from. Copies land
 * as drafts, and anyone who has since gone on leave is left out rather than
 * carried across into a gap nobody notices.
 */
export async function copyDayForward(
  client: CriticomClient,
  args: { silo: Silo; from: string; to: string; bySupervisorName?: string | null },
): Promise<{ copied: number; skippedOnLeave: number; skippedExisting: number }> {
  const [srcRes, existingRes, leave] = await Promise.all([
    client.from('rosters').select('*').eq('silo', args.silo).eq('duty_date', args.from),
    client.from('rosters').select('user_id, post_id').eq('silo', args.silo).eq('duty_date', args.to),
    leaveOn(client, args.silo, args.to),
  ]);
  if (srcRes.error) throw new Error(srcRes.error.message);

  const source = (srcRes.data ?? []) as Roster[];
  const taken = new Set(
    ((existingRes.data ?? []) as Array<{ user_id: string; post_id: string | null }>)
      .map((r) => `${r.user_id}:${r.post_id ?? ''}`),
  );

  let skippedOnLeave = 0;
  let skippedExisting = 0;
  const rows = [];
  for (const r of source) {
    if (r.user_id && leave.has(r.user_id)) { skippedOnLeave++; continue; }
    if (taken.has(`${r.user_id}:${r.post_id ?? ''}`)) { skippedExisting++; continue; }
    rows.push({
      silo: r.silo,
      duty_date: args.to,
      post_id: r.post_id,
      user_id: r.user_id,
      user_name: r.user_name,
      badge_number: r.badge_number,
      station: r.station,
      activity_type: r.activity_type,
      vehicle: r.vehicle,
      sector: r.sector,
      call_sign: r.call_sign,
      special_instructions: r.special_instructions,
      published: false,
      status: 'Allocated',
      created_by_supervisor_name: args.bySupervisorName ?? null,
    });
  }

  if (rows.length) {
    const { error } = await client.from('rosters').insert(rows);
    if (error) throw new Error(error.message);
  }
  return { copied: rows.length, skippedOnLeave, skippedExisting };
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
