'use server';

import { revalidatePath } from 'next/cache';
import { saveReportTemplate } from '@criticom/api';
import { getSession } from '@/lib/session';

export async function saveTemplateAction(formData: FormData) {
  const { supabase, userId, fullName } = await getSession();
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return;
  const payload = {
    q: String(formData.get('q') ?? ''),
    status: String(formData.get('status') ?? ''),
    silo: String(formData.get('silo') ?? ''),
    category: String(formData.get('category') ?? ''),
    region: String(formData.get('region') ?? ''),
    from: String(formData.get('from') ?? ''),
    to: String(formData.get('to') ?? ''),
  };
  await saveReportTemplate(supabase, { userId, name, payload, createdBy: fullName });
  revalidatePath('/report-hub');
}
