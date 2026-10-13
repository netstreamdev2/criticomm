'use server';

import { revalidatePath } from 'next/cache';
import {
  closeDepartmentPartFromDesk, fileFireReport, fileIncidentReport, filePcr, filePostMortem, setDepartmentStatus,
} from '@criticom/api';
import { canFileByRadio, STATUS_OVERRIDE_STEPS, type IncidentStatus, type Silo } from '@criticom/db';
import { getSession } from '@/lib/session';
import { radioPayload } from '@/lib/radio-forms';

/**
 * Filing by radio (migration 0075): the desk files a crew's report from the
 * console as they radioed it in, marks them on scene, and closes on scene for
 * them. Each action checks the caller here and the database checks again;
 * the database has the final word.
 */

type Result = { ok: true } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SILOS: readonly string[] = ['MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster'];

function refusal(e: unknown): string {
  const err = e as { message?: string; hint?: string | null };
  return [err.message ?? String(e), err.hint].filter(Boolean).join(' ');
}

/** Only short strings, a bounded number of them: what a report can hold, nothing more. */
function cleanAnswers(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, string> = {};
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > 600) return null;
  for (const [k, v] of entries) {
    if (typeof v !== 'string' || k.length > 120 || v.length > 10_000 || !/^[a-z0-9_ ·.-]+$/i.test(k)) continue;
    out[k] = v;
  }
  return out;
}

async function deskFor(silo: string) {
  const session = await getSession();
  if (!SILOS.includes(silo) || !canFileByRadio(session.role, session.silo, silo as Silo)) return null;
  return session;
}

export async function fileRadioReportAction(input: {
  incidentId: string;
  silo: string;
  officerId: string;
  forms: string[];
  answers: Record<string, string>;
}): Promise<Result> {
  const session = await deskFor(input.silo);
  if (!session) return { ok: false, error: 'Your desk does not file reports for this department.' };
  if (!UUID.test(input.incidentId) || !UUID.test(input.officerId)) return { ok: false, error: 'Choose who radioed it in.' };
  const answers = cleanAnswers(input.answers);
  if (!answers) return { ok: false, error: 'The report could not be read. Try again.' };
  const forms = Array.isArray(input.forms) ? input.forms.filter((f) => typeof f === 'string').slice(0, 10) : [];

  const { payload, problems } = radioPayload(input.silo, forms, answers, input.officerId);
  if (!payload) return { ok: false, error: problems.join(' ') };

  const { supabase } = session;
  try {
    switch (payload.kind) {
      case 'police':
        await fileIncidentReport(supabase, {
          incidentId: input.incidentId, reportType: payload.reportType, fields: payload.fields, details: payload.details,
        });
        break;
      case 'fire':
        await fileFireReport(supabase, { incidentId: input.incidentId, fields: payload.fields });
        break;
      case 'pcr':
        await filePcr(supabase, { incidentId: input.incidentId, fields: payload.fields });
        break;
      case 'post_mortem':
        await filePostMortem(supabase, { incidentId: input.incidentId, fields: payload.fields });
        break;
    }
  } catch (e) {
    return { ok: false, error: refusal(e) };
  }
  revalidatePath(`/incidents/${input.incidentId}`);
  return { ok: true };
}

/** The crew radioed a step in: mark it for their department. */
export async function markPartAction(input: { incidentId: string; silo: string; status: string }): Promise<Result> {
  const session = await deskFor(input.silo);
  if (!session) return { ok: false, error: 'Your desk does not mark this department\'s crew.' };
  if (!UUID.test(input.incidentId) || !(STATUS_OVERRIDE_STEPS as readonly string[]).includes(input.status)) {
    return { ok: false, error: 'Choose a step.' };
  }
  try {
    await setDepartmentStatus(session.supabase, {
      incident_id: input.incidentId, silo: input.silo as Silo, status: input.status as IncidentStatus,
    });
  } catch (e) {
    return { ok: false, error: refusal(e) };
  }
  revalidatePath(`/incidents/${input.incidentId}`);
  return { ok: true };
}

/** Close the department's part on scene for its crew, once its report is filed. */
export async function closeFromDeskAction(input: { incidentId: string; silo: string; note?: string }): Promise<Result> {
  const session = await deskFor(input.silo);
  if (!session) return { ok: false, error: 'Your desk does not close for this department.' };
  if (!UUID.test(input.incidentId)) return { ok: false, error: 'Incident not found.' };
  try {
    await closeDepartmentPartFromDesk(session.supabase, {
      incidentId: input.incidentId, silo: input.silo as Silo, note: (input.note ?? '').slice(0, 500) || null,
    });
  } catch (e) {
    return { ok: false, error: refusal(e) };
  }
  revalidatePath(`/incidents/${input.incidentId}`);
  return { ok: true };
}
