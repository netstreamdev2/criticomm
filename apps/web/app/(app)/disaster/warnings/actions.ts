'use server';

import { revalidatePath } from 'next/cache';
import {
  currentTenant, endWarning, getWarning, holdReadinessSession, importCouncillors, listCouncillors, logWarningSms, openIncidentFromWarning,
  recordWarning, saveCouncillor, setWarningColour, setWarningStep,
} from '@criticom/api';
import { EMERGENCY_NUMBER } from '@criticom/db/disaster-plan';
import { warningSms } from '@criticom/db/disaster-warnings';
import { checkPhone } from '@/lib/disaster-checks';
import { getSession } from '@/lib/session';
import { sendSmsMany } from '@/lib/sms';
import { syncSawsWarnings } from '@/lib/saws-sync';

/**
 * The early warning buttons (0116). Each goes through its guarded function:
 * the database checks the desk, the warning and the audit. The councillor
 * SMS is written here from the warning as stored, so it goes out as SAWS
 * issued it.
 */

type Result = { error: string } | { ok: true };
const fail = (e: unknown, fallback: string) => ({
  error: String((e as { message?: string })?.message ?? fallback).replace(/^error:\s*/i, ''),
});
const refresh = (warningId?: string) => {
  revalidatePath('/disaster/warnings');
  if (warningId) revalidatePath(`/disaster/warnings/${warningId}`);
  revalidatePath('/disaster', 'layout');
};

export async function recordWarningAction(clientRef: string, fields: Record<string, string>): Promise<{ error: string } | { id: string }> {
  const { supabase } = await getSession();
  try {
    const w = await recordWarning(supabase, clientRef, fields);
    refresh(w.id);
    return { id: w.id };
  } catch (e) {
    return fail(e, 'The warning was not saved. Try again.');
  }
}

export async function warningStepAction(warningId: string, step: string, done: boolean): Promise<Result> {
  const { supabase } = await getSession();
  try {
    await setWarningStep(supabase, warningId, step, done);
  } catch (e) {
    return fail(e, 'That was not saved. Try again.');
  }
  refresh(warningId);
  return { ok: true };
}

export async function warningColourAction(warningId: string, colour: string): Promise<Result> {
  const { supabase } = await getSession();
  try {
    await setWarningColour(supabase, warningId, colour || null);
  } catch (e) {
    return fail(e, 'The colour was not saved.');
  }
  refresh(warningId);
  return { ok: true };
}

export async function endWarningAction(warningId: string, reason: string): Promise<Result> {
  const { supabase } = await getSession();
  try {
    await endWarning(supabase, warningId, reason);
  } catch (e) {
    return fail(e, 'The warning was not ended.');
  }
  refresh(warningId);
  return { ok: true };
}

export async function readinessAction(warningId: string, clientRef: string, fields: Record<string, string>): Promise<Result> {
  const { supabase } = await getSession();
  try {
    await holdReadinessSession(supabase, warningId, clientRef, fields);
  } catch (e) {
    return fail(e, 'The session was not saved. Try again.');
  }
  refresh(warningId);
  return { ok: true };
}

export async function incidentFromWarningAction(warningId: string, clientRef: string, fields: Record<string, unknown>): Promise<{ error: string } | { id: string }> {
  const { supabase } = await getSession();
  // The caller's number goes on the incident itself, which 0114 does not check (as openIncidentAction).
  const number = checkPhone(typeof fields.caller_number === 'string' ? fields.caller_number : '');
  if (number) return { error: number.text };
  try {
    const inc = await openIncidentFromWarning(supabase, warningId, clientRef, fields);
    refresh(warningId);
    revalidatePath('/disaster/desk');
    return { id: inc.id };
  } catch (e) {
    return fail(e, 'The incident was not added. Try again.');
  }
}

/** The warning, as stored, to every councillor on the list with a cellphone. */
export async function smsCouncillorsAction(warningId: string): Promise<{ error: string } | { sent: number; failed: number }> {
  const { supabase } = await getSession();
  const [w, councillors] = await Promise.all([getWarning(supabase, warningId), listCouncillors(supabase)]);
  if (!w) return { error: 'That warning is not there any more.' };
  const numbers = councillors.filter((c) => c.is_active && c.phone).map((c) => c.phone!);
  if (!numbers.length) return { error: 'No councillor has a cellphone on the list yet.' };
  const body = warningSms(w, EMERGENCY_NUMBER);
  const res = await sendSmsMany(numbers, body);
  if (res.unconfigured) return { error: 'SMS is not set up yet. Ask the administrator to add the BulkSMS keys.' };
  try {
    await logWarningSms(supabase, warningId, res.sent, res.failed, body);
  } catch (e) {
    return fail(e, 'The SMS went but was not recorded.');
  }
  refresh(warningId);
  return { sent: res.sent, failed: res.failed };
}

/** Ask SAWS now, not in five minutes. */
export async function checkSawsNowAction(): Promise<{ error: string } | { forUs: number }> {
  const { supabase } = await getSession();
  const tenant = await currentTenant(supabase);
  if (!tenant) return { error: 'Sign in again.' };
  const { data: desk } = await (supabase.rpc as unknown as (fn: string, a: object) => Promise<{ data: unknown }>)('works_disaster_desk', {});
  if (desk !== true) return { error: 'Only the Disaster desk does this.' };
  const res = await syncSawsWarnings(tenant, { force: true });
  refresh();
  return res.ok ? { forUs: res.forUs } : { error: res.detail ?? 'The SA Weather Service did not answer. Try again later.' };
}

export async function saveCouncillorAction(id: string | null, fields: Record<string, string | boolean>): Promise<Result> {
  const { supabase } = await getSession();
  try {
    await saveCouncillor(supabase, id, fields);
  } catch (e) {
    return fail(e, 'The councillor was not saved.');
  }
  revalidatePath('/disaster/councillors');
  return { ok: true };
}

export async function importCouncillorsAction(rows: Array<Record<string, string>>): Promise<{ error: string } | { added: number; changed: number; skipped: number }> {
  const { supabase } = await getSession();
  try {
    const res = await importCouncillors(supabase, rows.slice(0, 500));
    revalidatePath('/disaster/councillors');
    return res;
  } catch (e) {
    return fail(e, 'The list was not added.');
  }
}
