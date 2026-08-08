'use server';

import { revalidatePath } from 'next/cache';
import { allowModule, denyModule, logAudit } from '@criticom/api';
import { getSession } from '@/lib/session';
import { getServiceSupabase } from '@/lib/supabase';

/**
 * Access Control writes. SuperAdmin only, service role for cross-tenant
 * administration — the role check happens BEFORE the elevated client exists,
 * matching the tenant console.
 *
 * Rules are deny-only: "deny" writes a row, "allow" deletes it and the
 * module falls back to whatever the code's route matrix says. There is no
 * way to grant beyond the matrix from here, by design.
 */

async function requireSuperAdmin() {
  const session = await getSession();
  if (session.role !== 'SuperAdmin') throw new Error('SuperAdmin only.');
  return session;
}

export async function setModuleAccessAction(formData: FormData): Promise<void> {
  const { supabase, fullName } = await requireSuperAdmin();
  const service = getServiceSupabase();

  const tenantId = String(formData.get('tenant_id') ?? '');
  const href = String(formData.get('href') ?? '');
  const role = String(formData.get('role') ?? '*') || '*';
  const deny = formData.get('deny') === 'true';
  if (!tenantId || !href.startsWith('/')) throw new Error('Bad module reference.');

  if (deny) {
    await denyModule(service, { tenantId, href, role, byName: fullName });
  } else {
    await allowModule(service, { tenantId, href, role });
  }

  await logAudit(supabase, {
    silo: 'Ethekwini',
    action_type: deny ? 'ModuleAccessDenied' : 'ModuleAccessRestored',
    entity_type: 'access_rule',
    user_name: fullName,
    details: `${href} for ${role === '*' ? 'all roles' : role} (tenant ${tenantId})`,
  }).catch(() => {});

  revalidatePath('/admin/access');
  revalidatePath('/', 'layout');
}
