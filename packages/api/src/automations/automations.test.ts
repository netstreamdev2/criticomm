import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RULE_FIELDS, sanitiseAutomationConfig, summariseAutomations, type AutomationRule,
} from './index.ts';

/**
 * The automation rules decide when this service escalates a call, warns about a
 * lapsing certification, or interrupts every console in a department. The
 * thresholds behind those decisions are typed into a form by an operator, so
 * what the form accepts is part of the safety story — a "0" in the wrong box
 * would turn escalation into a broadcast storm.
 *
 * Run: pnpm test
 */

const rule = (over: Partial<AutomationRule> = {}): AutomationRule => ({
  key: 'sla_unassigned',
  name: 'Unassigned call escalation',
  description: '',
  enabled: true,
  interval_minutes: 5,
  config: {},
  last_run_at: new Date().toISOString(),
  last_status: 'ok',
  last_detail: null,
  updated_at: new Date().toISOString(),
  ...over,
});

/* ── Threshold sanitising ───────────────────────────────────────────── */

test('sane values pass through untouched', () => {
  assert.deepEqual(
    sanitiseAutomationConfig('sla_unassigned', { warn_minutes: '10', critical_minutes: '20' }),
    { warn_minutes: 10, critical_minutes: 20 },
  );
});

test('out-of-range values are clamped, not rejected', () => {
  // Rejecting would lose the operator's other edits. Clamping keeps the intent
  // ("a long time") and keeps the rule on a usable value.
  const result = sanitiseAutomationConfig('sla_unassigned', {
    warn_minutes: '99999',
    critical_minutes: '0',
  });
  assert.equal(result.warn_minutes, 240, 'clamped to the declared maximum');
  assert.equal(result.critical_minutes, 2, 'clamped to the declared minimum');
});

test('a zero or negative threshold can never be stored', () => {
  // Zero would mean "escalate the instant a call is logged" — every call
  // becomes a Critical interrupt and the alert channel stops meaning anything.
  for (const value of ['0', '-5', '-1']) {
    const result = sanitiseAutomationConfig('sla_unassigned', { warn_minutes: value });
    assert.ok(
      typeof result.warn_minutes === 'number' && result.warn_minutes >= 1,
      `${value} produced ${String(result.warn_minutes)}`,
    );
  }
});

test('junk input is dropped so the rule keeps its default', () => {
  // A dropped key means the rule function falls back to its own default, which
  // is always safe. Storing NaN would not be.
  assert.deepEqual(sanitiseAutomationConfig('sla_unassigned', { warn_minutes: 'soon' }), {});
  assert.deepEqual(sanitiseAutomationConfig('sla_unassigned', { warn_minutes: '' }), {});
});

test('keys no rule reads are discarded', () => {
  const result = sanitiseAutomationConfig('sla_unassigned', {
    warn_minutes: '10',
    something_invented: '42',
  });
  assert.deepEqual(result, { warn_minutes: 10 });
});

test('expiry windows are cleaned, clamped and ordered furthest-out first', () => {
  const result = sanitiseAutomationConfig('cert_expiry', { windows: '1, 900, junk, 7,30' });
  assert.equal(result.windows, '365,30,7,1');
});

test('an unknown rule key stores nothing at all', () => {
  assert.deepEqual(sanitiseAutomationConfig('not_a_rule', { anything: '1' }), {});
});

test('every declared field has bounds that make a zero impossible', () => {
  // A missing `min` would let any field accept 0, and for a threshold that
  // means "fire constantly". Checked across the whole catalogue so a rule added
  // later cannot quietly omit it.
  for (const [key, fields] of Object.entries(RULE_FIELDS)) {
    for (const field of fields) {
      assert.ok(
        typeof field.min === 'number',
        `${key}.${field.key} declares no minimum`,
      );
      assert.ok(
        typeof field.max === 'number' && field.max >= (field.min ?? 0),
        `${key}.${field.key} has no usable maximum`,
      );
      // The digest hour is the one legitimate zero: midnight.
      if (key !== 'daily_digest') {
        assert.ok(field.min >= 1, `${key}.${field.key} allows a zero threshold`);
      }
    }
  }
});

/* ── Health ─────────────────────────────────────────────────────────── */

test('a scheduler that is running reads as healthy', () => {
  const health = summariseAutomations([
    rule({ key: 'a', last_run_at: new Date().toISOString() }),
    rule({ key: 'b', last_run_at: new Date().toISOString() }),
  ]);
  assert.equal(health.stalled, false);
  assert.equal(health.enabled, 2);
});

test('rules all overdue by more than two intervals read as stalled', () => {
  // This is the failure that matters: the rules are correct and enabled, but
  // nothing is calling them, so no escalation fires and the console would
  // otherwise look fine.
  const longAgo = new Date(Date.now() - 60 * 60_000).toISOString();
  const health = summariseAutomations([
    rule({ key: 'a', interval_minutes: 5, last_run_at: longAgo }),
    rule({ key: 'b', interval_minutes: 10, last_run_at: longAgo }),
  ]);
  assert.equal(health.stalled, true);
});

test('one slow rule does not make the engine look stalled', () => {
  const longAgo = new Date(Date.now() - 60 * 60_000).toISOString();
  const health = summariseAutomations([
    rule({ key: 'a', interval_minutes: 5, last_run_at: new Date().toISOString() }),
    rule({ key: 'b', interval_minutes: 1440, last_run_at: longAgo }),
  ]);
  assert.equal(health.stalled, false, 'the engine is clearly ticking');
});

test('disabled rules are ignored when judging whether the engine is alive', () => {
  const longAgo = new Date(Date.now() - 60 * 60_000).toISOString();
  const health = summariseAutomations([
    rule({ key: 'a', enabled: false, last_run_at: longAgo }),
    rule({ key: 'b', enabled: true, last_run_at: new Date().toISOString() }),
  ]);
  assert.equal(health.stalled, false);
  assert.equal(health.enabled, 1);
  assert.equal(health.total, 2);
});

test('a never-run engine is stalled, not healthy', () => {
  const health = summariseAutomations([rule({ last_run_at: null, last_status: null })]);
  assert.equal(health.stalled, true);
  assert.equal(health.lastRunAt, null);
});

test('erroring rules are surfaced', () => {
  const health = summariseAutomations([
    rule({ key: 'a', last_status: 'ok' }),
    rule({ key: 'b', last_status: 'error', last_detail: 'boom' }),
  ]);
  assert.equal(health.erroring.length, 1);
  assert.equal(health.erroring[0]?.key, 'b');
});
