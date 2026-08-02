import type { CriticomClient, Database, Silo } from '@criticom/db';

type Incident = Database['public']['Tables']['incidents']['Row'];
type Kpi = Database['public']['Tables']['performance_kpis']['Row'];
type Plan = Database['public']['Tables']['performance_plans']['Row'];
type Score = Database['public']['Tables']['performance_scores']['Row'];

// ── Annual cycle helpers (PerformanceCycle: 1 Jul → 30 Jun) ──────────
export function cycleYearFor(date = new Date()): number {
  return date.getMonth() >= 6 ? date.getFullYear() : date.getFullYear() - 1;
}
export function cycleLabel(cycleYear: number): string {
  return `${cycleYear}/${String((cycleYear + 1) % 100).padStart(2, '0')}`;
}

const UNASSIGNED = 'Unassigned';
const name = (v: string | null | undefined) => (v && v.trim() ? v.trim() : UNASSIGNED);
const minutesBetween = (a: string, b: string) => (new Date(a).getTime() - new Date(b).getTime()) / 60000;
const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : 0);

// ── KPI CONFIG (PerformanceController.Kpis / AddKpi / DeactivateKpi) ──
export async function listKpis(client: CriticomClient, cycleYear: number, silo?: Silo): Promise<Kpi[]> {
  let q = client.from('performance_kpis').select('*').eq('cycle_year', cycleYear).eq('is_active', true);
  if (silo) q = q.eq('silo', silo);
  const { data, error } = await q.order('weight', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function addKpi(client: CriticomClient, input: Database['public']['Tables']['performance_kpis']['Insert']) {
  const { data, error } = await client.from('performance_kpis').insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function deactivateKpi(client: CriticomClient, id: string) {
  const { error } = await client.from('performance_kpis').update({ is_active: false }).eq('id', id);
  if (error) throw error;
}

// ── PLANS + SCORES (Plans / Plan / SaveScore / ApproveStage) ─────────
export async function listPlans(
  client: CriticomClient,
  args: { cycleYear: number; silo?: Silo; department?: string },
): Promise<Plan[]> {
  let q = client.from('performance_plans').select('*').eq('cycle_year', args.cycleYear);
  if (args.silo) q = q.eq('silo', args.silo);
  if (args.department) q = q.eq('department', args.department);
  const { data, error } = await q.order('employee_name');
  if (error) throw error;
  return data ?? [];
}

export async function getPlan(client: CriticomClient, id: string) {
  const { data, error } = await client.from('performance_plans').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

export async function getPlanScores(client: CriticomClient, planId: string): Promise<Score[]> {
  const { data, error } = await client
    .from('performance_scores').select('*').eq('plan_id', planId).order('scored_at');
  if (error) throw error;
  return data ?? [];
}

/** Ensure a plan exists for a member in a cycle (auto-generated in V4). */
export async function ensurePlan(
  client: CriticomClient,
  args: { silo: Silo; userId: string; employeeName?: string; badgeNumber?: string; department?: string; cycleYear: number },
): Promise<Plan> {
  const { data: existing } = await client
    .from('performance_plans').select('*')
    .eq('user_id', args.userId).eq('cycle_year', args.cycleYear).maybeSingle();
  if (existing) return existing;
  const { data, error } = await client
    .from('performance_plans')
    .insert({
      silo: args.silo, user_id: args.userId, employee_name: args.employeeName ?? null,
      badge_number: args.badgeNumber ?? null, department: args.department ?? null,
      cycle_year: args.cycleYear, status: 'Active',
    })
    .select().single();
  if (error) throw error;
  return data;
}

/** PerformanceController.SaveScore — upsert a stage score for one KPI. */
export async function saveScore(
  client: CriticomClient,
  args: {
    silo: Silo; planId: string; kpiId: string; kpiTitle: string;
    stage: 'MidYear' | 'Final'; score: number; comments?: string; evidence?: string; scoredBy?: string;
  },
) {
  const { data: existing } = await client
    .from('performance_scores').select('id')
    .eq('plan_id', args.planId).eq('kpi_id', args.kpiId).eq('stage', args.stage).maybeSingle();

  const payload = {
    silo: args.silo, plan_id: args.planId, kpi_id: args.kpiId, kpi_title: args.kpiTitle,
    stage: args.stage, score: args.score, comments: args.comments ?? null,
    evidence: args.evidence ?? null, scored_by: args.scoredBy ?? null, scored_at: new Date().toISOString(),
  };
  if (existing) {
    const { data, error } = await client.from('performance_scores').update(payload).eq('id', existing.id).select().single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await client.from('performance_scores').insert(payload).select().single();
  if (error) throw error;
  return data;
}

/** PerformanceController.ApproveStage — approve all scores at a stage and advance the plan. */
export async function approveStage(
  client: CriticomClient,
  args: { planId: string; stage: 'MidYear' | 'Final'; approvedBy?: string },
) {
  const { error: scoreErr } = await client
    .from('performance_scores')
    .update({ approved: true, approved_by: args.approvedBy ?? null, approved_at: new Date().toISOString() })
    .eq('plan_id', args.planId).eq('stage', args.stage);
  if (scoreErr) throw scoreErr;

  const nextStatus = args.stage === 'MidYear' ? 'MidYearApproved' : 'Completed';
  const { data, error } = await client
    .from('performance_plans').update({ status: nextStatus }).eq('id', args.planId).select().single();
  if (error) throw error;
  return data;
}

// ── OPERATIONAL KPIs (OperationalKpiService) ─────────────────────────
export type OperatorStat = {
  operator: string; total: number; dispatched: number; closed: number;
  avgDispatchMinutes: number; avgResolutionMinutes: number; topCategory: string; topRegion: string;
  dispatchRate: number;
};
export type CategoryPivotRow = { category: string; subCategory: string; region: string; total: number };
export type CallDetailRow = {
  incidentNumber: string; incidentDate: string; category: string; subCategory: string;
  callerName: string; region: string; operator: string; dispatcher: string; respondingOfficer: string;
  status: string; dispatchMinutes: number | null; resolutionMinutes: number | null;
};

function topOf(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = UNASSIGNED, bestN = -1;
  for (const [k, n] of counts) if (n > bestN) { best = k; bestN = n; }
  return best;
}

function buildOperatorStats(rows: Incident[], pick: (r: Incident) => string | null | undefined): OperatorStat[] {
  const groups = new Map<string, Incident[]>();
  for (const r of rows) {
    const key = name(pick(r));
    if (key === UNASSIGNED) continue;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }
  return [...groups.entries()]
    .map(([operator, g]) => {
      const dispatched = g.filter((r) => r.dispatch_time);
      const closed = g.filter((r) => r.closed_at);
      return {
        operator,
        total: g.length,
        dispatched: dispatched.length,
        closed: closed.length,
        avgDispatchMinutes: avg(dispatched.map((r) => minutesBetween(r.dispatch_time!, r.incident_created_at))),
        avgResolutionMinutes: avg(closed.map((r) => minutesBetween(r.closed_at!, r.incident_created_at))),
        topCategory: topOf(g.map((r) => name(r.incident_category))),
        topRegion: topOf(g.map((r) => name(r.region))),
        dispatchRate: g.length ? Math.round((dispatched.length / g.length) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => b.total - a.total);
}

export type OperationalKpis = {
  from: string; to: string;
  departments: string[]; regions: string[];
  totals: {
    totalCalls: number; dispatched: number; closed: number; stillOpen: number;
    distinctCallTakers: number; distinctDispatchers: number;
    avgDispatchMinutes: number; avgResolutionMinutes: number;
    dispatchRate: number; closureRate: number;
  };
  callTakers: OperatorStat[];
  dispatchers: OperatorStat[];
  categoryPivot: CategoryPivotRow[];
  callDetail: CallDetailRow[];
  callDetailTotal: number;
  logons: Array<{ logDate: string; userName: string; department: string; comments: string }>;
};

/** OperationalKpiService.Build — the control-room KPI console. */
export async function getOperationalKpis(
  client: CriticomClient,
  args: { from: string; to: string; department?: string; region?: string; detailLimit?: number },
): Promise<OperationalKpis> {
  let q = client
    .from('incidents')
    .select('*')
    .gte('incident_created_at', args.from)
    .lt('incident_created_at', args.to);
  if (args.department && args.department !== 'All') q = q.eq('silo', args.department as Silo);
  if (args.region && args.region !== 'All') q = q.eq('region', args.region);
  const { data: rowsRaw, error } = await q;
  if (error) throw error;
  const rows = rowsRaw ?? [];

  const dispatched = rows.filter((r) => r.dispatch_time);
  const closed = rows.filter((r) => r.closed_at);

  // Distinct departments + regions for the filter dropdowns (unfiltered by dept/region).
  const { data: dims } = await client.from('incidents').select('silo, region');
  const departments = [...new Set((dims ?? []).map((d) => d.silo))].sort();
  const regions = [...new Set((dims ?? []).map((d) => d.region).filter(Boolean))].sort() as string[];

  // Category pivot (Metpol Pivot Report grain).
  const pivotMap = new Map<string, CategoryPivotRow>();
  for (const r of rows) {
    const category = name(r.incident_category);
    const subCategory = name(r.incident_type);
    const region = name(r.region);
    const key = `${category}|${subCategory}|${region}`;
    const row = pivotMap.get(key) ?? { category, subCategory, region, total: 0 };
    row.total++;
    pivotMap.set(key, row);
  }

  const detailLimit = args.detailLimit ?? 200;
  const callDetail: CallDetailRow[] = rows
    .slice()
    .sort((a, b) => new Date(b.incident_created_at).getTime() - new Date(a.incident_created_at).getTime())
    .slice(0, detailLimit)
    .map((r) => ({
      incidentNumber: r.incident_number,
      incidentDate: r.incident_created_at,
      category: name(r.incident_category),
      subCategory: r.incident_type,
      callerName: r.caller_name,
      region: name(r.region),
      operator: name(r.call_taken_by),
      dispatcher: name(r.dispatched_by),
      respondingOfficer: r.responding_officer ?? UNASSIGNED,
      status: r.status,
      dispatchMinutes: r.dispatch_time ? Math.round(minutesBetween(r.dispatch_time, r.incident_created_at) * 10) / 10 : null,
      resolutionMinutes: r.closed_at ? Math.round(minutesBetween(r.closed_at, r.incident_created_at) * 10) / 10 : null,
    }));

  // Logons from the audit trail (User Logon Report-CCTV grain).
  let logonQ = client
    .from('audit_logs')
    .select('timestamp, user_name, silo')
    .eq('action_type', 'Logon')
    .gte('timestamp', args.from)
    .lt('timestamp', args.to)
    .order('timestamp', { ascending: false })
    .limit(500);
  const { data: logonRows } = await logonQ;
  const logons = (logonRows ?? []).map((a) => ({
    logDate: a.timestamp, userName: a.user_name ?? UNASSIGNED, department: a.silo, comments: 'Signed in',
  }));

  return {
    from: args.from,
    to: args.to,
    departments,
    regions,
    totals: {
      totalCalls: rows.length,
      dispatched: dispatched.length,
      closed: closed.length,
      stillOpen: rows.length - closed.length,
      distinctCallTakers: new Set(rows.map((r) => name(r.call_taken_by)).filter((n) => n !== UNASSIGNED)).size,
      distinctDispatchers: new Set(dispatched.map((r) => name(r.dispatched_by)).filter((n) => n !== UNASSIGNED)).size,
      avgDispatchMinutes: avg(dispatched.map((r) => minutesBetween(r.dispatch_time!, r.incident_created_at))),
      avgResolutionMinutes: avg(closed.map((r) => minutesBetween(r.closed_at!, r.incident_created_at))),
      dispatchRate: rows.length ? Math.round((dispatched.length / rows.length) * 1000) / 10 : 0,
      closureRate: rows.length ? Math.round((closed.length / rows.length) * 1000) / 10 : 0,
    },
    callTakers: buildOperatorStats(rows, (r) => r.call_taken_by),
    dispatchers: buildOperatorStats(dispatched, (r) => r.dispatched_by),
    categoryPivot: [...pivotMap.values()].sort(
      (a, b) => a.category.localeCompare(b.category) || a.subCategory.localeCompare(b.subCategory),
    ),
    callDetail,
    callDetailTotal: rows.length,
    logons,
  };
}

/** PerformanceController.Mine — one member's throughput + appraisal snapshot. */
export async function getMyPerformance(
  client: CriticomClient,
  args: { from: string; to: string; displayName: string; userId: string; silo: Silo },
) {
  const { data: rowsRaw } = await client
    .from('incidents').select('*')
    .gte('incident_created_at', args.from).lt('incident_created_at', args.to);
  const rows = rowsRaw ?? [];
  const isMe = (v: string | null | undefined) =>
    !!v && v.trim().toLowerCase() === args.displayName.trim().toLowerCase();

  const taken = rows.filter((r) => isMe(r.call_taken_by));
  const dispatched = rows.filter((r) => isMe(r.dispatched_by));
  const attended = rows.filter((r) => isMe(r.responding_officer));

  const stat = (g: Incident[], label: string): OperatorStat => {
    const disp = g.filter((r) => r.dispatch_time);
    const closed = g.filter((r) => r.closed_at);
    return {
      operator: label, total: g.length, dispatched: disp.length, closed: closed.length,
      avgDispatchMinutes: avg(disp.map((r) => minutesBetween(r.dispatch_time!, r.incident_created_at))),
      avgResolutionMinutes: avg(closed.map((r) => minutesBetween(r.closed_at!, r.incident_created_at))),
      topCategory: topOf(g.map((r) => name(r.incident_category))),
      topRegion: topOf(g.map((r) => name(r.region))),
      dispatchRate: g.length ? Math.round((disp.length / g.length) * 1000) / 10 : 0,
    };
  };

  // Team ranking by call volume.
  const perTaker = new Map<string, number>();
  for (const r of rows) {
    const key = name(r.call_taken_by);
    if (key !== UNASSIGNED) perTaker.set(key, (perTaker.get(key) ?? 0) + 1);
  }
  const ranked = [...perTaker.entries()].sort((a, b) => b[1] - a[1]);
  const rankByVolume = ranked.findIndex(([k]) => isMe(k)) + 1;

  // Monthly trend (this member's call-taking).
  const monthly = new Map<string, number>();
  for (const r of taken) {
    const key = r.incident_created_at.slice(0, 7);
    monthly.set(key, (monthly.get(key) ?? 0) + 1);
  }

  // My category breakdown.
  const cat = new Map<string, CategoryPivotRow>();
  for (const r of taken) {
    const category = name(r.incident_category);
    const subCategory = name(r.incident_type);
    const region = name(r.region);
    const key = `${category}|${subCategory}|${region}`;
    const row = cat.get(key) ?? { category, subCategory, region, total: 0 };
    row.total++;
    cat.set(key, row);
  }

  // Appraisal snapshot.
  const cycleYear = cycleYearFor();
  const { data: plan } = await client
    .from('performance_plans').select('*')
    .eq('user_id', args.userId).eq('cycle_year', cycleYear).maybeSingle();
  let appraisal: Array<{ kpiTitle: string; midYearScore: number | null; finalScore: number | null; approved: boolean }> = [];
  let midYearAverage: number | null = null;
  let finalAverage: number | null = null;
  if (plan) {
    const scores = await getPlanScores(client, plan.id);
    const byKpi = new Map<string, { mid?: Score; fin?: Score }>();
    for (const s of scores) {
      const e = byKpi.get(s.kpi_title ?? s.kpi_id ?? '') ?? {};
      if (s.stage === 'MidYear') e.mid = s;
      else e.fin = s;
      byKpi.set(s.kpi_title ?? s.kpi_id ?? '', e);
    }
    appraisal = [...byKpi.entries()].map(([title, e]) => ({
      kpiTitle: title,
      midYearScore: e.mid?.score ?? null,
      finalScore: e.fin?.score ?? null,
      approved: Boolean(e.fin?.approved ?? e.mid?.approved),
    }));
    const mids = appraisal.map((a) => a.midYearScore).filter((s): s is number => s != null);
    const fins = appraisal.map((a) => a.finalScore).filter((s): s is number => s != null);
    midYearAverage = mids.length ? Math.round((mids.reduce((s, x) => s + x, 0) / mids.length) * 10) / 10 : null;
    finalAverage = fins.length ? Math.round((fins.reduce((s, x) => s + x, 0) / fins.length) * 10) / 10 : null;
  }

  return {
    asCallTaker: stat(taken, 'As call taker'),
    asDispatcher: stat(dispatched, 'As dispatcher'),
    asResponder: stat(attended, 'As responder'),
    teamAvgCallsTaken: ranked.length ? Math.round((ranked.reduce((s, [, n]) => s + n, 0) / ranked.length) * 10) / 10 : 0,
    rankByVolume: rankByVolume > 0 ? rankByVolume : ranked.length + 1,
    teamSize: ranked.length,
    monthlyTrend: [...monthly.entries()].sort().map(([label, count]) => ({ label, count })),
    myCategoryBreakdown: [...cat.values()].sort((a, b) => b.total - a.total),
    hasPlan: Boolean(plan),
    cycleYear,
    cycleLabel: cycleLabel(cycleYear),
    planStatus: plan?.status ?? null,
    appraisal,
    midYearAverage,
    finalAverage,
  };
}

/** PerformanceController.RoleKpis — control-room role member throughput. */
export async function getRoleKpis(
  client: CriticomClient,
  args: { role: string; from: string; to: string },
) {
  const { data: profiles } = await client
    .from('profiles').select('id, full_name, email')
    .eq('role', args.role as Database['public']['Enums']['user_role']);
  const members = profiles ?? [];

  const { data: rowsRaw } = await client
    .from('incidents').select('*')
    .gte('incident_created_at', args.from).lt('incident_created_at', args.to);
  const rows = rowsRaw ?? [];

  const { data: logonRows } = await client
    .from('audit_logs').select('user_name')
    .eq('action_type', 'Logon').gte('timestamp', args.from).lt('timestamp', args.to);
  const logonCount = new Map<string, number>();
  for (const l of logonRows ?? []) {
    const k = (l.user_name ?? '').toLowerCase();
    logonCount.set(k, (logonCount.get(k) ?? 0) + 1);
  }

  return members.map((m) => {
    const label = m.full_name ?? m.email ?? '';
    const isMe = (v: string | null | undefined) => !!v && v.trim().toLowerCase() === label.trim().toLowerCase();
    const taken = rows.filter((r) => isMe(r.call_taken_by));
    const dispatched = rows.filter((r) => isMe(r.dispatched_by));
    const closed = rows.filter((r) => isMe(r.dispatched_by) && r.closed_at);
    return {
      name: label,
      email: m.email ?? '',
      callsTaken: taken.length,
      dispatched: dispatched.length,
      closed: closed.length,
      avgResponseMinutes: avg(dispatched.filter((r) => r.dispatch_time).map((r) => minutesBetween(r.dispatch_time!, r.incident_created_at))),
      logons: logonCount.get((m.email ?? label).toLowerCase()) ?? logonCount.get(label.toLowerCase()) ?? 0,
    };
  }).sort((a, b) => b.callsTaken - a.callsTaken);
}
export * from './rollup.ts';
