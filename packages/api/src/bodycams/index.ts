import type { BodycamStatus, BodycamViewReason, CriticomClient, Database, Silo } from '@criticom/db';
import type { BodycamEntry, BodycamItem } from '@criticom/db/assets';
import { selectAll } from '../admin/paging.ts';

/**
 * Bodycams (migration 0054): the register, booking one out and back each
 * shift, finding footage again, and opening a view. Status, custody and every
 * view go through database functions, which decide who may and keep the
 * record; these carry the request across.
 */

type Tables = Database['public']['Tables'];
export type BodycamRow = Tables['bodycams']['Row'];
export type BodycamBooking = Tables['bodycam_bookings']['Row'];
export type BodycamViewRow = Tables['bodycam_views']['Row'];
export type NoBodycamDeclaration = Tables['shift_no_bodycam_declarations']['Row'];

/** The person a bodycam is with, as the console shows them. */
export type BodycamHolder = {
  userId: string;
  name: string;
  badge: string | null;
  station: string | null;
  silo: Silo | null;
  onDuty: boolean;
};

async function holdersOf(client: CriticomClient, userIds: string[]): Promise<Map<string, BodycamHolder>> {
  const out = new Map<string, BodycamHolder>();
  for (let i = 0; i < userIds.length; i += 100) {
    const ids = userIds.slice(i, i + 100);
    const [people, profiles] = await Promise.all([
      client.from('personnel').select('user_id, rank, first_name, last_name, badge_number, station, silo, is_on_duty').in('user_id', ids),
      client.from('profiles').select('id, full_name').in('id', ids),
    ]);
    for (const p of profiles.data ?? []) {
      out.set(p.id, { userId: p.id, name: p.full_name ?? 'An officer', badge: null, station: null, silo: null, onDuty: false });
    }
    for (const p of people.data ?? []) {
      if (!p.user_id) continue;
      out.set(p.user_id, {
        userId: p.user_id,
        name: [p.rank, p.first_name, p.last_name].filter(Boolean).join(' '),
        badge: p.badge_number || null,
        station: p.station ?? null,
        silo: p.silo,
        onDuty: Boolean(p.is_on_duty),
      });
    }
  }
  return out;
}

// ── The register ────────────────────────────────────────────────────────

export type RegisterBodycam = BodycamRow & { holder: BodycamHolder | null };

export async function listBodycamRegister(client: CriticomClient, opts: { silo?: Silo } = {}): Promise<RegisterBodycam[]> {
  const cams = await selectAll<BodycamRow>((from, to) => {
    let q = client.from('bodycams').select('*');
    if (opts.silo) q = q.eq('silo', opts.silo);
    return q.order('id').range(from, to);
  });
  const holders = await holdersOf(client, [...new Set(cams.filter((c) => c.booked_to).map((c) => c.booked_to!))]);
  return cams
    .map((c) => ({ ...c, holder: c.booked_to ? holders.get(c.booked_to) ?? null : null }))
    .sort((a, b) => a.serial_number.localeCompare(b.serial_number, undefined, { numeric: true }));
}

/** The register as the import check needs it. */
export async function bodycamSnapshot(client: CriticomClient): Promise<BodycamEntry[]> {
  return selectAll<BodycamEntry>((from, to) =>
    client.from('bodycams').select('id, serial_number, model, sim_number, hik_camera_code, silo, station, notes, status')
      .order('id').range(from, to) as unknown as PromiseLike<{ data: BodycamEntry[] | null; error: unknown }>);
}

export async function importBodycams(
  client: CriticomClient, rows: Array<BodycamItem & { line: number }>, meta: { fileName: string; fileSha256: string; reason: string },
) {
  const { data, error } = await client.rpc('import_bodycams', {
    p_rows: rows as unknown as Array<Record<string, unknown>>, p_file_name: meta.fileName, p_file_sha256: meta.fileSha256, p_reason: meta.reason,
  });
  if (error) throw error;
  return data as { added: number; updated: number; unchanged: number };
}

