import Link from 'next/link';
import { listPcrs, listRestocks } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { getSession } from '@/lib/session';
import { timeAgo } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'EMS · Criticom' };

export default async function MedicalPage() {
  const { supabase } = await getSession();
  const [pcrs, restocks] = await Promise.all([listPcrs(supabase), listRestocks(supabase)]);

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Emergency Medical Services</h1>
          <p className="text-muted-foreground">Patient care reports and ambulance inventory.</p>
        </div>
        <Link href="/medical/pcr/new" className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold">
          + New PCR
        </Link>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Patient care reports</p>
          <p className="mt-2 text-3xl font-bold">{pcrs.length}</p>
          <Link href="/medical/pcr" className="text-sm text-accent hover:underline">View all →</Link>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Restock entries</p>
          <p className="mt-2 text-3xl font-bold">{restocks.length}</p>
          <Link href="/medical/restock" className="text-sm text-accent hover:underline">Inventory →</Link>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Units flagged for cleaning</p>
          <p className="mt-2 text-3xl font-bold text-severity-medium">
            {pcrs.filter((p) => p.requires_cleaning).length}
          </p>
        </CardContent></Card>
      </section>

      <Card>
        <CardHeader><CardTitle>Recent PCRs</CardTitle></CardHeader>
        <CardContent className="p-0">
          <SimpleTable headers={['Patient', 'Complaint', 'Destination', 'Created', '']} empty="No PCRs yet.">
            {pcrs.slice(0, 10).map((p) => (
              <Tr key={p.id}>
                <Td>{p.patient_name ?? 'Unknown'}</Td>
                <Td className="max-w-[240px] truncate">{p.chief_complaint ?? '—'}</Td>
                <Td>{p.destination_hospital ?? '—'}</Td>
                <Td className="text-muted-foreground">{timeAgo(p.created_at)}</Td>
                <Td><Link href={`/medical/pcr/${p.id}`} className="text-accent hover:underline">Open</Link></Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
