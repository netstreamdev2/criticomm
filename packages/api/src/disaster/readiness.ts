import type { CriticomClient, Database } from '@criticom/db';

/**
 * Readiness, the Advisory Forum and the Framework (0120), and the records the
 * IDP figures are counted from. Reads go through RLS; every write is a
 * guarded function.
 */

type Tables = Database['public']['Tables'];
export type DisasterSettings = Tables['disaster_settings']['Row'];
export type DepartmentPlan = Tables['disaster_department_plans']['Row'];
export type TaskTeam = Tables['disaster_task_teams']['Row'];
export type ForumMeeting = Tables['disaster_forum_meetings']['Row'];
export type FrameworkStatus = Tables['disaster_framework_status']['Row'];

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
const rpc = async <T>(client: CriticomClient, fn: string, args: Record<string, unknown>) => {
  const { data, error } = await (client.rpc as unknown as Rpc)(fn, args);
  if (error) throw error;
  return data as T;
};
const rows = async <T>(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> => {
  const { data, error } = await q;
  return error ? [] : ((data ?? []) as T[]);
};

export async function getDisasterSettings(client: CriticomClient): Promise<DisasterSettings | null> {
  const { data, error } = await client.from('disaster_settings').select('*').maybeSingle();
  return error ? null : ((data ?? null) as DisasterSettings | null);
}
export const listDepartmentPlans = (client: CriticomClient) => rows<DepartmentPlan>(client.from('disaster_department_plans').select('*'));
export const listTaskTeams = (client: CriticomClient) => rows<TaskTeam>(client.from('disaster_task_teams').select('*'));
export const listForumMeetings = (client: CriticomClient) =>
  rows<ForumMeeting>(client.from('disaster_forum_meetings').select('*').order('held_on', { ascending: false }).limit(200));
export const listFrameworkStatus = (client: CriticomClient) => rows<FrameworkStatus>(client.from('disaster_framework_status').select('*'));

/** JOC readiness sessions held between two moments (IDP). */
export const listReadinessSessionsBetween = (client: CriticomClient, from: Date, to: Date) =>
  rows<Tables['disaster_joc_sessions']['Row']>(client.from('disaster_joc_sessions').select('*').eq('kind', 'Readiness')
    .gte('held_at', from.toISOString()).lt('held_at', to.toISOString()));
/** Reviews signed off between two moments (IDP). */
export const listReviewsSignedBetween = (client: CriticomClient, from: Date, to: Date) =>
  rows<Tables['disaster_reviews']['Row']>(client.from('disaster_reviews').select('*')
    .gte('signed_off_at', from.toISOString()).lt('signed_off_at', to.toISOString()));
/** Warnings that began between two moments (IDP). */
export const listWarningsBetween = (client: CriticomClient, from: Date, to: Date) =>
  rows<Tables['disaster_warnings']['Row']>(client.from('disaster_warnings').select('*')
    .gte('valid_from', from.toISOString()).lt('valid_from', to.toISOString()).limit(1000));
/** Every sitrep's figures on these incidents, oldest first (the latest figures per incident). */
export const listSitrepFigures = (client: CriticomClient, incidentIds: string[]) => incidentIds.length
  ? rows<{ incident_id: string; figures: Record<string, number> | null; logged_at: string }>(client.from('disaster_desk_updates')
    .select('incident_id, figures, logged_at').in('incident_id', incidentIds).order('logged_at'))
  : Promise.resolve([]);

export const setDisasterPopulation = (client: CriticomClient, population: number, note: string) =>
  rpc<DisasterSettings>(client, 'set_disaster_population', { p_population: population, p_note: note });
export const setDepartmentPlanReview = (client: CriticomClient, department: string, reviewedOn: string) =>
  rpc<DepartmentPlan>(client, 'set_department_plan_review', { p_department: department, p_reviewed_on: reviewedOn });
export const setTaskTeamChair = (client: CriticomClient, team: string, chair: string, phone: string) =>
  rpc<TaskTeam>(client, 'set_task_team_chair', { p_team: team, p_chair: chair, p_phone: phone });
export const recordForumMeeting = (client: CriticomClient, clientRef: string, fields: Record<string, string>) =>
  rpc<ForumMeeting>(client, 'record_forum_meeting', { p_client_ref: clientRef, p_fields: fields });
export const removeForumMeeting = (client: CriticomClient, id: string) => rpc<null>(client, 'remove_forum_meeting', { p_id: id });
export const setFrameworkStatus = (client: CriticomClient, measure: string, status: string, note?: string | null) =>
  rpc<FrameworkStatus>(client, 'set_framework_status', { p_measure: measure, p_status: status, p_note: note ?? null });
