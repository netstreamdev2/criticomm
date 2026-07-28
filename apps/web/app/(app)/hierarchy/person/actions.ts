'use server';

import { revalidatePath } from 'next/cache';
import { setReportingLine, clearReportingLine, logAudit } from '@criticom/api';
import { ADMIN_ROLES, type Silo } from '@criticom/db';
import { getSession } from '@/lib/session';

const CAN_EDIT = new Set([...ADMIN_ROLES, 'Supervisor', 'Captain', 'FireChief', 'Chief']);

export async function setReportsToAction(formData: FormData) {
  const { supabase, role, fullName } = await getSession();
  if (!CAN_EDIT.has(role)) throw new Error('Forbidden');

  const silo = String(formData.get('silo')) as Silo;
  const memberKind = String(formData.get('member_kind')) as 'user' | 'staff';
  const memberId = String(formData.get('member_id'));
  const choice = String(formData.get('choice')); // 'auto' | 'top' | '<kind>:<id>'

  if (choice === 'auto') {
    await clearReportingLine(supabase, { memberKind, memberId });
  } else if (choice === 'top') {
    await setReportingLine(supabase, { silo, memberKind, memberId, managerKind: null, managerId: null, updatedBy: fullName });
  } else {
    const [mk, mid] = choice.split(':');
    if (mk && mid) {
      await setReportingLine(supabase, {
        silo, memberKind, memberId,
        managerKind: mk as 'user' | 'staff', managerId: mid, updatedBy: fullName,
      });
    }
  }

  await logAudit(supabase, {
    silo, action_type: 'ReportingLineSet', entity_type: 'reporting_line', entity_id: memberId,
    user_name: fullName, details: `reports_to = ${choice}`,
  });
  revalidatePath('/hierarchy');
  revalidatePath(`/hierarchy/person?kind=${memberKind}&id=${memberId}`);
}
