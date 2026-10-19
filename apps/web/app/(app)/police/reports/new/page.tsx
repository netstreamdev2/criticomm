import Link from 'next/link';
import { formIdsOf, getMyBodycam } from '@criticom/api';
import { getSession } from '@/lib/session';
import { ConsoleReportForm } from './report-form';
import { requestT } from '@/lib/i18n';

export const metadata = { title: 'New Police Report · HikTech' };

export default async function NewPoliceReportPage({
  searchParams,
}: {
  searchParams: Promise<{ forms?: string }>;
}) {
  const { t } = await requestT();
  const { fullName, supabase } = await getSession();
  // A bodycam booked out this shift was on; the officer can still change it.
  const bodycamOn = Boolean(await getMyBodycam(supabase).catch(() => null));
  const { forms } = await searchParams;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('New police report')}</h1>
          <p className="text-muted-foreground">{t('A report not tied to a dispatched call.')}</p>
        </div>
        <Link href="/police/reports" className="text-sm text-accent hover:underline">{t('Police reports')}</Link>
      </header>
      <ConsoleReportForm initialForms={formIdsOf(forms ?? '')} officerName={fullName} bodycamOn={bodycamOn} />
    </div>
  );
}
