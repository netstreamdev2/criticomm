'use server';

import { revalidatePath } from 'next/cache';
import {
  finishStaffImport, importStaffRows, markRegisterLeft, moveRegisterPerson, registerForImport,
  restoreRegisterPerson, setRegisterRoles, startStaffImport,
} from '@criticom/api';
import type { Silo, UserRole } from '@criticom/db';
import type { ImportRow, RegisterEntry } from '@criticom/db/register';
import { invitationErrorMessage } from '@/lib/onboarding/errors';
import { getSession } from '@/lib/session';

/**
 * Staff Maintenance's Logins tab (the staff register, 0050): importing HR's
 * list, role review, leavers and moving department go through the database
 * functions of migration 0050, which check who may and keep the record.
 * Adding one person is Staff Maintenance's Add New Staff (0085).
 */

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const fail = (e: unknown, fallback = 'That did not work. Try again.') => ({
  ok: false as const,
  error: invitationErrorMessage(e, fallback),
});

function refresh() {
  revalidatePath('/modules/staff');
  revalidatePath('/admin/rollout');
  revalidatePath('/admin/invitations');
}

// ── Importing HR's staff list ──────────────────────────────────────────

const IMPORT_ROLES: UserRole[] = ['SystemAdmin', 'SuperAdmin'];

/** The register as the import check needs it, for the browser that holds the file. */
export async function registerSnapshotAction(): Promise<Result<{ register: RegisterEntry[] }>> {
  const { supabase, role } = await getSession();
  if (!IMPORT_ROLES.includes(role)) return { ok: false, error: 'Only a SystemAdmin can import the staff list.' };
  try {
    return { ok: true, register: await registerForImport(supabase) };
  } catch (e) {
    return fail(e, 'The staff register could not be loaded.');
  }
}

export async function startImportAction(input: {
  fileName: string; fileSha256: string; reason: string; departments: Silo[]; rowCount: number; skipped: number;
}): Promise<Result<{ importId: string }>> {
  const { supabase } = await getSession();
  try {
    return { ok: true, importId: await startStaffImport(supabase, input) };
  } catch (e) {
    return fail(e);
  }
}

export async function importRowsAction(importId: string, rows: ImportRow[]): Promise<Result<{ added: number; updated: number; unchanged: number }>> {
  const { supabase } = await getSession();
  try {
    return { ok: true, ...(await importStaffRows(supabase, String(importId), rows)) };
  } catch (e) {
    return fail(e);
  }
}

export async function finishImportAction(importId: string): Promise<Result<{ added: number; updated: number; unchanged: number; skipped: number; not_listed: number }>> {
  const { supabase } = await getSession();
  try {
    const res = await finishStaffImport(supabase, String(importId));
    refresh();
    return { ok: true, ...res };
  } catch (e) {
    return fail(e);
  }
}

// ── Role review and leavers ────────────────────────────────────────────

export async function setRolesAction(personnelIds: string[], role: UserRole): Promise<Result<{ set: number; skipped: number }>> {
  const { supabase } = await getSession();
  try {
    const res = await setRegisterRoles(supabase, personnelIds.map(String), role);
    refresh();
    return { ok: true, ...res };
  } catch (e) {
    return fail(e);
  }
}

export async function markLeftAction(personnelId: string, reason: string): Promise<Result<{ invitationsCancelled: number }>> {
  const { supabase } = await getSession();
  try {
    const res = await markRegisterLeft(supabase, String(personnelId), String(reason));
    refresh();
    return { ok: true, invitationsCancelled: res.invitations_cancelled };
  } catch (e) {
    return fail(e);
  }
}

/** Put a wrong department right, so the invitation can be for the department they work in (0067). */
export async function moveDepartmentAction(personnelId: string, silo: Silo, reason: string): Promise<Result<{ invitationsCancelled: number }>> {
  const { supabase } = await getSession();
  try {
    const res = await moveRegisterPerson(supabase, String(personnelId), silo, String(reason));
    refresh();
    return { ok: true, invitationsCancelled: res.invitations_cancelled };
  } catch (e) {
    return fail(e);
  }
}

export async function restoreAction(personnelId: string, reason: string): Promise<Result> {
  const { supabase } = await getSession();
  try {
    await restoreRegisterPerson(supabase, String(personnelId), String(reason));
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
