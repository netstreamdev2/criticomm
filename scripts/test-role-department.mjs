/** Run the real role-and-department migration (0067) against in-memory
 * Postgres (PGlite): a field role exists only in its own department, and an
 * account is always in the department its staff register entry says — for
 * accounts, invitations and the register; desk roles fit anywhere.
 *
 * CASE_PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node scripts/test-role-department.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.CASE_PGLITE_MODULE || '@electric-sql/pglite');

const migration = readFileSync(new URL('../supabase/migrations/0067_role_fits_department.sql', import.meta.url), 'utf8');
const db = new PGlite();
let checks = 0;
const one = async (q, args) => (await db.query(q, args)).rows[0];

const T = '20000000-0000-4000-8000-000000000001';
const SYS = '10000000-0000-4000-8000-000000000001';
const ADMIN = '10000000-0000-4000-8000-000000000002';

async function as(uid) {
  await db.query("select set_config('test.user', $1, true)", [uid]);
}
async function refused(call, pattern, message) {
  await db.query('savepoint refused');
  try { await assert.rejects(call(), pattern, message); }
  finally { await db.query('rollback to savepoint refused'); }
}
async function scenario(label, work) {
  await db.query('savepoint scenario');
  try { await work(); checks++; console.log(`PASS ${label}`); }
  finally { await db.query('rollback to savepoint scenario'); }
}
const person = (silo, first, extra = {}) => one(
  `insert into public.personnel (tenant_id, silo, first_name, last_name, badge_number, proposed_role, role_confirmed_at, user_id)
   values ($1, $2, $3, 'Test', $4, $5, $6, $7) returning *`,
  [T, silo, first, `B-${first}`, extra.role ?? null, extra.confirmed ? new Date().toISOString() : null, extra.user ?? null]);

try {
  await db.exec(`
    create role authenticated nologin; create role anon nologin;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user', true), '')::uuid $$;
    create type public.silo as enum ('Ethekwini', 'MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster');
    create type public.user_role as enum ('SystemAdmin', 'SuperAdmin', 'Admin', 'Supervisor', 'Dispatcher', 'ControlRoom',
      'IncidentLogger', 'Viewer', 'System', 'Captain', 'Police', 'FireChief', 'Firefighter', 'Paramedic', 'Doctor',
      'Disaster', 'CaseManager', 'Staff', 'SystemController');
    create function public.current_tenant() returns uuid language sql stable as $$ select '${T}'::uuid $$;
    create table public.profiles (
      id uuid primary key default gen_random_uuid(), tenant_id uuid default '${T}', role public.user_role, silo public.silo,
      full_name text, deactivated_at timestamptz);
    create table public.personnel (
      id uuid primary key default gen_random_uuid(), tenant_id uuid not null, silo public.silo not null,
      first_name text, last_name text, badge_number text, user_id uuid, left_at timestamptz, updated_at timestamptz,
      proposed_role public.user_role, role_confirmed_at timestamptz, role_confirmed_by uuid, role_confirmed_by_name text);
    create table public.account_invitations (
      id uuid primary key default gen_random_uuid(), tenant_id uuid default '${T}', personnel_id uuid,
      role public.user_role not null, silo public.silo not null, status text not null default 'sent',
      closed_at timestamptz, closed_by uuid, closed_by_name text, close_note text);
    create table public.account_requests (
      id uuid primary key default gen_random_uuid(), status text not null default 'pending', invitation_id uuid,
      decided_by uuid, decided_by_name text, decided_at timestamptz, decision_note text);
    create table public.audit_logs (
      tenant_id uuid, silo public.silo, user_id uuid, user_name text, action_type text, entity_type text, entity_id text, details text);
    -- As 0050.
    create function public.register_actor() returns public.profiles language plpgsql stable as $$
    declare v public.profiles;
    begin
      select * into v from public.profiles where id = auth.uid() and deactivated_at is null;
      if not found then raise exception 'Not signed in' using errcode = '42501'; end if;
      return v;
    end $$;
    create function public.vet_register_change(p_actor public.profiles, p_person public.personnel, p_reason text)
    returns void language plpgsql stable as $$
    begin
      if p_actor.role not in ('SystemAdmin', 'SuperAdmin', 'Admin') then
        raise exception 'Only an administrator can do this' using errcode = '42501';
      end if;
      if length(btrim(coalesce(p_reason, ''))) < 10 then
        raise exception 'Give a reason of at least 10 characters: it goes on the permanent record' using errcode = '22023';
      end if;
    end $$;
    insert into public.profiles (id, role, silo, full_name) values
      ('${SYS}', 'SystemAdmin', 'Ethekwini', 'Sipho Admin'), ('${ADMIN}', 'Admin', 'Medical', 'Priya Medical');
    -- One record from before the rule, which the migration leaves alone.
    insert into public.profiles (role, silo) values ('Captain', 'EthekwiniDisaster');
  `);
  await db.exec(migration);
  await db.exec(migration); // safe to re-run
  await db.exec('begin');

  await scenario('each field role fits only its own department; desk roles fit all', async () => {
    const fits = async (role, silo) => (await one('select public.role_fits_department($1, $2) as v', [role, silo])).v;
    for (const [role, home] of [['Police', 'MetroPolice'], ['Captain', 'MetroPolice'], ['Firefighter', 'MetroFire'],
      ['FireChief', 'MetroFire'], ['Paramedic', 'Medical'], ['Doctor', 'Medical'], ['Disaster', 'EthekwiniDisaster']]) {
      for (const silo of ['Ethekwini', 'MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster']) {
        assert.equal(await fits(role, silo), silo === home, `${role} in ${silo}`);
      }
    }
    for (const role of ['Dispatcher', 'Supervisor', 'Admin', 'CaseManager', 'Staff']) {
      assert.equal(await fits(role, 'EthekwiniDisaster'), true, role);
    }
  });

  await scenario('a Disaster Management account cannot be a Captain or a Firefighter', async () => {
    await db.query("insert into public.profiles (role, silo) values ('Disaster', 'EthekwiniDisaster'), ('Admin', 'EthekwiniDisaster')");
    await refused(() => db.query("insert into public.profiles (role, silo) values ('Captain', 'EthekwiniDisaster')"),
      /A Captain works in Metro Police\. Choose a Disaster Management role\./);
    await refused(() => db.query("insert into public.profiles (role, silo) values ('Firefighter', 'EthekwiniDisaster')"),
      /A Firefighter works in Fire & Rescue/);
  });

  await scenario('moving or re-roling an account is checked too', async () => {
    const { id } = await one("insert into public.profiles (role, silo) values ('Paramedic', 'Medical') returning id");
    await refused(() => db.query("update public.profiles set silo = 'MetroFire' where id = $1", [id]), /A Paramedic works in EMS/);
    await refused(() => db.query("update public.profiles set role = 'Disaster' where id = $1", [id]), /A Disaster Management Officer works in Disaster Management/);
    await db.query("update public.profiles set role = 'Firefighter', silo = 'MetroFire' where id = $1", [id]);
  });

  await scenario('an account from before the rule is left as it was', async () => {
    assert.equal((await one("select count(*)::int as n from public.profiles where role = 'Captain' and silo = 'EthekwiniDisaster'")).n, 1);
  });

  await scenario('an invitation is refused the same way', async () => {
    await db.query("insert into public.account_invitations (role, silo) values ('Disaster', 'EthekwiniDisaster')");
    await refused(() => db.query("insert into public.account_invitations (role, silo) values ('Police', 'EthekwiniDisaster')"),
      /A Police Officer works in Metro Police/);
  });

  await scenario('an invitation is for the department the staff register says, never another', async () => {
    const mark = await person('Medical', 'Mark');
    await refused(() => db.query("insert into public.account_invitations (personnel_id, role, silo) values ($1, 'Supervisor', 'MetroPolice')", [mark.id]),
      /Mark Test is in EMS in the staff register\. Change their department in Personnel first, then invite them\./);
    await db.query("insert into public.account_invitations (personnel_id, role, silo) values ($1, 'Paramedic', 'Medical')", [mark.id]);
  });

  await scenario('the register: a confirmed role must fit, a suggestion that does not is dropped', async () => {
    await refused(() => person('EthekwiniDisaster', 'Themba', { role: 'Captain', confirmed: true }),
      /A Captain works in Metro Police\. Choose a Disaster Management role\. \(Themba Test\)/);
    assert.equal((await person('EthekwiniDisaster', 'Sbu', { role: 'Firefighter' })).proposed_role, null);
    assert.equal((await person('EthekwiniDisaster', 'Anele', { role: 'Disaster', confirmed: true })).proposed_role, 'Disaster');
  });

  await scenario('Change department: a SystemAdmin moves someone, with a reason; the old role and invitation go', async () => {
    const mark = await person('Medical', 'Mark', { role: 'Paramedic', confirmed: true });
    const inv = await one("insert into public.account_invitations (personnel_id, role, silo) values ($1, 'Paramedic', 'Medical') returning id", [mark.id]);
    await db.query('insert into public.account_requests (invitation_id) values ($1)', [inv.id]);
    await as(ADMIN);
    await refused(() => db.query("select public.move_register_person($1, 'MetroPolice', 'Works in Metro Police per HR')", [mark.id]),
      /Only a SystemAdmin moves people between departments/);
    await as(SYS);
    await refused(() => db.query("select public.move_register_person($1, 'MetroPolice', 'short')", [mark.id]), /at least 10 characters/);
    await refused(() => db.query("select public.move_register_person($1, 'Medical', 'Works in EMS per HR list')", [mark.id]), /already in EMS/);
    const res = await one("select public.move_register_person($1, 'MetroPolice', 'Works in Metro Police per HR list') as r", [mark.id]);
    assert.deepEqual(res.r, { status: 'moved', invitations_cancelled: 1 });
    const after = await one('select silo, proposed_role, role_confirmed_at from public.personnel where id = $1', [mark.id]);
    assert.deepEqual([after.silo, after.proposed_role, after.role_confirmed_at], ['MetroPolice', null, null]);
    assert.equal((await one('select status from public.account_invitations where id = $1', [inv.id])).status, 'cancelled');
    assert.equal((await one('select status from public.account_requests where invitation_id = $1', [inv.id])).status, 'cancelled');
    assert.match((await one("select details from public.audit_logs where action_type = 'PersonnelMoved'")).details, /moved from EMS to Metro Police/);
    await db.query("insert into public.account_invitations (personnel_id, role, silo) values ($1, 'Police', 'MetroPolice')", [mark.id]);
  });

  await scenario('someone with an account moves with the account, never on the register alone', async () => {
    const { id: uid } = await one("insert into public.profiles (role, silo) values ('Paramedic', 'Medical') returning id");
    const p = await person('Medical', 'Lwazi', { user: uid });
    await as(SYS);
    await refused(() => db.query("select public.move_register_person($1, 'MetroFire', 'Works in Fire per HR list')", [p.id]),
      /has an account\. Change their department on their account page/);
    await refused(() => db.query("update public.personnel set silo = 'MetroFire' where id = $1", [p.id]),
      /Lwazi Test has an account in EMS\. Change their department on their account page/);
    await db.query("update public.profiles set role = 'Firefighter', silo = 'MetroFire' where id = $1", [uid]);
    assert.equal((await one('select silo from public.personnel where id = $1', [p.id])).silo, 'MetroFire', 'the entry follows the account');
  });

  await scenario('an account is linked only to an entry in its own department', async () => {
    const { id: uid } = await one("insert into public.profiles (role, silo) values ('Supervisor', 'MetroPolice') returning id");
    const p = await person('Medical', 'Sanele');
    await refused(() => db.query('update public.personnel set user_id = $1 where id = $2', [uid, p.id]),
      /Sanele Test is in EMS in the staff register, not Metro Police\. Send a new invitation\./);
  });

  await db.exec('rollback');
  console.log(`\n${checks} scenarios passed`);
} catch (e) {
  console.error(e);
  process.exit(1);
}
