import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canAccess, ROUTE_RULES } from './roles.ts';
import type { Silo, UserRole } from './types.generated.ts';

/**
 * The route matrix IS the authorization boundary for this system — the
 * middleware, sidebar, command palette and every quick link read from it.
 * A silent regression here means a responder can open a dispatch console, or
 * a call-taker loses the incident they were told to work.
 *
 * These tests pin the decisions that matter operationally. Run: pnpm test
 */

const at = (role: UserRole, silo: Silo = 'Ethekwini') => ({ role, silo });

/* ── The two-desk split: loggers log, dispatchers dispatch ─────────── */

test('IncidentLogger may capture a call but never work the dispatch desk', () => {
  const { role, silo } = at('IncidentLogger');
  assert.equal(canAccess('/dispatch/log-call', role, silo), true, 'intake is their job');
  assert.equal(canAccess('/dispatch/pending', role, silo), false, 'queue is not');
  assert.equal(canAccess('/dispatch/assign/abc', role, silo), false, 'assigning is not');
  assert.equal(canAccess('/dispatch/kpi', role, silo), false);
  assert.equal(canAccess('/dispatch/ptt', role, silo), false);
});

test('Dispatcher works the queue but never captures a call', () => {
  const { role, silo } = at('Dispatcher');
  assert.equal(canAccess('/dispatch/log-call', role, silo), false, 'intake is the call-taker desk');
  assert.equal(canAccess('/dispatch/pending', role, silo), true);
  assert.equal(canAccess('/dispatch/assign/abc', role, silo), true);
  assert.equal(canAccess('/dispatch/kpi', role, silo), true);
});

test('ControlRoom and Operator sit on both desks', () => {
  for (const role of ['ControlRoom', 'Operator'] as UserRole[]) {
    assert.equal(canAccess('/dispatch/log-call', role, 'Ethekwini'), true, `${role} intake`);
    assert.equal(canAccess('/dispatch/pending', role, 'Ethekwini'), true, `${role} queue`);
  }
});

/* ── The dispatch alert loop ───────────────────────────────────────── */

test('every responder can open the incident a dispatch alert links to', () => {
  // Alerts link at /incidents/{id}. If a responder cannot open that, the
  // acknowledge-and-open flow dead-ends at the login page.
  const responders: Array<[UserRole, Silo]> = [
    ['Firefighter', 'MetroFire'],
    ['Paramedic', 'Medical'],
    ['Police', 'MetroPolice'],
    ['Metro', 'MetroPolice'],
    ['Captain', 'MetroPolice'],
    ['Doctor', 'Medical'],
    ['Disaster', 'EthekwiniDisaster'],
    ['Officer', 'MetroPolice'],
    ['Security', 'MetroPolice'],
  ];
  for (const [role, silo] of responders) {
    assert.equal(
      canAccess('/incidents/8e34cc4f-6b06-4cd8-99a6-a9c30398d15e', role, silo),
      true,
      `${role} must be able to open a dispatched incident`,
    );
  }
});

/* ── Silo isolation ────────────────────────────────────────────────── */

test('field roles cannot cross into another department', () => {
  assert.equal(canAccess('/fire', 'Firefighter', 'MetroFire'), true);
  assert.equal(canAccess('/police', 'Firefighter', 'MetroFire'), false, 'fire cannot open police');
  assert.equal(canAccess('/medical', 'Police', 'MetroPolice'), false, 'police cannot open EMS');
  assert.equal(canAccess('/fire', 'Paramedic', 'Medical'), false, 'EMS cannot open fire');
});

test('global roles reach every silo', () => {
  for (const path of ['/police', '/fire', '/medical', '/disaster']) {
    assert.equal(canAccess(path, 'SystemAdmin', 'Ethekwini'), true, `admin → ${path}`);
  }
});

/* ── Administration is closed ──────────────────────────────────────── */

test('non-admins cannot reach any admin surface', () => {
  const adminPaths = [
    '/admin', '/admin/departments', '/admin/integrations',
    '/admin/operations', '/admin/personnel', '/admin/vehicles',
  ];
  const outsiders: UserRole[] = ['Dispatcher', 'Firefighter', 'Supervisor', 'Viewer', 'CaseManager'];
  for (const role of outsiders) {
    for (const path of adminPaths) {
      assert.equal(canAccess(path, role, 'Ethekwini'), false, `${role} must not reach ${path}`);
    }
  }
});

test('the admin tier reaches admin surfaces', () => {
  for (const role of ['Admin', 'SystemAdmin', 'SuperAdmin'] as UserRole[]) {
    assert.equal(canAccess('/admin/departments', role, 'Ethekwini'), true);
  }
});

/* ── Self-service is open to everyone who works here ───────────────── */

test('every working role can see their own schedule and file leave', () => {
  const everyone: Array<[UserRole, Silo]> = [
    ['Firefighter', 'MetroFire'],
    ['Paramedic', 'Medical'],
    ['Police', 'MetroPolice'],
    ['Dispatcher', 'Ethekwini'],
    ['IncidentLogger', 'Ethekwini'],
    ['ControlRoom', 'Ethekwini'],
    ['CaseManager', 'Ethekwini'],
    ['Supervisor', 'Ethekwini'],
    ['Disaster', 'EthekwiniDisaster'],
  ];
  for (const [role, silo] of everyone) {
    assert.equal(canAccess('/roster/mine', role, silo), true, `${role} schedule`);
    assert.equal(canAccess('/leave', role, silo), true, `${role} leave`);
  }
});

test('building the roster stays with supervisors', () => {
  assert.equal(canAccess('/roster', 'Firefighter', 'MetroFire'), false);
  assert.equal(canAccess('/roster', 'Supervisor', 'Ethekwini'), true);
  assert.equal(canAccess('/roster', 'FireChief', 'MetroFire'), true);
});

/* ── Matrix hygiene ────────────────────────────────────────────────── */

test('longest-prefix wins, so specific rules override general ones', () => {
  // /dispatch/log-call must beat /dispatch, and /roster/mine must beat /roster.
  const rules = ROUTE_RULES.filter((r) => '/dispatch/log-call'.startsWith(r.prefix));
  assert.ok(rules.length > 1, 'both /dispatch and /dispatch/log-call should match');
  assert.equal(canAccess('/dispatch/log-call', 'IncidentLogger', 'Ethekwini'), true);
  assert.equal(canAccess('/roster/mine', 'Firefighter', 'MetroFire'), true);
});

test('an unmapped route is authenticated-only, never public', () => {
  // canAccess answers "may this signed-in user proceed"; the middleware has
  // already rejected anonymous callers. Unmapped routes must not throw.
  assert.equal(canAccess('/some/new/page', 'Viewer', 'Ethekwini'), true);
});
