import { NextResponse } from 'next/server';
import { PDFDocument } from 'pdf-lib';
import { getServerSupabase } from '@/lib/supabase';
import { enforceRateLimit } from '@/lib/rate-limit';

/**
 * A certificate, always as a PDF: a PDF upload as it is, a photo or scan
 * (JPG, PNG) placed on an A4 page. Opened in the browser to view, or saved
 * with ?download=1. Read under the person's own session, so only someone
 * the certificate's storage rules allow (the person, their command, the
 * administrators) gets it.
 */
export const dynamic = 'force-dynamic';

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 36;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  const limited = await enforceRateLimit(supabase, 'pdf');
  if (limited) return limited;

  const { data: cert } = await supabase.from('certifications')
    .select('id, name, file_path, personnel:personnel_id (first_name, last_name)')
    .eq('id', id).maybeSingle();
  if (!cert?.file_path) return NextResponse.json({ error: 'No certificate uploaded.' }, { status: 404 });
  const { data: file, error } = await supabase.storage.from('certifications').download(cert.file_path);
  if (error || !file) return NextResponse.json({ error: 'You may not open this certificate.' }, { status: 403 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  let pdf: Uint8Array;
  const lower = cert.file_path.toLowerCase();
  if (file.type === 'application/pdf' || lower.endsWith('.pdf')) {
    pdf = bytes;
  } else {
    const doc = await PDFDocument.create();
    const image = file.type === 'image/png' || lower.endsWith('.png') ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    // Landscape scans go on a landscape page.
    const [w, h] = image.width > image.height ? [A4[1], A4[0]] : A4;
    const page = doc.addPage([w, h]);
    const scale = Math.min((w - MARGIN * 2) / image.width, (h - MARGIN * 2) / image.height, 1);
    const dw = image.width * scale;
    const dh = image.height * scale;
    page.drawImage(image, { x: (w - dw) / 2, y: (h - dh) / 2, width: dw, height: dh });
    doc.setTitle(cert.name);
    pdf = await doc.save();
  }

  const person = cert.personnel as { first_name?: string; last_name?: string } | null;
  const name = `${[person?.first_name, person?.last_name, cert.name].filter(Boolean).join(' ')}`.replace(/[^\w -]+/g, '').trim() || 'certificate';
  const download = new URL(req.url).searchParams.get('download') === '1';
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${name}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
