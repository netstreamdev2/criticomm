import Link from 'next/link';
import { DEPARTMENT_LABELS, findCases, incidentNumbersFor, listAuditLogs } from '@criticom/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SimpleTable, Td, Tr } from '@/components/simple-table';
import { getSession } from '@/lib/session';
import { formatSaTime } from '@/lib/utils';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Case Audit Trail · HikTech' };

/**
 * Cases audit under two entity types: 'incident' from the console and
 * 'incidents' from the database functions (logging, routing, the report,
 * closing). Filtering on one of them hid half of every case's history.
 */
const CASE_ENTITIES = ['incident', 'incidents'];

/** The actions worth filtering on, in the order a call lives them. */
const ACTIONS = [
  'CREATE_INCIDENT', 'IncidentRouted', 'IncidentAssigned', 'StatusChange', 'EvidenceUpload', 'IncidentUpdate',
  'REPORT_FILED', 'CASE_CLOSED', 'CALL_CANCELLED', 'LocationSmsTriggered', 'BodycamLiveViewed', 'BodycamFootageViewed',
];

type Search = { incident?: string; action?: string };

export default async function CaseAuditPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { t } = await requestT();
  const { supabase } = await getSession();
  const params = await searchParams;
  const wanted = (params.incident ?? '').trim();

  // One case, found by its id or number; or the latest across every case.
  const targets = wanted ? await findCases(supabase, wanted).catch(() => []) : [];
  const action = params.action && ACTIONS.includes(params.action) ? params.action : undefined;
  const logs = wanted && targets.length === 0
    ? []
    : await listAuditLogs(supabase, {
      entityTypes: CASE_ENTITIES,
      entityIds: targets.length ? targets.map((t) => t.id) : undefined,
      actionType: action,
      limit: targets.length ? 500 : 200,
    });
  const numbers = targets.length
    ? new Map(targets.map((t) => [t.id, t.incident_number]))
    : await incidentNumbersFor(supabase, logs.map((l) => l.entity_id ?? '')).catch(() => new Map<string, string>());
  const target = targets.length === 1 ? targets[0] : null;

  const field = 'mt-1 block h-10 w-full rounded-md border border-border bg-bg-soft px-3 text-sm';

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">{t('Case audit trail')}</h1>
        <p className="text-muted-foreground">
          {t('Every recorded action on a case: who logged it, routed it, responded, filed the report and closed it. Audit rows are permanent.')}</p>
      </header>

      <form method="get" className="grid gap-3 rounded-lg border border-border bg-bg-card p-4 sm:grid-cols-3">
        <div>
          <label className="text-xs uppercase text-muted-foreground" htmlFor="incident">{t('Incident number')}</label>
          <input id="incident" name="incident" defaultValue={wanted} placeholder={t('INC-20261008-0001')} className={`${field} font-mono`} />
        </div>
        <div>
          <label className="text-xs uppercase text-muted-foreground" htmlFor="action">{t('Action')}</label>
          <select id="action" name="action" defaultValue={action ?? ''} className={field}>
            <option value="">{t('Any')}</option>
            {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div className="flex items-end gap-2">
          <button type="submit" className="h-10 rounded-md bg-primary px-5 text-sm font-semibold">{t('Show')}</button>
          {wanted || action ? <Link href="/case-manager/audit" className="text-sm text-accent hover:underline">{t('Clear')}</Link> : null}
        </div>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>
            {target ? (
              <>{t('Trail for')}{' '}<Link href={`/incidents/${target.id}`} className="font-mono text-accent hover:underline">{target.incident_number}</Link></>
            ) : targets.length > 1 ? (
              <>
                {t('Trails for {length} cases numbered', { length: targets.length })}{' '}<span className="font-mono">{targets[0]?.incident_number}</span>
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  ({targets.map((t) => DEPARTMENT_LABELS[t.silo] ?? t.silo).join(', ')})
                </span>
              </>
            ) : `${logs.length} recent events`}
          </CardTitle>
          <CardDescription>
            {wanted && targets.length === 0
              ? `No case numbered “${wanted}” that you can see.`
              : targets.length ? 'Newest first. The case file shows the same events alongside its timeline.' : 'Newest first, across every case you can see.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable headers={['Time', 'Case', 'Action', 'By', 'Details']} empty={t('No audit events.')}>
            {logs.map((l) => {
              const number = l.entity_id ? numbers.get(l.entity_id) : undefined;
              return (
                <Tr key={l.id}>
                  <Td className="whitespace-nowrap text-muted-foreground">{formatSaTime(l.timestamp)}</Td>
                  <Td className="whitespace-nowrap">
                    {number && l.entity_id
                      ? <Link href={`/incidents/${l.entity_id}`} className="font-mono text-accent hover:underline">{number}</Link>
                      : <span className="text-muted-foreground">—</span>}
                  </Td>
                  <Td className="font-semibold">{l.action_type}</Td>
                  <Td>{l.user_name ?? 'System'}</Td>
                  <Td className="max-w-[420px] break-words text-sm">{l.details ?? '—'}</Td>
                </Tr>
              );
            })}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
