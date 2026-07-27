'use server';

import { revalidatePath } from 'next/cache';
import {
  addKpi, deactivateKpi, ensurePlan, saveScore, approveStage, listPlans, logAudit,
  cycleYearFor,
} from '@criticom/api';
import { ADMIN_ROLES, type Silo } from '@criticom/db';
import { getSession } from '@/lib/session';

function canManage(role: string) {
  return ADMIN_ROLES.includes(role as never) || role === 'Supervisor' || role === 'System';
}

export async function addKpiAction(formData: FormData) {
  const { supabase, role, silo, fullName } = await getSession();
  if (!canManage(role)) throw new Error('Forbidden');
  await addKpi(supabase, {
    silo: (silo === 'Ethekwini' ? 'Ethekwini' : silo) as Silo,
    cycle_year: Number(formData.get('cycle_year')) || cycleYearFor(),
    department: String(formData.get('department') ?? '').trim() || null,
    title: String(formData.get('title')),
    description: String(formData.get('description') ?? '').trim() || null,
    weight: Number(formData.get('weight')) || 0,
    is_active: true,
    created_by: fullName,
  });
  revalidatePath('/performance/kpis');
}

export async function deactivateKpiAction(formData: FormData) {
  const { supabase, role } = await getSession();
  if (!canManage(role)) throw new Error('Forbidden');
  await deactivateKpi(supabase, String(formData.get('id')));
  revalidatePath('/performance/kpis');
}

/** Auto-generate plans for every silo member for the current cycle. */
export async function generatePlansAction(formData: FormData) {
  const { supabase, role, silo, fullName } = await getSession();
  if (!canManage(role)) throw new Error('Forbidden');
  const cycleYear = Number(formData.get('cycle_year')) || cycleYearFor();

  const { data: profiles } = await supabase
    .from('profiles').select('id, full_name, badge_number, silo')
    .eq(silo === 'Ethekwini' ? 'id' : 'silo', silo === 'Ethekwini' ? undefined as never : silo);

  const targets = (profiles ?? []).filter((p) => p.id);
  for (const p of targets) {
    await ensurePlan(supabase, {
      silo: (p.silo ?? silo) as Silo,
      userId: p.id,
      employeeName: p.full_name ?? undefined,
      badgeNumber: p.badge_number ?? undefined,
      cycleYear,
    });
  }
  await logAudit(supabase, {
    silo: 'Ethekwini', action_type: 'PerfPlansGenerated', user_name: fullName,
    details: `${targets.length} plans for cycle ${cycleYear}`,
  });
  revalidatePath('/performance/plans');
}

export async function saveScoreAction(formData: FormData) {
  const { supabase, role, silo, fullName } = await getSession();
  if (!canManage(role)) throw new Error('Forbidden');
  const planId = String(formData.get('plan_id'));
  await saveScore(supabase, {
    silo: silo as Silo,
    planId,
    kpiId: String(formData.get('kpi_id')),
    kpiTitle: String(formData.get('kpi_title')),
    stage: String(formData.get('stage')) as 'MidYear' | 'Final',
    score: Number(formData.get('score')) || 0,
    comments: String(formData.get('comments') ?? '').trim() || undefined,
    evidence: String(formData.get('evidence') ?? '').trim() || undefined,
    scoredBy: fullName,
  });
  revalidatePath(`/performance/plans/${planId}`);
}

export async function approveStageAction(formData: FormData) {
  const { supabase, role, fullName } = await getSession();
  if (!canManage(role)) throw new Error('Forbidden');
  const planId = String(formData.get('plan_id'));
  await approveStage(supabase, {
    planId,
    stage: String(formData.get('stage')) as 'MidYear' | 'Final',
    approvedBy: fullName,
  });
  revalidatePath(`/performance/plans/${planId}`);
}
