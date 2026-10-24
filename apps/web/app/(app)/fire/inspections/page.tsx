import Link from 'next/link';
import { Plus, Search } from 'lucide-react';
import { listFireInspections, listFirePremises } from '@criticom/api';
import { addDays, premisesState, saDay } from '@criticom/db/fire-inspection';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { getSession } from '@/lib/session';
import { formatSaTime } from '@/lib/utils';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Fire Safety Inspections · HikTech' };

type Params = { q?: string; outcome?: string };
const FILERS = ['Firefighter', 'Captain', 'FireChief', 'Supervisor', 'Admin', 'SystemAdmin', 'SuperAdmin'];
const field = 'h-9 rounded-md border border-border bg-bg-soft px-2.5 text-sm';
const OUTCOME_TONE: Record<string, string> = {
  Compliant: 'text-severity-low-ink', 'Compliance notice': 'text-severity-high-ink', Instruction: 'text-severity-critical-ink',
  PASS: 'text-severity-low-ink', FAIL: 'text-severity-high-ink',
};
const STATE_TONE: Record<string, string> = {
  'Never inspected': 'text-severity-medium-ink', Overdue: 'text-severity-critical-ink', 'Notice open': 'text-severity-high-ink',
  'Due soon': 'text-severity-medium-ink', 'Up to date': 'text-severity-low-ink',
};

/**
 * Fire safety site inspections (0106): the sites due (never inspected,
 * overdue, a notice to follow up, due in the next two weeks), then every
 * inspection with what followed. Filed on the phone or from here.
 */
export default async function FireInspectionsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { t } = await requestT();
  const { supabase, role, silo } = await getSession();
  const params = await searchParams;
  const today = saDay();
  // Empty until migration 0106 is run.
  const [due, rows] = await Promise.all([
    listFirePremises(supabase, { dueBy: addDays(today, 14), limit: 100 }).catch(() => []),
    listFireInspections(supabase, params).catch(() => []),
  ]);
  const canFile = FILERS.includes(role) && silo === 'MetroFire';
  const filtered = Boolean(params.q || params.outcome);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('Fire Safety Inspections')}</h1>
          <p className="text-muted-foreground">{t('Site inspections under the eThekwini Fire By-law.')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canFile ? (
            <Link href="/fire/inspections/new" className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold">
              <Plus className="h-4 w-4" /> {t('New inspection')}</Link>
          ) : null}
          <Link href="/fire/inspections/premises" className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm hover:bg-muted">
            {t('Premises register')}</Link>
        </div>
      </header>

      <Card>
        <CardHeader><CardTitle>{t('Due for inspection ({n})', { n: due.length })}</CardTitle></CardHeader>
        <CardContent className="p-0">
          <SimpleTable headers={['Site', 'Used as', 'Risk', 'State', 'Due', '']} empty={'Nothing due in the next two weeks.'}>
            {due.map((p) => {
              const state = premisesState(p, today);
              return (
                <Tr key={p.id}>
                  <Td className="font-semibold">{p.name}<div className="text-xs font-normal text-muted-foreground">{p.address}</div></Td>
                  <Td>{t(p.occupancy)}</Td>
                  <Td>{t(p.risk)}</Td>
                  <Td><span className={`font-semibold ${STATE_TONE[state] ?? ''}`}>{t(state)}</span></Td>
                  <Td className="whitespace-nowrap text-xs">{p.next_due ?? '—'}</Td>
                  <Td className="text-right">
                    {canFile ? <Link href={`/fire/inspections/new?premises=${p.id}`} className="text-sm text-accent hover:underline">{t('Inspect')}</Link> : null}
                  </Td>
                </Tr>
              );
            })}
          </SimpleTable>
        </CardContent>
      </Card>

      <form method="get" className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-bg-card px-3 py-2.5">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input name="q" defaultValue={params.q} placeholder={t('Search site, address, contact or reference')} aria-label={t('Search inspections')} className={`${field} w-full pl-8`} />
        </div>
        <select name="outcome" defaultValue={params.outcome ?? ''} aria-label={t('Outcome')} className={field}>
          <option value="">{t('All outcomes')}</option>
          <option value="Compliant">{t('Compliant')}</option>
          <option value="Compliance notice">{t('Compliance notice')}</option>
          <option value="Instruction">{t('Instruction')}</option>
        </select>
        <button type="submit" className="h-9 rounded-md bg-accent px-4 text-sm font-semibold">{t('Apply')}</button>
        {filtered ? <Link href="/fire/inspections" className="text-sm text-accent hover:underline">{t('Clear')}</Link> : null}
      </form>

      <Card>
        <CardHeader><CardTitle>{t('{length} inspection{value}', { length: rows.length, value: rows.length === 1 ? '' : 's' })}</CardTitle></CardHeader>
        <CardContent className="p-0">
          <SimpleTable headers={['Reference', 'Site', 'Outcome', 'Put right by', 'Inspector', 'Inspected']}
            empty={filtered ? 'No inspections match.' : 'No inspections yet.'}>
            {rows.map((r) => {
              const outcome = r.outcome ?? r.result;
              return (
                <Tr key={r.id}>
                  <Td className="font-mono text-xs"><Link href={`/fire/inspections/${r.id}`} className="text-accent hover:underline">{r.inspection_ref}</Link></Td>
                  <Td className="font-semibold">{r.business_name}<div className="text-xs font-normal text-muted-foreground">{r.address}</div></Td>
                  <Td>
                    <span className={`font-bold ${OUTCOME_TONE[outcome] ?? ''}`}>{t(outcome)}</span>
                    {r.repeat_failure ? <div className="text-xs font-semibold text-severity-critical-ink">{t('Not complied with')}</div> : null}
                  </Td>
                  <Td className="whitespace-nowrap text-xs">{r.comply_by ?? '—'}</Td>
                  <Td className="text-xs">{r.inspector_name ?? '—'}</Td>
                  <Td className="whitespace-nowrap text-xs text-muted-foreground">{formatSaTime(r.inspected_at)}</Td>
                </Tr>
              );
            })}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
