import type { CriticomClient, Database, Silo } from '@criticom/db';

type Endorsement = Database['public']['Tables']['endorsements']['Row'];

export const ENDORSEMENT_TYPES = [
  'Court Attendance', 'Special Event', 'Special Instruction', 'Restriction',
] as const;

/** RosterViewController.GetEndorsements */
export async function listEndorsements(
  client: CriticomClient,
  args: { silo?: Silo; userId?: string; includeInactive?: boolean } = {},
): Promise<Endorsement[]> {
  let q = client.from('endorsements').select('*').order('start_date', { ascending: false });
  if (args.silo) q = q.eq('silo', args.silo);
  if (args.userId) q = q.eq('user_id', args.userId);
  if (!args.includeInactive) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

/** Active endorsements overlapping a given duty date (print on the duty sheet). */
export async function listEndorsementsForDate(
  client: CriticomClient,
  silo: Silo,
  date: string,
): Promise<Endorsement[]> {
  const { data, error } = await client
    .from('endorsements')
    .select('*')
    .eq('silo', silo)
    .eq('is_active', true)
    .lte('start_date', date)
    .or(`end_date.is.null,end_date.gte.${date}`);
  if (error) throw error;
  return data ?? [];
}

/** RosterViewController.AddEndorsement */
export async function addEndorsement(
  client: CriticomClient,
  input: Database['public']['Tables']['endorsements']['Insert'],
) {
  const { data, error } = await client.from('endorsements').insert(input).select().single();
  if (error) throw error;
  return data;
}

/** RosterViewController.DeactivateEndorsement (soft delete). */
export async function deactivateEndorsement(client: CriticomClient, id: string) {
  const { data, error } = await client
    .from('endorsements').update({ is_active: false }).eq('id', id).select().single();
  if (error) throw error;
  return data;
}
