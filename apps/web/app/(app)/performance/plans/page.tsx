import Link from 'next/link';
import { listPlans, cycleYearFor, cycleLabel } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { getSession, siloFilter } from '@/lib/session';
import { ADMIN_ROLES } from '@criticom/db';
import { PerfNav } from '../perf-nav';
import { generatePlansAction } from '../actions';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Appraisal Plans · HikTech' };

const STATUS_COLOR: Record<string, string> = {
  Active: 'text-muted-foreground',
  MidYearSubmitted: 'text-severity-medium-ink',
  MidYearApproved: 'text-accent',
  FinalSubmitted: 'text-severity-medium-ink',
  Completed: 'text-severity-low-ink',
};

export default async function PlansPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { t } = await requestT();
  const { supabase, role, silo } = await getSession();
  const params = await searchParams;
  const cycleYear = Number(params.year) || cycleYearFor();
  const canManage = ADMIN_ROLES.includes(role) || role === 'Supervisor' || role === 'System';

  const plans = await listPlans(supabase, { cycleYear, silo: siloFilter(silo) });

  return (
    <div className="space-y-6">
      <PerfNav active="/performance/plans" />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('Appraisal plans')}</h1>
          <p className="text-muted-foreground">
            {t('Cycle {cycleLabel} (1 Jul – 30 Jun). One plan per member, mid-year & final assessment.', { cycleLabel: cycleLabel(cycleYear) })}</p>
        </div>
        {canManage && (
          <form action={generatePlansAction}>
            <input type="hidden" name="cycle_year" value={cycleYear} />
            <button type="submit" className="h-10 rounded-md bg-primary px-4 text-sm font-semibold">
              {t('Generate plans for cycle')}</button>
          </form>
        )}
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{t('{length} plans', { length: plans.length })}</CardTitle>
          <CardDescription>{t('Open a plan to record mid-year or final scores.')}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable headers={['Member', 'Badge', 'Department', 'Status', '']} empty={t('No plans generated yet.')}>
            {plans.map((p) => (
              <Tr key={p.id}>
                <Td className="font-semibold">{p.employee_name ?? '—'}</Td>
                <Td className="font-mono">{p.badge_number ?? '—'}</Td>
                <Td>{p.department ?? p.silo}</Td>
                <Td><span className={STATUS_COLOR[p.status] ?? ''}>{p.status}</span></Td>
                <Td><Link href={`/performance/plans/${p.id}`} className="text-accent hover:underline">{t('Open')}</Link></Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
