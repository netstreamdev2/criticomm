'use server';

import { revalidatePath } from 'next/cache';
import {
  callOutPartner, closeShelter, endDuty, fileDisasterAssessment, filePostMortem, logDeskUpdate, openShelter, saveDuty, saveMutualAidPartner,
  saveShelter, setCalloutStatus, setCoordinationLevel, setDisasterCall, setScgChair, updateShelter, type CalloutStatus, type DeskChannel,
} from '@criticom/api';
import { DESK_POST_MORTEM_FIELDS, deskPostMortemPayload, validatePostMortem } from '@criticom/db/post-mortem';
import { getSession } from '@/lib/session';

/**
 * The Disaster desk's buttons (0111, 0112). Each goes through its guarded
 * function; the database checks the desk, the call and the audit. A client
 * reference makes a double press, or a retry after a dropped line, safe.
 */

type Result = { error: string } | { ok: true };
const CHANNELS: DeskChannel[] = ['Call', 'Radio', 'WhatsApp', 'Other'];
const fail = (e: unknown, fallback: string): Result => ({
  error: String((e as { message?: string })?.message ?? fallback).replace(/^error:\s*/i, ''),
});
const channel = (v: unknown): DeskChannel | null => (CHANNELS.includes(v as DeskChannel) ? (v as DeskChannel) : null);
const minutes = (v: unknown) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : Number.NaN;
  return Number.isInteger(n) && n >= 0 && n <= 1440 ? n : null;
};
const refresh = (incidentId: string) => {
  revalidatePath(`/disaster/desk/${incidentId}`);
  revalidatePath('/disaster/desk');
};

export async function callOutAction(input: {
  incidentId: string; clientRef: string; how: string; partnerId?: string | null; officerId?: string | null; agencyName?: string | null;
  contactNumber?: string | null; reason?: string | null; etaMinutes?: number | string | null; suggestedByAi?: boolean;
}): Promise<Result> {
  const how = channel(input.how);
  if (!how) return { error: 'Say how you reached them.' };
  const { supabase } = await getSession();
  try {
    await callOutPartner(supabase, {
      incidentId: input.incidentId, clientRef: input.clientRef, how,
      partnerId: input.partnerId || null, officerId: input.officerId || null, agencyName: input.agencyName?.trim() || null,
      contactNumber: input.contactNumber?.trim() || null, reason: input.reason?.trim() || null,
      etaMinutes: minutes(input.etaMinutes), suggestedByAi: input.suggestedByAi === true,
    });
  } catch (e) {
    return fail(e, 'The call-out was not saved. Try again.');
  }
  refresh(input.incidentId);
  return { ok: true };
}

export async function calloutStatusAction(input: {
  incidentId: string; calloutId: string; status: string; how?: string | null; note?: string | null; etaMinutes?: number | string | null;
}): Promise<Result> {
  const allowed: Array<Exclude<CalloutStatus, 'Called'>> = ['On the way', 'On scene', 'Left scene', 'Stood down'];
  const status = allowed.find((s) => s === input.status);
  if (!status) return { error: 'Choose what they said.' };
  const { supabase } = await getSession();
  try {
    await setCalloutStatus(supabase, {
      calloutId: input.calloutId, status, how: channel(input.how), note: input.note?.trim() || null, etaMinutes: minutes(input.etaMinutes),
    });
  } catch (e) {
    return fail(e, 'That was not saved. Try again.');
  }
  refresh(input.incidentId);
  return { ok: true };
}

export async function deskUpdateAction(input: {
  incidentId: string; clientRef: string; source: string; text: string; calloutId?: string | null; fromName?: string | null;
}): Promise<Result> {
  const source = channel(input.source);
  if (!source) return { error: 'Say how it came in.' };
  if (!input.text.trim()) return { error: 'Write what they said.' };
  const { supabase } = await getSession();
  try {
    await logDeskUpdate(supabase, {
      incidentId: input.incidentId, clientRef: input.clientRef, source, text: input.text.trim().slice(0, 2000),
      calloutId: input.calloutId || null, fromName: input.fromName?.trim() || null,
    });
  } catch (e) {
    return fail(e, 'The update was not saved. Try again.');
  }
  refresh(input.incidentId);
  return { ok: true };
}

/* ── The call, the eThekwini way (0112) ─────────────────────────────────── */

/** Short title, hazard, municipalities affected, FCP and EOC. */
export async function setCallAction(input: {
  incidentId: string; shortTitle?: string; hazard?: string; municipalities?: string[]; fcpLocation?: string; eocLocation?: string;
}): Promise<Result> {
  const fields: Record<string, unknown> = {};
  if (input.shortTitle !== undefined) fields.short_title = input.shortTitle;
  if (input.hazard !== undefined) fields.hazard = input.hazard;
  if (input.municipalities !== undefined) fields.municipalities = input.municipalities;
  if (input.fcpLocation !== undefined) fields.fcp_location = input.fcpLocation;
  if (input.eocLocation !== undefined) fields.eoc_location = input.eocLocation;
  const { supabase } = await getSession();
  try {
    await setDisasterCall(supabase, input.incidentId, fields);
  } catch (e) {
    return fail(e, 'That was not saved. Try again.');
  }
  refresh(input.incidentId);
  return { ok: true };
}

export async function setLevelAction(input: { incidentId: string; level: string; note?: string | null }): Promise<Result> {
  if (input.level !== 'Bronze' && input.level !== 'Silver' && input.level !== 'Gold') return { error: 'Choose Bronze, Silver or Gold.' };
  const { supabase } = await getSession();
  try {
    await setCoordinationLevel(supabase, input.incidentId, input.level, input.note?.trim() || null);
  } catch (e) {
    return fail(e, 'The level was not changed. Try again.');
  }
  refresh(input.incidentId);
  return { ok: true };
}

