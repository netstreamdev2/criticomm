import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SUPERVISORY_ROLES } from '@criticom/db/roles';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { getSession } from '@/lib/session';
import { formatSaTime } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Readiness Review · Criticomm' };

const PAGE_SIZE = 25;
const ANSWERS = [
  ['memory_recall', 'Memory recall'],
  ['judgment', 'Judgment'],
  ['situational_awareness', 'Situational awareness'],
  ['not_under_influence', 'Free from impairment'],
  ['anger_check', 'Emotional wellbeing'],
  ['reflexes', 'Reflexes'],
] as const;

export default async function ReadinessReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { supabase, role, silo } = await getSession();
  if (!SUPERVISORY_ROLES.includes(role) && role !== 'SystemController') notFound();
  const requested = Number((await searchParams).page ?? '1');
  const page = Number.isSafeInteger(requested) && requested > 0 ? requested : 1;
  const global = role === 'SystemAdmin' || role === 'SuperAdmin' || role === 'SystemController';

  let query = supabase.from('mental_checks')
    .select('*', { count: 'exact' })
    .order('timestamp', { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (!global) query = query.eq('silo', silo);
  const { data: checks, count, error } = await query;
  if (error) throw error;

  const ids = [...new Set((checks ?? []).map((check) => check.user_id))];
  const { data: people, error: peopleError } = ids.length
    ? await supabase.from('personnel')
      .select('user_id, first_name, last_name, badge_number')
      .in('user_id', ids)
    : { data: [], error: null };
  if (peopleError) throw peopleError;
  const byUser = new Map((people ?? []).map((person) => [person.user_id, person]));
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Readiness review</h1>
        <p className="text-muted-foreground">
          Submitted officer declarations, including failed checks and retakes. Records are shown newest first. For
          who is working now, with which vehicle and firearm, see <Link href="/shift/today" className="text-primary hover:underline">today’s shift</Link>.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{count ?? 0} submitted checks</CardTitle>
          <CardDescription>Restricted to command and supervisory staff. Open a row to review all six answers.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable headers={['Officer', 'Department', 'Submitted', 'Result', 'Declaration']} empty="No readiness checks found.">
            {(checks ?? []).map((check) => {
              const person = byUser.get(check.user_id);
              const passed = ANSWERS.every(([key]) => check[key]);
              return (
                <Tr key={check.id}>
                  <Td>
                    <div className="font-semibold">{person ? `${person.first_name} ${person.last_name}` : 'Unlinked officer'}</div>
                    <div className="text-xs text-muted-foreground">{person?.badge_number ?? check.user_id}</div>
                  </Td>
                  <Td>{check.silo}</Td>
                  <Td className="whitespace-nowrap">{formatSaTime(check.timestamp)}</Td>
                  <Td>
                    <span className={passed ? 'font-semibold text-severity-low-ink' : 'font-semibold text-severity-critical-ink'}>
                      {passed ? 'PASS' : 'FAIL'}
                    </span>
                  </Td>
                  <Td>
                    <details className="min-w-48">
                      <summary className="cursor-pointer font-medium">View answers</summary>
                      <dl className="mt-3 space-y-1 text-xs">
                        {ANSWERS.map(([key, label]) => (
                          <div key={key} className="flex justify-between gap-4">
                            <dt>{label}</dt>
                            <dd className={check[key] ? 'text-severity-low-ink' : 'font-semibold text-severity-critical-ink'}>
                              {check[key] ? 'Yes' : 'No'}
                            </dd>
                          </div>
                        ))}
                        <div className="border-t border-border pt-2">
                          <dt className="font-semibold">Comments</dt>
                          <dd className="mt-1 whitespace-pre-wrap">{check.comments || 'None'}</dd>
                        </div>
                      </dl>
                    </details>
                  </Td>
                </Tr>
              );
            })}
          </SimpleTable>
        </CardContent>
      </Card>

      <nav aria-label="Readiness review pages" className="flex items-center justify-between text-sm">
        {page > 1 ? <Link className="text-primary underline" href={`/shift/readiness-review?page=${page - 1}`}>Previous</Link> : <span />}
        <span>Page {page} of {pages}</span>
        {page < pages ? <Link className="text-primary underline" href={`/shift/readiness-review?page=${page + 1}`}>Next</Link> : <span />}
      </nav>
    </div>
  );
}
