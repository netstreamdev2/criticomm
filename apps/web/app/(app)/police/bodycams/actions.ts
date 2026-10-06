'use server';

import { revalidatePath } from 'next/cache';
import {
  bodycamSnapshot, importBodycams, logAudit, receiveBodycam, setBodycamStatus, type BodycamCondition,
} from '@criticom/api';
import { hikCameraCodeFrom, type BodycamEntry, type BodycamItem } from '@criticom/db/assets';
import type { BodycamStatus, Silo } from '@criticom/db';
import { invitationErrorMessage } from '@/lib/onboarding/errors';
import { getSession } from '@/lib/session';

/**
 * The bodycam register (migration 0054). Adding or correcting a bodycam's
 * details goes straight to the table, which only its keepers may write;
 * status, receiving one back and imports go through database functions that
 * keep the record.
 */

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const failed = (e: unknown, fallback = 'That did not work. Try again.') => {
  const err = e as { code?: string; message?: string };
  if (err?.code === '23505') {
    return {
      ok: false as const,
      error: /hik_code/i.test(err.message ?? '')
        ? 'That Hikvision camera code is already on another bodycam.'
        : 'That serial number is already on the register.',
    };
  }
  if (err?.code === '42501' && /row-level security/i.test(err.message ?? '')) {
    return { ok: false as const, error: 'Your role cannot change these bodycams.' };
  }
  return { ok: false as const, error: invitationErrorMessage(e, fallback) };
};

function refresh() {
  revalidatePath('/police/bodycams');
  revalidatePath('/shift/today');
  revalidatePath('/cameras');
}

export type BodycamDetails = {
  serial_number: string; model: string; sim_number: string; hik_camera_code: string; silo: Silo; station: string; notes: string;
};

function clean(d: BodycamDetails) {
  if (!d.serial_number.trim()) return { error: 'The serial number is needed.' } as const;
  const code = hikCameraCodeFrom(d.hik_camera_code);
  if (!code.ok) return { error: 'The Hikvision camera code may only hold letters, digits, - and _.' } as const;
  return {
    row: {
      serial_number: d.serial_number.trim(), model: d.model.trim().toUpperCase() || null, sim_number: d.sim_number.trim() || null,
      hik_camera_code: code.code, silo: d.silo, station: d.station.trim() || null, notes: d.notes.trim() || null,
    },
  } as const;
}

export async function addBodycamAction(d: BodycamDetails): Promise<Result<{ id: string }>> {
  const { supabase, fullName } = await getSession();
  const c = clean(d);
  if (c.error !== undefined) return { ok: false, error: c.error };
  try {
    const { data, error } = await supabase.from('bodycams').insert(c.row).select('id, serial_number, silo').single();
    if (error) throw error;
    await logAudit(supabase, {
      silo: data.silo, action_type: 'BodycamAdded', entity_type: 'bodycam', entity_id: data.id,
      user_name: fullName, details: data.serial_number,
    }).catch(() => {});
    refresh();
    return { ok: true, id: data.id };
  } catch (e) {
    return failed(e, 'The bodycam could not be added.');
  }
}

export async function updateBodycamAction(id: string, d: BodycamDetails): Promise<Result> {
  const { supabase, fullName } = await getSession();
  const c = clean(d);
  if (c.error !== undefined) return { ok: false, error: c.error };
  try {
    const { data, error } = await supabase.from('bodycams').update(c.row).eq('id', String(id)).select('id, silo, serial_number').single();
    if (error) throw error;
    await logAudit(supabase, {
      silo: data.silo, action_type: 'BodycamEdited', entity_type: 'bodycam', entity_id: data.id,
      user_name: fullName, details: `${data.serial_number}: details updated`,
    }).catch(() => {});
    refresh();
    return { ok: true };
  } catch (e) {
    return failed(e, 'The bodycam could not be updated.');
  }
}

export async function setBodycamStatusAction(id: string, status: Exclude<BodycamStatus, 'Booked out'>, reason: string): Promise<Result> {
  const { supabase } = await getSession();
  try {
    await setBodycamStatus(supabase, String(id), status, String(reason));
    refresh();
    return { ok: true };
  } catch (e) {
    return failed(e);
  }
}

export async function receiveBodycamAction(input: {
  bodycamId: string; condition: BodycamCondition; notes: string;
}): Promise<Result<{ status: string }>> {
  const { supabase } = await getSession();
  try {
    const res = await receiveBodycam(supabase, input);
    refresh();
    return { ok: true, ...res };
  } catch (e) {
    return failed(e);
  }
}

export async function bodycamSnapshotAction(): Promise<Result<{ register: BodycamEntry[] }>> {
  const { supabase } = await getSession();
  try {
    return { ok: true, register: await bodycamSnapshot(supabase) };
  } catch (e) {
    return failed(e, 'The bodycam register could not be loaded.');
  }
}

export async function importBodycamsAction(
  rows: Array<BodycamItem & { line: number }>, meta: { fileName: string; fileSha256: string; reason: string },
): Promise<Result<{ added: number; updated: number; unchanged: number }>> {
  const { supabase } = await getSession();
  try {
    const res = await importBodycams(supabase, rows, meta);
    refresh();
    return { ok: true, ...res };
  } catch (e) {
    return failed(e);
  }
}
