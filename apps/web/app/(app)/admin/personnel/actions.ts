'use server';

import { revalidatePath } from 'next/cache';
import {
  createPersonnel, finishStaffImport, importStaffRows, logAudit, markRegisterLeft, moveRegisterPerson, registerForImport,
  restoreRegisterPerson, setRegisterRoles, startStaffImport,
} from '@criticom/api';
import { ADMIN_CONSOLE_ROLES, normaliseCellphone, normaliseWorkEmail, type Silo, type UserRole } from '@criticom/db';
import type { ImportRow, RegisterEntry } from '@criticom/db/register';
import { invitationErrorMessage } from '@/lib/onboarding/errors';
import { getSession } from '@/lib/session';

/**
 * The staff register. Adding one person goes straight to the table, as it
 * always has (row security decides who may); importing, role review and
 * leaving go through the database functions of migration 0050, which check
 * who may and keep the record.
 */

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const fail = (e: unknown, fallback = 'That did not work. Try again.') => ({
  ok: false as const,
  error: invitationErrorMessage(e, fallback),
});

function refresh() {
  revalidatePath('/admin/personnel');
  revalidatePath('/admin/rollout');
  revalidatePath('/admin/invitations');
}

export async function createPersonnelAction(formData: FormData): Promise<Result<{ id: string }>> {
  const session = await getSession();
  if (!ADMIN_CONSOLE_ROLES.includes(session.role) && session.role !== 'Supervisor') return { ok: false, error: 'Your role cannot add people to the staff register.' };
  const S = (k: string) => String(formData.get(k) ?? '').trim() || null;

  const email = normaliseWorkEmail(S('work_email'));
  if (!email.ok) return { ok: false, error: `“${email.value}” is not an email address.` };
  const phone = normaliseCellphone(S('work_cellphone'));
  if (!phone.ok) return { ok: false, error: `“${phone.value}” is not a cellphone number.` };
  for (const field of ['first_name', 'last_name', 'badge_number', 'rank'] as const) {
    if (!S(field)) return { ok: false, error: 'First names, surname, badge number and rank are all needed.' };
  }

  try {
    const p = await createPersonnel(session.supabase, {
      silo: String(formData.get('silo')) as Silo,
      first_name: S('first_name')!,
      last_name: S('last_name')!,
      badge_number: S('badge_number')!,
      rank: S('rank')!,
      unit: S('unit'),
      station: S('station'),
      platoon: S('platoon'),
      emergency_contact: S('emergency_contact'),
      work_email: email.value,
      work_cellphone: phone.value,
    });
    await logAudit(session.supabase, {
      silo: p.silo, action_type: 'PersonnelCreated', entity_type: 'personnel', entity_id: p.id,
      user_name: session.fullName, details: `${p.first_name} ${p.last_name} (${p.badge_number})`,
    });
    refresh();
    return { ok: true, id: p.id };
  } catch (e) {
    return fail(e, 'The person could not be added.');
  }
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
