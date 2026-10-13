import 'server-only';
import { getDepartmentBranding } from '@criticom/api';
import type { CriticomClient } from '@criticom/db';

/** The municipality on a PDF's letterhead: its name, and its crest when one is uploaded. */
export type PdfBrand = { name: string; logo: { bytes: Uint8Array; type: 'png' | 'jpg' } | null };

/**
 * The municipality the platform serves (the control room's branding row,
 * eThekwini), for the PDF letterhead beside HikTech's own. The crest is the
 * one an administrator uploaded in Admin → Departments; PDFs take PNG and
 * JPEG, so an SVG or WebP crest leaves the name on its own. Never fails a
 * PDF: with nothing to show, the name alone.
 */
export async function loadPdfBrand(supabase: CriticomClient): Promise<PdfBrand> {
  const row = await getDepartmentBranding(supabase, 'Ethekwini');
  if (!row.logo_path || /\.(svg|webp)$/i.test(row.logo_path)) return { name: row.official_name, logo: null };
  try {
    const { data } = await supabase.storage.from('department-logos').download(row.logo_path);
    if (!data) return { name: row.official_name, logo: null };
    const bytes = new Uint8Array(await data.arrayBuffer());
    // By the file's first bytes, not its name.
    const type = bytes[0] === 0x89 && bytes[1] === 0x50 ? 'png' : bytes[0] === 0xff && bytes[1] === 0xd8 ? 'jpg' : null;
    return { name: row.official_name, logo: type ? { bytes, type } : null };
  } catch {
    return { name: row.official_name, logo: null };
  }
}
