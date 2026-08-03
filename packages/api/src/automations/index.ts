import type { CriticomClient, Database } from '@criticom/db';

/**
 * Background automations (migration 0025).
 *
 * The engine lives entirely in Postgres — see the migration for why. This layer
 * is the console's view of it: read the rules, tune a threshold, trigger a run,
 * read the log.
 *
 * Nothing here can raise an alert directly. Every write goes through a guarded
 * RPC or an RLS-checked update, so "the automation did it" always means the
 * engine ran, never that a page constructed something that looked like it.
 */

export type AutomationRule = Database['public']['Tables']['automation_rules']['Row'];
export type AutomationRun = Database['public']['Tables']['automation_runs']['Row'];

/**
 * A tunable threshold on a rule.
 *
 * Declared here rather than inferred from whatever the config happens to
 * contain, so the admin page renders a labelled, bounded control per knob
 * instead of a JSON textarea. Bounds are enforced on save; the rule functions
 * additionally fall back to their own defaults, so a value that somehow gets
 * past this cannot stop a rule running.
 */
export type RuleField = {
  key: string;
  label: string;
  hint: string;
  kind: 'int' | 'csv-int';
  min?: number;
  max?: number;
  unit?: string;
};

export const RULE_FIELDS: Record<string, RuleField[]> = {
  sla_unassigned: [
    {
      key: 'warn_minutes',
      label: 'Warn after',
      hint: 'A call still waiting for a department raises a High alert at this age.',
      kind: 'int', min: 1, max: 240, unit: 'minutes',
    },
    {
      key: 'critical_minutes',
      label: 'Interrupt after',
      hint: 'At this age it becomes a Critical, blocking pop-up on every console in the department.',
      kind: 'int', min: 2, max: 480, unit: 'minutes',
    },
  ],
  sla_no_arrival: [
    {
      key: 'minutes',
      label: 'Flag when no arrival within',
      hint: 'Measured from dispatch. Set it to the longest a legitimate response takes across your area.',
      kind: 'int', min: 5, max: 480, unit: 'minutes',
    },
  ],
  stale_incidents: [
    {
      key: 'hours',
      label: 'Nudge after silence of',
      hint: 'An open incident with no timeline entry for this long gets one nudge a day.',
      kind: 'int', min: 1, max: 72, unit: 'hours',
    },
  ],
  cert_expiry: [
    {
      key: 'windows',
      label: 'Warn at',
      hint: 'Days before expiry, comma separated. Each window warns once — for example 30,7,1.',
      kind: 'csv-int', min: 1, max: 365, unit: 'days before',
    },
  ],
  duty_unacknowledged: [
    {
      key: 'lead_hours',
      label: 'Remind within',
      hint: 'Members who have not confirmed a published duty starting inside this window get a reminder.',
      kind: 'int', min: 1, max: 168, unit: 'hours of the start',
    },
  ],
  daily_digest: [
    {
      key: 'hour',
      label: 'Send at',
      hint: 'Local hour (Africa/Johannesburg). Aim it at shift changeover so the incoming shift reads it.',
      kind: 'int', min: 0, max: 23, unit: ":00",
    },
  ],
  hygiene: [
    {
      key: 'alert_days',
      label: 'Keep expired alerts for',
      hint: 'Alerts are a notification channel; the incident, its timeline and the audit log are the record.',
      kind: 'int', min: 7, max: 365, unit: 'days',
    },
    {
      key: 'run_days',
      label: 'Keep the run log for',
      hint: 'How far back you can answer "what did the engine do".',
      kind: 'int', min: 7, max: 365, unit: 'days',
    },
    {
      key: 'event_days',
      label: 'Keep suppression records for',
      hint: 'These stop repeat alerts. Pruning too early can re-raise an alert for an old entity.',
      kind: 'int', min: 7, max: 365, unit: 'days',
    },
  ],
};

/* ── Reading ────────────────────────────────────────────────────────── */

export async function listAutomationRules(client: CriticomClient): Promise<AutomationRule[]> {
  const { data, error } = await client
    .from('automation_rules')
    .select('*')
    .order('key');
  if (error) throw error;
  return data ?? [];
}

