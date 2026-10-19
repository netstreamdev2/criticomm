import Link from 'next/link';
import { listFirefighterReports } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { getSession } from '@/lib/session';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Fire Reports · HikTech' };

export default async function FireReportsPage() {
  const { t } = await requestT();
  const { supabase } = await getSession();
  const reports = await listFirefighterReports(supabase);

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('Fire incident reports')}</h1>
          <p className="text-muted-foreground">{t('Raw operational reports — publish sanitised versions from the PIR desk.')}</p>
        </div>
        <Link href="/fire/reports/new" className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold">
          {t('+ New report')}</Link>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{t('{length} reports', { length: reports.length })}</CardTitle>
          <CardDescription>{t('PDF export lands with the Edge Function phase.')}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable
            headers={['Report #', 'Date', 'Type', 'Location', 'Damage (R)', 'Officer', '']}
            empty={t('No fire reports filed.')}
          >
            {reports.map((r) => (
              <Tr key={r.id}>
                <Td className="font-mono">{r.report_number}</Td>
                <Td>{r.date_of_incident}</Td>
                <Td>{r.type_of_incident ?? '—'}</Td>
                <Td className="max-w-[220px] truncate">{r.location ?? '—'}</Td>
                <Td className="font-mono">{Number(r.damage_estimate).toLocaleString()}</Td>
                <Td>{r.reporting_officer_name ?? '—'}</Td>
                <Td className="whitespace-nowrap">
                  <Link href={`/fire/reports/${r.id}`} className="text-accent hover:underline">{t('Open')}</Link>
                  <span className="mx-1 text-muted-foreground">·</span>
                  <Link href={`/fire/pir/publish/${r.id}`} className="text-accent hover:underline">{t('Publish PIR')}</Link>
                </Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
