'use server';

import { revalidatePath } from 'next/cache';
import { logAudit, updateDepartmentBranding } from '@criticom/api';
import { ADMIN_ROLES, type Silo } from '@criticom/db';
import { getSession } from '@/lib/session';

const SILOS: Silo[] = ['Ethekwini', 'MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster'];
const HEX = /^#[0-9a-fA-F]{6}$/;

async function requireAdmin() {
  const session = await getSession();
  if (!ADMIN_ROLES.includes(session.role)) throw new Error('Forbidden');
  return session;
}

export async function saveBrandingAction(formData: FormData) {
  const { supabase, fullName } = await requireAdmin();
  const silo = String(formData.get('silo') ?? '') as Silo;
  if (!SILOS.includes(silo)) return { error: 'Unknown department.' };

  const primary = String(formData.get('primary_color') ?? '').trim();
  const accent = String(formData.get('accent_color') ?? '').trim();
  if (!HEX.test(primary) || !HEX.test(accent)) {
    return { error: 'Colours must be 6-digit hex, e.g. #3b82f6.' };
  }

  const officialName = String(formData.get('official_name') ?? '').trim();
  const shortName = String(formData.get('short_name') ?? '').trim();
  const monogram = String(formData.get('monogram') ?? '').trim().slice(0, 4);
  if (!officialName || !shortName || !monogram) {
    return { error: 'Official name, short name and monogram are all required.' };
  }

  await updateDepartmentBranding(supabase, silo, {
    official_name: officialName,
    short_name: shortName,
    monogram: monogram.toUpperCase(),
    primary_color: primary,
    accent_color: accent,
    motto: String(formData.get('motto') ?? '').trim() || null,
    updatedBy: fullName,
  });

  await logAudit(supabase, {
    silo: 'Ethekwini', action_type: 'BrandingUpdated', entity_type: 'department_branding',
    entity_id: silo, user_name: fullName, details: `${shortName} identity updated`,
  }).catch(() => {});

  revalidatePath('/admin/departments');
  revalidatePath('/dashboard');
  return { ok: true };
}

export async function clearLogoAction(formData: FormData) {
  const { supabase, fullName } = await requireAdmin();
  const silo = String(formData.get('silo') ?? '') as Silo;
  if (!SILOS.includes(silo)) return;

  await updateDepartmentBranding(supabase, silo, { logo_path: null, updatedBy: fullName });
  await logAudit(supabase, {
    silo: 'Ethekwini', action_type: 'BrandingLogoCleared', entity_type: 'department_branding',
    entity_id: silo, user_name: fullName, details: `${silo} crest removed`,
  }).catch(() => {});

  revalidatePath('/admin/departments');
}
