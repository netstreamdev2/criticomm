import { redirect } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import {
  listAutomationRules, listAutomationRuns, summariseAutomations, RULE_FIELDS,
} from '@criticom/api';
import { ADMIN_CONSOLE_ROLES } from '@criticom/db';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { getSession } from '@/lib/session';
import { timeAgo } from '@/lib/utils';
import { RuleCard } from './rule-card';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Automations · HikTech' };

export default async function AutomationsPage() {
  const { supabase, role } = await getSession();
  if (!ADMIN_CONSOLE_ROLES.includes(role)) redirect('/dashboard');

  const [rules, runs] = await Promise.all([
    listAutomationRules(supabase),
    listAutomationRuns(supabase, { limit: 25 }),
  ]);
  const health = summariseAutomations(rules);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Automations</h1>
        <p className="text-muted-foreground">
          Rules that watch the board when nobody is watching it — ageing calls, lapsing
          certifications, duties nobody confirmed. They run in the database on a five-minute tick.
        </p>
      </header>

      {/* Whether the engine is alive comes first. A page full of enabled rules
          that have not run in a day is worse than one that says so. */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-3 p-4">
          <div className="flex items-center gap-2">
            {health.stalled ? (
              <AlertTriangle className="size-4 text-severity-critical" />
            ) : (
              <CheckCircle2 className="size-4 text-success" />
            )}
            <span className="font-semibold">
              {health.stalled ? 'Scheduler not running' : 'Engine healthy'}
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="size-3.5" />
            {health.lastRunAt ? `Last tick ${timeAgo(health.lastRunAt)}` : 'Never run'}
          </div>
          <div className="text-sm text-muted-foreground">
            {health.enabled} of {health.total} rules enabled
          </div>
          {health.erroring.length > 0 ? (
            <div className="text-sm font-semibold text-severity-critical">
              {health.erroring.length} rule{health.erroring.length === 1 ? '' : 's'} erroring
            </div>
          ) : null}
        </CardContent>
      </Card>

      {health.stalled ? (
        <Card className="border-severity-critical/40 bg-severity-critical/5">
          <CardHeader>
            <CardTitle className="text-severity-critical">Nothing is calling the engine</CardTitle>
            <CardDescription>
              The rules are installed and correct, but no scheduler is ticking them, so no
              escalation will fire on its own. Either enable <code>pg_cron</code> on the database
              (migration <code>0026</code> does this where the platform allows it), or call{' '}
              <code>select public.run_automations();</code> every five minutes from an external
              scheduler. &ldquo;Run now&rdquo; below still works in the meantime.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>How this works</CardTitle>
          <CardDescription>
            Each rule acts at most once per thing per threshold — a call that breaches its SLA
            raises one alert at each tier, not one every five minutes. Thresholds are stored per
            rule, so changing &ldquo;escalate after 10 minutes&rdquo; to 15 needs no deployment.
            Every change and every manual run is written to the audit trail with your name on it.
          </CardDescription>
        </CardHeader>
      </Card>

      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Rules</h2>
        <div className="overflow-hidden rounded-xl border border-border bg-bg-card">
          <ul className="divide-y divide-border">
            {rules.map((rule) => (
              <RuleCard key={rule.key} rule={rule} fields={RULE_FIELDS[rule.key] ?? []} />
            ))}
          </ul>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Recent runs
        </h2>
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-4 py-3 text-left">Rule</th>
                    <th className="px-4 py-3 text-left">When</th>
                    <th className="px-4 py-3 text-left">Result</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                        The engine has not run yet.
                      </td>
                    </tr>
                  ) : null}
                  {runs.map((run) => (
                    <tr key={run.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-2.5 font-medium">{run.rule_key}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {timeAgo(run.started_at)}
                        {run.triggered_by ? ' · manual' : ''}
                      </td>
                      <td
                        className={
                          run.status === 'error'
                            ? 'px-4 py-2.5 text-severity-critical'
                            : 'px-4 py-2.5 text-muted-foreground'
                        }
                      >
                        {run.detail ?? run.status}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{run.affected}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
