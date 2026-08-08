import type { CriticomClient, Database, Silo } from '@criticom/db';

/**
 * Command-platform modules (migration 0033): sections, Duty Maintenance
 * tasks, the Time & Attendance register and internal mail.
 *
 * Authorization lives entirely in RLS — these functions shape queries and
 * validate input, and add no permission logic of their own. Document numbers
 * (DM-0001…) come from `next_doc_number`, the per-tenant counter, so two
 * tenants can each hold DM-0001 without ever colliding.
 */

export type Section = Database['public']['Tables']['sections']['Row'];
export type DutyTask = Database['public']['Tables']['duty_tasks']['Row'];
export type DutyTaskStatus = DutyTask['status'];
export type AttendanceEvent = Database['public']['Tables']['attendance_events']['Row'];
export type MailMessage = Database['public']['Tables']['mail_messages']['Row'];

/* ── Sections ─────────────────────────────────────────────────────────── */

export async function listSections(
  client: CriticomClient,
  args: { silo?: Silo; includeInactive?: boolean } = {},
): Promise<Section[]> {
  let q = client.from('sections').select('*').order('code');
  if (args.silo) q = q.eq('silo', args.silo);
  if (!args.includeInactive) q = q.eq('active', true);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function createSection(
  client: CriticomClient,
  args: { silo: Silo; code: string; name: string; region?: string },
): Promise<Section> {
  const code = args.code.trim().toUpperCase();
  if (!/^[A-Z0-9]{1,6}$/.test(code)) {
    throw new Error('Section code must be 1–6 letters or digits (e.g. NR, DR, B).');
  }
  const { data, error } = await client
    .from('sections')
    .insert({ silo: args.silo, code, name: args.name.trim(), region: args.region?.trim() || null })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function setSectionActive(
  client: CriticomClient,
  args: { id: string; active: boolean },
): Promise<void> {
  const { error } = await client.from('sections').update({ active: args.active }).eq('id', args.id);
  if (error) throw error;
}

/* ── Duty Maintenance ─────────────────────────────────────────────────── */

export async function listDutyTasks(
  client: CriticomClient,
  args: { silo?: Silo; status?: DutyTaskStatus; limit?: number } = {},
): Promise<DutyTask[]> {
  let q = client
    .from('duty_tasks')
    .select('*')
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(args.limit ?? 200);
  if (args.silo) q = q.eq('silo', args.silo);
  if (args.status) q = q.eq('status', args.status);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function createDutyTask(
  client: CriticomClient,
  args: {
    title: string;
    details?: string;
    silo?: Silo;
    assignedUserId?: string;
    assignedName?: string;
    unitRef?: string;
    sectionCode?: string;
    dueDate?: string;
    createdBy?: string;
    createdName?: string;
  },
): Promise<DutyTask> {
  if (!args.title.trim()) throw new Error('A task needs a title.');
  const { data: number, error: numErr } = await client.rpc('next_doc_number', { p_prefix: 'DM' });
  if (numErr) throw numErr;
  const { data, error } = await client
    .from('duty_tasks')
    .insert({
      task_number: number as string,
      title: args.title.trim(),
      details: args.details?.trim() || null,
      ...(args.silo ? { silo: args.silo } : {}),
      assigned_user_id: args.assignedUserId || null,
      assigned_name: args.assignedName || null,
      unit_ref: args.unitRef?.trim() || null,
      section_code: args.sectionCode?.trim() || null,
      due_date: args.dueDate || null,
      created_by: args.createdBy || null,
      created_name: args.createdName || null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Advance a task. Completing pins progress to 100 and stamps the moment. */
export async function updateDutyTask(
  client: CriticomClient,
  args: { id: string; status?: DutyTaskStatus; progress?: number },
): Promise<void> {
  const patch: Database['public']['Tables']['duty_tasks']['Update'] = {};
  if (args.status) {
    patch.status = args.status;
    if (args.status === 'Completed') {
      patch.progress = 100;
      patch.completed_at = new Date().toISOString();
    }
  }
  if (args.progress !== undefined && args.status !== 'Completed') {
    patch.progress = Math.max(0, Math.min(100, Math.round(args.progress)));
    if (patch.progress > 0 && !args.status) patch.status = 'In Progress';
  }
  const { error } = await client.from('duty_tasks').update(patch).eq('id', args.id);
  if (error) throw error;
}

/** Overdue / in-progress / pending / done, as the dashboard footer shows. */
export function dutyTaskCounts(tasks: DutyTask[], today = new Date()) {
  const iso = today.toISOString().slice(0, 10);
  const open = tasks.filter((t) => t.status === 'Pending' || t.status === 'In Progress');
  return {
    overdue: open.filter((t) => t.due_date && t.due_date < iso).length,
    inProgress: tasks.filter((t) => t.status === 'In Progress').length,
    pending: tasks.filter((t) => t.status === 'Pending').length,
    done: tasks.filter((t) => t.status === 'Completed').length,
  };
}

/* ── Time & Attendance ────────────────────────────────────────────────── */

export async function clockEvent(
  client: CriticomClient,
  args: { kind: 'clock_in' | 'clock_out'; userName?: string; source?: 'console' | 'mobile'; note?: string },
): Promise<void> {
  const { error } = await client.from('attendance_events').insert({
    kind: args.kind,
    user_name: args.userName || null,
    source: args.source ?? 'console',
    note: args.note?.trim() || null,
  });
  if (error) throw error;
}

export async function listAttendance(
  client: CriticomClient,
  args: { sinceIso: string; userId?: string; limit?: number },
): Promise<AttendanceEvent[]> {
  let q = client
    .from('attendance_events')
    .select('*')
    .gte('at', args.sinceIso)
    .order('at', { ascending: false })
    .limit(args.limit ?? 500);
  if (args.userId) q = q.eq('user_id', args.userId);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

/**
 * The caller's most recent event decides which button the page offers:
 * clocked in → offer out, and vice versa.
 */
export async function lastClockEvent(
  client: CriticomClient,
  userId: string,
): Promise<AttendanceEvent | null> {
  const { data, error } = await client
    .from('attendance_events')
    .select('*')
    .eq('user_id', userId)
    .order('at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Pair each person's ins and outs into worked spans and total them.
 * An unmatched in counts up to `now` — someone still on the clock.
 */
export function attendanceSummary(events: AttendanceEvent[], now = new Date()) {
  const byUser = new Map<string, { name: string; events: AttendanceEvent[] }>();
  for (const e of events) {
    const entry = byUser.get(e.user_id) ?? { name: e.user_name ?? 'Unknown', events: [] };
    entry.events.push(e);
    if (e.user_name) entry.name = e.user_name;
    byUser.set(e.user_id, entry);
  }
  return [...byUser.entries()].map(([userId, { name, events: evs }]) => {
    const asc = [...evs].sort((a, b) => a.at.localeCompare(b.at));
    let ms = 0;
    let openIn: string | null = null;
    for (const e of asc) {
      if (e.kind === 'clock_in') openIn = e.at;
      else if (openIn) {
        ms += new Date(e.at).getTime() - new Date(openIn).getTime();
        openIn = null;
      }
    }
    if (openIn) ms += now.getTime() - new Date(openIn).getTime();
    return {
      userId,
      name,
      hours: Math.round((ms / 3_600_000) * 10) / 10,
      onClock: openIn !== null,
      firstIn: asc.find((e) => e.kind === 'clock_in')?.at ?? null,
      lastOut: [...asc].reverse().find((e) => e.kind === 'clock_out')?.at ?? null,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/* ── Internal mail ────────────────────────────────────────────────────── */

export async function listInbox(client: CriticomClient, userId: string): Promise<MailMessage[]> {
  const { data, error } = await client
    .from('mail_messages')
    .select('*')
    .eq('to_user', userId)
    .order('sent_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return data ?? [];
}

export async function listSent(client: CriticomClient, userId: string): Promise<MailMessage[]> {
  const { data, error } = await client
    .from('mail_messages')
    .select('*')
    .eq('from_user', userId)
    .order('sent_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return data ?? [];
}

export async function sendMail(
  client: CriticomClient,
  args: { toUser: string; toName?: string; subject: string; body: string; fromName?: string },
): Promise<void> {
  if (!args.subject.trim()) throw new Error('A message needs a subject.');
  if (!args.body.trim()) throw new Error('A message needs a body.');
  const { error } = await client.from('mail_messages').insert({
    to_user: args.toUser,
    to_name: args.toName || null,
    subject: args.subject.trim(),
    body: args.body.trim(),
    from_name: args.fromName || null,
  });
  if (error) throw error;
}

export async function markMailRead(client: CriticomClient, id: string): Promise<void> {
  const { error } = await client
    .from('mail_messages')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}