export async function setBodycamStatus(
  client: CriticomClient, bodycamId: string, status: Exclude<BodycamStatus, 'Booked out'>, reason: string,
) {
  const { data, error } = await client.rpc('set_bodycam_status', { p_bodycam_id: bodycamId, p_status: status, p_reason: reason });
  if (error) throw error;
  return data;
}

export type BodycamCondition = 'ok' | 'damaged' | 'lost';

export async function receiveBodycam(client: CriticomClient, args: { bodycamId: string; condition: BodycamCondition; notes: string }) {
  const { data, error } = await client.rpc('receive_bodycam', {
    p_bodycam_id: args.bodycamId, p_condition: args.condition, p_notes: args.notes,
  });
  if (error) throw error;
  return data as { status: 'Available' | 'In repair' | 'Lost' };
}

// ── The officer's shift ─────────────────────────────────────────────────

/** Bodycams the officer may book out: Available, or already booked out to them. */
export async function listShiftBodycams(client: CriticomClient): Promise<BodycamRow[]> {
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error('You must be signed in to view the bodycams.');
  const { data, error } = await client
    .from('bodycams')
    .select('*')
    .or(`status.eq.Available,and(status.eq."Booked out",booked_to.eq.${user.id})`)
    .order('serial_number');
  if (error) throw error;
  return (data ?? []) as BodycamRow[];
}

export type BodycamBookOutInput = {
  bodycamId: string;
  batteryOk: boolean;
  recordingOk: boolean;
  mountedOk: boolean;
  notes: string | null;
};

/** Books it out, or — when a check fails — sends it for repair. */
export async function bookOutBodycam(client: CriticomClient, args: BodycamBookOutInput) {
  const { data, error } = await client.rpc('book_out_bodycam', {
    p_bodycam_id: args.bodycamId, p_battery_ok: args.batteryOk, p_recording_ok: args.recordingOk,
    p_mounted_ok: args.mountedOk, p_notes: args.notes,
  });
  if (error) throw error;
  return data as Database['public']['Functions']['book_out_bodycam']['Returns'];
}

/** Completes the bodycam step without one; the reason goes on the record for command. */
export async function declareShiftNoBodycam(client: CriticomClient, reason: string) {
  const { data, error } = await client.rpc('declare_shift_no_bodycam', { p_reason: reason });
  if (error) throw error;
  return data as NoBodycamDeclaration;
}

/** The bodycam booked out to the signed-in officer, if any. Null before 0054 is run. */
export async function getMyBodycam(client: CriticomClient): Promise<BodycamRow | null> {
  const { data: { user } } = await client.auth.getUser();
  if (!user) return null;
  const { data, error } = await client
    .from('bodycams').select('*').eq('status', 'Booked out').eq('booked_to', user.id).limit(1).maybeSingle();
  if (error) return null;
  return data as BodycamRow | null;
}

export async function returnBodycam(client: CriticomClient, args: { bodycamId: string; condition: BodycamCondition; notes?: string | null }) {
  const { data, error } = await client.rpc('return_bodycam', {
    p_bodycam_id: args.bodycamId, p_condition: args.condition, p_notes: args.notes ?? null,
  });
  if (error) throw error;
  return data as { status: 'Available' | 'In repair' | 'Lost' };
}

/** For the officer's phone: is the control room viewing my camera right now? */
export async function getBodycamWatchStatus(client: CriticomClient) {
  const { data, error } = await client.rpc('bodycam_watch_status');
  if (error) throw error;
  return data as { serial_number: string | null; watching: boolean; since: string | null };
}

// ── Watching ────────────────────────────────────────────────────────────

export type LiveBodycam = { bodycam: BodycamRow; holder: BodycamHolder | null };

