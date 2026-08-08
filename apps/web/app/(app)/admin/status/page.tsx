import { redirect } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, MinusCircle } from 'lucide-react';
import { listAutomationRules, summariseAutomations } from '@criticom/api';
import { ADMIN_CONSOLE_ROLES } from '@criticom/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getSession } from '@/lib/session';
import { timeAgo } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'System status · Criticom' };

/**
 * One page that answers "is the platform actually working right now".
 *
 * The information was all reachable before — across the integrations panel, the
 * automations console, a psql session and the Supabase dashboard. That is fine
 * on a quiet afternoon and useless at 03:00, which is the only time anybody
 * asks the question. So each check states what it means operationally rather
 * than reporting a number: "no alerts in the last hour" is not a fact an
 * administrator can act on, "alerting is live" or "alerting has gone quiet —
 * check the automation engine" is.
 *
 * Every check fails soft. A status page that itself errors when a subsystem is
 * down is worse than no status page.
 */

type Level = 'ok' | 'warn' | 'down' | 'idle';

type Check = {
  name: string;
  level: Level;
  detail: string;
  /** Where to go next when it is not ok. */
  href?: string;
};

const LEVEL_STYLE: Record<Level, { icon: typeof CheckCircle2; className: string; label: string }> = {
  ok: { icon: CheckCircle2, className: 'text-success', label: 'OK' },
  warn: { icon: AlertTriangle, className: 'text-severity-medium-ink', label: 'Degraded' },
  down: { icon: AlertTriangle, className: 'text-severity-critical', label: 'Down' },
  idle: { icon: MinusCircle, className: 'text-muted-foreground', label: 'Idle' },
};

