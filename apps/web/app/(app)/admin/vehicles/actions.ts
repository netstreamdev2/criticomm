'use server';

import { revalidatePath } from 'next/cache';
import { createApparatus, fleetSnapshot, importVehicles, logAudit, setVehicleStatus, updateApparatus } from '@criticom/api';
import { normalisePlate, parseSheetDate, vehicleTypeFrom, type VehicleEntry, type VehicleItem } from '@criticom/db/assets';
import type { ApparatusStatus, Silo } from '@criticom/db';
import { invitationErrorMessage } from '@/lib/onboarding/errors';
import { getSession } from '@/lib/session';

/**
 * The fleet register (migration 0051). Adding or editing a vehicle's details
 * goes straight to the table under its row rules; status changes and imports
 * go through database functions that check who may and keep the record.
 */

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const failed = (e: unknown, fallback = 'That did not work. Try again.') => {
  const err = e as { code?: string; message?: string };
  if (err?.code === '23505') return { ok: false as const, error: 'That unit number is already used in that department.' };
  if (err?.code === '42501' && /row-level security/i.test(err.message ?? '')) {
    return { ok: false as const, error: 'Your role cannot change this fleet.' };
  }
  return { ok: false as const, error: invitationErrorMessage(e, fallback) };
};

function refresh() {
  revalidatePath('/admin/vehicles');
  revalidatePath('/shift/today');
}

export type VehicleDetails = {
  unit_number: string; name: string; type: string; silo: Silo; make: string; model: string; year: string;
  license_plate: string; vin: string; station_number: string; fuel_type: string; disc_expiry: string;
};

function clean(d: VehicleDetails) {
  const unit = d.unit_number.trim();
  const type = vehicleTypeFrom(d.type);
  if (!unit || !type) return { error: 'Unit number and type are both needed.' } as const;
  const year = d.year.trim() ? Number(d.year) : null;
  if (year !== null && !(Number.isInteger(year) && year >= 1950 && year <= new Date().getFullYear() + 1)) {
    return { error: `${d.year} is not a vehicle year.` } as const;
  }
  const disc = d.disc_expiry.trim() ? parseSheetDate(d.disc_expiry) : null;
  if (d.disc_expiry.trim() && !disc) return { error: 'The licence disc date is not a date.' } as const;
  return {
    row: {
      unit_number: unit, name: d.name.trim() || `${type} ${unit}`, type, silo: d.silo, make: d.make.trim() || null,
      model: d.model.trim() || null, year, license_plate: normalisePlate(d.license_plate), vin: d.vin.trim().toUpperCase() || null,
      station_number: d.station_number.trim() || null, fuel_type: d.fuel_type.trim() || null, disc_expiry: disc,
    },
  } as const;
}

export async function addVehicleAction(d: VehicleDetails): Promise<Result<{ id: string }>> {
  const { supabase, fullName } = await getSession();
  const c = clean(d);
  if (c.error !== undefined) return { ok: false, error: c.error };
  try {
    const v = await createApparatus(supabase, c.row);
    await logAudit(supabase, {
      silo: v.silo, action_type: 'VehicleAdded', entity_type: 'apparatus', entity_id: v.id,
      user_name: fullName, details: `${v.unit_number} ${v.name}`,
    }).catch(() => {});
    refresh();
    return { ok: true, id: v.id };
  } catch (e) {
    return failed(e, 'The vehicle could not be added.');
  }
}

export async function updateVehicleAction(id: string, d: VehicleDetails): Promise<Result> {
  const { supabase, fullName } = await getSession();
  const c = clean(d);
  if (c.error !== undefined) return { ok: false, error: c.error };
  try {
    const v = await updateApparatus(supabase, String(id), { ...c.row, updated_at: new Date().toISOString() });
    await logAudit(supabase, {
      silo: v.silo, action_type: 'VehicleEdited', entity_type: 'apparatus', entity_id: v.id,
      user_name: fullName, details: `${v.unit_number}: details updated`,
    }).catch(() => {});
    refresh();
    return { ok: true };
  } catch (e) {
    return failed(e, 'The vehicle could not be updated.');
  }
}

export async function setVehicleStatusAction(id: string, status: ApparatusStatus, reason: string): Promise<Result> {
  const { supabase } = await getSession();
  try {
    await setVehicleStatus(supabase, String(id), status, String(reason));
    refresh();
    return { ok: true };
  } catch (e) {
    return failed(e);
  }
}

export async function fleetSnapshotAction(): Promise<Result<{ register: VehicleEntry[] }>> {
  const { supabase } = await getSession();
  try {
    return { ok: true, register: await fleetSnapshot(supabase) };
  } catch (e) {
    return failed(e, 'The fleet register could not be loaded.');
  }
}

export async function importVehiclesAction(
  rows: Array<VehicleItem & { line: number }>, meta: { fileName: string; fileSha256: string; reason: string },
): Promise<Result<{ added: number; updated: number; unchanged: number }>> {
  const { supabase } = await getSession();
  try {
    const res = await importVehicles(supabase, rows, meta);
    refresh();
    return { ok: true, ...res };
  } catch (e) {
    return failed(e);
  }
}
