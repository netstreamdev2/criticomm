import { listFirearmChecklists } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { getSession } from '@/lib/session';
import { cn, formatSaTime } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Firearm checks · Criticomm' };

/**
 * The console view of the armoury checklists officers complete on the phone.
 * Deliberately read-only: a checklist is testimony from the officer holding
 * the weapon at that moment, and nobody edits testimony from a desk.
 */
export default async function FirearmChecksPage() {
  const { supabase } = await getSession();
  const checks = await listFirearmChecklists(supabase);
  const failed = checks.filter((c) => !c.passed).length;

  const CHECK_LABELS: Array<[keyof (typeof checks)[number], string]> = [
    ['serial_verified', 'serial'], ['barrel_clear', 'barrel'], ['action_functional', 'action'],
    ['safety_functional', 'safety'], ['sights_secure', 'sights'], ['cleaned', 'cleaned'],
  ];

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Firearm checks</h1>
        <p className="text-muted-foreground">
          {checks.length} checklists from the field · {failed} did not pass. Captured on the phone, read-only here.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Register</CardTitle>
          <CardDescription>Pass requires every safety item ticked — the form cannot claim otherwise.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable
            headers={['When', 'Officer', 'Kind', 'Firearm', 'Checks', 'Ammunition', 'Result', 'Defects']}
            empty="No checklists submitted yet."
          >
            {checks.map((c) => (
              <Tr key={c.id}>
                <Td className="text-xs text-muted-foreground">{formatSaTime(c.created_at)}</Td>
                <Td className="font-medium">{c.user_name ?? '—'}</Td>
                <Td className="text-xs font-semibold uppercase">{c.kind}</Td>
                <Td>
                  <span className="font-mono text-xs">{c.serial_number}</span>
                  {c.make_model && <div className="text-xs text-muted-foreground">{c.make_model}</div>}
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {CHECK_LABELS.map(([key, label]) => (
                      <span
                        key={label}
                        className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                          c[key] ? 'bg-severity-low/15 text-severity-low-ink' : 'bg-severity-critical/15 text-severity-critical-ink')}
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                </Td>
                <Td className="text-xs text-muted-foreground">
                  {c.magazines} mag · {c.rounds_issued} out{c.rounds_returned !== null ? ` · ${c.rounds_returned} back` : ''}
                </Td>
                <Td>
                  <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold uppercase',
                    c.passed ? 'bg-severity-low/15 text-severity-low-ink' : 'bg-severity-critical/15 text-severity-critical-ink')}>
                    {c.passed ? 'Passed' : 'Not passed'}
                  </span>
                </Td>
                <Td className="max-w-48 text-xs text-muted-foreground">{c.defects ?? '—'}</Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
