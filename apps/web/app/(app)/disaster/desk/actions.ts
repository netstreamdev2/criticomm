'use server';

import { revalidatePath } from 'next/cache';
import {
  addLineFunction, logDisasterSms, openDisasterIncident, recordCasualty, removeLineFunction, saveDepartmentContact, saveLineReport,
  setShelterPosition, setShelterServices, updateCasualty,
  callOutPartner, closeShelter, endDuty, fileDisasterAssessment, filePostMortem, logDeskUpdate, openShelter, saveDuty, saveMutualAidPartner,
  saveShelter, setCalloutStatus, setDisasterCall, setScgChair, updateShelter, type CalloutStatus, type DeskChannel,
} from '@criticom/api';
import { DESK_POST_MORTEM_FIELDS, deskPostMortemPayload, validatePostMortem } from '@criticom/db/post-mortem';
import { getSession } from '@/lib/session';
import { searchPlaces } from '@/lib/geocode';
import { normalizeSaPhone, sendSms } from '@/lib/sms';
import { checkPhone } from '@/lib/disaster-checks';

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
  /** A sitrep's figures, and who was moved how and where (0113). */
  figures?: Record<string, string>; movedBy?: string | null; movedTo?: string | null;
}): Promise<Result> {
  const source = channel(input.source);
  if (!source) return { error: 'Say how it came in.' };
  const figures = Object.fromEntries(Object.entries(input.figures ?? {}).filter(([, v]) => v.trim() !== ''));
  if (!input.text.trim() && Object.keys(figures).length === 0 && !input.movedTo?.trim()) return { error: 'Write what they said.' };
  const { supabase } = await getSession();
  try {
    await logDeskUpdate(supabase, {
      incidentId: input.incidentId, clientRef: input.clientRef, source, text: input.text.trim().slice(0, 2000),
      calloutId: input.calloutId || null, fromName: input.fromName?.trim() || null,
      figures, movedBy: input.movedBy || null, movedTo: input.movedTo?.trim() || null,
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
export async function saveShelterAction(
  id: string | null, fields: Record<string, string | boolean>, at: { lat: number; lng: number } | null = null,
): Promise<Result> {
  const { supabase } = await getSession();
  try {
    const hall = await saveShelter(supabase, id, fields);
    // Its place on the map (0113): the point picked from the address search, or
    // else looked up from the typed address. A lookup that fails leaves it off the map, not unsaved.
    const address = typeof fields.address === 'string' ? fields.address.trim() : '';
    if (at && Number.isFinite(at.lat) && Number.isFinite(at.lng)) {
      await setShelterPosition(supabase, hall.id, at.lat, at.lng).catch(() => null);
    } else if (address) {
      const hit = (await searchPlaces(`${address}, ${hall.municipality === 'eThekwini Metro' ? 'Durban' : hall.municipality}`).catch(() => []))[0];
      if (hit) await setShelterPosition(supabase, hall.id, hit.lat, hit.lng).catch(() => null);
    }
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

/* ── The duty roster and the JOC duty chair ─────────────────────────────── */

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

/* ── Disaster operations from the desk (0113) ───────────────────────────── */

/** Open incident: the desk opens one itself. Returns the new incident's id. */
export async function openIncidentAction(clientRef: string, fields: Record<string, unknown>): Promise<{ error: string } | { id: string }> {
  const { supabase } = await getSession();
  // The caller's number goes on the incident itself, which 0114 does not check.
  const number = checkPhone(typeof fields.caller_number === 'string' ? fields.caller_number : '');
  if (number) return { error: number.text };
  try {
    const inc = await openDisasterIncident(supabase, clientRef, fields);
    revalidatePath('/disaster/desk');
    revalidatePath('/disaster');
    return { id: inc.id };
  } catch (e) {
    return fail(e, 'The incident was not opened. Try again.') as { error: string };
  }
}

export async function addDepartmentAction(incidentId: string, department: string): Promise<Result> {
  const { supabase } = await getSession();
  try {
    await addLineFunction(supabase, incidentId, department);
  } catch (e) {
    return fail(e, 'The department was not added. Try again.');
  }
  refresh(incidentId);
  return { ok: true };
}

export async function removeDepartmentAction(incidentId: string, department: string): Promise<Result> {
  const { supabase } = await getSession();
  try {
    await removeLineFunction(supabase, incidentId, department);
  } catch (e) {
    return fail(e, 'The department was not taken off. Try again.');
  }
  refresh(incidentId);
  return { ok: true };
}

export async function saveDepartmentReportAction(incidentId: string, department: string, fields: Record<string, unknown>): Promise<Result> {
  const { supabase } = await getSession();
  try {
    await saveLineReport(supabase, incidentId, department, fields);
  } catch (e) {
    return fail(e, 'The department report was not saved. Try again.');
  }
  refresh(incidentId);
  return { ok: true };
}

export async function saveContactAction(id: string | null, fields: Record<string, unknown>): Promise<Result> {
  const { supabase } = await getSession();
  try {
    await saveDepartmentContact(supabase, id, fields);
  } catch (e) {
    return fail(e, 'The contact was not saved. Try again.');
  }
  revalidatePath('/disaster/departments');
  return { ok: true };
}

export async function recordCasualtyAction(incidentId: string, clientRef: string, fields: Record<string, unknown>): Promise<Result> {
  const { supabase } = await getSession();
  try {
    await recordCasualty(supabase, incidentId, clientRef, fields);
  } catch (e) {
    return fail(e, 'The record was not saved. Try again.');
  }
  refresh(incidentId);
  return { ok: true };
}

export async function updateCasualtyAction(incidentId: string, id: string, fields: Record<string, unknown>): Promise<Result> {
  const { supabase } = await getSession();
  try {
    await updateCasualty(supabase, id, fields);
  } catch (e) {
    return fail(e, 'The record was not saved. Try again.');
  }
  refresh(incidentId);
  return { ok: true };
}

export async function shelterServicesAction(incidentId: string, openingId: string, fields: Record<string, unknown>): Promise<Result> {
  const { supabase } = await getSession();
  try {
    await setShelterServices(supabase, openingId, fields);
  } catch (e) {
    return fail(e, 'The supplies were not saved. Try again.');
  }
  refresh(incidentId);
  return { ok: true };
}

/** A shelter's place on the map, found from its address. */
export async function placeShelterAction(shelterId: string, address: string): Promise<Result> {
  const { supabase } = await getSession();
  const hit = (await searchPlaces(address).catch(() => []))[0];
  if (!hit) return { error: 'That address was not found on the map.' };
  try {
    await setShelterPosition(supabase, shelterId, hit.lat, hit.lng);
  } catch (e) {
    return fail(e, 'The position was not saved.');
  }
  revalidatePath('/disaster/shelters');
  return { ok: true };
}

/**
 * Send an SMS (BulkSMS) and keep it with the incident, sent or not. The
 * dispatcher has read it before pressing Send.
 */
export async function sendSmsAction(input: { incidentId: string; toName: string; toNumber: string; body: string }): Promise<Result> {
  const body = input.body.trim().slice(0, 640);
  const digits = input.toNumber.replace(/[^\d+]/g, '');
  if (digits.length < 9) return { error: 'Give a cellphone number.' };
  if (!body) return { error: 'Write the message.' };
  const { supabase } = await getSession();
  const to = normalizeSaPhone(digits);
  const res = await sendSms(to, body);
  try {
    await logDisasterSms(supabase, input.incidentId, {
      to_name: input.toName.trim() || null, to_number: to, body,
      status: res.ok ? 'Sent' : res.reason === 'unconfigured' ? 'Not set up' : 'Failed',
      detail: res.ok ? null : (res.detail ?? res.reason),
    });
  } catch (e) {
    return fail(e, 'The SMS was not recorded.');
  }
  refresh(input.incidentId);
  if (!res.ok) return { error: res.reason === 'unconfigured' ? 'SMS is not set up yet. Ask the administrator to add the BulkSMS keys.' : 'The SMS did not go. Call instead.' };
  return { ok: true };
}
