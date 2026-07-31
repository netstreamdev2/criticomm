import type { CriticomClient, Database, Silo } from '@criticom/db';

export type DepartmentBranding = Database['public']['Tables']['department_branding']['Row'];

/**
 * Department identity — official name, colours and crest per silo.
 *
 * Logos are uploaded by administrators into the public `department-logos`
 * bucket; the row stores only the path. Everything here fails safe: if the
 * table is unreachable or a silo has no row, callers get the built-in
 * fallback so the chrome never renders blank.
 */

const FALLBACK: Record<Silo, Omit<DepartmentBranding, 'updated_by' | 'updated_at'>> = {
  Ethekwini: {
    silo: 'Ethekwini', official_name: 'eThekwini Emergency Services', short_name: 'Control Room',
    monogram: 'ES', primary_color: '#64748b', accent_color: '#334155', logo_path: null,
    motto: 'Unified command for the metro',
  },
  MetroPolice: {
    silo: 'MetroPolice', official_name: 'eThekwini Metropolitan Police Service', short_name: 'Metro Police',
    monogram: 'MP', primary_color: '#3b82f6', accent_color: '#1d4ed8', logo_path: null,
    motto: 'Serve and protect',
  },
  MetroFire: {
    silo: 'MetroFire', official_name: 'eThekwini Fire & Emergency Services', short_name: 'Fire & Rescue',
    monogram: 'F&R', primary_color: '#dc3545', accent_color: '#991b1b', logo_path: null,
    motto: 'Courage under fire',
  },
  Medical: {
    silo: 'Medical', official_name: 'eThekwini Emergency Medical Services', short_name: 'EMS',
    monogram: 'EMS', primary_color: '#10b981', accent_color: '#047857', logo_path: null,
    motto: 'Every second counts',
  },
  EthekwiniDisaster: {
    silo: 'EthekwiniDisaster', official_name: 'eThekwini Disaster Management Centre', short_name: 'Disaster Mgmt',
    monogram: 'DM', primary_color: '#f59e0b', accent_color: '#b45309', logo_path: null,
    motto: 'Prepared for the worst',
  },
};

export const ALL_SILOS: Silo[] = [
  'Ethekwini', 'MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster',
];

/** Built-in identity for a silo — used when the table has nothing to say. */
export function fallbackBranding(silo: Silo): DepartmentBranding {
  return { ...FALLBACK[silo], updated_by: null, updated_at: new Date(0).toISOString() };
}

/** Every department's branding, merged over the built-in defaults. */
export async function listDepartmentBranding(
  client: CriticomClient,
): Promise<Record<Silo, DepartmentBranding>> {
  const merged = Object.fromEntries(
    ALL_SILOS.map((s) => [s, fallbackBranding(s)]),
  ) as Record<Silo, DepartmentBranding>;

  try {
    const { data, error } = await client.from('department_branding').select('*');
    if (error) throw error;
    for (const row of data ?? []) {
      if (row.silo in merged) merged[row.silo] = row;
    }
  } catch {
    // Branding is chrome, never a blocker.
  }
  return merged;
}

export async function getDepartmentBranding(
  client: CriticomClient,
  silo: Silo,
): Promise<DepartmentBranding> {
  try {
    const { data, error } = await client
      .from('department_branding').select('*').eq('silo', silo).maybeSingle();
    if (error) throw error;
    if (data) return data;
  } catch { /* fall through */ }
  return fallbackBranding(silo);
}

export async function updateDepartmentBranding(
  client: CriticomClient,
  silo: Silo,
  patch: Partial<Pick<DepartmentBranding,
    'official_name' | 'short_name' | 'monogram' | 'primary_color' | 'accent_color' | 'logo_path' | 'motto'>>
    & { updatedBy?: string },
) {
  const { updatedBy, ...fields } = patch;
  const { data, error } = await client
    .from('department_branding')
    .upsert({
      // Upsert needs the not-null columns present on insert; the fallback
      // supplies anything the caller didn't send.
      ...fallbackBranding(silo),
      ...fields,
      silo,
      updated_by: updatedBy ?? null,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Public URL for an uploaded crest, or null when none is set. */
export function departmentLogoUrl(
  client: CriticomClient,
  branding: Pick<DepartmentBranding, 'logo_path'>,
): string | null {
  if (!branding.logo_path) return null;
  const { data } = client.storage.from('department-logos').getPublicUrl(branding.logo_path);
  return data.publicUrl || null;
}

/** Upload a crest and point the department at it. Returns the storage path. */
export async function uploadDepartmentLogo(
  client: CriticomClient,
  args: { silo: Silo; file: Blob | File; filename: string; updatedBy?: string },
) {
  const ext = args.filename.split('.').pop()?.toLowerCase() ?? 'png';
  // Cache-busting name so an updated crest shows immediately on public URLs.
  const path = `${args.silo}/crest-${Date.now()}.${ext}`;

  const { error: upErr } = await client.storage
    .from('department-logos')
    .upload(path, args.file, { upsert: true, contentType: (args.file as File).type || undefined });
  if (upErr) throw upErr;

  await updateDepartmentBranding(client, args.silo, {
    logo_path: path,
    updatedBy: args.updatedBy,
  });
  return path;
}

export async function clearDepartmentLogo(
  client: CriticomClient,
  silo: Silo,
  updatedBy?: string,
) {
  await updateDepartmentBranding(client, silo, { logo_path: null, updatedBy });
}
