import { listMutualAidPartners } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Mutual-Aid Partners · HikTech' };

export default async function PartnersPage({
  searchParams,
}: {
  searchParams: Promise<{ resource?: string }>;
}) {
  const { supabase } = await getSession();
  const { resource } = await searchParams;
  const partners = await listMutualAidPartners(supabase, resource);
  const resourceTypes = [...new Set(partners.map((p) => p.resource_type))].sort();

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Mutual-aid partner directory</h1>
        <p className="text-muted-foreground">
          The V4 hardcoded 41-partner list, now a maintainable table.
        </p>
      </header>

      <form method="get" className="flex items-end gap-3">
        <div>
          <label className="text-xs uppercase text-muted-foreground" htmlFor="resource">Resource type</label>
          <select id="resource" name="resource" defaultValue={resource ?? ''} className="mt-1 block h-10 rounded-md border border-border bg-bg-soft px-3 text-sm">
            <option value="">All</option>
            {resourceTypes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <button type="submit" className="h-10 rounded-md bg-primary px-4 text-sm font-semibold">Filter</button>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>{partners.length} partners</CardTitle>
          <CardDescription>Contact and radio channels for joint operations.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable
            headers={['Agency', 'Resource type', 'Commander', 'Contact', 'Radio freq']}
            empty="Directory is empty — load supabase/seed."
          >
            {partners.map((p) => (
              <Tr key={p.id}>
                <Td className="font-semibold">{p.agency_name}</Td>
                <Td>{p.resource_type}</Td>
                <Td>{p.commander_name ?? '—'}</Td>
                <Td className="font-mono">{p.contact_number ?? '—'}</Td>
                <Td className="font-mono">{p.radio_frequency ?? '—'}</Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
