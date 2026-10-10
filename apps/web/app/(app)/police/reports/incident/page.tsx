import Link from 'next/link';
import { ReportsList, type ReportsParams } from '../reports-list';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Incident Reports · HikTech' };

export default async function IncidentReportsPage({ searchParams }: { searchParams: Promise<ReportsParams> }) {
  const params = await searchParams;
  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Incident reports</h1>
          <p className="text-muted-foreground">Reports officers filed on dispatched calls.</p>
        </div>
        <Link href="/police/reports" className="text-sm text-accent hover:underline">Police reports</Link>
      </header>
      <ReportsList kind="incident" params={params} basePath="/police/reports/incident" />
    </div>
  );
}
