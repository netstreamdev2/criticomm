import type { CriticomClient, Database, Silo } from '@criticom/db';

/**
 * Hard hats and radios (0101): numbered items, booked for the shift and
 * handed back. A radio or smart hard hat running the app books itself to
 * whoever starts the shift on it; a plain hard hat is taken by its number.
 * Every write goes through the database functions.
 */

export type KitKind = 'hard_hat' | 'radio';
export type KitItem = Database['public']['Tables']['field_kit']['Row'];
export type KitBookingRow = Database['public']['Tables']['field_kit_bookings']['Row'];
export type KitCondition = 'fine' | 'damaged' | 'lost';

/** One item with who has it now. */
export type KitEntry = KitItem & { holder: { bookingId: string; name: string | null; userId: string; since: string; how: 'device' | 'number' } | null };

/** What the officer holds now. */
export type MyKit = { bookingId: string; kitId: string; kind: KitKind; assetNo: string; since: string; how: 'device' | 'number' };

export const KIT_WORD: Record<KitKind, string> = { hard_hat: 'Hard hat', radio: 'Radio' };

export const KIT_STATUS_WORD: Record<KitItem['status'], string> = {
  available: 'Available', in_use: 'Booked out', repair: 'In repair', lost: 'Lost', retired: 'Out of service',
};

/** "hh 14" → "HH-14", as the database stores numbers. */
export function kitNumber(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '-').replace(/[^A-Z0-9-]/g, '');
}

/** The register as this person may read it, with who has each item now. */
export async function listKit(client: CriticomClient, opts: { includeRetired?: boolean } = {}): Promise<KitEntry[]> {
  let q = client.from('field_kit').select('*');
  if (!opts.includeRetired) q = q.neq('status', 'retired');
  const [items, open] = await Promise.all([
    q.order('kind').order('asset_no').limit(5000),
    client.from('field_kit_bookings').select('id, kit_id, user_id, name, booked_at, booked_how').is('returned_at', null).limit(5000),
  ]);
  if (items.error) throw items.error;
  const holders = new Map(((open.data ?? []) as Array<Pick<KitBookingRow, 'id' | 'kit_id' | 'user_id' | 'name' | 'booked_at' | 'booked_how'>>)
    .map((b) => [b.kit_id, { bookingId: b.id, name: b.name, userId: b.user_id, since: b.booked_at, how: b.booked_how }]));
  return ((items.data ?? []) as KitItem[]).map((k) => ({ ...k, holder: holders.get(k.id) ?? null }));
}

/** An item's last bookings, newest first. */
export async function listKitHistory(client: CriticomClient, kitId: string, limit = 20): Promise<KitBookingRow[]> {
  const { data, error } = await client.from('field_kit_bookings').select('*').eq('kit_id', kitId)
    .order('booked_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []) as KitBookingRow[];
}

/** What this officer holds now. */
export async function listMyKit(client: CriticomClient, userId: string): Promise<MyKit[]> {
  const { data, error } = await client.from('field_kit_bookings')
    .select('id, kit_id, booked_at, booked_how, kit:field_kit!inner(kind, asset_no)')
    .eq('user_id', userId).is('returned_at', null).order('booked_at');
  if (error) throw error;
  return ((data ?? []) as unknown as Array<{ id: string; kit_id: string; booked_at: string; booked_how: 'device' | 'number'; kit: { kind: KitKind; asset_no: string } }>)
    .map((b) => ({ bookingId: b.id, kitId: b.kit_id, kind: b.kit.kind, assetNo: b.kit.asset_no, since: b.booked_at, how: b.booked_how }));
}

/** The hard hats free to take in this person's department, by number. */
export async function listFreeHardHats(client: CriticomClient): Promise<Array<Pick<KitItem, 'id' | 'asset_no'>>> {
  const { data, error } = await client.from('field_kit').select('id, asset_no')
    .eq('kind', 'hard_hat').eq('status', 'available').order('asset_no').limit(2000);
  if (error) throw error;
  return (data ?? []) as Array<Pick<KitItem, 'id' | 'asset_no'>>;
}

export type BookedKit = { booked: boolean; booking_id?: string; kit_id?: string; kind?: KitKind; asset_no?: string; already?: boolean; taken_from?: string | null };

/** Take one: by this device's Radio ID, by the item, or by the number on it. */
export async function bookKit(client: CriticomClient, args: { deviceId?: string; kitId?: string; kind?: KitKind; assetNo?: string }): Promise<BookedKit> {
  const { data, error } = await client.rpc('book_field_kit', {
    p_kind: args.kind ?? null,
    p_asset_no: args.assetNo ?? null,
    p_kit_id: args.kitId ?? null,
    p_device_id: args.deviceId ?? null,
  });
  if (error) throw error;
  return (data ?? { booked: false }) as BookedKit;
}

/** Hand one back: the officer, or command receiving it. Damaged or lost needs a note. */
export async function returnKit(client: CriticomClient, bookingId: string, condition: KitCondition = 'fine', note?: string | null) {
  const { error } = await client.rpc('return_field_kit', { p_booking_id: bookingId, p_condition: condition, p_note: note ?? null });
  if (error) throw error;
}

/** End of shift: everything the officer holds goes back. Returns how many. */
export async function returnMyKit(client: CriticomClient): Promise<number> {
  const { data, error } = await client.rpc('return_my_field_kit', {});
  if (error) throw error;
  return Number(data ?? 0);
}

export type SaveKitInput = {
  id?: string | null;
  kind: KitKind;
  assetNo: string;
  serial?: string | null;
  deviceId?: string | null;
  model?: string | null;
  silo: Silo;
  status?: 'available' | 'repair' | 'lost';
  statusNote?: string | null;
  notes?: string | null;
};

/** Add or change one item (command and admin). */
export async function saveKit(client: CriticomClient, input: SaveKitInput) {
  const { data, error } = await client.rpc('save_field_kit', {
    p: {
      id: input.id ?? null, kind: input.kind, asset_no: input.assetNo, serial: input.serial ?? null,
      device_id: input.deviceId ?? null, model: input.model ?? null, silo: input.silo,
      status: input.status ?? 'available', status_note: input.statusNote ?? null, notes: input.notes ?? null,
    },
  });
  if (error) throw error;
  return data as KitItem;
}

/** Add HH-0001 … HH-0300 in one go; numbers already there are skipped. Returns how many were new. */
export async function addKitRange(client: CriticomClient, args: { kind: KitKind; prefix: string; from: number; to: number; digits: number; silo: Silo; model?: string | null }) {
  const { data, error } = await client.rpc('add_field_kit_range', {
    p_kind: args.kind, p_prefix: args.prefix, p_from: args.from, p_to: args.to, p_digits: args.digits, p_silo: args.silo, p_model: args.model ?? null,
  });
  if (error) throw error;
  return Number(data ?? 0);
}

/** Out of service for good; kept with its history. */
export async function retireKit(client: CriticomClient, id: string, reason: string) {
  const { error } = await client.rpc('retire_field_kit', { p_id: id, p_reason: reason });
  if (error) throw error;
}

/** Before 0101 is run: the tables are not there. */
export function noKitRegister(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  return Boolean(e && (e.code === '42P01' || e.code === 'PGRST205' || e.code === 'PGRST202' || /field_kit/.test(e.message ?? '')));
}
