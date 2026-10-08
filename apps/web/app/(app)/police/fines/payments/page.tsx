import Link from 'next/link';
import { redirect } from 'next/navigation';
import { canViewAllFines } from '@criticom/db';
import { requireFeaturePage } from '@/lib/features';
import { getSession } from '@/lib/session';
import { ImportPayments } from './import-payments';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Fine payments · HikTech' };

/**
 * Payments from the cashier's or the bank's file, matched to fines by fine or
 * notice number and recorded together (migration 0058). A single payment is
 * recorded on the fine itself.
 */
export default async function FinePaymentsPage() {
  await requireFeaturePage('web.enforcement');
  const { role, silo } = await getSession();
  if (!canViewAllFines({ role, silo })) redirect('/police/fines');

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <Link href="/police/fines" className="text-sm font-semibold text-muted-foreground hover:text-fg">← Fines register</Link>
      <header>
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary">Metro Police · Enforcement</p>
        <h1 className="mt-1 text-2xl font-bold">Import fine payments</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Upload the day’s receipts from the cashier or the bank. Each row is matched to a fine by its FN- number or its
          notice number, and recorded with the date on the receipt — so a payment made inside the 32 days keeps the AARTO
          discount even when it is captured later. A receipt already on a fine is skipped, so importing the same file
          twice records nothing twice.
        </p>
      </header>
      <ImportPayments />
    </div>
  );
}
