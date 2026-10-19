import { redirect } from 'next/navigation';
import { listSections } from '@criticom/api';
import type { Silo } from '@criticom/db';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { requireFeaturePage } from '@/lib/features';
import { getSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { createSectionAction, setSectionActiveAction } from './actions';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sections · HikTech' };

const SILOS: Silo[] = ['MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster'];

export default async function SectionsPage() {
  // Moved to the duty office (0085).
  redirect('/modules/sections');
  const { t } = await requestT();
  await requireFeaturePage('web.sections');
  const { supabase } = await getSession();
  const sections = await listSections(supabase, { includeInactive: true });

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">{t('Sections')}</h1>
        <p className="text-muted-foreground">
          {t('The operational areas that appear beside every officer on the duty board — NR, DR, B, CH…')}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{t('Add a section')}</CardTitle>
          <CardDescription>{t('Codes are short and permanent; retire a section rather than renaming it.')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createSectionAction} className="grid gap-3 md:grid-cols-5">
            <input name="code" required maxLength={6} placeholder={t('Code — e.g. NR')}
              className="h-10 rounded-md border border-border bg-bg-soft px-3 font-mono text-sm uppercase" />
            <input name="name" required placeholder={t('Name — e.g. North Region')}
              className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm md:col-span-2" />
            <input name="region" placeholder={t('Region (optional)')}
              className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm" />
            <select name="silo" className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm">
              {SILOS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button type="submit" className="h-10 rounded-md bg-primary px-4 text-sm font-semibold md:col-start-5">
              {t('Add')}</button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('{length} sections', { length: sections.length })}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable headers={['Code', 'Name', 'Region', 'Department', 'Status', 'Action']} empty={t('No sections defined.')}>
            {sections.map((s) => (
              <Tr key={s.id}>
                <Td className="font-mono font-bold">{s.code}</Td>
                <Td>{s.name}</Td>
                <Td className="text-muted-foreground">{s.region ?? '—'}</Td>
                <Td className="text-xs text-muted-foreground">{s.silo}</Td>
                <Td>
                  <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold uppercase',
                    s.active ? 'bg-severity-low/15 text-severity-low-ink' : 'bg-muted text-muted-foreground')}>
                    {s.active ? 'Active' : 'Retired'}
                  </span>
                </Td>
                <Td>
                  <form action={setSectionActiveAction}>
                    <input type="hidden" name="id" value={s.id} />
                    <input type="hidden" name="active" value={String(!s.active)} />
                    <button type="submit" className="h-8 rounded-md bg-muted px-3 text-xs font-semibold hover:bg-accent/20">
                      {s.active ? 'Retire' : 'Reactivate'}
                    </button>
                  </form>
                </Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
