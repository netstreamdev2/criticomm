import Link from 'next/link';
import { listConfigRecords, type ConfigModule } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { FormSection, TextField, TextAreaField, SelectField } from '@/components/fields';
import { getSession } from '@/lib/session';
import { addConfigAction, toggleConfigAction } from './actions';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Configuration · HikTech' };

const MODULES: { key: ConfigModule; label: string; hint: string }[] = [
  { key: 'IncidentCategory', label: 'Incident Categories', hint: 'Category groups and their sub-categories (10-codes) with optional form prompts.' },
  { key: 'LeaveType', label: 'Leave Types', hint: 'Selectable leave types on the Leave application form.' },
  { key: 'ShiftType', label: 'Shift Types', hint: 'Selectable shift patterns on the roster.' },
  { key: 'ReportTemplate', label: 'Report Templates', hint: 'Saved Report Hub filter templates (read-only here).' },
];

export default async function AdminConfigPage({
  searchParams,
}: {
  searchParams: Promise<{ module?: string }>;
}) {
  const { t } = await requestT();
  const { supabase } = await getSession();
  const params = await searchParams;
  const module = (MODULES.find((m) => m.key === params.module)?.key ?? 'IncidentCategory') as ConfigModule;
  const records = await listConfigRecords(supabase, module);
  const active = records.filter((r) => r.status === 'Active');

  // Group names for the sub-category parent dropdown (IncidentCategory only).
  const groups = module === 'IncidentCategory'
    ? active.filter((r) => !r.detail1).map((r) => r.name ?? '')
    : [];
  const current = MODULES.find((m) => m.key === module)!;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">{t('System configuration')}</h1>
        <p className="text-muted-foreground">
          {t('Admin-configurable operational lists. Everything is a soft delete — history is never lost.')}</p>
      </header>

      <nav className="flex flex-wrap gap-2">
        {MODULES.map((m) => (
          <Link
            key={m.key}
            href={`/admin/config?module=${m.key}`}
            className={`rounded-md border px-4 py-2 text-sm font-semibold ${
              m.key === module
                ? 'border-primary bg-primary/15 text-fg'
                : 'border-border bg-bg-soft text-fg/70 hover:bg-muted'
            }`}
          >
            {m.label}
          </Link>
        ))}
      </nav>

      {module !== 'ReportTemplate' && (
        <form action={addConfigAction} className="space-y-4">
          <input type="hidden" name="module" value={module} />
          <FormSection title={`Add ${current.label.replace(/s$/, '')}`}>
            {module === 'IncidentCategory' && (
              <SelectField
                name="parent"
                label={t('Parent group (leave blank to add a group)')}
                options={['', ...groups]}
              />
            )}
            <TextField name="name" label={t('Name')} required />
            {module === 'IncidentCategory' && <TextField name="code" label={t('Code (e.g. 10-1)')} />}
            {module === 'IncidentCategory' && (
              <TextAreaField
                name="prompts"
                label={t('Extra form prompts (one per line)')}
                className="sm:col-span-2 lg:col-span-3"
              />
            )}
          </FormSection>
          <button type="submit" className="h-10 w-full rounded-md bg-primary text-sm font-semibold">
            {t('Add entry')}</button>
        </form>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{current.label} ({records.length})</CardTitle>
          <CardDescription>{current.hint}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable
            headers={
              module === 'IncidentCategory'
                ? ['Group', 'Name', 'Code', 'Prompts', 'Status', '']
                : ['Name', 'Status', '']
            }
            empty={t('No entries yet.')}
          >
            {records.map((r) => (
              <Tr key={r.id}>
                {module === 'IncidentCategory' && <Td className="text-muted-foreground">{r.detail1 ?? '— group —'}</Td>}
                <Td className="font-semibold">{r.name}</Td>
                {module === 'IncidentCategory' && <Td className="font-mono">{r.code ?? '—'}</Td>}
                {module === 'IncidentCategory' && (
                  <Td className="max-w-[200px] truncate text-xs text-muted-foreground">
                    {r.detail2 ? r.detail2.split('\n').length + ' prompt(s)' : '—'}
                  </Td>
                )}
                <Td>
                  <span className={r.status === 'Active' ? 'text-severity-low-ink' : 'text-muted-foreground'}>
                    {r.status}
                  </span>
                </Td>
                <Td>
                  {module !== 'ReportTemplate' && (
                    <form action={toggleConfigAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <button
                        type="submit"
                        className="rounded bg-muted px-2 py-1 text-xs hover:bg-muted/70"
                      >
                        {r.status === 'Active' ? 'Deactivate' : 'Reactivate'}
                      </button>
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
