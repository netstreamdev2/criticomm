'use server';

import { revalidatePath } from 'next/cache';
import { createSection, logAudit, setSectionActive } from '@criticom/api';
import type { Silo } from '@criticom/db';
import { getSession } from '@/lib/session';

export async function createSectionAction(formData: FormData) {
  const { supabase, fullName } = await getSession();
  const section = await createSection(supabase, {
    silo: (String(formData.get('silo')) || 'MetroPolice') as Silo,
    code: String(formData.get('code') ?? ''),
    name: String(formData.get('name') ?? '').trim(),
    region: String(formData.get('region') ?? '').trim() || undefined,
  });
  await logAudit(supabase, {
    silo: section.silo, action_type: 'SectionCreated', entity_type: 'section',
    entity_id: section.id, user_name: fullName, details: `${section.code} ${section.name}`,
  }).catch(() => {});
  revalidatePath('/admin/sections');
}

export async function setSectionActiveAction(formData: FormData) {
  const { supabase, fullName } = await getSession();
  const id = String(formData.get('id'));
  const active = formData.get('active') === 'true';
  await setSectionActive(supabase, { id, active });
  await logAudit(supabase, {
    silo: 'MetroPolice', action_type: active ? 'SectionActivated' : 'SectionRetired',
    entity_type: 'section', entity_id: id, user_name: fullName,
  }).catch(() => {});
  revalidatePath('/admin/sections');
}
