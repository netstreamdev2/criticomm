import { NextResponse, type NextRequest } from 'next/server';
import { getFireInspection } from '@criticom/api';
import { daysWords } from '@criticom/db/fire-inspection';
import { getServerSupabase } from '@/lib/supabase';
import { getBrandingMap } from '@/lib/branding';
import { escapeHtml as e, formatSaTime } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * The compliance notice as the owner is served it (eThekwini Fire By-law,
 * 2022, s.81): what was found, the section, what to do and by when, and what
 * follows if it is not done; an instruction (s.76) in writing; how to appeal
 * (s.87). Printed from the console; RLS decides whether the inspection is
 * visible. The crest is the one an administrator uploaded, never shipped.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL(`/login?next=/fire/inspections/${encodeURIComponent(id)}/notice`, request.url));
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse('Not found.', { status: 404 });
  const row = await getFireInspection(supabase, id).catch(() => null);
  if (!row) return new NextResponse('Inspection not found, or not yours to see.', { status: 404 });

  const brand = await getBrandingMap().catch(() => null);
  const crest = brand?.Ethekwini?.logoUrl ?? null;
  const service = brand?.MetroFire?.official_name ?? 'Fire & Emergency Services';
  const items = row.notice_items ?? [];

  const findings = items.length ? `
    <table>
      <thead><tr><th>What was found</th><th>By-law</th><th>What must be done</th><th>Time given</th></tr></thead>
      <tbody>${items.map((n) => `<tr><td>Not in order: ${e(n.label)}</td><td>${e(n.section)}</td><td>${e(n.remedy)}</td><td>${e(daysWords(n.days))}</td></tr>`).join('')}</tbody>
    </table>` : '';
  const instruction = row.instruction ? `
    <div class="instruction">
      <h2>Instruction: ${e(row.instruction)}, with immediate effect (s.76)</h2>
      <p>${e(row.instruction_reason ?? '')}</p>
      <p>This is the written confirmation of the instruction given on site. It stands until the contravention is put right and the Chief Fire Officer is satisfied; where it cannot be put right at once, give the Chief Fire Officer an action plan (s.76(5)).</p>
    </div>` : '';

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${e(row.inspection_ref ?? 'Compliance notice')}</title>
<style>
  body { font-family: -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; color: #0f172a; margin: 0; }
  .page { max-width: 186mm; margin: 0 auto; padding: 14mm 0; font-size: 12.5px; line-height: 1.5; }
  .head { display: flex; align-items: center; gap: 14px; border-bottom: 2px solid #0f172a; padding-bottom: 10px; }
  .head img { height: 56px; }
  .head h1 { margin: 0; font-size: 20px; letter-spacing: .5px; }
  .head p { margin: 2px 0 0; color: #334155; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 18px; margin: 12px 0; }
  .grid b { display: inline-block; min-width: 110px; }
  table { width: 100%; border-collapse: collapse; margin: 10px 0; }
  th, td { border: 1px solid #94a3b8; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #f1f5f9; font-size: 11px; text-transform: uppercase; }
  .instruction { border: 2px solid #b91c1c; padding: 8px 12px; margin: 10px 0; }
  .instruction h2 { color: #b91c1c; font-size: 15px; margin: 0 0 4px; }
  .due { font-size: 14px; font-weight: 700; margin: 10px 0; }
  .sign { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; margin-top: 28px; }
  .sign div { border-top: 1px solid #0f172a; padding-top: 4px; }
  .small { color: #475569; font-size: 11.5px; }
  .bar { max-width: 186mm; margin: 12px auto 0; display: flex; justify-content: flex-end; }
  .bar button { font: inherit; font-size: 13px; font-weight: 700; padding: 8px 14px; border-radius: 6px; border: 1px solid #0f172a; background: #0f172a; color: #fff; cursor: pointer; }
  @media print { .bar { display: none; } .page { padding-top: 0; } }
</style></head><body>
<div class="bar"><button type="button" onclick="window.print()">Print</button></div>
<div class="page">
  <div class="head">
    ${crest ? `<img src="${e(crest)}" alt="">` : ''}
    <div><h1>COMPLIANCE NOTICE</h1><p>${e(service)} · eThekwini Fire By-law, 2022, section 81</p></div>
  </div>
  <div class="grid">
    <div><b>Notice number</b> ${e(row.inspection_ref ?? '')}</div>
    <div><b>Date</b> ${e(formatSaTime(row.inspected_at))}</div>
    <div><b>Premises</b> ${e(row.business_name)}</div>
    <div><b>Address</b> ${e(row.address)}</div>
    <div><b>Served on</b> ${e(row.person_in_charge ?? 'The owner or person in charge')}</div>
    <div><b>Served by</b> ${e(row.served ?? '')}</div>
  </div>
  <p>An authorised official inspected these premises under the eThekwini Fire By-law, 2022 and found the following. You are required to put each item right within the time given.</p>
  ${findings}
  ${instruction}
  ${row.comply_by ? `<p class="due">Put right by: ${e(row.comply_by)}. The premises will be inspected again on or after ${e(row.reinspect_on ?? row.comply_by)}.</p>` : ''}
  <p><b>If this notice is not complied with:</b> failing to comply with a notice, instruction or order is an offence (s.79). The Municipality may fine or prosecute, refuse, suspend or revoke an approval or certificate (s.82), close the premises or stop the activity (s.76), and remedy the hazard itself at the cost of the person responsible (s.80).</p>
  <p class="small"><b>Appeal:</b> you may appeal against this decision by written notice, with your reasons, to the Municipal Manager within 21 days of being notified (s.87; Municipal Systems Act, s.62).</p>
  <div class="sign">
    <div>Authorised official: ${e(row.inspector_name ?? '')}</div>
    <div>Received by${row.served === 'Refused to sign' ? ' (refused to sign)' : row.served === 'Affixed to the premises' ? ' (affixed to the premises, s.81(3))' : ''}</div>
  </div>
</div></body></html>`;

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' },
  });
}
