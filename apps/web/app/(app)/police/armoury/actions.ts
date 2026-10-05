'use server';

import { revalidatePath } from 'next/cache';
import { armourySnapshot, importFirearms, logAudit, receiveFirearm, setFirearmStatus } from '@criticom/api';
import { firearmTypeFrom, type FirearmEntry, type FirearmItem } from '@criticom/db/assets';
import type { Silo } from '@criticom/db';
import { invitationErrorMessage } from '@/lib/onboarding/errors';
import { getSession } from '@/lib/session';

/**
 * The armoury register (migration 0051). Adding or editing a firearm's
 * details goes straight to the table, which only command staff may write;
 * status, receiving one back and imports go through database functions that
 * keep the record.
 */

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const failed = (e: unknown, fallback = 'That did not work. Try again.') => {
  const err = e as { code?: string; message?: string };
  if (err?.code === '23505') return { ok: false as const, error: 'That serial number is already on the register.' };
  if (err?.code === '42501' && /row-level security/i.test(err.message ?? '')) {
    return { ok: false as const, error: 'Your role cannot change this armoury.' };
  }
  return { ok: false as const, error: invitationErrorMessage(e, fallback) };
};

function refresh() {
  revalidatePath('/police/armoury');
  revalidatePath('/shift/today');
}

export type FirearmDetails = {
  serial_number: string; make: string; model: string; calibre: string; firearm_type: string; silo: Silo; station: string; notes: string;
};

function clean(d: FirearmDetails) {
  const type = firearmTypeFrom(d.firearm_type);
  if (!d.serial_number.trim() || !d.make.trim() || !d.model.trim()) return { error: 'Serial number, make and model are all needed.' } as const;
  if (!type) return { error: 'Choose the type of firearm.' } as const;
  return {
    row: {
      serial_number: d.serial_number.trim(), make: d.make.trim(), model: d.model.trim(), calibre: d.calibre.trim() || null,
      firearm_type: type, silo: d.silo, station: d.station.trim() || null, notes: d.notes.trim() || null,
    },
  } as const;
}

export async function addFirearmAction(d: FirearmDetails): Promise<Result<{ id: string }>> {
  const { supabase, fullName } = await getSession();
  const c = clean(d);
  if (c.error !== undefined) return { ok: false, error: c.error };
  try {
    const { data, error } = await supabase.from('firearms').insert(c.row).select('id, serial_number, make, model, silo').single();
    if (error) throw error;
    await logAudit(supabase, {
      silo: data.silo, action_type: 'FirearmAdded', entity_type: 'firearm', entity_id: data.id,
      user_name: fullName, details: `${data.serial_number} ${data.make} ${data.model}`,
    }).catch(() => {});
    refresh();
    return { ok: true, id: data.id };
  } catch (e) {
    return failed(e, 'The firearm could not be added.');
  }
}

export async function updateFirearmAction(id: string, d: FirearmDetails): Promise<Result> {
  const { supabase, fullName } = await getSession();
  const c = clean(d);
  if (c.error !== undefined) return { ok: false, error: c.error };
  try {
    const { data, error } = await supabase.from('firearms').update(c.row).eq('id', String(id)).select('id, silo, serial_number').single();
    if (error) throw error;
    await logAudit(supabase, {
      silo: data.silo, action_type: 'FirearmEdited', entity_type: 'firearm', entity_id: data.id,
      user_name: fullName, details: `${data.serial_number}: details updated`,
    }).catch(() => {});
    refresh();
    return { ok: true };
  } catch (e) {
    return failed(e, 'The firearm could not be updated.');
  }
}

export async function setFirearmStatusAction(id: string, status: 'Available' | 'Maintenance' | 'Retired', reason: string): Promise<Result> {
  const { supabase } = await getSession();
  try {
    await setFirearmStatus(supabase, String(id), status, String(reason));
    refresh();
    return { ok: true };
  } catch (e) {
    return failed(e);
  }
}

export async function receiveFirearmAction(input: {
  firearmId: string; roundsReturned: number; magazines: number; checksOk: boolean;
  condition: 'clean' | 'requires_cleaning' | 'damaged'; notes: string;
}): Promise<Result<{ status: string; short: number }>> {
  const { supabase } = await getSession();
  try {
    const res = await receiveFirearm(supabase, input);
    refresh();
    return { ok: true, ...res };
  } catch (e) {
    return failed(e);
  }
}

export async function armourySnapshotAction(): Promise<Result<{ register: FirearmEntry[] }>> {
  const { supabase } = await getSession();
  try {
    return { ok: true, register: await armourySnapshot(supabase) };
  } catch (e) {
    return failed(e, 'The armoury register could not be loaded.');
  }
}

export async function importFirearmsAction(
  rows: Array<FirearmItem & { line: number }>, meta: { fileName: string; fileSha256: string; reason: string },
): Promise<Result<{ added: number; updated: number; unchanged: number }>> {
  const { supabase } = await getSession();
  try {
    const res = await importFirearms(supabase, rows, meta);
    refresh();
    return { ok: true, ...res };
  } catch (e) {
    return failed(e);
  }
}
