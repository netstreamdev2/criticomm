import { listCrimeStats } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Crime Hotspots · HikTech' };

export default async function CrimeHotspotsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { supabase } = await getSession();
  const { year } = await searchParams;
  const stats = await listCrimeStats(supabase, year);

  const years = [...new Set(stats.map((s) => s.year))].sort().reverse();
  const total = (s: (typeof stats)[number]) =>
    (s.murder ?? 0) + (s.carjacking ?? 0) + (s.burglary_residential ?? 0) +
    (s.robbery_residential ?? 0) + (s.drug_crime ?? 0) + (s.dui ?? 0);
  const ranked = [...stats].sort((a, b) => total(b) - total(a));

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Crime hotspots</h1>
        <p className="text-muted-foreground">
          SAPS station-level statistics (2008–2023 dataset). Ranked by combined incident count.
        </p>
      </header>

      <form method="get" className="flex items-end gap-3">
        <div>
          <label className="text-xs uppercase text-muted-foreground" htmlFor="year">Year</label>
          <select id="year" name="year" defaultValue={year ?? ''} className="mt-1 block h-10 rounded-md border border-border bg-bg-soft px-3 text-sm">
            <option value="">Latest loaded</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <button type="submit" className="h-10 rounded-md bg-primary px-4 text-sm font-semibold">Filter</button>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>{ranked.length} stations</CardTitle>
          <CardDescription>
            {ranked.length === 0
              ? 'Dataset not loaded yet — import sapacr CSV into crime_stats (see docs/03-PHASES.md Phase 4).'
              : 'Highest-crime stations first.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable
            headers={['Station', 'Municipality', 'Murder', 'Carjacking', 'Burglary', 'Robbery', 'Drugs', 'DUI', 'Total']}
            empty="No crime statistics loaded."
          >
            {ranked.slice(0, 60).map((s) => (
              <Tr key={s.id}>
                <Td className="font-semibold">{s.station_name}</Td>
                <Td>{s.district_municipality ?? s.local_municipality ?? '—'}</Td>
                <Td className="font-mono">{s.murder ?? 0}</Td>
                <Td className="font-mono">{s.carjacking ?? 0}</Td>
                <Td className="font-mono">{s.burglary_residential ?? 0}</Td>
                <Td className="font-mono">{s.robbery_residential ?? 0}</Td>
                <Td className="font-mono">{s.drug_crime ?? 0}</Td>
                <Td className="font-mono">{s.dui ?? 0}</Td>
                <Td className="font-mono font-semibold">{total(s)}</Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
