import type { CriticomClient, Database, Silo } from '@criticom/db';

type ReportingLine = Database['public']['Tables']['reporting_lines']['Row'];

/** All manual reporting overrides for a department. */
export async function listReportingLines(client: CriticomClient, silo: Silo): Promise<ReportingLine[]> {
  const { data, error } = await client.from('reporting_lines').select('*').eq('silo', silo);
  if (error) throw error;
  return data ?? [];
}

/**
 * RosterViewController-style pin: set (or clear) who a member reports to.
 * managerKind/managerId null ⇒ pinned to the top of the chain.
 */
export async function setReportingLine(
  client: CriticomClient,
  args: {
    silo: Silo; memberKind: 'user' | 'staff'; memberId: string;
    managerKind: 'user' | 'staff' | null; managerId: string | null; updatedBy?: string;
  },
) {
  const { data, error } = await client
    .from('reporting_lines')
    .upsert({
      silo: args.silo, member_kind: args.memberKind, member_id: args.memberId,
      manager_kind: args.managerKind, manager_id: args.managerId,
      updated_by: args.updatedBy ?? null, updated_at: new Date().toISOString(),
    }, { onConflict: 'member_kind,member_id' })
    .select().single();
  if (error) throw error;
  return data;
}

/** Remove an override so the member reverts to the inferred chain. */
export async function clearReportingLine(
  client: CriticomClient,
  args: { memberKind: 'user' | 'staff'; memberId: string },
) {
  const { error } = await client
    .from('reporting_lines')
    .delete()
    .eq('member_kind', args.memberKind)
    .eq('member_id', args.memberId);
  if (error) throw error;
}
