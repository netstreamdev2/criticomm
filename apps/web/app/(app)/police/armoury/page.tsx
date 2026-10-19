import Link from 'next/link';
import { Download, FileUp } from 'lucide-react';
import {
  FIREARM_OUT_LIMIT_HOURS, firearmOverdueBefore, listArmoury, listAssetImports, type ArmouryFirearm, type AssetImport,
} from '@criticom/api';
import type { Silo } from '@criticom/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { invitationErrorMessage } from '@/lib/onboarding/errors';
import { getSession } from '@/lib/session';
import { formatSaTime } from '@/lib/utils';
import { ArmouryTable, type ArmouryFilter } from './armoury-table';
import { blankFirearm } from './blank';
import { FirearmForm } from './firearm-form';
import { armouryRolesFor } from '@/lib/assets/roles';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Armoury · HikTech' };

const FILTERS: ArmouryFilter[] = ['current', 'Available', 'Issued', 'overdue', 'Maintenance', 'Retired', 'all'];

/**
 * The armoury register (migration 0051): every firearm, where it is kept and
 * who holds it now. Officers book firearms out in the app at the start of a
 * shift and hand them back at the end; command staff keep the register here.
 */
export default async function ArmouryPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { t } = await requestT();
  const { supabase, role, silo } = await getSession();
  const { status } = await searchParams;
  const { global, canManage, departments } = armouryRolesFor(role, silo);

  let firearms: ArmouryFirearm[] = [];
  let loadError: string | null = null;
  let setupError: string | null = null;
  let latest: AssetImport | null = null;
  try {
    firearms = await listArmoury(supabase, { silo: global ? undefined : silo });
  } catch (e) {
    loadError = invitationErrorMessage(e, 'The armoury could not be loaded.');
  }
  try {
    latest = (await listAssetImports(supabase, 'firearms', 1))[0] ?? null;
  } catch (e) {
    setupError = invitationErrorMessage(e, '');
  }

  const overdueBefore = firearmOverdueBefore().toISOString();
  const tally = (pred: (f: ArmouryFirearm) => boolean) => firearms.filter(pred).length;
  const overdue = tally((f) => f.status === 'Issued' && !!f.issued_at && f.issued_at < overdueBefore);
  const initialFilter = FILTERS.includes(status as ArmouryFilter) ? (status as ArmouryFilter) : 'current';
  const homeSilo: Silo = global ? 'MetroPolice' : silo;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('Armoury')}</h1>
          <p className="max-w-2xl text-muted-foreground">
            {t('Every firearm on the register, where it is kept and who has it now. Officers book a firearm out in the app at the start of their shift and hand it back before the shift can end.')}</p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          {canManage ? (
            <>
              <Link href="/police/armoury/import" className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 font-semibold text-primary-foreground hover:bg-primary/90">
                <FileUp className="h-4 w-4" /> {' '}{t('Import armoury list')}</Link>
              <a href="/police/armoury/template" className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 hover:bg-muted">
                <Download className="h-4 w-4" /> {' '}{t('Template')}</a>
            </>
          ) : null}
          <Link href="/shift/today" className="rounded-md border border-border px-4 py-2 hover:bg-muted">{t('Today’s shift')}</Link>
          <Link href="/police/firearms" className="rounded-md border border-border px-4 py-2 hover:bg-muted">{t('Issue register')}</Link>
        </div>
      </header>

      {setupError ? (
        <p role="alert" className="rounded-lg border border-severity-medium/50 bg-severity-medium/10 px-4 py-3 text-sm">{setupError}</p>
      ) : null}

      {loadError ? (
        <p role="alert" className="rounded-lg border border-severity-critical/40 bg-severity-critical/10 px-4 py-3 text-sm text-severity-critical-ink">{loadError}</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {([
              ['Available', tally((f) => f.status === 'Available'), 'Available', ''],
              ['Booked out', tally((f) => f.status === 'Issued'), 'Issued', ''],
              [`Out over ${FIREARM_OUT_LIMIT_HOURS} hours`, overdue, 'overdue', overdue ? 'text-severity-high-ink' : ''],
              ['Maintenance', tally((f) => f.status === 'Maintenance'), 'Maintenance', ''],
              ['Retired', tally((f) => f.status === 'Retired'), 'Retired', 'text-muted-foreground'],
            ] as const).map(([label, n, filter, tone]) => (
              <Link key={filter} href={`/police/armoury?status=${filter}`} className="rounded-lg border border-border bg-bg-card px-3 py-2 hover:border-primary/50">
                <dd className={`text-2xl font-bold tabular-nums ${tone}`}>{n}</dd>
                <dt className="text-xs text-muted-foreground">{label}</dt>
              </Link>
            ))}
          </dl>

          {latest ? (
            <p className="text-sm text-muted-foreground">
              {t('Last armoury import:')}{' '}<b className="text-fg">{latest.file_name}</b>{t(', {saTime} by {value}. {added} added, {updated} updated.', { saTime: formatSaTime(latest.imported_at), value: latest.imported_by_name ?? 'an administrator', added: latest.added, updated: latest.updated })}</p>
          ) : null}

          <ArmouryTable firearms={firearms} canManage={canManage} departments={departments} overdueBefore={overdueBefore} initialFilter={initialFilter} />
        </>
      )}

      {canManage && !loadError ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('Add a firearm')}</CardTitle>
            <CardDescription>{t('One at a time. For the whole armoury, use the import with the template.')}</CardDescription>
          </CardHeader>
          <CardContent>
            <FirearmForm initial={blankFirearm(homeSilo)} departments={departments} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
