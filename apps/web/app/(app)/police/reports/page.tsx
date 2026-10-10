import Link from 'next/link';
import { ReportsList, type ReportsParams } from './reports-list';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Police Reports · HikTech' };

export default async function PoliceReportsPage({ searchParams }: { searchParams: Promise<ReportsParams> }) {
  const params = await searchParams;
  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Police reports</h1>
          <p className="text-muted-foreground">Reports filed from the console, not tied to a dispatched call.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/police/reports/incident" className="text-sm text-accent hover:underline">Incident reports</Link>
          <Link href="/police/reports/new" className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold">
            + New report
          </Link>
        </div>
      </header>
      <ReportsList kind="police" params={params} basePath="/police/reports" />
    </div>
  );
}