export async function listAutomationRuns(
  client: CriticomClient,
  opts: { ruleKey?: string; limit?: number } = {},
): Promise<AutomationRun[]> {
  let q = client
    .from('automation_runs')
    .select('*')
    .order('started_at', { ascending: false });
  if (opts.ruleKey) q = q.eq('rule_key', opts.ruleKey);
  const { data, error } = await q.limit(opts.limit ?? 50);
  if (error) throw error;
  return data ?? [];
}

/** Health summary for the admin dashboard: is the engine actually ticking? */
export type AutomationHealth = {
  enabled: number;
  total: number;
  /** Most recent run across all rules, or null if it has never run. */
  lastRunAt: string | null;
  erroring: AutomationRule[];
  /**
   * True when a rule is overdue by more than twice its interval — which means
   * the scheduler is not calling `run_automations()`, not that a rule is slow.
   */
  stalled: boolean;
};

export function summariseAutomations(rules: AutomationRule[]): AutomationHealth {
  const enabled = rules.filter((r) => r.enabled);
  const lastRunAt = rules
    .map((r) => r.last_run_at)
    .filter((d): d is string => Boolean(d))
    .sort()
    .at(-1) ?? null;

  // Grace of two intervals before calling it stalled: one missed tick is a
  // restart, two is a scheduler that is not running.
  const now = Date.now();
  const stalled = enabled.length > 0 && enabled.every((r) => {
    if (!r.last_run_at) return true;
    return now - new Date(r.last_run_at).getTime() > r.interval_minutes * 60_000 * 2;
  });

  return {
    enabled: enabled.length,
    total: rules.length,
    lastRunAt,
    erroring: rules.filter((r) => r.last_status === 'error'),
    stalled,
  };
}

/* ── Writing ────────────────────────────────────────────────────────── */

export async function setAutomationEnabled(
  client: CriticomClient,
  args: { key: string; enabled: boolean },
) {
  const { error } = await client
    .from('automation_rules')
    .update({ enabled: args.enabled, updated_at: new Date().toISOString() })
    .eq('key', args.key);
  if (error) throw error;
}

/**
 * Save thresholds for one rule.
 *
 * Values are clamped to the declared bounds rather than rejected: an operator
 * typing 900 into "warn after minutes" meant "a long time", and failing the
 * save loses the rest of their edits. Out-of-range input is a UI problem, not a
 * reason to leave the rule on a stale value. Unknown keys are dropped, so a
 * config cannot accumulate junk that no rule reads.
 */
export async function updateAutomationConfig(
  client: CriticomClient,
  args: { key: string; config: Record<string, string>; intervalMinutes?: number },
) {
  const fields = RULE_FIELDS[args.key] ?? [];
  const next: Record<string, unknown> = {};

  for (const field of fields) {
    const raw = args.config[field.key];
    if (raw === undefined || raw === '') continue;

    if (field.kind === 'csv-int') {
      const values = raw
        .split(',')
        .map((part) => Number.parseInt(part.trim(), 10))
        .filter((n) => Number.isFinite(n))
        .map((n) => Math.min(field.max ?? n, Math.max(field.min ?? n, n)))
        // Descending, because the rule reads them as "warn at 30, then 7, then
        // 1 day out" and an operator reads the same order.
        .sort((a, b) => b - a);
      if (values.length > 0) next[field.key] = values.join(',');
      continue;
    }

    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) continue;
    next[field.key] = Math.min(field.max ?? parsed, Math.max(field.min ?? parsed, parsed));
  }

  const patch: Database['public']['Tables']['automation_rules']['Update'] = {
    config: next,
    updated_at: new Date().toISOString(),
  };
  if (args.intervalMinutes !== undefined && Number.isFinite(args.intervalMinutes)) {
    patch.interval_minutes = Math.min(10_080, Math.max(1, Math.trunc(args.intervalMinutes)));
  }

  const { error } = await client.from('automation_rules').update(patch).eq('key', args.key);
  if (error) throw error;
  return next;
}

export type AutomationRunResult = {
  rule_key: string;
  status: string;
  affected: number;
  detail: string;
};

/** Run one rule immediately, ignoring its interval. Admin tier only (0025). */
export async function runAutomationNow(
  client: CriticomClient,
  key: string,
): Promise<AutomationRunResult[]> {
  const { data, error } = await client.rpc('run_automation_now', { p_key: key });
  if (error) throw error;
  return (data ?? []) as AutomationRunResult[];
}
