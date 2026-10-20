/** Run the real firearm issue migration (0089) against in-memory Postgres
 * (PGlite): who may issue and return a firearm, from which department, the
 * checks on what is entered, one return per issue, the audit trail, and no
 * direct writes to the register.
 *
 * CASE_PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node scripts/test-firearm-issue.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.CASE_PGLITE_MODULE || '@electric-sql/pglite');

const migration = readFileSync(new URL('../supabase/migrations/0089_firearm_issue.sql', import.meta.url), 'utf8');
const db = new PGlite();
let checks = 0;

const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = '20000000-0000-4000-8000-000000000001';
const T2 = '20000000-0000-4000-8000-000000000002';
const U = {
  sysadmin: id(1), captain: id(2), supervisor: id(3), policeAdmin: id(4), cop: id(5), fireChief: id(6), fireAdmin: id(7), dispatcher: id(8), otherOrg: id(9), controller: id(10),
};
const who = {
  [U.sysadmin]: ['SystemAdmin', 'Ethekwini', T, 'Sipho Admin'], [U.captain]: ['Captain', 'MetroPolice', T, 'Capt. Dube'],
  [U.supervisor]: ['Supervisor', 'MetroPolice', T, 'Sgt. Naidoo'], [U.policeAdmin]: ['Admin', 'MetroPolice', T, 'Police Admin'],
  [U.cop]: ['Police', 'MetroPolice', T, 'Const. Khumalo'], [U.fireChief]: ['FireChief', 'MetroFire', T, 'Chief Mthembu'],
  [U.fireAdmin]: ['Admin', 'MetroFire', T, 'Fire Admin'], [U.dispatcher]: ['Dispatcher', 'Ethekwini', T, 'Disp. Zulu'],
  [U.otherOrg]: ['SystemAdmin', 'Ethekwini', T2, 'Elsewhere'], [U.controller]: ['SystemController', 'Ethekwini', T, 'Sys Controller'],
};

async function as(uid) {
  const [role, silo, tenant] = who[uid];
  await db.query('reset role');
  await db.query("select set_config('test.user', $1, true), set_config('test.role', $2, true), set_config('test.silo', $3, true), set_config('test.tenant', $4, true)",
    [uid, role, silo, tenant]);
  await db.query('set local role authenticated');
}
async function refused(call, pattern, message) {
  await db.query('savepoint refused');
  try { await assert.rejects(call(), pattern, message); }
  finally { await db.query('rollback to savepoint refused'); }
}
async function scenario(label, work) {
  await db.query('reset role');
  await db.query('savepoint scenario');
  try { await work(); checks++; console.log(`PASS ${label}`); }
  catch (e) { console.log(`FAIL ${label}`); throw e; }
  finally { await db.query('rollback to savepoint scenario'); await db.query('reset role'); }
}
const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const good = (o = {}) => ({
  employee_name: 'Const. Khumalo', id_number: '9001015800087', firearm_number: 'Z9-1234', make: 'Glock 17', rounds: 15,
  from: iso(now), to: iso(now + 12 * 3600_000), chamber_status: 'Cleared', ...o,
});
const issue = (p) => db.query('select * from public.issue_firearm_authorization($1::jsonb)', [JSON.stringify(p)]).then((r) => r.rows[0]);
const giveBack = (fid, rounds, condition = null) =>
  db.query('select * from public.return_firearm_authorization($1, $2, $3)', [fid, rounds, condition]).then((r) => r.rows[0]);

try {
  await db.exec(`
    create role authenticated nologin; create role anon nologin; create role service_role nologin;
    create schema auth;
    create type public.silo as enum ('Ethekwini', 'MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user', true), '')::uuid $$;
    create function public.current_tenant() returns uuid language sql stable as $$ select nullif(current_setting('test.tenant', true), '')::uuid $$;
    create function public.current_silo() returns public.silo language sql stable as $$
      select coalesce(nullif(current_setting('test.silo', true), ''), 'Ethekwini')::public.silo $$;
    create function public.role_in(variadic roles text[]) returns boolean language sql stable as $$
      select current_setting('test.role', true) = any (roles) $$;
    create function public.require_role(variadic roles text[]) returns void language plpgsql as $$ begin
      if auth.uid() is null or not public.role_in(variadic roles) then raise exception 'Not permitted for your role' using errcode = '42501'; end if;
    end $$;
    create function public.is_global() returns boolean language sql stable as $$
      select public.role_in('SystemAdmin','SuperAdmin','Dispatcher','Operator','ControlRoom','IncidentLogger','Viewer','System','SystemController') $$;
    create table public.profiles (id uuid primary key, full_name text);
    create table public.audit_logs (id uuid primary key default gen_random_uuid(), tenant_id uuid, silo public.silo, user_id uuid,
      user_name text, action_type text, entity_type text, entity_id text, details text);
    -- As 0001, 0002 and 0030 left it.
    create table public.firearm_authorizations (
      id uuid primary key default gen_random_uuid(), tenant_id uuid not null default public.current_tenant(),
      silo public.silo not null default 'MetroPolice', user_id uuid, form_number text not null unique,
      employee_name text not null, company_number text, id_number text not null, firearm_number text not null, make text,
      rounds_ammunition int not null default 0, from_date timestamptz not null, to_date timestamptz not null,
      posted_location text, issued_by text, received_by text, rounds_returned int not null default 0,
      date_received timestamptz, signature text, condition text, chamber_status text, notes text,
      created_at timestamptz not null default now());
    alter table public.firearm_authorizations enable row level security;
    create policy tenant_isolation on public.firearm_authorizations as restrictive for all to authenticated
      using (tenant_id = public.current_tenant()) with check (tenant_id = public.current_tenant());
    create policy firearm_auth_read on public.firearm_authorizations for select
      using (silo = public.current_silo() or public.is_global() or user_id = auth.uid());
    create policy firearm_auth_write on public.firearm_authorizations for all
      using (silo = public.current_silo() and (user_id = auth.uid() or public.role_in('Captain','Supervisor','SystemAdmin','SuperAdmin','Admin')))
      with check (silo = public.current_silo());
    grant usage on schema public, auth to authenticated;
    grant select, insert, update, delete on public.firearm_authorizations to authenticated;
  `);
  for (const [uid, [, , , name]] of Object.entries(who)) await db.query('insert into public.profiles values ($1, $2)', [uid, name]);
  await db.exec(migration);
  await db.exec(migration); // safe to re-run
  await db.query('begin');

  await scenario('the system administrator (control room) issues for Metro Police — the 42501 that was reported', async () => {
    await as(U.sysadmin);
    const r = await issue(good({ issued_by: 'Someone else' }));
    assert.equal(r.silo, 'MetroPolice');
    assert.equal(r.tenant_id, T);
    assert.equal(r.issued_by, 'Sipho Admin', 'the issuer is who is signed in, not what was typed');
    assert.equal(r.rounds_ammunition, 15);
    assert.match(r.form_number, /^FA-\d{8}-\d{6}-\d{3}$/, 'a form number when none is given');
    await db.query('reset role');
    const audit = (await db.query("select action_type, details, silo from public.audit_logs")).rows;
    assert.deepEqual(audit.map((a) => a.action_type), ['FirearmIssued']);
    assert.match(audit[0].details, /Z9-1234 → Const\. Khumalo \(15 rounds\)/);
  });

  await scenario('Metro Police command issues; officers, other departments and dispatch do not', async () => {
    for (const u of [U.captain, U.supervisor, U.policeAdmin, U.controller]) {
      await as(u);
      await issue(good({ form_number: `F-${u.slice(-3)}` }));
    }
    await as(U.cop);
    await refused(() => issue(good()), /Not permitted/, 'an ordinary officer');
    await as(U.dispatcher);
    await refused(() => issue(good()), /Not permitted/, 'dispatch');
    await as(U.fireAdmin);
    await refused(() => issue(good()), /Only Metro Police/, 'another department’s administrator');
    await as(U.fireChief);
    await refused(() => issue(good()), /Not permitted/);
  });

  await scenario('what is entered is checked', async () => {
    await as(U.captain);
    await refused(() => issue(good({ employee_name: '  ' })), /employee's name/);
    await refused(() => issue(good({ id_number: '' })), /ID number/);
    await refused(() => issue(good({ firearm_number: null })), /serial number/);
    await refused(() => issue(good({ rounds: 'fifteen' })), /a number/);
    await refused(() => issue(good({ rounds: 900 })), /between 0 and 500/);
    await refused(() => issue(good({ to: iso(now - 3600_000) })), /after the "from" time/);
    await refused(() => issue(good({ to: iso(now + 9 * 86400_000) })), /at most 7 days/);
    await refused(() => issue(good({ chamber_status: 'Half' })), /Cleared, Loaded or Unknown/);
    await issue(good({ form_number: 'F-1' }));
    await refused(() => issue(good({ form_number: 'F-1' })), /already in the register/);
  });

  await scenario('returned once, by command, with the rounds counted', async () => {
    await as(U.sysadmin);
    const r = await issue(good());
    await as(U.cop);
    await refused(() => giveBack(r.id, 15), /Not permitted/, 'an officer cannot book it back in');
    await as(U.supervisor);
    await refused(() => giveBack(r.id, 16), /between 0 and the 15 issued/);
    const back = await giveBack(r.id, 14, 'Good');
    assert.equal(back.rounds_returned, 14);
    assert.equal(back.received_by, 'Sgt. Naidoo');
    assert.ok(back.date_received);
    await refused(() => giveBack(r.id, 14), /already returned/);
    await db.query('reset role');
    const audit = (await db.query("select details from public.audit_logs where action_type = 'FirearmReturned'")).rows;
    assert.match(audit[0].details, /14 of 15 rounds back, Good/);
  });

  await scenario('no direct writes to the register, by anyone', async () => {
    await as(U.captain);
    const r = await issue(good());
    await refused(() => db.query("insert into public.firearm_authorizations (form_number, employee_name, id_number, firearm_number, from_date, to_date) values ('X', 'A', '1', 'S', now(), now())"), /permission denied/);
    await refused(() => db.query('update public.firearm_authorizations set rounds_returned = 0'), /permission denied/);
    await refused(() => db.query('delete from public.firearm_authorizations'), /permission denied/);
    await as(U.cop);
    assert.equal((await db.query('select count(*)::int as n from public.firearm_authorizations')).rows[0].n, 1, 'officers still read the register');
    await as(U.otherOrg);
    assert.equal((await db.query('select count(*)::int as n from public.firearm_authorizations')).rows[0].n, 0, 'another organisation reads none');
    await refused(() => giveBack(r.id, 0), /Issue not found/, 'nor returns one');
  });

  await db.query('rollback');
  console.log(`\n${checks} scenarios passed; 0089 applied twice.`);
} finally {
  await db.close();
}
