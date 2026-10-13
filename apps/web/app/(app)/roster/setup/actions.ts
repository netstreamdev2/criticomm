'use server';

import { revalidatePath } from 'next/cache';
import {
  removePublicHoliday, saveRotation, saveScheduleSettings, savePublicHoliday, saveShiftTemplate, listShiftTemplates,
} from '@criticom/api';
import { canAdminSchedule, isScheduleHr, type Silo } from '@criticom/db';
import { getSession } from '@/lib/session';

/**
 * Shift setup: the department admin's (organisation HR for any department).
 * The database holds the same line and checks every value (0072).
 */

export type SetupResult = { ok?: true; error?: string };

async function admin(silo: string | null) {
  const session = await getSession();
  const target = (silo || session.silo) as Silo;
  if (!canAdminSchedule(session.role, session.silo, target)) throw new Error('Only the department administrator sets this up.');
  return { ...session, target };
}
const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const fail = (e: unknown, fallback: string): SetupResult => ({ error: e instanceof Error ? e.message : fallback });
const done = () => { revalidatePath('/roster/setup'); revalidatePath('/roster'); };

export async function saveTemplateAction(fd: FormData): Promise<SetupResult> {
  try {
    const { supabase, target } = await admin(str(fd, 'silo'));
    const hours = Number(str(fd, 'hours'));
    if (!Number.isFinite(hours) || hours < 0.5 || hours > 26) return { error: 'A shift is between half an hour and 26 hours.' };
    if (!/^\d{2}:\d{2}$/.test(str(fd, 'start'))) return { error: 'Give the start time as 06:00.' };
    await saveShiftTemplate(supabase, {
      ...(str(fd, 'id') ? { id: str(fd, 'id') } : {}),
      silo: target,
      name: str(fd, 'name'),
      code: str(fd, 'code').toUpperCase(),
      start_time: `${str(fd, 'start')}:00`,
      minutes: Math.round(hours * 60),
      colour: /^#[0-9a-fA-F]{6}$/.test(str(fd, 'colour')) ? str(fd, 'colour') : '#3b82f6',
      active: str(fd, 'active') !== 'off',
    });
  } catch (e) {
    return fail(e, 'Not saved.');
  }
  done();
  return { ok: true };
}

/**
 * A rotation from the codes of the department's shift types: "D D N N - - - -"
 * (a dash or a dot is a day off), its teams "A B C D" and the day each starts
 * on "0 2 4 6".
 */
export async function saveRotationAction(fd: FormData): Promise<SetupResult> {
  try {
    const { supabase, target } = await admin(str(fd, 'silo'));
    const templates = await listShiftTemplates(supabase, target, { includeInactive: true });
    const byCode = new Map(templates.map((t) => [t.code.toUpperCase(), t.id]));
    const words = (k: string) => str(fd, k).split(/[\s,]+/).filter(Boolean);
    const cycle: Array<string | null> = [];
    for (const w of words('cycle')) {
      if (w === '-' || w === '.' || w.toLowerCase() === 'off') { cycle.push(null); continue; }
      const id = byCode.get(w.toUpperCase());
      if (!id) return { error: `"${w}" is not one of this department's shift codes (${[...byCode.keys()].join(', ')}).` };
      cycle.push(id);
    }
    const teams = words('teams');
    const offsets = words('offsets').map(Number);
    if (offsets.some((n) => !Number.isInteger(n) || n < 0)) return { error: 'Each team starts on a whole day: 0, 1, 2…' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(str(fd, 'anchor'))) return { error: 'Choose the day the cycle starts.' };
    await saveRotation(supabase, {
      ...(str(fd, 'id') ? { id: str(fd, 'id') } : {}),
      silo: target,
      name: str(fd, 'name'),
      cycle, teams, offsets,
      anchor: str(fd, 'anchor'),
      skip_public_holidays: str(fd, 'holidays') === 'on',
      active: str(fd, 'active') !== 'off',
    });
  } catch (e) {
    return fail(e, 'Not saved.');
  }
  done();
  return { ok: true };
}

export async function saveSettingsAction(fd: FormData): Promise<SetupResult> {
  try {
    const { supabase, target, userId, fullName } = await admin(str(fd, 'silo'));
    const grace = Number(str(fd, 'grace'));
    const noshow = Number(str(fd, 'noshow'));
    if (!Number.isInteger(grace) || grace < 0 || grace > 120) return { error: 'Late after 0 to 120 minutes.' };
    if (!Number.isInteger(noshow) || noshow <= grace || noshow > 480) return { error: 'Not started is after "late", and at most 480 minutes.' };
    await saveScheduleSettings(supabase, { silo: target, grace, noshow, byId: userId, byName: fullName });
  } catch (e) {
    return fail(e, 'Not saved.');
  }
  done();
  return { ok: true };
}

export async function saveHolidayAction(fd: FormData): Promise<SetupResult> {
  try {
    const { supabase, role } = await getSession();
    if (!isScheduleHr(role)) return { error: 'Public holidays are kept by organisation HR.' };
    await savePublicHoliday(supabase, { day: str(fd, 'day'), name: str(fd, 'name') });
  } catch (e) {
    return fail(e, 'Not saved.');
  }
  done();
  return { ok: true };
}

export async function removeHolidayAction(fd: FormData): Promise<SetupResult> {
  try {
    const { supabase, role } = await getSession();
    if (!isScheduleHr(role)) return { error: 'Public holidays are kept by organisation HR.' };
    await removePublicHoliday(supabase, str(fd, 'day'));
  } catch (e) {
    return fail(e, 'Not removed.');
  }
  done();
  return { ok: true };
}
