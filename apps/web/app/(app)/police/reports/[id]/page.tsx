import { notFound } from 'next/navigation';
import { getMetroReport } from '@criticom/api';
import { PoliceReportView } from '@/components/police-report-view';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Police Report · HikTech' };

export default async function MetroReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase } = await getSession();
  const r = await getMetroReport(supabase, id).catch(() => null);
  if (!r) notFound();
  return <PoliceReportView r={r} />;
}
