import { listKpis, cycleYearFor, cycleLabel } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { FormSection, TextField, TextAreaField, SelectField } from '@/components/fields';
import { getSession, siloFilter } from '@/lib/session';
import { ADMIN_ROLES } from '@criticom/db';
import { PerfNav } from '../perf-nav';
import { addKpiAction, deactivateKpiAction } from '../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'KPI Config · HikTech' };

export default async function KpiConfigPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { supabase, role, silo } = await getSession();
  const params = await searchParams;
  const cycleYear = Number(params.year) || cycleYearFor();
  const canManage = ADMIN_ROLES.includes(role) || role === 'Supervisor' || role === 'System';

  const kpis = await listKpis(supabase, cycleYear, siloFilter(silo));
  const totalWeight = kpis.reduce((s, k) => s + k.weight, 0);

  return (
    <div className="space-y-6">
      <PerfNav active="/performance/kpis" />
      <header>
        <h1 className="text-2xl font-bold">Performance KPI configuration</h1>
        <p className="text-muted-foreground">
          Cycle {cycleLabel(cycleYear)} · total weight {totalWeight}%. Add or retire KPIs without a code change.
        </p>
      </header>

      {canManage && (
        <form action={addKpiAction} className="space-y-4">
          <input type="hidden" name="cycle_year" value={cycleYear} />
          <FormSection title="Add KPI">
            <TextField name="title" label="Title" required />
            <TextField name="weight" label="Weight (%)" type="number" defaultValue={10} />
            <TextField name="department" label="Department (blank = all)" />
            <TextAreaField name="description" label="Description" className="sm:col-span-2 lg:col-span-3" />
          </FormSection>
          <button type="submit" className="h-10 w-full rounded-md bg-primary text-sm font-semibold">Add KPI</button>
        </form>
      )}

      <Card>
        <CardHeader>
          <CardTitle>KPIs ({kpis.length})</CardTitle>
          <CardDescription>Applied to appraisal plans this cycle.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable headers={['Title', 'Weight', 'Department', 'Description', canManage ? '' : '']} empty="No KPIs configured for this cycle.">
            {kpis.map((k) => (
              <Tr key={k.id}>
                <Td className="font-semibold">{k.title}</Td>
                <Td className="font-mono">{k.weight}%</Td>
                <Td>{k.department || 'All'}</Td>
                <Td className="max-w-[320px] truncate text-muted-foreground">{k.description ?? '—'}</Td>
                <Td>
                  {canManage && (
                    <form action={deactivateKpiAction}>
                      <input type="hidden" name="id" value={k.id} />
                      <button type="submit" className="rounded bg-muted px-2 py-1 text-xs hover:bg-muted/70">Retire</button>
                    </form>
                  )}
                </Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