export default async function StatusPage() {
  const { supabase, role } = await getSession();
  if (!ADMIN_CONSOLE_ROLES.includes(role)) redirect('/dashboard');

  const checks: Check[] = [];

  /* ── Database ──────────────────────────────────────────────────────── */

  const started = Date.now();
  const { count: incidentCount, error: dbError } = await supabase
    .from('incidents')
    .select('id', { count: 'exact', head: true });
  const dbMs = Date.now() - started;

  checks.push(
    dbError
      ? {
          name: 'Database',
          level: 'down',
          detail: `Unreachable: ${dbError.message}. Nothing else on this page is trustworthy until this is fixed.`,
        }
      : {
          name: 'Database',
          level: dbMs > 2000 ? 'warn' : 'ok',
          detail: `Answered in ${dbMs} ms · ${incidentCount ?? 0} incidents on record.`
            + (dbMs > 2000 ? ' That is slow enough for operators to notice.' : ''),
        },
  );

  /* ── Intake ────────────────────────────────────────────────────────── */

  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const { count: callsToday } = await supabase
    .from('incidents')
    .select('id', { count: 'exact', head: true })
    .gte('call_timestamp', dayAgo);

  checks.push({
    name: 'Call intake',
    level: (callsToday ?? 0) > 0 ? 'ok' : 'idle',
    detail: (callsToday ?? 0) > 0
      ? `${callsToday} call${callsToday === 1 ? '' : 's'} logged in the last 24 hours.`
      : 'No calls logged in the last 24 hours. Quiet, or the call-taking screen is not reaching the database — log a test call to tell the difference.',
    href: '/dispatch/log-call',
  });

  /* ── Queue depth ───────────────────────────────────────────────────── */

  const { count: waiting } = await supabase
    .from('incidents')
    .select('id', { count: 'exact', head: true })
    .in('status', ['New', 'Pending', 'Pending Dispatch', 'Pending Analysis']);

  checks.push({
    name: 'Dispatch queue',
    level: (waiting ?? 0) > 20 ? 'warn' : 'ok',
    detail: (waiting ?? 0) === 0
      ? 'Nothing waiting for a department.'
      : `${waiting} call${waiting === 1 ? '' : 's'} awaiting dispatch.`
        + ((waiting ?? 0) > 20 ? ' That is a backlog, not a blip — check crew availability.' : ''),
    href: '/dispatch/pending',
  });

  /* ── Alerting ──────────────────────────────────────────────────────── */

  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const { count: recentAlerts } = await supabase
    .from('alerts')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', hourAgo);

  checks.push({
    name: 'Alerting',
    level: (recentAlerts ?? 0) > 0 ? 'ok' : 'idle',
    detail: (recentAlerts ?? 0) > 0
      ? `${recentAlerts} alert${recentAlerts === 1 ? '' : 's'} raised in the last hour.`
      : 'No alerts in the last hour. Expected on a quiet shift; suspicious if the queue above is not empty.',
    href: '/notifications',
  });

  /* ── Automations ───────────────────────────────────────────────────── */

  const rules = await listAutomationRules(supabase).catch(() => []);
  const engine = summariseAutomations(rules);

  checks.push({
    name: 'Automation engine',
    level: rules.length === 0 ? 'down' : engine.stalled ? 'down' : engine.erroring.length > 0 ? 'warn' : 'ok',
    detail: rules.length === 0
      ? 'No rules found. Migration 0025 has not been applied to this environment, so nothing is watching the board.'
      : engine.stalled
        ? 'Rules are enabled but nothing is calling them — no SLA escalation will fire. See the runbook, §5.'
        : `${engine.enabled} of ${engine.total} rules enabled · last tick ${engine.lastRunAt ? timeAgo(engine.lastRunAt) : 'never'}`
          + (engine.erroring.length > 0 ? ` · ${engine.erroring.length} erroring.` : '.'),
    href: '/admin/automations',
  });

  /* ── Field connectivity ────────────────────────────────────────────── */

  const { count: devices } = await supabase
    .from('push_tokens')
    .select('token', { count: 'exact', head: true });

  const { count: onDuty } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('is_on_duty', true);

  checks.push({
    name: 'Responder app',
    level: (devices ?? 0) > 0 ? 'ok' : 'warn',
    detail: (devices ?? 0) > 0
      ? `${devices} handset${devices === 1 ? '' : 's'} registered for push · ${onDuty ?? 0} on duty.`
      : 'No handsets registered for push. Crews will only receive alerts while the app is open — check that store builds carry an FCM configuration.',
    href: '/admin/devices',
  });

  /* ── Deployment configuration ──────────────────────────────────────── */

  const missingEnv = [
    !process.env.SUPABASE_SERVICE_ROLE_KEY && 'SUPABASE_SERVICE_ROLE_KEY',
    !process.env.NEXT_PUBLIC_APP_URL && 'NEXT_PUBLIC_APP_URL',
    !(process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY) && 'GROQ_API_KEY or GEMINI_API_KEY',
  ].filter((v): v is string => Boolean(v));

  checks.push({
    name: 'Deployment configuration',
    level: missingEnv.length === 0 ? 'ok' : 'warn',
    detail: missingEnv.length === 0
      ? 'Every required variable is present in this build.'
      : `Missing: ${missingEnv.join(', ')}. These are inlined at build time — set them and redeploy, a restart will not pick them up.`,
    href: '/api/health/config',
  });

  const worst: Level = checks.some((c) => c.level === 'down')
    ? 'down'
    : checks.some((c) => c.level === 'warn')
      ? 'warn'
      : 'ok';

  const Overall = LEVEL_STYLE[worst].icon;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">System status</h1>
        <p className="text-muted-foreground">
          Everything an administrator needs to answer &ldquo;is the platform working&rdquo;, in one
          place. Each check says what it means, not just what it measured.
        </p>
      </header>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 p-4">
          <Overall className={`size-6 ${LEVEL_STYLE[worst].className}`} />
          <div>
            <p className="font-semibold">
              {worst === 'ok'
                ? 'All checks passing'
                : worst === 'warn'
                  ? 'Running, with degraded subsystems'
                  : 'A core subsystem is down'}
            </p>
            <p className="text-sm text-muted-foreground">
              Checked {new Date().toLocaleString('en-ZA')}. Refresh to re-run.
            </p>
          </div>
          <Link
            href="/api/health/config"
            className="ml-auto text-sm text-accent hover:underline"
          >
            Raw configuration diagnostics →
          </Link>
        </CardContent>
      </Card>

      <div className="overflow-hidden rounded-xl border border-border bg-bg-card">
        <ul className="divide-y divide-border">
          {checks.map((check) => {
            const style = LEVEL_STYLE[check.level];
            const Icon = style.icon;
            return (
              <li key={check.name} className="flex items-start gap-3 p-4">
                <Icon className={`mt-0.5 size-4 shrink-0 ${style.className}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <h2 className="font-semibold">{check.name}</h2>
                    <span className={`text-xs font-bold uppercase tracking-wide ${style.className}`}>
                      {style.label}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{check.detail}</p>
                </div>
                {check.href ? (
                  <Link
                    href={check.href}
                    className="shrink-0 text-sm text-accent hover:underline"
                  >
                    Open
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>If something here is red</CardTitle>
          <CardDescription>
            <code>docs/08-RUNBOOK.md</code> has the procedure for each subsystem, in the order to
            work through them. It opens with the thing worth remembering: every procedure in it is
            slower than the radio. If crews are waiting, put the control room on radio and paper
            first, then fix the platform.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
