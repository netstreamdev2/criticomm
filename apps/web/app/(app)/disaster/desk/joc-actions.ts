'use server';

import { revalidatePath } from 'next/cache';
import {
  addJocMember, escalateIncident, logJocSession, removeJocMember, removeWardRelief, saveReview, saveWardRelief, setDmStatus, setIncidentCheck,
  setInformalSettlement, setLevelPlaces, setRecoveryTask, signReview,
} from '@criticom/api';
import { getSession } from '@/lib/session';

/**
 * The levels, the JOC and after the response (0117). Each button goes
 * through its guarded function: the database checks the desk, the reasons,
 * who may authorise the JOC, the status moves and the audit.
 */

type Result = { error: string } | { ok: true };
const fail = (e: unknown, fallback: string): Result => ({
  error: String((e as { message?: string })?.message ?? fallback).replace(/^error:\s*/i, ''),
});
const refresh = (incidentId: string) => {
  revalidatePath(`/disaster/desk/${incidentId}`);
  revalidatePath('/disaster/desk');
  revalidatePath('/disaster', 'layout');
};
async function run(incidentId: string, fallback: string, call: (s: Awaited<ReturnType<typeof getSession>>['supabase']) => Promise<unknown>): Promise<Result> {
  const { supabase } = await getSession();
  try {
    await call(supabase);
  } catch (e) {
    return fail(e, fallback);
  }
  refresh(incidentId);
  return { ok: true };
}

export async function escalateAction(incidentId: string, level: 'Bronze' | 'Silver' | 'Gold', fields: Record<string, unknown>) {
  return run(incidentId, 'The level was not changed. Try again.', (s) => escalateIncident(s, incidentId, level, fields));
}
export async function levelPlacesAction(incidentId: string, fields: Record<string, string>) {
  return run(incidentId, 'That was not saved. Try again.', (s) => setLevelPlaces(s, incidentId, fields));
}
export async function incidentCheckAction(incidentId: string, key: string, done: boolean) {
  return run(incidentId, 'That was not saved. Try again.', (s) => setIncidentCheck(s, incidentId, key, done));
}
export async function informalSettlementAction(incidentId: string, on: boolean) {
  return run(incidentId, 'That was not saved. Try again.', (s) => setInformalSettlement(s, incidentId, on));
}
export async function jocMemberAction(incidentId: string, fields: Record<string, string>) {
  return run(incidentId, 'The member was not added. Try again.', (s) => addJocMember(s, incidentId, fields));
}
export async function removeJocMemberAction(incidentId: string, memberId: string) {
  return run(incidentId, 'That was not saved. Try again.', (s) => removeJocMember(s, memberId));
}
export async function jocSessionAction(incidentId: string, clientRef: string, fields: Record<string, string>) {
  return run(incidentId, 'The session was not saved. Try again.', (s) => logJocSession(s, incidentId, clientRef, fields));
}
export async function dmStatusAction(incidentId: string, status: string, fields: Record<string, unknown>) {
  return run(incidentId, 'The status was not changed. Try again.', (s) => setDmStatus(s, incidentId, status, fields));
}
export async function recoveryAction(incidentId: string, task: string, state: string, note: string) {
  return run(incidentId, 'That was not saved. Try again.', (s) => setRecoveryTask(s, incidentId, task, state, note.trim() || null));
}
export async function reviewAction(incidentId: string, fields: Record<string, string>) {
  return run(incidentId, 'The review was not saved. Try again.', (s) => saveReview(s, incidentId, fields));
}
export async function signReviewAction(incidentId: string, key: string, done: boolean) {
  return run(incidentId, 'That was not saved. Try again.', (s) => signReview(s, incidentId, key, done));
}
export async function wardReliefAction(incidentId: string, fields: Record<string, string>) {
  return run(incidentId, 'The ward was not saved. Try again.', (s) => saveWardRelief(s, incidentId, fields));
}
export async function removeWardReliefAction(incidentId: string, id: string) {
  return run(incidentId, 'The ward was not taken off. Try again.', (s) => removeWardRelief(s, id));
}
