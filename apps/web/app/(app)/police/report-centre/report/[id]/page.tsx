import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getMetroReport } from '@criticom/api';
import { POLICE_REPORTS_PATH, mayViewPoliceReports } from '@criticom/db';
import { PoliceReportView } from '@/components/police-report-view';
import { getSession } from '@/lib/session';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Police Report · HikTech' };

/** A police report, read from the reporting pages: for police dispatch and the case manager too, who do not open the police department's own pages. */
export default async function ReportCentreReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = await requestT();
  const { id } = await params;
  const { supabase, role, silo } = await getSession();
  if (!mayViewPoliceReports(role, silo)) redirect('/403');
  const r = await getMetroReport(supabase, id).catch(() => null);
  if (!r) notFound();
  return (
    <PoliceReportView
      r={r}
      back={<Link href={`${POLICE_REPORTS_PATH}/records`} className="text-sm text-accent hover:underline">{t('Back to records')}</Link>}
    />
  );
}