/* ── Shelters for the call ──────────────────────────────────────────────── */

const counts = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v !== undefined && v !== null));

export async function openShelterAction(input: {
  incidentId: string; shelterId: string; clientRef: string; people?: string; households?: string; children?: string; elderly?: string;
  disabled?: string; note?: string;
}): Promise<Result> {
  const { supabase } = await getSession();
  try {
    await openShelter(supabase, {
      incidentId: input.incidentId, shelterId: input.shelterId, clientRef: input.clientRef,
      fields: counts({ people: input.people, households: input.households, children: input.children, elderly: input.elderly,
        disabled: input.disabled, note: input.note }),
    });
  } catch (e) {
    return fail(e, 'The shelter was not opened. Try again.');
  }
  refresh(input.incidentId);
  revalidatePath('/disaster/shelters');
  return { ok: true };
}

export async function updateShelterAction(input: {
  incidentId: string; openingId: string; clientRef: string; arrived?: string; left?: string; households?: string; children?: string;
  elderly?: string; disabled?: string; relief?: Record<string, string>; note?: string;
}): Promise<Result> {
  const { supabase } = await getSession();
  try {
    await updateShelter(supabase, {
      openingId: input.openingId, clientRef: input.clientRef,
      fields: counts({ arrived: input.arrived, left: input.left, households: input.households, children: input.children,
        elderly: input.elderly, disabled: input.disabled, relief: input.relief ? counts(input.relief) : undefined, note: input.note }),
    });
  } catch (e) {
    return fail(e, 'That was not saved. Try again.');
  }
  refresh(input.incidentId);
  revalidatePath('/disaster/shelters');
  return { ok: true };
}

export async function closeShelterAction(input: { incidentId: string; openingId: string; note?: string }): Promise<Result> {
  const { supabase } = await getSession();
  try {
    await closeShelter(supabase, input.openingId, input.note?.trim() || null);
  } catch (e) {
    return fail(e, 'The shelter was not closed. Try again.');
  }
  refresh(input.incidentId);
  revalidatePath('/disaster/shelters');
  return { ok: true };
}

/** The register: add or change a hall or facility. */
export async function saveShelterAction(id: string | null, fields: Record<string, string | boolean>): Promise<Result> {
  const { supabase } = await getSession();
  try {
    await saveShelter(supabase, id, fields);
  } catch (e) {
    return fail(e, 'The shelter was not saved. Try again.');
  }
  revalidatePath('/disaster/shelters');
  return { ok: true };
}

/* ── An officer's assessment, filed for them ────────────────────────────── */

export async function fileAssessmentAction(input: { incidentId: string; clientRef: string; fields: Record<string, unknown> }): Promise<Result> {
  const { supabase } = await getSession();
  try {
    await fileDisasterAssessment(supabase, { incidentId: input.incidentId, clientRef: input.clientRef, fields: input.fields });
  } catch (e) {
    return fail(e, 'The assessment was not filed. Try again.');
  }
  refresh(input.incidentId);
  return { ok: true };
}

/* ── The duty roster and the SCG duty chair ─────────────────────────────── */

export async function saveDutyAction(id: string | null, fields: Record<string, string>): Promise<Result> {
  const { supabase } = await getSession();
  try {
    await saveDuty(supabase, id, fields);
  } catch (e) {
    return fail(e, 'The roster was not saved. Try again.');
  }
  revalidatePath('/disaster/duty');
  return { ok: true };
}

export async function endDutyAction(id: string): Promise<Result> {
  const { supabase } = await getSession();
  try {
    await endDuty(supabase, id);
  } catch (e) {
    return fail(e, 'That was not saved. Try again.');
  }
  revalidatePath('/disaster/duty');
  return { ok: true };
}

export async function setScgChairAction(input: { year: number; month: number; name: string; phone?: string }): Promise<Result> {
  const { supabase } = await getSession();
  try {
    await setScgChair(supabase, { year: input.year, month: input.month, name: input.name.trim() || null, phone: input.phone?.trim() || null });
  } catch (e) {
    return fail(e, 'That was not saved. Try again.');
  }
  revalidatePath('/disaster/duty');
  return { ok: true };
}

/* ── Partners ───────────────────────────────────────────────────────────── */

export async function savePartnerAction(id: string | null, fields: Record<string, string | boolean>): Promise<Result> {
  const { supabase } = await getSession();
  try {
    await saveMutualAidPartner(supabase, id, fields);
  } catch (e) {
    return fail(e, 'The partner was not saved. Try again.');
  }
  revalidatePath('/disaster/partners');
  return { ok: true };
}

/* ── The post-mortem from the desk ──────────────────────────────────────── */

export async function fileDeskPostMortemAction(incidentId: string, answers: Record<string, string>): Promise<Result> {
  const problems = validatePostMortem(answers);
  for (const f of DESK_POST_MORTEM_FIELDS) {
    const v = (answers[f.key] ?? '').trim();
    if (f.kind === 'count' && v && !/^\d{1,6}$/.test(v)) problems.push(`${f.label} is a whole number.`);
  }
  if (problems.length) return { error: [...new Set(problems)].join(' ') };
  const { supabase } = await getSession();
  try {
    await filePostMortem(supabase, { incidentId, fields: deskPostMortemPayload(answers) as Record<string, string> });
  } catch (e) {
    return fail(e, 'The post-mortem was not filed. Try again.');
  }
  refresh(incidentId);
  revalidatePath('/disaster');
  revalidatePath('/disaster/post-mortem');
  return { ok: true };
}
