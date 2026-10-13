import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as roles from './roles.ts';
import {
  accessChanges, ASSIGNABLE_ROLES, canAccess, confirmWordFor, needsSecondApproval, normaliseConfirm,
  receivesLiveOperations, RETIRED_ROLES, rolesAssignableBy, ROUTE_RULES, TENANT_WIDE_ROLES,
} from './roles.ts';
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

test('ControlRoom sits on both desks', () => {
  assert.equal(canAccess('/dispatch/log-call', 'ControlRoom', 'Ethekwini'), true, 'intake');
  assert.equal(canAccess('/dispatch/pending', 'ControlRoom', 'Ethekwini'), true, 'queue');
});

/* ── The dispatch alert loop ───────────────────────────────────────── */

test('every responder can open the incident a dispatch alert links to', () => {
  // Alerts link at /incidents/{id}. If a responder cannot open that, the
  // acknowledge-and-open flow dead-ends at the login page.
  const responders: Array<[UserRole, Silo]> = [
    ['Firefighter', 'MetroFire'],
    ['Paramedic', 'Medical'],
    ['Police', 'MetroPolice'],
    ['Captain', 'MetroPolice'],
    ['FireChief', 'MetroFire'],
    ['Doctor', 'Medical'],
    ['Disaster', 'EthekwiniDisaster'],
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

/* ── The admin ladder (0046) ───────────────────────────────────────── */

const SILOS: Silo[] = ['Ethekwini', 'MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster'];

test('SuperAdmin opens every screen a SystemAdmin opens, in every department', () => {
  for (const { prefix } of ROUTE_RULES) {
    for (const silo of SILOS) {
      if (canAccess(prefix, 'SystemAdmin', silo)) {
        assert.equal(canAccess(prefix, 'SuperAdmin', silo), true, `SuperAdmin must reach ${prefix} (${silo})`);
      }
    }
  }
});

test('tenant, feature and access administration stay with the SuperAdmin desk', () => {
  // Route-level these are the admin tier; the pages and actions themselves
  // refuse anyone but SuperAdmin. The controller seat is kept out entirely.
  for (const path of ['/admin/tenants', '/admin/features', '/admin/access']) {
    assert.equal(canAccess(path, 'SystemController', 'Ethekwini'), false, path);
  }
});

const acct = (id: string, role: UserRole, silo: Silo = 'MetroPolice') => ({ id, role, silo });

test('only a SuperAdmin grants or removes SuperAdmin', () => {
  const sys = acct('sys', 'SystemAdmin', 'Ethekwini');
  const sup = acct('sup', 'SuperAdmin', 'Ethekwini');
  assert.ok(rolesAssignableBy(sup, acct('x', 'Police')).includes('SuperAdmin'));
  assert.ok(!rolesAssignableBy(sys, acct('x', 'Police')).includes('SuperAdmin'));
  assert.deepEqual(rolesAssignableBy(sys, acct('y', 'SuperAdmin')), [], 'SystemAdmin cannot touch a SuperAdmin');
});

test('a SystemAdmin manages every other role in the tenant', () => {
  const options = rolesAssignableBy(acct('sys', 'SystemAdmin', 'Ethekwini'), acct('x', 'Firefighter', 'MetroFire'));
  assert.deepEqual(options, ASSIGNABLE_ROLES.filter((r) => r !== 'SuperAdmin'));
});

test('a department Admin grants only department roles, only in their department', () => {
  const admin = acct('adm', 'Admin', 'MetroPolice');
  const options = rolesAssignableBy(admin, acct('x', 'Police', 'MetroPolice'));
  assert.ok(options.includes('Captain'));
  for (const wide of TENANT_WIDE_ROLES) assert.ok(!options.includes(wide), `Admin must not grant ${wide}`);
  assert.deepEqual(rolesAssignableBy(admin, acct('y', 'Firefighter', 'MetroFire')), [], 'other department');
  assert.deepEqual(rolesAssignableBy(admin, acct('z', 'Dispatcher', 'MetroPolice')), [], 'tenant-wide holder');
});

test('nobody changes their own role, and the rest of the desk cannot change roles at all', () => {
  for (const role of ['SuperAdmin', 'SystemAdmin', 'Admin'] as UserRole[]) {
    assert.deepEqual(rolesAssignableBy(acct('me', role), acct('me', role)), [], `${role} on themselves`);
  }
  for (const role of ['Supervisor', 'Captain', 'SystemController', 'Dispatcher', 'Police'] as UserRole[]) {
    assert.deepEqual(rolesAssignableBy(acct('me', role), acct('x', 'Police')), [], role);
  }
});

/* ── Retired roles (0045) ──────────────────────────────────────────── */

test('no role list or route rule names a retired role', () => {
  // A retired role in a list would quietly re-open a door 0045 closed.
  const lists = Object.entries(roles)
    .filter(([name, v]) => Array.isArray(v) && name !== 'RETIRED_ROLES' && name !== 'ROUTE_RULES');
  for (const [name, list] of lists) {
    for (const role of RETIRED_ROLES) {
      assert.ok(!(list as unknown[]).includes(role), `${name} must not include ${role}`);
    }
  }
  for (const rule of ROUTE_RULES) {
    for (const role of RETIRED_ROLES) {
      assert.ok(!rule.roles?.includes(role), `${rule.prefix} must not admit ${role}`);
    }
  }
});

test('a stale token holding a retired role opens no gated area', () => {
  for (const role of RETIRED_ROLES) {
    for (const [path, silo] of [
      ['/police', 'MetroPolice'], ['/fire', 'MetroFire'], ['/medical', 'Medical'],
      ['/dispatch/pending', 'Ethekwini'], ['/dispatch/log-call', 'Ethekwini'],
      ['/responder', 'MetroPolice'], ['/admin', 'Ethekwini'],
    ] as Array<[string, Silo]>) {
      assert.equal(canAccess(path, role, silo), false, `${role} must not open ${path}`);
    }
  }
});

test('every assignable role is a live one', () => {
  for (const role of ASSIGNABLE_ROLES) {
    assert.ok(!RETIRED_ROLES.includes(role), `${role} is retired`);
  }
  assert.equal(new Set(ASSIGNABLE_ROLES).size, ASSIGNABLE_ROLES.length, 'no duplicates');
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

/* ── Who is paged by live operations ───────────────────────────────── */

test('the SuperAdmin is never paged by day-to-day operations, but can still look', () => {
  assert.equal(receivesLiveOperations('SuperAdmin'), false);
  for (const role of ['Dispatcher', 'ControlRoom', 'Supervisor', 'Captain', 'FireChief', 'SystemController', 'SystemAdmin'] as UserRole[]) {
    assert.equal(receivesLiveOperations(role), true, role);
  }
  // Not paged is not locked out: the incident, the queue and the map stay open.
  for (const path of ['/incidents/abc', '/dispatch/pending', '/incidents/map']) {
    assert.equal(canAccess(path, 'SuperAdmin', 'Ethekwini'), true, path);
  }
});

/* ── Account safety rules (0048) ───────────────────────────────────── */

test('powerful roles wait for a second SystemAdmin, unless the SuperAdmin acts', () => {
  assert.equal(needsSecondApproval('SystemAdmin', 'Police', 'Admin'), true, 'granting Admin');
  assert.equal(needsSecondApproval('SystemAdmin', 'SystemAdmin', 'Viewer'), true, 'removing SystemAdmin');
  assert.equal(needsSecondApproval('SystemAdmin', 'Police', 'SystemController'), true, 'granting the controller seat');
  assert.equal(needsSecondApproval('SystemAdmin', 'Admin', 'Admin'), true, 'deactivating an Admin');
  assert.equal(needsSecondApproval('SystemAdmin', 'Police', 'Captain'), false, 'a field promotion');
  assert.equal(needsSecondApproval('Admin', 'Police', 'Captain'), false, 'a department Admin promoting');
  assert.equal(needsSecondApproval('SuperAdmin', 'Police', 'SystemAdmin'), false, 'the platform owner');
});

test('the confirmation is the badge number, else the full name, compared forgivingly', () => {
  assert.deepEqual(confirmWordFor({ id: 'x', badge_number: ' MP-1 ', full_name: 'A B' }), { word: 'MP-1', kind: 'badge number' });
  assert.deepEqual(confirmWordFor({ id: 'x', badge_number: null, full_name: 'A B' }, 'P-2000'), { word: 'P-2000', kind: 'badge number' });
  assert.deepEqual(confirmWordFor({ id: 'x', badge_number: '', full_name: 'Test Officer' }, null), { word: 'Test Officer', kind: 'full name' });
  assert.equal(confirmWordFor({ id: 'x', badge_number: null, full_name: null }).kind, 'account id');
  assert.equal(normaliseConfirm('  test   OFFICER two '), normaliseConfirm('Test Officer Two'));
  assert.notEqual(normaliseConfirm('MP-1001'), normaliseConfirm('MP-1002'));
});

test('a role change lists what the person gains and loses', () => {
  const up = accessChanges({ role: 'Police', silo: 'MetroPolice' }, { role: 'Captain', silo: 'MetroPolice' });
  assert.ok(up.gains.includes('Build rosters'), JSON.stringify(up));
  assert.ok(up.gains.includes('HR centre'));
  assert.deepEqual(up.losses, []);
  const down = accessChanges({ role: 'Captain', silo: 'MetroPolice' }, { role: 'Police', silo: 'MetroPolice' });
  assert.deepEqual(down.gains, []);
  assert.ok(down.losses.includes('Build rosters'));
  const admin = accessChanges({ role: 'Police', silo: 'MetroPolice' }, { role: 'SystemAdmin', silo: 'Ethekwini' });
  assert.ok(admin.gains.includes('Manage every account in the organisation'));
  assert.ok(admin.gains.includes('Administration'));
  const move = accessChanges({ role: 'Firefighter', silo: 'MetroFire' }, { role: 'Paramedic', silo: 'Medical' });
  assert.ok(move.gains.includes('EMS / Medical section') && move.losses.includes('Fire & Rescue section'), JSON.stringify(move));
});

test('only SystemAdmins and the SuperAdmin decide account requests', () => {
  for (const role of ['SystemAdmin', 'SuperAdmin'] as UserRole[]) {
    assert.equal(canAccess('/admin/approvals', role, 'Ethekwini'), true, role);
  }
  for (const role of ['Admin', 'SystemController', 'Supervisor', 'Dispatcher'] as UserRole[]) {
    assert.equal(canAccess('/admin/approvals', role, 'Ethekwini'), false, role);
  }
});

test('only administrators invite people', () => {
  for (const role of ['SuperAdmin', 'SystemAdmin', 'Admin'] as UserRole[]) {
    assert.equal(canAccess('/admin/invitations', role, 'MetroPolice'), true, role);
    assert.equal(canAccess('/admin/invitations/new', role, 'MetroPolice'), true, role);
  }
  for (const role of ['SystemController', 'Supervisor', 'Dispatcher', 'Police', 'Viewer'] as UserRole[]) {
    assert.equal(canAccess('/admin/invitations', role, 'Ethekwini'), false, role);
  }
});

test('the staff list is imported by SystemAdmins; the rollout is for administrators', () => {
  for (const role of ['SystemAdmin', 'SuperAdmin'] as UserRole[]) {
    assert.equal(canAccess('/admin/personnel/import', role, 'Ethekwini'), true, role);
  }
  for (const role of ['Admin', 'SystemController', 'Supervisor', 'Police'] as UserRole[]) {
    assert.equal(canAccess('/admin/personnel/import', role, 'MetroPolice'), false, role);
  }
  for (const role of ['SystemAdmin', 'SuperAdmin', 'Admin'] as UserRole[]) {
    assert.equal(canAccess('/admin/rollout', role, 'MetroPolice'), true, role);
  }
  for (const role of ['SystemController', 'Captain', 'Dispatcher'] as UserRole[]) {
    assert.equal(canAccess('/admin/rollout', role, 'Ethekwini'), false, role);
  }
  assert.equal(canAccess('/admin/personnel', 'Admin', 'MetroPolice'), true, 'department Admins keep the register');
});

test('the handbook is for administrators only', () => {
  for (const role of ['SuperAdmin', 'SystemAdmin', 'Admin'] as UserRole[]) {
    assert.equal(canAccess('/admin/handbook/staff-onboarding', role, 'Ethekwini'), true, role);
  }
  for (const role of ['SystemController', 'Supervisor', 'Dispatcher', 'Police', 'Viewer'] as UserRole[]) {
    assert.equal(canAccess('/admin/handbook/staff-onboarding', role, 'Ethekwini'), false, role);
  }
});

test('the armoury is kept by police command; the officers book out in the app', () => {
  for (const role of ['Captain', 'Supervisor', 'Admin'] as UserRole[]) {
    assert.equal(canAccess('/police/armoury', role, 'MetroPolice'), true, role);
    assert.equal(canAccess('/police/armoury/import', role, 'MetroPolice'), true, role);
  }
  for (const role of ['SystemAdmin', 'SuperAdmin', 'SystemController'] as UserRole[]) {
    assert.equal(canAccess('/police/armoury', role, 'Ethekwini'), true, role);
  }
  for (const role of ['Police', 'Dispatcher', 'Viewer', 'Firefighter'] as UserRole[]) {
    assert.equal(canAccess('/police/armoury', role, 'MetroPolice'), false, role);
  }
  assert.equal(canAccess('/police/armoury', 'Supervisor', 'MetroFire'), false, 'another department');
  assert.equal(canAccess('/police/armoury', 'Admin', 'Medical'), false, 'another department');
  assert.equal(canAccess('/police/firearms', 'Police', 'MetroPolice'), true, 'the issue register is unchanged');
});

test("today's shift board is for command staff", () => {
  for (const role of ['Supervisor', 'Captain', 'FireChief', 'Admin', 'SystemAdmin', 'SuperAdmin', 'SystemController', 'System'] as UserRole[]) {
    assert.equal(canAccess('/shift/today', role, 'MetroPolice'), true, role);
  }
  for (const role of ['Police', 'Firefighter', 'Paramedic', 'Dispatcher', 'Viewer'] as UserRole[]) {
    assert.equal(canAccess('/shift/today', role, 'MetroPolice'), false, role);
  }
  assert.equal(canAccess('/shift', 'Police', 'MetroPolice'), true, 'officers keep the start of shift');
});

test('map zones: command and control-room desks draw; field officers only look', () => {
  for (const role of ['ControlRoom', 'Dispatcher', 'IncidentLogger', 'Supervisor', 'Captain', 'FireChief', 'Disaster', 'SystemAdmin'] as UserRole[]) {
    assert.ok(roles.canDrawMapZones(role), role);
  }
  for (const role of ['Police', 'Firefighter', 'Paramedic', 'Doctor', 'Viewer', 'CaseManager', 'Staff'] as UserRole[]) {
    assert.ok(!roles.canDrawMapZones(role), role);
  }
});

test('map zones: the author, the control room and the department commander may change one', () => {
  const zone = { created_by: 'chief-1', silo: 'MetroFire' as Silo };
  assert.ok(roles.canManageMapZone(zone, { id: 'chief-1', role: 'FireChief', silo: 'MetroFire' }), 'author');
  assert.ok(roles.canManageMapZone(zone, { id: 'cr', role: 'ControlRoom', silo: 'Ethekwini' }), 'control room');
  assert.ok(roles.canManageMapZone(zone, { id: 'chief-2', role: 'FireChief', silo: 'MetroFire' }), 'same-department commander');
  assert.ok(!roles.canManageMapZone(zone, { id: 'cap', role: 'Captain', silo: 'MetroPolice' }), 'another department\'s commander');
  assert.ok(!roles.canManageMapZone(zone, { id: 'v', role: 'Viewer', silo: 'Ethekwini' }), 'viewer');
});

test('map zones: consoles are told, field officers\' screens are not (officer app comes later)', () => {
  for (const role of ['ControlRoom', 'Dispatcher', 'Captain', 'FireChief', 'Disaster', 'Viewer', 'Supervisor'] as UserRole[]) {
    assert.ok(roles.receivesZoneNotices(role), role);
  }
  for (const role of ['Police', 'Firefighter', 'Paramedic', 'Doctor', 'Staff', 'SuperAdmin'] as UserRole[]) {
    assert.ok(!roles.receivesZoneNotices(role), role);
  }
});

/* ── Case review and close (0061) ──────────────────────────────────────── */

test('case management opens for case managers, the desk and command, never for field officers', () => {
  for (const [role, silo] of [
    ['CaseManager', 'Ethekwini'], ['CaseManager', 'MetroPolice'], ['Supervisor', 'Ethekwini'],
    ['Captain', 'MetroPolice'], ['FireChief', 'MetroFire'], ['Dispatcher', 'Ethekwini'],
    ['SystemAdmin', 'Ethekwini'], ['Viewer', 'Ethekwini'], ['IncidentLogger', 'Ethekwini'],
  ] as Array<[UserRole, Silo]>) {
    for (const path of ['/case-manager', '/case-manager/review', '/case-manager/open', '/case-manager/closed', '/case-manager/audit']) {
      assert.equal(canAccess(path, role, silo), true, `${role} opens ${path}`);
    }
  }
  for (const [role, silo] of [['Police', 'MetroPolice'], ['Firefighter', 'MetroFire'], ['Paramedic', 'Medical'], ['Staff', 'Ethekwini']] as Array<[UserRole, Silo]>) {
    assert.equal(canAccess('/case-manager', role, silo), false, `${role} must not open case management`);
  }
});

test('a resolved case is closed after review; a live call is cancelled by the desk only, never by the case manager', () => {
  assert.equal(roles.caseStage('Resolved'), 'review');
  assert.equal(roles.caseStage('Closed'), 'closed');
  for (const s of ['Pending Dispatch', 'Dispatched', 'En Route', 'On Scene', 'Transporting']) {
    assert.equal(roles.caseStage(s), 'live', s);
  }

  assert.equal(roles.closeActionFor('CaseManager', 'Resolved'), 'review');
  assert.equal(roles.closeActionFor('CaseManager', 'On Scene'), null, 'the case manager does not cancel live calls');
  assert.equal(roles.closeActionFor('Dispatcher', 'Pending Dispatch'), 'cancel');
  assert.equal(roles.closeActionFor('Dispatcher', 'Resolved'), 'review');
  assert.equal(roles.closeActionFor('Captain', 'Resolved'), 'review');
  for (const role of ['IncidentLogger', 'Viewer', 'Police', 'Firefighter', 'Paramedic', 'Staff'] as UserRole[]) {
    assert.equal(roles.closeActionFor(role, 'Resolved'), null, `${role} never closes a case`);
    assert.equal(roles.closeActionFor(role, 'Dispatched'), null, `${role} never cancels a call`);
  }
  for (const role of roles.ASSIGNABLE_ROLES) {
    assert.equal(roles.closeActionFor(role, 'Closed'), null, `${role}: a closed case stays closed`);
  }
});

test('only the desk corrects a crew status from the console, and never to Resolved or Closed', () => {
  assert.ok(!roles.STATUS_OVERRIDE_STEPS.includes('Resolved' as never));
  assert.ok(!roles.STATUS_OVERRIDE_STEPS.includes('Closed' as never));
  for (const role of ['Police', 'Captain', 'CaseManager', 'Viewer', 'IncidentLogger'] as UserRole[]) {
    assert.ok(!roles.STATUS_OVERRIDE_ROLES.includes(role), `${role} has no console status override`);
  }
  // Everyone who can see the button must also pass the database's role gate.
  for (const role of roles.STATUS_OVERRIDE_ROLES) {
    assert.ok(roles.DISPATCH_ROLES.includes(role) || roles.ADMIN_ROLES.includes(role), role);
  }
});

test('the receiving doctor reads EMS reports and handovers but does not write them', () => {
  assert.equal(canAccess('/medical/handovers', 'Doctor', 'Medical'), true);
  assert.equal(canAccess('/medical/pcr', 'Doctor', 'Medical'), true);
  assert.equal(canAccess('/medical/pcr/new', 'Doctor', 'Medical'), false);
  assert.equal(canAccess('/medical/restock', 'Doctor', 'Medical'), false);
  assert.equal(canAccess('/medical/pcr/new', 'Paramedic', 'Medical'), true);
  assert.equal(canAccess('/medical/restock', 'Paramedic', 'Medical'), true);
  assert.equal(canAccess('/medical/pcr/new', 'Admin', 'Medical'), true);
});

test('a field role is offered only in its own department; desk roles everywhere', () => {
  const disaster = roles.rolesForDepartment(roles.ASSIGNABLE_ROLES, 'EthekwiniDisaster');
  for (const r of ['Police', 'Captain', 'Firefighter', 'FireChief', 'Paramedic', 'Doctor'] as UserRole[]) {
    assert.ok(!disaster.includes(r), `${r} is not a Disaster Management role`);
  }
  assert.ok(disaster.includes('Disaster') && disaster.includes('Admin') && disaster.includes('Supervisor'));
  const fire = roles.rolesForDepartment(roles.ASSIGNABLE_ROLES, 'MetroFire');
  assert.ok(fire.includes('Firefighter') && fire.includes('FireChief') && !fire.includes('Police') && !fire.includes('Disaster'));
  const control = roles.rolesForDepartment(roles.ASSIGNABLE_ROLES, 'Ethekwini');
  assert.ok(roles.RESPONDER_ROLES.every((r) => !control.includes(r)), 'the control room holds no field roles');
  for (const r of roles.RESPONDER_ROLES) assert.ok(roles.FIELD_ROLE_DEPARTMENT[r], `${r} has a department`);
});

/* ── Schedules (0072): the same ladder the database keeps ───────────── */

test('who rosters, who sets up, who decides — as schedule_rank() and its checks', () => {
  const { scheduleRank, canManageRoster, canAdminSchedule, isScheduleHr, outranksForSchedule } = roles;
  assert.deepEqual(
    (['SuperAdmin', 'SystemAdmin', 'SystemController', 'Admin', 'Captain', 'FireChief', 'Supervisor', 'Police', 'Dispatcher', 'ControlRoom'] as const)
      .map((r) => scheduleRank(r)),
    [5, 4, 4, 3, 2, 2, 1, 0, 0, 0],
  );
  assert.equal(canManageRoster('Supervisor', 'MetroPolice'), true);
  assert.equal(canManageRoster('Supervisor', 'MetroPolice', 'MetroFire'), false, 'never another department');
  assert.equal(canManageRoster('SystemAdmin', 'Ethekwini', 'MetroFire'), true, 'HR rosters any department');
  assert.equal(canManageRoster('Dispatcher', 'Ethekwini'), false);
  assert.equal(canManageRoster('ControlRoom', 'Ethekwini'), false, 'the control room supervisor rosters the control room, not the operator');
  assert.equal(canAdminSchedule('Admin', 'Medical'), true);
  assert.equal(canAdminSchedule('Admin', 'Medical', 'MetroFire'), false);
  assert.equal(canAdminSchedule('Captain', 'MetroPolice'), false, 'captains roster; the admin sets up');
  assert.equal(isScheduleHr('SystemAdmin'), true);
  assert.equal(isScheduleHr('Admin'), false);

  const p = (id: string, role: UserRole, silo: Silo = 'MetroPolice') => ({ id, role, silo });
  assert.equal(outranksForSchedule(p('s', 'Supervisor'), p('c', 'Police')), true);
  assert.equal(outranksForSchedule(p('s', 'Supervisor'), p('s2', 'Supervisor')), false, 'a sergeant does not decide for a sergeant');
  assert.equal(outranksForSchedule(p('s', 'Supervisor'), p('s', 'Supervisor')), false, 'never yourself');
  assert.equal(outranksForSchedule(p('cap', 'Captain'), p('s', 'Supervisor')), true);
  assert.equal(outranksForSchedule(p('f', 'Supervisor', 'MetroFire'), p('c', 'Police')), false, 'never across departments');
  assert.equal(outranksForSchedule(p('hr', 'SystemAdmin', 'Ethekwini'), p('a', 'Admin', 'Medical')), true);
  assert.equal(outranksForSchedule(p('hr', 'SystemAdmin', 'Ethekwini'), p('hr2', 'SystemAdmin', 'Ethekwini')), true, 'HR decide for one another');
  assert.equal(outranksForSchedule(p('c', 'Police'), p('c2', 'Police')), false);
});

test('schedule pages: setup and rosters for those who roster, My Schedule for everyone', () => {
  assert.equal(roles.canAccess('/roster/setup', 'Supervisor', 'MetroPolice'), true);
  assert.equal(roles.canAccess('/roster/setup', 'Police', 'MetroPolice'), false);
  assert.equal(roles.canAccess('/roster', 'SystemController', 'Ethekwini'), true);
  assert.equal(roles.canAccess('/roster/mine', 'ControlRoom', 'Ethekwini'), true);
  assert.equal(roles.canAccess('/leave', 'SystemController', 'Ethekwini'), true);
});

test('who directs a department on a shared call: its desk and command, the control room, the organisation', () => {
  assert.equal(roles.canDirectDepartment('Dispatcher', 'MetroFire', 'MetroFire'), true);
  assert.equal(roles.canDirectDepartment('Dispatcher', 'MetroFire', 'MetroPolice'), false, 'the Fire desk never directs Police');
  assert.equal(roles.canDirectDepartment('Dispatcher', 'Ethekwini', 'MetroPolice'), true, 'the control room directs every department');
  assert.equal(roles.canDirectDepartment('Captain', 'MetroPolice', 'MetroPolice'), true);
  assert.equal(roles.canDirectDepartment('SystemAdmin', 'Ethekwini', 'Medical'), true);
  assert.equal(roles.canDirectDepartment('Police', 'MetroPolice', 'MetroPolice'), false, 'field crews work their part, they do not direct it');
  assert.equal(roles.canDirectDepartment('CaseManager', 'Ethekwini', 'MetroPolice'), false);
  assert.equal(roles.commandsDepartment('Dispatcher', 'Medical', 'Medical'), false, 'a desk does not stand down a crew on scene');
  assert.equal(roles.commandsDepartment('Supervisor', 'Medical', 'Medical'), true);
  assert.equal(roles.commandsDepartment('FireChief', 'MetroFire', 'Medical'), false);
});

test('filing by radio (0075): the desk and command of the department, the control room, never the field', () => {
  assert.equal(roles.canFileByRadio('Dispatcher', 'MetroPolice', 'MetroPolice'), true);
  assert.equal(roles.canFileByRadio('Dispatcher', 'MetroFire', 'MetroPolice'), false, "another department's desk");
  assert.equal(roles.canFileByRadio('Dispatcher', 'Ethekwini', 'Medical'), true, 'the control room');
  assert.equal(roles.canFileByRadio('SystemController', 'Ethekwini', 'MetroFire'), true);
  for (const role of ['Police', 'Firefighter', 'Paramedic', 'Disaster', 'CaseManager', 'Viewer', 'IncidentLogger'] as UserRole[]) {
    assert.equal(roles.canFileByRadio(role, 'MetroPolice', 'MetroPolice'), false, role);
  }
  assert.ok(roles.PART_STATUS_ROLES.includes('SystemController'));
});
