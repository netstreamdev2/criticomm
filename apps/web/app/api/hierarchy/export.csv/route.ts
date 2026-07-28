import { NextResponse } from 'next/server';
import { listPersonnel, listAllProfiles, listReportingLines } from '@criticom/api';
import type { Silo } from '@criticom/db';
import { getServerSupabase } from '@/lib/supabase';
import { DEPARTMENTS, TIER_LABEL, keyOf, buildMembers, resolveParents } from '@/lib/org';

/** Export the department org chart (member → manager) as CSV. */
export const dynamic = 'force-dynamic';

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: Request) {
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const deptParam = new URL(req.url).searchParams.get('dept');
  const dept = (DEPARTMENTS.find((d) => d.silo === deptParam)?.silo ?? 'MetroPolice') as Exclude<Silo, 'Ethekwini'>;

  const [personnel, profiles, reportingLines] = await Promise.all([
    listPersonnel(supabase, dept),
    listAllProfiles(supabase, dept),
    listReportingLines(supabase, dept).catch(() => []),
  ]);

  const overrides = new Map<string, string | null>();
  for (const r of reportingLines) {
    overrides.set(
      keyOf(r.member_kind, r.member_id),
      r.manager_kind && r.manager_id ? keyOf(r.manager_kind, r.manager_id) : null,
    );
  }

  const members = buildMembers(profiles, personnel, overrides);
  const parents = resolveParents(members, overrides);
  const nameByKey = new Map(members.map((m) => [keyOf(m.kind, m.id), m.name]));

  const headers = ['Name', 'Rank', 'Tier', 'Badge', 'Station', 'Unit', 'On duty', 'Reports to', 'Reporting line'];
  const lines = [headers.join(',')];
  for (const m of members) {
    const mk = keyOf(m.kind, m.id);
    const pk = parents.get(mk) ?? null;
    lines.push([
      m.name, m.rank, TIER_LABEL[m.tier], m.badge ?? '', m.station ?? '', m.unit ?? '',
      m.onDuty ? 'Yes' : 'No',
      pk ? (nameByKey.get(pk) ?? '') : '— (top of chain)',
      m.pinned ? 'Pinned' : 'Inferred',
    ].map(csvCell).join(','));
  }

  return new NextResponse(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="hierarchy-${dept}-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
