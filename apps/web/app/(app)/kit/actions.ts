'use server';

import { revalidatePath } from 'next/cache';
import { addKitRange, retireKit, returnKit, saveKit, type KitCondition, type KitKind } from '@criticom/api';
import type { Silo } from '@criticom/db';
import { getSession } from '@/lib/session';

export type KitFormState = { error?: string; done?: string } | null;

const text = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? '').trim();
  return v || null;
};
const plain = (e: unknown, fallback: string) => {
  const message = (e as { message?: string }).message ?? fallback;
  return message.includes('row-level security') || message.includes('permission denied') ? 'You may not change the register.' : message;
};
const refresh = () => {
  revalidatePath('/kit');
  revalidatePath('/dispatch/ptt');
};

/** Add or change one item: save_field_kit() checks who may, and audits it (0101). */
export async function saveKitAction(_prev: KitFormState, formData: FormData): Promise<KitFormState> {
  const { supabase } = await getSession();
  const id = text(formData, 'id');
  try {
    const row = await saveKit(supabase, {
      id,
      kind: (text(formData, 'kind') ?? '') as KitKind,
      assetNo: text(formData, 'asset_no') ?? '',
      serial: text(formData, 'serial'),
      deviceId: text(formData, 'device_id'),
      model: text(formData, 'model'),
      silo: (text(formData, 'silo') ?? '') as Silo,
      status: (text(formData, 'status') ?? 'available') as 'available' | 'repair' | 'lost',
      statusNote: text(formData, 'status_note'),
      notes: text(formData, 'notes'),
    });
    refresh();
    return { done: `${row.asset_no} is ${id ? 'saved' : 'in the register'}.` };
  } catch (e) {
    return { error: plain(e, 'It could not be saved.') };
  }
}

/** HH-0001 … HH-0300 in one go (0101). */
export async function addRangeAction(_prev: KitFormState, formData: FormData): Promise<KitFormState> {
  const { supabase } = await getSession();
  const from = Number(text(formData, 'from'));
  const to = Number(text(formData, 'to'));
  if (!Number.isInteger(from) || !Number.isInteger(to)) return { error: 'Enter the first and last number.' };
  try {
    const added = await addKitRange(supabase, {
      kind: (text(formData, 'kind') ?? '') as KitKind,
      prefix: text(formData, 'prefix') ?? '',
      from,
      to,
      digits: Number(text(formData, 'digits') ?? 4) || 4,
      silo: (text(formData, 'silo') ?? '') as Silo,
      model: text(formData, 'model'),
    });
    refresh();
    const asked = to - from + 1;
    return { done: added === asked ? `${added} added.` : `${added} added; ${asked - added} were already in the register.` };
  } catch (e) {
    return { error: plain(e, 'They could not be added.') };
  }
}

/** Received back at the desk or the store: fine, damaged (repair) or lost. */
export async function receiveKitAction(_prev: KitFormState, formData: FormData): Promise<KitFormState> {
  const { supabase } = await getSession();
  try {
    await returnKit(supabase, text(formData, 'booking_id') ?? '', (text(formData, 'condition') ?? 'fine') as KitCondition, text(formData, 'note'));
    refresh();
    return { done: 'Received back.' };
  } catch (e) {
    return { error: plain(e, 'It could not be received back.') };
  }
}

/** Out of service for good; kept on record. */
export async function retireKitAction(_prev: KitFormState, formData: FormData): Promise<KitFormState> {
  const { supabase } = await getSession();
  try {
    await retireKit(supabase, text(formData, 'id') ?? '', text(formData, 'reason') ?? '');
    refresh();
    return { done: 'Taken out of service. It stays on record.' };
  } catch (e) {
    return { error: plain(e, 'It could not be taken out of service.') };
  }
}
