'use server';

import { revalidatePath } from 'next/cache';
import {
  recordForumMeeting, removeForumMeeting, setDepartmentPlanReview, setDisasterPopulation, setFrameworkStatus, setReliefStock, setTaskTeamChair,
} from '@criticom/api';
import { getSession } from '@/lib/session';

/**
 * Readiness, the Forum and the Framework (0118, 0120). Each goes through its
 * guarded function: the database checks the desk, the values and the audit.
 */

type Result = { error: string } | { ok: true };
const fail = (e: unknown, fallback: string): Result => ({
  error: String((e as { message?: string })?.message ?? fallback).replace(/^error:\s*/i, ''),
});
async function run(paths: string[], fallback: string, call: (s: Awaited<ReturnType<typeof getSession>>['supabase']) => Promise<unknown>): Promise<Result> {
  const { supabase } = await getSession();
  try {
    await call(supabase);
  } catch (e) {
    return fail(e, fallback);
  }
  for (const p of paths) revalidatePath(p);
  return { ok: true };
}

const whole = (v: string) => (/^\s*\d{1,9}\s*$/.test(v) ? Number(v) : Number.NaN);

export async function reliefStockAction(item: string, inStorage: string, minimum: string) {
  const a = whole(inStorage);
  const b = whole(minimum);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return { error: 'Give whole numbers.' } as Result;
  return run(['/disaster/readiness', '/disaster'], 'The stock was not saved.', (s) => setReliefStock(s, item, a, b));
}
export async function populationAction(population: string, note: string) {
  const n = whole(population.replace(/[\s,]/g, ''));
  if (!Number.isFinite(n)) return { error: 'Give the population as a whole number.' } as Result;
  return run(['/disaster/readiness'], 'The population was not saved.', (s) => setDisasterPopulation(s, n, note));
}
export async function planReviewAction(department: string, reviewedOn: string) {
  return run(['/disaster/readiness', '/disaster/departments'], 'The date was not saved.', (s) => setDepartmentPlanReview(s, department, reviewedOn));
}
export async function taskTeamAction(team: string, chair: string, phone: string) {
  return run(['/disaster/readiness', '/disaster/duty'], 'The chair was not saved.', (s) => setTaskTeamChair(s, team, chair, phone));
}
export async function forumMeetingAction(clientRef: string, fields: Record<string, string>) {
  return run(['/disaster/readiness', '/disaster/duty'], 'The meeting was not saved.', (s) => recordForumMeeting(s, clientRef, fields));
}
export async function removeForumMeetingAction(id: string) {
  return run(['/disaster/readiness', '/disaster/duty'], 'The meeting was not taken off.', (s) => removeForumMeeting(s, id));
}
export async function frameworkAction(measure: string, status: string) {
  return run(['/disaster/framework', '/disaster/readiness'], 'That was not saved.', (s) => setFrameworkStatus(s, measure, status));
}
