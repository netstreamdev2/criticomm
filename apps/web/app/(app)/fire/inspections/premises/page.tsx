import Link from 'next/link';
import { Search } from 'lucide-react';
import { getFirePremises, listFirePremises } from '@criticom/api';
import { premisesState, saDay } from '@criticom/db/fire-inspection';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { getSession } from '@/lib/session';
import { requestT } from '@/lib/i18n';
import { PremisesForm } from './premises-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Premises Register · HikTech' };

const COMMAND = ['Captain', 'FireChief', 'Supervisor', 'Admin', 'SystemAdmin', 'SuperAdmin'];
const STATE_TONE: Record<string, string> = {
  'Never inspected': 'text-severity-medium-ink', Overdue: 'text-severity-critical-ink', 'Notice open': 'text-severity-high-ink',
  'Due soon': 'text-severity-medium-ink', 'Up to date': 'text-severity-low-ink',
};

/** The fire safety premises register (0106): every site, its use, risk and when it is next due. */
export default async function PremisesPage({ searchParams }: { searchParams: Promise<{ q?: string; edit?: string }> }) {
  const { t } = await requestT();
  const { supabase, role, silo } = await getSession();
  const { q, edit } = await searchParams;
  const canEdit = COMMAND.includes(role) && silo === 'MetroFire';
  const [rows, editing] = await Promise.all([
    listFirePremises(supabase, { q }).catch(() => []),
    canEdit && edit && /^[0-9a-f-]{36}$/i.test(edit) ? getFirePremises(supabase, edit).catch(() => null) : Promise.resolve(null),
  ]);
  const today = saDay();

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{t('Premises register')}</h1>
          <p className="text-muted-foreground">{t('Every site, what it is used for, its risk and when it is due.')}</p>
        </div>
        <Link href="/fire/inspections" className="text-sm text-accent hover:underline">{t('Back to inspections')}</Link>
      </header>

      {canEdit ? <PremisesForm key={editing?.id ?? 'new'} premises={editing} /> : null}

      <form method="get" className="flex items-center gap-2 rounded-lg border border-border bg-bg-card px-3 py-2.5">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input name="q" defaultValue={q} placeholder={t('Search name, address or contact')} aria-label={t('Search the register')}
            className="h-9 w-full rounded-md border border-border bg-bg-soft pl-8 pr-2.5 text-sm" />
        </div>
        <button type="submit" className="h-9 rounded-md bg-accent px-4 text-sm font-semibold">{t('Search')}</button>
      </form>

      <Card>
        <CardHeader><CardTitle>{t('{n} sites', { n: rows.length })}</CardTitle></CardHeader>
        <CardContent className="p-0">
          <SimpleTable headers={['Site', 'Used as', 'Risk', 'State', 'Due', '']} empty={q ? 'No site matches.' : 'No sites on the register yet.'}>
            {rows.map((p) => {
              const state = premisesState(p, today);
              return (
                <Tr key={p.id}>
                  <Td className="font-semibold">{p.name}<div className="text-xs font-normal text-muted-foreground">{p.address}</div></Td>
                  <Td>{t(p.occupancy)}</Td>
                  <Td>{t(p.risk)}</Td>
                  <Td><span className={`font-semibold ${STATE_TONE[state] ?? ''}`}>{t(state)}</span></Td>
                  <Td className="whitespace-nowrap text-xs">{p.next_due ?? '—'}</Td>
                  <Td className="whitespace-nowrap text-right text-sm">
                    <Link href={`/fire/inspections/new?premises=${p.id}`} className="text-accent hover:underline">{t('Inspect')}</Link>
                    {canEdit ? <> · <Link href={`/fire/inspections/premises?edit=${p.id}`} className="text-accent hover:underline">{t('Change')}</Link></> : null}
                  </Td>
                </Tr>
              );
            })}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
