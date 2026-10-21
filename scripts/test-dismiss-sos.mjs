/** Run the real SOS dismissal migration (0093) against in-memory Postgres
 * (PGlite): who may dismiss, a reason every time, the call leaves the live
 * screens without being Closed, its alerts are withdrawn, it is on the
 * record, and a department's desk keeps to its own calls.
 *
 * CASE_PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node scripts/test-dismiss-sos.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.CASE_PGLITE_MODULE || '@electric-sql/pglite');

const migration = readFileSync(new URL('../supabase/migrations/0093_dismiss_sos.sql', import.meta.url), 'utf8');
const db = new PGlite();
let checks = 0;

const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = '20000000-0000-4000-8000-000000000001';
const T2 = '20000000-0000-4000-8000-000000000002';
const U = {
  sysadmin: id(1), superadmin: id(2), controller: id(3), controlDispatcher: id(4), fireDispatcher: id(5),
  cop: id(6), supervisor: id(7), viewer: id(8), otherOrg: id(9), captain: id(10),
};
const who = {
  [U.sysadmin]: ['SystemAdmin', 'Ethekwini', T, 'Sipho Admin'], [U.superadmin]: ['SuperAdmin', 'Ethekwini', T, 'Super Admin'],
  [U.controller]: ['SystemController', 'Ethekwini', T, 'Sys Controller'], [U.controlDispatcher]: ['Dispatcher', 'Ethekwini', T, 'Disp. Zulu'],
  [U.fireDispatcher]: ['Dispatcher', 'MetroFire', T, 'Fire Disp.'], [U.cop]: ['Police', 'MetroPolice', T, 'Const. Khumalo'],
  [U.supervisor]: ['Supervisor', 'MetroPolice', T, 'Sgt. Naidoo'], [U.viewer]: ['Viewer', 'Ethekwini', T, 'Vusi Viewer'],
  [U.otherOrg]: ['SystemAdmin', 'Ethekwini', T2, 'Elsewhere'], [U.captain]: ['Captain', 'MetroPolice', T, 'Capt. Dube'],
};
const SOS = id(201);
const SOS2 = id(202);
const CALL = id(203);

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
const dismiss = (incident, reason = 'Pressed by mistake') =>
  db.query('select * from public.dismiss_sos($1, $2)', [incident, reason]).then((r) => r.rows[0]);
const call = async (incident) => { await db.query('reset role'); return (await db.query('select * from public.incidents where id = $1', [incident])).rows[0]; };

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
    create table public.profiles (id uuid primary key, full_name text);
    create table public.incidents (id uuid primary key, tenant_id uuid not null, silo public.silo not null, incident_number text,
      source text, status text not null, caller_name text, notes text, resolved_at timestamptz, closed_at timestamptz,
      dispatched_silos public.silo[] default '{}');
    create table public.alerts (id uuid primary key default gen_random_uuid(), tenant_id uuid, incident_id uuid, kind text,
      target_user_id uuid, withdrawn_at timestamptz, withdrawn_by uuid);
    create table public.incident_updates (id uuid primary key default gen_random_uuid(), silo public.silo, incident_id uuid,
      message text, created_by uuid, created_by_name text, timestamp timestamptz default now());
    create table public.audit_logs (id uuid primary key default gen_random_uuid(), tenant_id uuid, silo public.silo, user_id uuid,
      user_name text, action_type text, entity_type text, entity_id text, details text);
    -- The desk scope (0068), in short: a department's dispatch desk changes only its own department's calls.
    create function public.guard_desk_scope() returns trigger language plpgsql as $$ begin
      if public.role_in('Dispatcher') and public.current_silo() <> 'Ethekwini'
         and not (old.silo = public.current_silo() or public.current_silo() = any (coalesce(old.dispatched_silos, '{}'))) then
        raise exception '% was not sent to your dispatch desk', old.incident_number using errcode = '42501';
      end if;
      return new;
    end $$;
    create trigger guard_desk_scope before update on public.incidents for each row execute function public.guard_desk_scope();
    insert into public.incidents (id, tenant_id, silo, incident_number, source, status, caller_name) values
      ('${SOS}', '${T}', 'MetroPolice', 'MP-20261002-0002', 'Responder-Panic', 'Pending', 'Test Officer Two'),
      ('${SOS2}', '${T}', 'MetroPolice', 'MP-20261002-0003', 'Responder-Panic', 'Dispatched', 'Test Officer Two'),
      ('${CALL}', '${T}', 'MetroPolice', 'MP-20261020-0010', 'Call-Center', 'Pending', 'A citizen');
    insert into public.alerts (tenant_id, incident_id, kind, target_user_id) values
      ('${T}', '${SOS}', 'sos', '${U.controlDispatcher}'), ('${T}', '${SOS}', 'sos', '${U.supervisor}'),
      ('${T}', '${SOS}', 'assignment', '${U.cop}');
    grant usage on schema public, auth to authenticated;
  `);
  for (const [uid, [, , , name]] of Object.entries(who)) await db.query('insert into public.profiles values ($1, $2)', [uid, name]);
  await db.exec(migration);
  await db.exec(migration); // safe to re-run
  await db.query('begin');

  await scenario('the system administrator dismisses an SOS: off the live screens, alerts withdrawn, on the record', async () => {
    await as(U.sysadmin);
    const r = await dismiss(SOS, '  Pressed by mistake  ');
    assert.equal(r.status, 'Resolved', 'off the live screens');
    assert.equal(r.closed_at, null, 'never Closed: that stays the case review\'s');
    assert.ok(r.sos_dismissed_at);
    assert.equal(r.sos_dismissed_by, U.sysadmin);
    assert.equal(r.sos_dismissed_by_name, 'Sipho Admin');
    assert.equal(r.sos_dismiss_reason, 'Pressed by mistake');
    assert.match(r.notes, /SOS dismissed by Sipho Admin: Pressed by mistake/);
    await db.query('reset role');
    const alerts = (await db.query("select kind, withdrawn_at, withdrawn_by from public.alerts where incident_id = $1 order by kind", [SOS])).rows;
    assert.equal(alerts.find((a) => a.kind === 'assignment').withdrawn_at, null, 'only the SOS alerts');
    assert.ok(alerts.filter((a) => a.kind === 'sos').every((a) => a.withdrawn_at && a.withdrawn_by === U.sysadmin), 'every SOS alert withdrawn');
    const timeline = (await db.query("select message, created_by_name from public.incident_updates where incident_id = $1", [SOS])).rows;
    assert.deepEqual(timeline, [{ message: 'SOS dismissed by Sipho Admin: Pressed by mistake', created_by_name: 'Sipho Admin' }], 'on the call timeline');
    const audit = (await db.query("select action_type, details, user_name from public.audit_logs")).rows;
    assert.deepEqual(audit.map((a) => a.action_type), ['SosDismissed']);
    assert.match(audit[0].details, /SOS MP-20261002-0002 from Test Officer Two dismissed: Pressed by mistake \(2 alerts withdrawn\)/);
  });

  await scenario('a second dismissal changes nothing and audits nothing more', async () => {
    await as(U.controller);
    const first = await dismiss(SOS);
    const again = await dismiss(SOS, 'Something else');
    assert.equal(again.sos_dismiss_reason, first.sos_dismiss_reason);
    await db.query('reset role');
    assert.equal((await db.query("select count(*)::int as n from public.audit_logs")).rows[0].n, 1);
  });

  await scenario('who may dismiss: super admin, system admin, the system controller and dispatch', async () => {
    for (const u of [U.superadmin, U.controller, U.controlDispatcher]) {
      await as(u);
      await db.query('savepoint each');
      assert.equal((await dismiss(SOS2)).status, 'Resolved', who[u][0]);
      await db.query('rollback to savepoint each');
    }
    for (const u of [U.cop, U.supervisor, U.viewer, U.captain]) {
      await as(u);
      await refused(() => dismiss(SOS2), /Not permitted/, who[u][0]);
    }
    await as(U.otherOrg);
    await refused(() => dismiss(SOS2), /Call not found/, 'another organisation');
  });

  await scenario('a department’s dispatch desk dismisses only the SOS calls sent to it', async () => {
    await as(U.fireDispatcher);
    await refused(() => dismiss(SOS2), /not sent to your dispatch desk/);
    assert.equal((await call(SOS2)).status, 'Dispatched', 'untouched');
  });

  await scenario('a reason every time; only an SOS; not one already finished', async () => {
    await as(U.sysadmin);
    await refused(() => dismiss(SOS, '  '), /Say why/);
    await refused(() => dismiss(SOS, 'no'), /Say why/);
    await refused(() => dismiss(SOS, 'x'.repeat(301)), /Keep the reason short/);
    await refused(() => dismiss(CALL), /is not an SOS/);
    await db.query('reset role');
    await db.query("update public.incidents set status = 'Closed' where id = $1", [SOS2]);
    await as(U.sysadmin);
    await refused(() => dismiss(SOS2), /already finished/);
  });

  await db.query('rollback');
  console.log(`\n${checks} scenarios passed; 0093 applied twice.`);
} finally {
  await db.close();
}
