import 'server-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getDepartmentBranding } from '@criticom/api';
import type { CriticomClient } from '@criticom/db';

type PdfImage = { bytes: Uint8Array; type: 'png' | 'jpg' };

/**
 * The municipality on a PDF's letterhead: its name, and its crest when one is
 * uploaded. `police`: the DMPS badge beside it, on a police record.
 */
export type PdfBrand = { name: string; logo: PdfImage | null; police?: PdfImage | null };

let policeBadge: Promise<PdfImage | null> | null = null;
/** The Durban Metropolitan Police Service badge (public/images/dmps-badge.png), read once. */
export function loadPoliceBadge(): Promise<PdfImage | null> {
  policeBadge ??= readFile(path.join(process.cwd(), 'public', 'images', 'dmps-badge.png'))
    .then((b) => ({ bytes: new Uint8Array(b), type: 'png' as const }))
    .catch(() => {
      policeBadge = null; // try again next time
      return null;
    });
  return policeBadge;
}

/**
 * The municipality the platform serves (the control room's branding row,
 * eThekwini), for the PDF letterhead beside HikTech's own. The crest is the
 * one an administrator uploaded in Admin → Departments; PDFs take PNG and
 * JPEG, so an SVG or WebP crest leaves the name on its own. Never fails a
 * PDF: with nothing to show, the name alone.
 */
export async function loadPdfBrand(supabase: CriticomClient, opts: { police?: boolean } = {}): Promise<PdfBrand> {
  const brand = await loadMunicipality(supabase);
  return opts.police ? { ...brand, police: await loadPoliceBadge() } : brand;
}

async function loadMunicipality(supabase: CriticomClient): Promise<PdfBrand> {
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
