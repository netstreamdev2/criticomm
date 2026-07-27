import Link from 'next/link';
import { listPcrs } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { getSession } from '@/lib/session';
import { formatSaTime } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Patient Care Reports · Criticom' };

export default async function PcrListPage() {
  const { supabase } = await getSession();
  const pcrs = await listPcrs(supabase);

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Patient care reports</h1>
          <p className="text-muted-foreground">PCRs remain editable until the incident is closed.</p>
        </div>
        <Link href="/medical/pcr/new" className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold">
          + New PCR
        </Link>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{pcrs.length} reports</CardTitle>
          <CardDescription>Patient identifiers stay inside the Medical silo (RLS-enforced).</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable
            headers={['Patient', 'Age', 'Complaint', 'MOI', 'Destination', 'Care', 'Created', '']}
            empty="No PCRs filed."
          >
            {pcrs.map((p) => (
              <Tr key={p.id}>
                <Td>{p.patient_name ?? 'Unknown'}</Td>
                <Td>{p.age ?? '—'}</Td>
                <Td className="max-w-[200px] truncate">{p.chief_complaint ?? '—'}</Td>
                <Td>{p.mechanism_of_injury ?? '—'}</Td>
                <Td>{p.destination_hospital ?? '—'}</Td>
                <Td>{p.level_of_care ?? '—'}</Td>
                <Td className="text-muted-foreground">{formatSaTime(p.created_at)}</Td>
                <Td className="whitespace-nowrap">
                  <Link href={`/medical/pcr/${p.id}`} className="text-accent hover:underline">Open</Link>
                  <span className="mx-1 text-muted-foreground">·</span>
                  <Link href={`/medical/pcr/${p.id}/edit`} className="text-accent hover:underline">Edit</Link>
                </Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
