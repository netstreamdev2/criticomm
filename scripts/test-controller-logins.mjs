/** Run migration 0086 against in-memory Postgres (PGlite) on a stand-in for
 * the tables it touches, and try who may create logins: the systems
 * controller invites and creates logins (never a SystemAdmin or the
 * SuperAdmin), powerful roles still wait for a second SystemAdmin, the
 * controller sets roles and marks leavers, reads the invitations list, and a
 * supervisor or a visitor still cannot.
 *
 * CASE_PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node scripts/test-controller-logins.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.CASE_PGLITE_MODULE || '@electric-sql/pglite');

const migration = readFileSync(new URL('../supabase/migrations/0086_controller_creates_logins.sql', import.meta.url), 'utf8');
const db = new PGlite();
let checks = 0;
const one = async (q, args) => (await db.query(q, args)).rows[0];
const rows = async (q, args) => (await db.query(q, args)).rows;

const T = '20000000-0000-4000-8000-000000000001';
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const U = { controller: id(1), sysadmin: id(2), admin: id(3), sup: id(4), cop: id(5) };
const P = { ben: id(11), melissa: id(12), firey: id(13), gone: id(14) };

async function as(uid) {
  await db.query('reset role');
  await db.query("select set_config('test.user', $1, true)", [uid ?? '']);
  await db.query('set local role authenticated');
}
async function refused(call, pattern) {
  await db.query('savepoint refused');
  try { await assert.rejects(call(), pattern); } finally { await db.query('rollback to savepoint refused'); }
}
async function scenario(label, work) {
  await db.query('reset role');
  await db.query('savepoint scenario');
  try { await work(); checks++; console.log(`PASS ${label}`); }
  catch (e) { console.error(`FAIL ${label}`); throw e; }
  finally { await db.query('rollback to savepoint scenario'); await db.query('reset role'); }
}
const isPrivate = async (sig) => !(await one(`select has_function_privilege('authenticated', 'public.${sig}', 'EXECUTE') as ok`)).ok;
const direct = (person, role, silo, email) =>
  db.query('select public.create_direct_account($1, $2::public.user_role, $3::public.silo, $4, $5) as r',
    [person, role, silo, email, 'New appointment, HR memo 2026/140']);

try {
  await db.exec(`
    create role authenticated nologin; create role anon nologin; create role service_role nologin;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user', true), '')::uuid $$;
    create table auth.users (id uuid primary key, email text);
    create type public.silo as enum ('Ethekwini', 'MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster');
    create type public.user_role as enum ('SystemAdmin', 'SuperAdmin', 'Admin', 'Supervisor', 'Dispatcher', 'Operator',
      'ControlRoom', 'IncidentLogger', 'Viewer', 'System', 'Captain', 'Police', 'Officer', 'Metro', 'Security',
      'Chief', 'FireChief', 'Firefighter', 'Paramedic', 'Doctor', 'Disaster', 'CaseManager', 'Citizen',
      'Responder', 'Staff', 'SystemController');
    create function public.current_tenant() returns uuid language sql stable as $$ select '${T}'::uuid $$;
    create table public.profiles (id uuid primary key, tenant_id uuid not null, role public.user_role, silo public.silo,
      full_name text, deactivated_at timestamptz);
    create function public.current_silo() returns public.silo language sql stable security definer as $$
      select coalesce((select silo from public.profiles where id = auth.uid()), 'Ethekwini') $$;
    create function public.role_in(variadic roles public.user_role[]) returns boolean language sql stable security definer as $$
      select coalesce((select role = any (roles) from public.profiles where id = auth.uid() and deactivated_at is null), false) $$;
    create function public.is_powerful_role(p_role public.user_role) returns boolean language sql immutable as $$
      select p_role in ('SuperAdmin', 'SystemAdmin', 'Admin', 'SystemController') $$;
    create function public.normalise_badge(p_badge text) returns text language sql immutable as $$
      select upper(regexp_replace(coalesce(p_badge, ''), '[^A-Za-z0-9]', '', 'g')) $$;
    create function public.register_actor() returns public.profiles language plpgsql stable security definer as $$
      declare v public.profiles; begin
        select * into v from public.profiles where id = auth.uid() and deactivated_at is null;
        if not found then raise exception 'Not signed in' using errcode = '42501'; end if;
        return v; end $$;
    create table public.personnel (id uuid primary key, tenant_id uuid not null, silo public.silo not null,
      first_name text not null, last_name text not null, badge_number text not null, user_id uuid, left_at timestamptz,
      proposed_role public.user_role, role_confirmed_at timestamptz, role_confirmed_by uuid, role_confirmed_by_name text);
    create table public.account_invitations (id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
      personnel_id uuid, full_name text, badge_number text, role public.user_role not null, silo public.silo not null,
      channel text not null, email text, phone text, login_email text, reason text, needs_approval boolean,
      status text not null, expires_at timestamptz, invited_by uuid, invited_by_name text, sent_at timestamptz,
      sent_by_name text, closed_at timestamptz, closed_by uuid, closed_by_name text, close_note text);
    alter table public.account_invitations enable row level security;
    grant usage on schema public, auth to authenticated, anon;
    grant select on all tables in schema public to authenticated;
    grant select on auth.users to authenticated;
  `);
  const people = [
    [U.controller, 'SystemController', 'Ethekwini', 'Dianne Controller'],
    [U.sysadmin, 'SystemAdmin', 'Ethekwini', 'HR Admin'],
    [U.admin, 'Admin', 'MetroPolice', 'Police Admin'],
    [U.sup, 'Supervisor', 'MetroPolice', 'Sgt. Pillay'],
    [U.cop, 'Police', 'MetroPolice', 'Const. Dlamini'],
  ];
  for (const [uid, role, silo, name] of people) await db.query('insert into public.profiles values ($1, $2, $3, $4, $5, null)', [uid, T, role, silo, name]);
  for (const [pid, silo, first, last, badge, left] of [
    [P.ben, 'MetroPolice', 'Ben', 'Ndlovu', 'ME3010', null],
    [P.melissa, 'MetroPolice', 'Melissa', 'Naidoo', 'ME3011', null],
    [P.firey, 'MetroFire', 'Sipho', 'Zulu', 'FR2001', null],
    [P.gone, 'MetroPolice', 'Gone', 'Already', 'ME0001', new Date().toISOString()],
  ]) await db.query('insert into public.personnel (id, tenant_id, silo, first_name, last_name, badge_number, left_at) values ($1, $2, $3, $4, $5, $6, $7)', [pid, T, silo, first, last, badge, left]);
  await db.query(`insert into public.account_invitations (tenant_id, personnel_id, role, silo, channel, status, invited_by)
    values ($1, $2, 'Police', 'MetroPolice', 'code', 'ready', $3), ($1, $2, 'SystemAdmin', 'Ethekwini', 'email', 'awaiting_approval', $3)`,
    [T, P.melissa, U.sysadmin]);

  await db.exec('begin');
  await db.exec(migration);
  await db.exec(migration); // safe to re-run

  await scenario('the controller creates a login at once for an officer, in any department', async () => {
    await as(U.controller);
    const r = (await direct(P.ben, 'Police', 'MetroPolice', 'ben.ndlovu@durban.gov.za')).rows[0].r;
    assert.equal(r.full_name, 'Ben Ndlovu');
    const inv = await one("select channel, status, invited_by_name from public.account_invitations where personnel_id = $1 and channel = 'direct'", [P.ben]);
    assert.deepEqual(inv, { channel: 'direct', status: 'ready', invited_by_name: 'Dianne Controller' });
    await direct(P.firey, 'Firefighter', 'MetroFire', 'sipho.zulu@durban.gov.za');
  });

  await scenario('the controller never makes a SystemAdmin or SuperAdmin; powerful roles still need a second SystemAdmin', async () => {
    await as(U.controller);
    await refused(() => direct(P.ben, 'SystemAdmin', 'Ethekwini', 'b@durban.gov.za'), /Only a SystemAdmin can invite a SystemAdmin/);
    await refused(() => direct(P.ben, 'SuperAdmin', 'Ethekwini', 'b@durban.gov.za'), /Only a SuperAdmin/);
    await refused(() => direct(P.ben, 'Admin', 'MetroPolice', 'b@durban.gov.za'), /second SystemAdmin/);
    await refused(() => direct(P.ben, 'SystemController', 'Ethekwini', 'b@durban.gov.za'), /second SystemAdmin/);
    await refused(() => direct(P.gone, 'Police', 'MetroPolice', 'g@durban.gov.za'), /has left/);
    await refused(() => direct(P.ben, 'Police', 'MetroPolice', 'b@x'), /valid email/);
    // vet_invitation is internal (signed-in users cannot call it): checked as the database.
    await db.query('reset role');
    await refused(() => db.query("select public.vet_invitation(p, 'Police', 'MetroPolice', 'too short') from public.profiles p where id = $1", [U.controller]), /10 characters/);
    assert.equal(await isPrivate('vet_invitation(public.profiles, public.user_role, public.silo, text)'), true);
  });

  await scenario('a supervisor or an officer still cannot create logins; a department Admin cannot create one directly', async () => {
    for (const who of [U.sup, U.cop, U.admin]) {
      await as(who);
      await refused(() => direct(P.ben, 'Police', 'MetroPolice', 'ben@durban.gov.za'), /can create a login directly/);
    }
  });

  await scenario('the controller resends and cancels invitations below SystemAdmin, and reads the list', async () => {
    await db.query('reset role');
    assert.equal(await isPrivate('can_manage_invitation(public.profiles, public.account_invitations)'), true);
    const can = await rows(`select i.role::text as role, public.can_manage_invitation(p, i) as ok
      from public.account_invitations i, public.profiles p where p.id = $1 order by i.role::text`, [U.controller]);
    assert.deepEqual(can, [{ role: 'Police', ok: true }, { role: 'SystemAdmin', ok: false }]);
    await as(U.controller);
    assert.equal((await rows('select 1 from public.account_invitations')).length, 2, 'the controller reads the list');
    await as(U.sup);
    assert.equal((await rows('select 1 from public.account_invitations')).length, 0, 'a supervisor does not');
  });

  await scenario('the controller sets roles in any department and marks leavers; not powerful roles', async () => {
    await as(U.controller);
    const r = (await one(`select public.set_register_roles(array[$1, $2]::uuid[], 'Police') as r`, [P.ben, P.firey])).r;
    assert.equal(r.set, 2);
    await refused(() => db.query(`select public.set_register_roles(array[$1]::uuid[], 'Admin')`, [P.ben]), /one person at a time/);
    await db.query('reset role');
    await db.query(`select public.vet_register_change(a, p, 'Resigned, HR notice 2026/77') from public.profiles a, public.personnel p where a.id = $1 and p.id = $2`, [U.controller, P.ben]);
    await refused(() => db.query(`select public.vet_register_change(a, p, 'Resigned, HR notice 2026/77') from public.profiles a, public.personnel p where a.id = $1 and p.id = $2`, [U.sup, P.ben]), /administrator or the systems controller/);
    await as(U.sup);
    await refused(() => db.query(`select public.set_register_roles(array[$1]::uuid[], 'Police')`, [P.ben]), /administrator or the systems controller/);
  });

  await scenario('a visitor cannot reach direct creation', async () => {
    assert.equal((await one(`select has_function_privilege('anon', 'public.create_direct_account(uuid, public.user_role, public.silo, text, text)', 'EXECUTE') as ok`)).ok, false);
  });

  await db.exec('rollback');
  console.log(`\n${checks} scenarios passed.`);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}
