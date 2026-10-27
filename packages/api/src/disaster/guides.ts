import type { CriticomClient, Database } from '@criticom/db';

/**
 * Criti's tour and practice incidents (0121): whether this person has taken
 * a tour or turned it off, and their own practice incident. Their rows only.
 */

type Tables = Database['public']['Tables'];
export type GuideStatus = Tables['user_guides']['Row']['status'];
export type PracticeIncident = Tables['disaster_practice_incidents']['Row'];

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
const rpc = async <T>(client: CriticomClient, fn: string, args: Record<string, unknown>) => {
  const { data, error } = await (client.rpc as unknown as Rpc)(fn, args);
  if (error) throw error;
  return data as T;
};

/** null: never taken nor turned off (or 0121 is not run yet), so the tour may be offered. */
export async function getGuideStatus(client: CriticomClient, guide: string): Promise<GuideStatus | null | 'unknown'> {
  const { data, error } = await client.from('user_guides').select('status').eq('guide', guide).maybeSingle();
  if (error) return 'unknown';
  return ((data as { status: GuideStatus } | null)?.status) ?? null;
}

export async function getPracticeIncident(client: CriticomClient): Promise<PracticeIncident | null> {
  const { data, error } = await client.from('disaster_practice_incidents').select('*').order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) return null;
  return (data ?? null) as PracticeIncident | null;
}

export const setGuideStatus = (client: CriticomClient, guide: string, status: GuideStatus) =>
  rpc<Tables['user_guides']['Row']>(client, 'set_guide_status', { p_guide: guide, p_status: status });
export const startPracticeIncident = (client: CriticomClient, fields: Record<string, unknown>) =>
  rpc<PracticeIncident>(client, 'start_practice_incident', { p_fields: fields });
export const practiceStep = (client: CriticomClient, id: string, step: string, fields: Record<string, unknown>) =>
  rpc<PracticeIncident>(client, 'practice_step', { p_id: id, p_step: step, p_fields: fields });
