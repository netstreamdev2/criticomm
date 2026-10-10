import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkStaffList, cleanStaffRow, departmentFrom, findHeaderRow, inviteChannelFor, mapHeaders, normaliseCellphone,
  normaliseWorkEmail, registerRolesFor, sameName, splitFullName, suggestRole, tidyLabel, tidyName,
  type RawStaffRow, type RegisterEntry,
} from './register.ts';

test('headings are found however HR wrote them', () => {
  const m = mapHeaders(['First Names *', 'SURNAME', 'Badge No.', 'Rank', 'Dept', 'Station', 'E-mail', 'Cell Number', 'Salary']);
  assert.deepEqual(m.columns, {
    first_name: 0, last_name: 1, badge_number: 2, rank: 3, department: 4, station: 5, work_email: 6, work_cellphone: 7,
  });
  assert.deepEqual(m.ignored, ['Salary'], 'columns we do not ask for are ignored, never read');
  assert.deepEqual(m.missing, []);

  const ours = mapHeaders(['First names', 'Surname', 'Badge number', 'Rank', 'Department', 'Station', 'Work email',
    'Work cellphone', 'Role in current system']);
  assert.equal(ours.columns.previous_role, 8, 'our own template maps exactly');

  const lone = mapHeaders(['Name', 'Force Number', 'Rank', 'Department']);
  assert.equal(lone.fullNameOnly, true, 'a lone Name column is the whole name');
  assert.equal(lone.badgeFromForceNumber, true, 'a force number stands in for a badge');
  assert.deepEqual(lone.missing, []);

  assert.deepEqual(mapHeaders(['First names', 'Surname', 'Rank']).missing, ['badge_number', 'department']);
});

test('the heading row may sit below a title', () => {
  const table = [['eThekwini staff list, October 2026'], [], ['Surname', 'First names', 'Badge number', 'Department'], ['Dlamini']];
  assert.equal(findHeaderRow(table), 2);
  assert.equal(findHeaderRow([['nothing'], ['useful']]), -1);
});

test('names, ranks and stations in capitals are tidied; mixed case is left alone', () => {
  assert.equal(tidyName('THANDEKA  DLAMINI'), 'Thandeka Dlamini');
  assert.equal(tidyName('PIETER VAN DER MERWE'), 'Pieter van der Merwe');
  assert.equal(tidyName("O'BRIEN-NKOSI"), "O'Brien-Nkosi");
  assert.equal(tidyName('McDonald'), 'McDonald');
  assert.equal(tidyLabel('ALS PARAMEDIC'), 'ALS Paramedic');
  assert.equal(tidyLabel('DURBAN CBD'), 'Durban CBD');
  assert.equal(tidyLabel('Station Officer'), 'Station Officer');
  assert.deepEqual(splitFullName('Thandeka Precious Dlamini'), { first: 'Thandeka Precious', last: 'Dlamini' });
});

test('cellphone numbers end up in one form', () => {
  assert.deepEqual(normaliseCellphone('082 123 4567'), { value: '+27821234567', ok: true });
  assert.deepEqual(normaliseCellphone('821234567'), { value: '+27821234567', ok: true }, 'Excel dropped the leading zero');
  assert.deepEqual(normaliseCellphone('+27 (82) 123-4567'), { value: '+27821234567', ok: true });
  assert.deepEqual(normaliseCellphone('27821234567'), { value: '+27821234567', ok: true });
  assert.deepEqual(normaliseCellphone(''), { value: null, ok: true });
  assert.equal(normaliseCellphone('12345').ok, false);
  assert.deepEqual(normaliseWorkEmail(' T.Dlamini@Durban.gov.za '), { value: 't.dlamini@durban.gov.za', ok: true });
  assert.equal(normaliseWorkEmail('t.dlamini at durban').ok, false);
});

test('departments as people write them', () => {
  assert.equal(departmentFrom('Fire & Rescue'), 'MetroFire');
  assert.equal(departmentFrom('FIRE AND RESCUE SERVICES'), 'MetroFire');
  assert.equal(departmentFrom('EMS / Medical'), 'Medical');
  assert.equal(departmentFrom('metro police'), 'MetroPolice');
  assert.equal(departmentFrom('MetroPolice'), 'MetroPolice');
  assert.equal(departmentFrom('Disaster Management'), 'EthekwiniDisaster');
  assert.equal(departmentFrom('Control Room'), 'Ethekwini');
  assert.equal(departmentFrom('SAPS'), null, 'the national police is not ours');
  assert.equal(departmentFrom(''), null);
});

