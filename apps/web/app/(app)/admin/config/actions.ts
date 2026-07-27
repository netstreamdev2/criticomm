'use server';

import { revalidatePath } from 'next/cache';
import { addConfigRecord, toggleConfigStatus, logAudit, type ConfigModule } from '@criticom/api';
import { ADMIN_ROLES } from '@criticom/db';
import { getSession } from '@/lib/session';

async function requireAdmin() {
  const session = await getSession();
  if (!ADMIN_ROLES.includes(session.role)) throw new Error('Forbidden');
  return session;
}

export async function addConfigAction(formData: FormData) {
  const { supabase, fullName } = await requireAdmin();
  const module = String(formData.get('module')) as ConfigModule;
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return;

  const record = await addConfigRecord(supabase, {
    module,
    name,
    code: String(formData.get('code') ?? '').trim() || null,
    parent: String(formData.get('parent') ?? '').trim() || null,
    prompts: String(formData.get('prompts') ?? '').trim() || null,
    createdBy: fullName,
  });
  await logAudit(supabase, {
    silo: 'Ethekwini', action_type: 'ConfigAdd', entity_type: 'command_record',
    entity_id: record.id, user_name: fullName, details: `${module}: ${name}`,
  });
  revalidatePath('/admin/config');
}

export async function toggleConfigAction(formData: FormData) {
  const { supabase, fullName } = await requireAdmin();
  const id = String(formData.get('id'));
  const record = await toggleConfigStatus(supabase, id);
  await logAudit(supabase, {
    silo: 'Ethekwini', action_type: 'ConfigStatus', entity_type: 'command_record',
    entity_id: id, user_name: fullName, details: `${record.module}: ${record.name} → ${record.status}`,
  });
  revalidatePath('/admin/config');
}
