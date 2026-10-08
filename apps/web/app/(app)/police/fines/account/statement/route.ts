import { NextResponse, type NextRequest } from 'next/server';
import { logAudit } from '@criticom/api';
import { amountDue, buildFineStatementHtml, canViewAllFines, fineStage, type Silo, type UserRole } from '@criticom/db';
import { loadFineAccount } from '@/lib/fine-account';
import { readAccountKey } from '@/lib/fines';
import { requireFeatureApi } from '@/lib/features';
import { getServerSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const BAR = `<style>.bar{max-width:186mm;margin:12px auto;display:flex;justify-content:flex-end;gap:8px;font-family:-apple-system,'Segoe UI',Roboto,sans-serif}
.bar button{font:inherit;font-size:13px;font-weight:700;padding:8px 14px;border-radius:6px;border:1px solid #0f172a;background:#0f172a;color:#fff;cursor:pointer}
@media print{.bar{display:none}}</style><div class="bar"><button type="button" onclick="window.print()">Print</button></div>`;

/**
 * A printable statement for one ID number or registration. Command staff
 * only; printing one goes on the audit trail, as it carries personal
 * information.
 */
export async function GET(request: NextRequest) {
  const refused = await requireFeatureApi('web.enforcement');
  if (refused) return refused;
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL('/login?next=/police/fines/account', request.url));
  const role = (user.app_metadata?.role ?? 'Viewer') as UserRole;
  const silo = (user.app_metadata?.silo ?? 'Ethekwini') as Silo;
  if (!canViewAllFines({ role, silo })) return NextResponse.redirect(new URL('/403', request.url));

  const key = readAccountKey(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!key) return new NextResponse('Give a full ID number or registration.', { status: 400 });

  const { fines, ledger, paid, person } = await loadFineAccount(supabase, key);
  const now = new Date();
  const printedBy = (user.user_metadata?.full_name as string | undefined) ?? user.email ?? 'Command staff';
  const html = buildFineStatementHtml({
    issuingAuthority: fines[0]?.issuing_authority ?? 'Metro Police',
    subject: [person?.offender_name, key.id ? `ID ${key.id}` : null, key.reg ? `Vehicle ${key.reg}` : null].filter(Boolean).join(' · '),
    fines,
    paid,
    payments: ledger.map((t) => ({
      fineNumber: fines.find((f) => f.id === t.fine_id)?.fine_number ?? '—',
      paidOn: t.paid_on, recordedAt: t.recorded_at, type: t.tx_type, method: t.method, receipt: t.reference, amount: Number(t.amount),
    })),
    stageOf: (f) => fineStage(f),
    owingOf: (f) => (f.status === 'Paid' || f.status === 'Cancelled' ? 0 : Math.max(0, amountDue(f, now) - (paid.get(f.id) ?? 0))),
    printedBy,
    now,
  }).replace('<body>', `<body>${BAR}`);

  await logAudit(supabase, {
    silo: 'MetroPolice', user_id: user.id, user_name: printedBy, action_type: 'FineStatementPrinted', entity_type: 'fine',
    details: [key.id ? `ID ••••${key.id.slice(-4)}` : null, key.reg, `${fines.length} fines`].filter(Boolean).join(' · '),
  }).catch(() => {});

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' },
  });
}
