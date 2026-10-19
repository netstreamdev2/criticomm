import Link from 'next/link';
import { listFirearmAuthorizations } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { getSession } from '@/lib/session';
import { formatSaTime } from '@/lib/utils';
import { returnFirearmAction } from '../actions';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Issue register · HikTech' };

export default async function FirearmsPage() {
  const { t } = await requestT();
  const { supabase } = await getSession();
  const records = await listFirearmAuthorizations(supabase);

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('Firearm issue register')}</h1>
          <p className="text-muted-foreground">
            {t('Paper-style issue and return authorisations. The firearms themselves, and who holds each, are in the')}{' '}
            <Link href="/police/armoury" className="text-primary hover:underline">{t('Armoury')}</Link>.
          </p>
        </div>
        <Link href="/police/firearms/new" className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold">
          {t('+ Issue firearm')}</Link>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{t('{length} authorizations', { length: records.length })}</CardTitle>
          <CardDescription>{t('Outstanding issues highlighted — record the return inline.')}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable
            headers={['Form #', 'Employee', 'Firearm', 'Rounds out', 'From', 'To', 'Return']}
            empty={t('No armoury records.')}
          >
            {records.map((f) => (
              <Tr key={f.id}>
                <Td className="font-mono">{f.form_number}</Td>
                <Td>{f.employee_name}<div className="text-xs text-muted-foreground">{f.id_number}</div></Td>
                <Td>{f.firearm_number}{f.make ? ` (${f.make})` : ''}</Td>
                <Td className="font-mono">{f.rounds_ammunition}</Td>
                <Td className="text-muted-foreground">{formatSaTime(f.from_date)}</Td>
                <Td className="text-muted-foreground">{formatSaTime(f.to_date)}</Td>
                <Td>
                  {f.date_received ? (
                    <span className="text-severity-low-ink">
                      {t('Returned {saTime} ({value} rounds)', { saTime: formatSaTime(f.date_received), value: f.rounds_returned })}</span>
                  ) : (
                    <form action={returnFirearmAction} className="flex items-center gap-2">
                      <input type="hidden" name="id" value={f.id} />
                      <input
                        name="rounds_returned" type="number" min={0} defaultValue={f.rounds_ammunition}
                        className="h-8 w-20 rounded-md border border-border bg-bg-soft px-2 text-xs"
                      />
                      <select name="condition" className="h-8 rounded-md border border-border bg-bg-soft px-2 text-xs">
                        <option value="Good">{t('Good')}</option>
                        <option value="Needs cleaning">{t('Needs cleaning')}</option>
                        <option value="Damaged">{t('Damaged')}</option>
                      </select>
                      <button type="submit" className="h-8 rounded-md bg-accent px-3 text-xs font-semibold">
                        {t('Return')}</button>
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
