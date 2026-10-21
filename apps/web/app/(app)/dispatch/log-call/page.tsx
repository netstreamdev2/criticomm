import type { Metadata } from 'next';
import Link from 'next/link';
import { getIncident, getIncidentCategoryTree, getOperationalSettings, listUnfinishedCalls } from '@criticom/api';
import { canAccess, finishCallBlock, seesAllUnfinished } from '@criticom/db';
import { getSession } from '@/lib/session';
import { getT } from '@/lib/i18n';
import { LogCallForm } from './log-call-form';
import { UnfinishedCalls } from './unfinished-calls';

export const metadata: Metadata = { title: 'Log incoming call · HikTech' };
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function LogCallPage({ searchParams }: { searchParams: Promise<{ resume?: string }> }) {
  const { supabase, silo, role, userId } = await getSession();
  const { t } = await getT(supabase, userId);
  const { resume } = await searchParams;

  // Carrying on with a call sent early (0076): only one this person may
  // finish, and only while it is unfinished and open. The database checks
  // the same on every change (complete_call_intake); this decides only
  // whether the form opens.
  let resumeCall = null;
  if (resume) {
    const call = UUID.test(resume) ? await getIncident(supabase, resume).catch(() => null) : null;
    const block = call ? finishCallBlock({ userId, role, silo }, call) : 'missing';
    if (!call || block) {
      const why = !call ? t('That call was not found.')
        : block === 'closed' ? t('{number} is closed.', { number: call.incident_number })
          : block === 'finished' ? t('{number} has all its details.', { number: call.incident_number })
            : t('Only the person who logged {number}, or the control room, can finish it.', { number: call.incident_number });
      return (
        <div className="mx-auto max-w-lg space-y-3 rounded-2xl border border-border bg-bg-card p-6 text-center">
          <p className="text-lg font-semibold">{t('Logging cannot be continued for this call')}</p>
          <p className="text-sm text-muted-foreground">{why}</p>
          <div className="flex flex-wrap justify-center gap-2 pt-1">
            {call && canAccess('/incidents/x', role, silo) ? (
              <Link href={`/incidents/${call.id}`} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-muted">
                {t('Open the call')}
              </Link>
            ) : null}
            <Link href="/dispatch/log-call" className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90">
              {t('Log a new call')}
            </Link>
          </div>
        </div>
      );
    }
    resumeCall = call;
  }

  const [categoryTree, settings, unfinished] = await Promise.all([
    getIncidentCategoryTree(supabase).catch(() => []),
    getOperationalSettings(supabase),
    // Calls sent early still waiting for their details: found again after a refresh.
    resumeCall ? Promise.resolve([]) : listUnfinishedCalls(supabase, { userId, all: seesAllUnfinished({ role, silo }) }),
  ]);

  // Dual-role chairs (Operator/ControlRoom/admins) may route straight from
  // intake; a pure IncidentLogger only queues — routing is the dispatch
  // desk's job. Same check as the /dispatch/pending route rule.
  const canRoute = canAccess('/dispatch/pending', role, silo);

  return (
    <div className="space-y-4">
      {unfinished.length ? <UnfinishedCalls calls={unfinished} userId={userId} /> : null}
      <LogCallForm
        // A new form for each call: carrying on with one never mixes with the last.
        key={resumeCall?.id ?? 'new'}
        defaultSilo={silo}
        canRoute={canRoute}
        canOpenCalls={canAccess('/incidents/x', role, silo)}
        categoryTree={categoryTree}
        resume={resumeCall}
        tuning={{
          clockWarnSeconds: settings['sla.clock_warn_seconds'],
          clockCriticalSeconds: settings['sla.clock_critical_seconds'],
        }}
      />
    </div>
  );
}
