import Link from 'next/link';
import { listFineOffences, type FineOffence } from '@criticom/api';
import { canManageFineOffences } from '@criticom/db';
import { requireFeaturePage } from '@/lib/features';
import { invitationErrorMessage } from '@/lib/onboarding/errors';
import { getSession } from '@/lib/session';
import { OffenceTable } from './offence-table';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Charge book · HikTech' };

/**
 * The charge book: the offences officers pick from, with the code, legal
 * reference, penalty and demerit points. When an offence has an amount, that
 * is what the notice charges — the officer cannot change it. The admin tier
 * keeps it; captains and supervisors read it.
 */
export default async function ChargeBookPage() {
  const { t } = await requestT();
  await requireFeaturePage('web.enforcement');
  const { supabase, role, silo } = await getSession();
  let offences: FineOffence[] = [];
  let loadError: string | null = null;
  try {
    offences = await listFineOffences(supabase);
  } catch (e) {
    loadError = invitationErrorMessage(e, 'The charge book could not be loaded.');
  }
  const unverified = offences.filter((o) => o.active && !o.verified).length;
  const noAmount = offences.filter((o) => o.active && o.penalty_amount === null).length;

  return (
    <div className="space-y-5">
      <Link href="/police/fines" className="text-sm font-semibold text-muted-foreground hover:text-fg">{t('← Fines register')}</Link>
      <header>
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary">{t('Metro Police · Enforcement')}</p>
        <h1 className="mt-1 text-2xl font-bold">{t('Charge book')}</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          {t('Road traffic offences carry the AARTO Schedule 3 charge code and penalty; by-law offences carry the by-law section and the admission of guilt amount. Enter both from the official schedules, then verify. Changing a verified code or amount takes the verification off until someone checks it again.')}</p>
      </header>

      {loadError ? (
        <div className="rounded-xl border border-severity-critical/40 bg-severity-critical/10 p-4 text-sm font-semibold text-severity-critical-ink">{loadError}</div>
      ) : null}
      {unverified > 0 ? (
        <div className="rounded-xl border border-severity-medium/40 bg-severity-medium/10 p-4 text-sm">
          <b>{t('{unverified} offence{value} not verified', { unverified, value: unverified === 1 ? '' : 's' })}</b>
          {noAmount ? `, ${noAmount} without an amount — officers type the amount for those, and the record notes it.` : '.'}
        </div>
      ) : null}

      <OffenceTable offences={offences} canEdit={canManageFineOffences({ role, silo })} />
    </div>
  );
}