/** Bodycams out with an officer right now: what can be watched. */
export async function listBookedOutBodycams(client: CriticomClient, opts: { silo?: Silo; userIds?: string[] } = {}): Promise<LiveBodycam[]> {
  let q = client.from('bodycams').select('*').eq('status', 'Booked out');
  if (opts.silo) q = q.eq('silo', opts.silo);
  if (opts.userIds) {
    if (!opts.userIds.length) return [];
    q = q.in('booked_to', opts.userIds);
  }
  const { data, error } = await q.order('booked_at', { ascending: false }).limit(500);
  if (error) throw error;
  const cams = (data ?? []) as BodycamRow[];
  const holders = await holdersOf(client, [...new Set(cams.map((c) => c.booked_to!).filter(Boolean))]);
  return cams
    .map((bodycam) => ({ bodycam, holder: bodycam.booked_to ? holders.get(bodycam.booked_to) ?? null : null }))
    .sort((a, b) => Number(b.holder?.onDuty ?? false) - Number(a.holder?.onDuty ?? false)
      || (a.holder?.name ?? '').localeCompare(b.holder?.name ?? ''));
}

/**
 * Bookings that cover any part of a window — how footage is found again:
 * which camera an officer had, and when. Bookings that failed their check at
 * book-out never went out, so they are left out.
 */
export async function searchBodycamBookings(
  client: CriticomClient,
  opts: { from: string; to: string; userIds?: string[]; limit?: number },
): Promise<BodycamBooking[]> {
  let q = client.from('bodycam_bookings').select('*')
    .lt('booked_at', opts.to)
    .or(`returned_at.is.null,returned_at.gt."${opts.from}"`)
    .eq('battery_ok', true).eq('recording_ok', true).eq('mounted_ok', true);
  if (opts.userIds) {
    if (!opts.userIds.length) return [];
    q = q.in('user_id', opts.userIds);
  }
  const { data, error } = await q.order('booked_at', { ascending: false }).limit(opts.limit ?? 200);
  if (error) throw error;
  return (data ?? []) as BodycamBooking[];
}

export type StartViewInput = {
  bodycamId: string;
  kind: 'live' | 'footage';
  incidentId?: string | null;
  reason?: BodycamViewReason | null;
  note?: string | null;
  from?: string | null;
  to?: string | null;
};

/** Asks the database for a view: it says yes or no and writes the record. */
export async function startBodycamView(client: CriticomClient, args: StartViewInput) {
  const { data, error } = await client.rpc('start_bodycam_view', {
    p_bodycam_id: args.bodycamId,
    p_kind: args.kind,
    p_incident_id: args.incidentId ?? null,
    p_reason_code: args.incidentId ? null : (args.reason ?? null),
    p_reason_note: args.note?.trim() || null,
    p_from: args.kind === 'footage' ? (args.from ?? null) : null,
    p_to: args.kind === 'footage' ? (args.to ?? null) : null,
  });
  if (error) throw error;
  return data as Database['public']['Functions']['start_bodycam_view']['Returns'];
}

export async function touchBodycamView(client: CriticomClient, viewId: string) {
  const { data, error } = await client.rpc('touch_bodycam_view', { p_view_id: viewId });
  if (error) throw error;
  return data as Database['public']['Functions']['touch_bodycam_view']['Returns'];
}

export async function endBodycamView(client: CriticomClient, viewId: string, reason: 'closed' | 'timeout' | 'failed' = 'closed') {
  const { data, error } = await client.rpc('end_bodycam_view', { p_view_id: viewId, p_reason: reason });
  if (error) throw error;
  return data as { ended: boolean };
}

/** The latest views of bodycams this person keeps or watched: who, when, why. */
export async function listRecentBodycamViews(client: CriticomClient, limit = 25): Promise<BodycamViewRow[]> {
  const { data, error } = await client.from('bodycam_views').select('*').order('started_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []) as BodycamViewRow[];
}

/** Who has a bodycam on right now, by officer: what the live map marks. */
export async function listBodycamHolders(client: CriticomClient) {
  const { data, error } = await client
    .from('bodycams').select('id, serial_number, silo, booked_to').eq('status', 'Booked out').limit(1000);
  if (error) throw error;
  return ((data ?? []) as Array<Pick<BodycamRow, 'id' | 'serial_number' | 'silo' | 'booked_to'>>)
    .filter((c) => c.booked_to)
    .map((c) => ({ bodycamId: c.id, serial: c.serial_number, silo: c.silo, userId: c.booked_to! }));
}
