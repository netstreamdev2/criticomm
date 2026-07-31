import 'server-only';
import { listDepartmentBranding, type DepartmentBranding } from '@criticom/api';
import type { Silo } from '@criticom/db';
import { getServerSupabase } from '@/lib/supabase';

export type BrandingMap = Record<Silo, DepartmentBranding & { logoUrl: string | null }>;

/**
 * Department branding for every silo, with public logo URLs resolved.
 *
 * The `department-logos` bucket is public, so the URL is a deterministic
 * string — no signing round trip, and the badge renders in server components
 * without a client fetch.
 */
export async function getBrandingMap(): Promise<BrandingMap> {
  const supabase = await getServerSupabase();
  const branding = await listDepartmentBranding(supabase);

  const entries = Object.entries(branding).map(([silo, b]) => {
    const logoUrl = b.logo_path
      ? supabase.storage.from('department-logos').getPublicUrl(b.logo_path).data.publicUrl || null
      : null;
    return [silo, { ...b, logoUrl }];
  });

  return Object.fromEntries(entries) as BrandingMap;
}
