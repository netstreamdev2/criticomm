import type { CriticomClient, Silo } from '@criticom/db';
import type { RadioKind, RadioProvider, RegisterEntry } from './live.ts';

export * from './live.ts';
export * from './talk.ts';

/** The radio register (0082), as this person may read it, with whose each radio is. */
export async function listRadioRegister(client: CriticomClient, opts: { includeRetired?: boolean } = {}): Promise<RegisterEntry[]> {
  let q = client.from('radio_devices')
    .select('id, provider, kind, account, label, silo, personnel_id, apparatus_id, active, imei, notes, provider_user_id, updated_at');
  if (!opts.includeRetired) q = q.eq('active', true);
  const { data, error } = await q.order('account');
  if (error) throw error;
  const rows = (data ?? []) as Array<RegisterEntry & { imei: string | null; notes: string | null; provider_user_id: string | null; updated_at: string }>;

  const people = [...new Set(rows.map((r) => r.personnel_id).filter(Boolean))] as string[];
  const units = [...new Set(rows.map((r) => r.apparatus_id).filter(Boolean))] as string[];
  const [p, a] = await Promise.all([
    people.length
      ? client.from('personnel').select('id, first_name, last_name, rank').in('id', people)
      : Promise.resolve({ data: [] as Array<{ id: string; first_name: string; last_name: string; rank: string }> }),
    units.length
      ? client.from('apparatus').select('id, unit_number').in('id', units)
      : Promise.resolve({ data: [] as Array<{ id: string; unit_number: string }> }),
  ]);
  const personName = new Map((p.data ?? []).map((x) => [x.id, [x.rank, x.first_name, x.last_name].filter(Boolean).join(' ')]));
  const unitNumber = new Map((a.data ?? []).map((x) => [x.id, x.unit_number]));
  return rows.map((r) => ({
    ...r,
    personName: r.personnel_id ? personName.get(r.personnel_id) ?? null : null,
    unitNumber: r.apparatus_id ? unitNumber.get(r.apparatus_id) ?? null : null,
  }));
}

export type SaveRadioInput = {
  id?: string | null;
  provider: RadioProvider;
  kind: RadioKind;
  account: string;
  label?: string | null;
  providerUserId?: string | null;
  imei?: string | null;
  silo: Silo;
  personnelId?: string | null;
  apparatusId?: string | null;
  notes?: string | null;
  active?: boolean;
};

/** Add or change a radio in the register: through save_radio_device() only (0082). */
export async function saveRadioDevice(client: CriticomClient, input: SaveRadioInput) {
  const { data, error } = await client.rpc('save_radio_device', {
    p_id: input.id ?? null,
    p_provider: input.provider,
    p_kind: input.kind,
    p_account: input.account,
    p_label: input.label ?? null,
    p_provider_user_id: input.providerUserId ?? null,
    p_imei: input.imei ?? null,
    p_silo: input.silo,
    p_personnel_id: input.personnelId ?? null,
    p_apparatus_id: input.apparatusId ?? null,
    p_notes: input.notes ?? null,
    p_active: input.active ?? true,
  });
  if (error) throw error;
  return data;
}

export type TalkChannel = { channel: string; name: string; speak: boolean; priority: boolean };

/** Of the talk groups asked about, the ones this person may join, with whether they may speak (talk_access, 0083). */
export async function listTalkChannels(client: CriticomClient, channels: readonly string[]): Promise<TalkChannel[]> {
  const answers = await Promise.all(channels.map(async (channel) => {
    const { data, error } = await client.rpc('talk_access', { p_channel: channel });
    if (error || !data?.listen) return null;
    return { channel, name: data.name ?? channel, speak: Boolean(data.speak), priority: Boolean(data.priority) };
  }));
  return answers.filter((a): a is TalkChannel => a !== null);
}

/** Is a voice server set up (no secret). Null when Talk is not installed (0083 not run). */
export async function getTalkServerStatus(client: CriticomClient) {
  const { data, error } = await client.rpc('talk_server_status');
  if (error) return null;
  return data;
}