test('roles are suggested from the old system, never administrator rights', () => {
  assert.equal(suggestRole('Officer', 'MetroPolice').role, 'Police');
  assert.equal(suggestRole('Operator', 'Ethekwini').role, 'ControlRoom');
  assert.equal(suggestRole('Chief', 'MetroFire').role, 'FireChief');
  assert.equal(suggestRole('Responder', 'Medical').role, 'Paramedic');
  assert.equal(suggestRole('Responder', 'Ethekwini').role, null);
  assert.equal(suggestRole('Security', 'MetroPolice').role, 'Staff');
  assert.equal(suggestRole('SystemAdmin', 'Ethekwini').role, null);
  assert.match(suggestRole('SystemAdmin', 'Ethekwini').note ?? '', /not carried over/);
  assert.equal(suggestRole('Citizen', null).role, null);
  // Never another department's field role.
  assert.equal(suggestRole('Captain', 'EthekwiniDisaster').role, null);
  assert.equal(suggestRole('Captain', 'EthekwiniDisaster').note, 'A Captain works in Metro Police. Choose a Disaster Management role.');
  assert.equal(suggestRole('Firefighter', 'MetroFire').role, 'Firefighter');
  assert.equal(suggestRole('Supervisor', 'EthekwiniDisaster').role, 'Supervisor');
  assert.equal(suggestRole('', 'MetroPolice').role, null);
});

test('only everyday roles are set in the register; administrators are invited one by one', () => {
  assert.ok(registerRolesFor('SystemAdmin').includes('Dispatcher'));
  assert.ok(!registerRolesFor('SystemAdmin').includes('Admin'));
  assert.ok(!registerRolesFor('SystemAdmin').includes('SystemController'));
  assert.ok(registerRolesFor('Admin').includes('Police'));
  assert.ok(!registerRolesFor('Admin').includes('Dispatcher'), 'a department Admin sets department roles only');
  assert.deepEqual(registerRolesFor('Police'), []);
});

test('the same person, allowing for initials', () => {
  assert.ok(sameName({ first_name: 'N.', last_name: 'Shabalala' }, { first_name: 'Nomsa', last_name: 'Shabalala' }));
  assert.ok(sameName({ first_name: 'Thandeka', last_name: 'Dlamini' }, { first_name: 'THANDEKA P', last_name: 'DLAMINI' }));
  assert.ok(!sameName({ first_name: 'Anele', last_name: 'Buthelezi' }, { first_name: 'Nomsa', last_name: 'Shabalala' }));
  assert.ok(!sameName({ first_name: 'Anele', last_name: 'Shabalala' }, { first_name: 'Nomsa', last_name: 'Shabalala' }));
});

test('a row lists everything wrong with it, and fixes clear them', () => {
  const raw: RawStaffRow = { line: 7, first_name: 'Sbu', last_name: 'Mthembu', badge_number: 'FF-2290', rank: '',
    department: 'Fire Brigade', work_email: 'not-an-email', work_cellphone: '123' };
  const { issues } = cleanStaffRow(raw);
  assert.deepEqual(issues.map((i) => i.code), ['no-rank', 'unknown-department', 'bad-email', 'bad-phone']);
  const fixed = cleanStaffRow(raw, { rank: 'Firefighter', silo: 'MetroFire', dropEmail: true, dropPhone: true });
  assert.deepEqual(fixed.issues, []);
  assert.equal(fixed.person.silo, 'MetroFire');
  assert.equal(fixed.person.work_email, null);
});

const entry = (over: Partial<RegisterEntry>): RegisterEntry => ({
  id: 'r1', first_name: 'Anele', last_name: 'Buthelezi', badge_number: 'MP-1101', rank: 'Constable', silo: 'MetroPolice',
  station: 'Durban Central', work_email: null, work_cellphone: null, previous_role: null, force_number: null,
  user_id: null, left_at: null, proposed_role: null, role_confirmed_at: null, ...over,
});

test('checking a staff list against the register', () => {
  const register: RegisterEntry[] = [
    entry({}),
    entry({ id: 'r2', first_name: 'Thandeka', last_name: 'Dlamini', badge_number: 'MP-1042', station: 'Pinetown' }),
    entry({ id: 'r3', first_name: 'Bheki', last_name: 'Zulu', badge_number: 'MP-2000' }),
    entry({ id: 'r4', first_name: 'Sipho', last_name: 'Ndlovu', badge_number: 'FF-1000', silo: 'MetroFire', user_id: 'u4' }),
    entry({ id: 'r5', first_name: 'Left', last_name: 'Gone', badge_number: 'MP-3000', left_at: '2026-09-01' }),
    entry({ id: 'r6', first_name: 'Same', last_name: 'Badge', badge_number: 'MP-4000' }),
    entry({ id: 'r7', first_name: 'Same', last_name: 'Badge', badge_number: 'mp 4000' }),
    entry({ id: 'r8', first_name: 'Other', last_name: 'Department', badge_number: 'EM-1', silo: 'Medical' }),
  ];
  const rows: RawStaffRow[] = [
    { line: 2, first_name: 'LWAZI', last_name: 'CELE', badge_number: 'MP-5000', rank: 'CONSTABLE', department: 'Metro Police', previous_role: 'Officer', work_cellphone: '0821234567' },
    { line: 3, first_name: 'Thandeka', last_name: 'Dlamini', badge_number: 'mp1042', rank: 'Constable', department: 'Metro Police', station: 'Durban Central', work_email: 't.dlamini@durban.gov.za' },
    { line: 4, first_name: 'N.', last_name: 'Shabalala', badge_number: 'MP-1101', rank: 'Constable', department: 'Metro Police' },
    { line: 5, first_name: 'Sipho', last_name: 'Ndlovu', badge_number: 'FF-1000', rank: 'Constable', department: 'Metro Police' },
    { line: 6, first_name: 'Left', last_name: 'Gone', badge_number: 'MP-3000', rank: 'Constable', department: 'Metro Police' },
    { line: 7, first_name: 'Same', last_name: 'Badge', badge_number: 'MP-4000', rank: 'Constable', department: 'Metro Police' },
    { line: 8, first_name: 'Lwazi', last_name: 'Cele', badge_number: 'MP 5000', rank: 'Constable', department: 'metro police', previous_role: 'Officer', work_cellphone: '082 123 4567' },
    { line: 9, first_name: 'Two', last_name: 'Versions', badge_number: 'MP-6000', rank: 'Constable', department: 'Metro Police' },
    { line: 10, first_name: 'Two', last_name: 'Versions', badge_number: 'MP-6000', rank: 'Sergeant', department: 'Metro Police' },
    { line: 11, first_name: '', last_name: 'Nobody', badge_number: '', rank: 'Constable', department: 'Metro Police' },
  ];
  const res = checkStaffList(rows, register);
  const at = (line: number) => res.rows.find((r) => r.line === line)!;

  assert.equal(at(2).outcome, 'add');
  assert.equal(at(2).person.first_name, 'Lwazi');
  assert.equal(at(2).suggestedRole, 'Police');
  assert.equal(at(8).outcome, 'merged', 'the same person twice is merged');
  assert.equal(at(8).mergedInto, 2);

  assert.equal(at(3).outcome, 'update');
  assert.deepEqual(at(3).changes.map((c) => c.field), ['station', 'work_email']);

  assert.equal(at(4).outcome, 'attention');
  assert.equal(at(4).issues[0]?.code, 'name-mismatch');
  assert.match(at(4).issues[0]?.message ?? '', /already belongs to Anele Buthelezi/);

  assert.equal(at(5).outcome, 'unchanged', 'an account holder keeps their department');
  assert.match(at(5).notes[0] ?? '', /account page/);

  assert.equal(at(6).outcome, 'update', 'someone marked as left comes back');
  assert.equal(at(7).issues[0]?.code, 'register-duplicate');
  assert.equal(at(9).issues.at(-1)?.code, 'file-duplicate');
  assert.equal(at(10).outcome, 'attention');
  assert.deepEqual(at(11).issues.map((i) => i.code), ['no-badge', 'no-name']);

  assert.deepEqual(res.counts, { add: 1, update: 2, unchanged: 1, merged: 1, attention: 5, skipped: 0 });
  assert.deepEqual(res.departments, ['MetroPolice']);
  assert.deepEqual(res.notListed.map((e) => e.id), ['r3'], 'missing from the list, in a department it covers');
  assert.deepEqual(res.toImport.map((r) => r.line), [2, 3, 5, 6]);
  assert.equal(res.toImport[0]?.proposed_role, 'Police');

  // Deciding on screen.
  const fixed = checkStaffList(rows, register, { 4: { acceptMatch: true }, 10: { skip: true }, 11: { skip: true } });
  const f = (line: number) => fixed.rows.find((r) => r.line === line)!;
  assert.equal(f(4).outcome, 'update', 'accepted as the same person');
  assert.equal(f(9).outcome, 'add', 'with the other version skipped, the row goes in');
  assert.equal(f(10).outcome, 'skipped');
  assert.equal(fixed.counts.attention, 1, 'only the register duplicate still waits');
});

test('how an invitation would reach someone', () => {
  const on = { email: true, sms: true };
  assert.equal(inviteChannelFor({ work_email: 'a@b.co', work_cellphone: '+27821234567' }, on), 'email');
  assert.equal(inviteChannelFor({ work_email: null, work_cellphone: '+27821234567' }, on), 'sms');
  assert.equal(inviteChannelFor({ work_email: null, work_cellphone: '+27821234567' }, { email: true, sms: false }), 'code');
  assert.equal(inviteChannelFor({ work_email: 'a@b.co', work_cellphone: null }, { email: false, sms: false }), 'code');
});
