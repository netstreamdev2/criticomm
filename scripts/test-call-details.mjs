/** Run the real migrations 0076 and 0077 against in-memory Postgres (PGlite):
 * the new incident number (departments in pairs, South African date and
 * time, one counter per organisation per day), the details filled in for a
 * type, each type's code, and every organisation's incident types.
 *
 * CASE_PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node scripts/test-call-details.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.CASE_PGLITE_MODULE || '@electric-sql/pglite');

const read = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const sqlFn = (src, name) => {
  const start = src.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `${name} found`);
  const body = src.indexOf('$$', start);
  return src.slice(start, src.indexOf('$$;', body + 2) + 3);
};
const init = read('0001_init.sql');

const db = new PGlite();
let checks = 0;
const one = async (q, args) => (await db.query(q, args)).rows[0];
const rows = async (q, args) => (await db.query(q, args)).rows;

const T = '20000000-0000-4000-8000-000000000001';
const T2 = '20000000-0000-4000-8000-000000000002';
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ref = (n) => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const U = { logger: id(1), control: id(2), cop: id(3), other: id(4), firefighter: id(5) };
const PEOPLE = [
  [U.logger, 'IncidentLogger', 'Ethekwini', 'Lerato Logger', T],
  [U.control, 'ControlRoom', 'Ethekwini', 'Control Room', T],
  [U.cop, 'Police', 'MetroPolice', 'Const. Khumalo', T],
  [U.other, 'IncidentLogger', 'Ethekwini', 'Other Org Logger', T2],
  [U.firefighter, 'Firefighter', 'MetroFire', 'FF Dlamini', T],
];

async function as(uid) {
  await db.query('reset role');
  await db.query("select set_config('test.user', $1, true)", [uid]);
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

/** Today in South Africa, as the number writes it. */
const sastNow = async () => one(`select to_char(now() at time zone 'Africa/Johannesburg', 'YYYYMMDD') as day`);
const NUMBER = /^(MP|FD|MD|DM|CR|MPFD|MPMD|MPDM|FDMD|FDDM|MDDM|MPFD-MD|MPFD-DM|MPFD-MDDM|MPMD-DM|FDMD-DM)-(\d{8})-(\d{4})-(\d{4,})$/;

const logCall = (extra = {}) => db.query(
  `select * from public.log_incoming_call(
     p_silo => 'Ethekwini', p_caller_name => 'Thabo Mkhize', p_caller_number => '+27825550143',
     p_call_description => 'Glass breaking next door', p_incident_type => $1, p_incident_severity => 'High',
     p_location_address => '112 Florida Road', p_location_lat => -29.84, p_location_lng => 31.01,
     p_is_caller_patient => $2, p_tagged_silos => $3::public.silo[], p_injuries => $4::text[],
     p_incident_category => $5, p_details => $6::jsonb, p_client_ref => $7)`,
  [extra.type ?? 'Burglary', extra.patient ?? null, extra.tags ?? '{MetroPolice}', extra.injuries ?? null,
    extra.category ?? 'Crime', extra.details === undefined ? null : JSON.stringify(extra.details), extra.ref ?? null]).then((r) => r.rows[0]);
const early = (n, extra = {}) => db.query(
  `select * from public.send_call_early(
     p_client_ref => $1, p_silo => 'Ethekwini', p_incident_type => $2, p_incident_severity => 'Critical',
     p_location_address => '12 West Street', p_location_lat => -29.858, p_location_lng => 31.025,
     p_tagged_silos => $3::public.silo[], p_incident_category => 'Crime', p_details => $4::jsonb)`,
  [ref(n), extra.type ?? 'Shooting / gunshot wound', extra.tags ?? '{MetroPolice,Medical}',
    extra.details === undefined ? null : JSON.stringify(extra.details)]).then((r) => r.rows[0]);
const complete = (incident, fields) => db.query('select * from public.complete_call_intake($1, $2::jsonb)', [incident, JSON.stringify(fields)])
  .then((r) => r.rows[0]);

try {
  await db.exec(`
    create role authenticated nologin; create role anon nologin; create role service_role nologin;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user', true), '')::uuid $$;
    create function public.uuid_generate_v4() returns uuid language sql as $$ select gen_random_uuid() $$;
    create type public.silo as enum ('Ethekwini', 'MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster');
    create type public.user_role as enum ('SystemAdmin', 'SuperAdmin', 'Admin', 'Supervisor', 'Dispatcher', 'Operator',
      'ControlRoom', 'IncidentLogger', 'Viewer', 'System', 'Captain', 'Police', 'Firefighter', 'Paramedic', 'Disaster',
      'CaseManager', 'SystemController', 'FireChief');
    create type public.incident_severity as enum ('Low', 'Medium', 'High', 'Critical');
    create type public.incident_status as enum ('New', 'Pending', 'Pending Dispatch', 'Pending Analysis', 'Dispatched',
      'En Route', 'Arrived', 'On Scene', 'Transporting', 'Active', 'Closed', 'Resolved');
    create table public.tenants (id uuid primary key, name text);
    create table public.profiles (id uuid primary key, tenant_id uuid, role public.user_role, silo public.silo,
      full_name text, deactivated_at timestamptz, contact_number text);
    create function public.current_tenant() returns uuid language sql stable as $$
      select tenant_id from public.profiles where id = auth.uid() $$;
    create function public.current_silo() returns public.silo language sql stable as $$
      select coalesce((select silo from public.profiles where id = auth.uid()), 'Ethekwini') $$;
    create function public.role_in(variadic roles text[]) returns boolean language sql stable as $$
      select exists (select 1 from public.profiles where id = auth.uid() and role::text = any (roles)) $$;
    create function public.require_role(variadic roles text[]) returns void language plpgsql stable as $$
    begin
      if not public.role_in(variadic roles) then raise exception 'Not permitted for your role' using errcode = '42501'; end if;
    end $$;
    ${sqlFn(read('0067_role_fits_department.sql'), 'department_label')}
    create table public.apparatus (id uuid primary key default gen_random_uuid(), unit_number text);
    create table public.personnel (id uuid primary key default gen_random_uuid(), user_id uuid, tenant_id uuid,
      latitude double precision, longitude double precision, last_login timestamptz, updated_at timestamptz,
      assigned_apparatus_id uuid);
    create table public.alerts (id uuid primary key default gen_random_uuid(), tenant_id uuid, silo public.silo,
      target_user_id uuid, kind text, severity text, title text, body text, incident_id uuid, link text,
      presentation text, requires_ack boolean, created_by uuid, created_by_name text);
  `);
  const incidents = init.slice(init.indexOf('create table public.incidents ('), init.indexOf('create index on public.incidents(silo);'))
    .replace('geography(point, 4326)', 'text')
    .replace('unique (silo, incident_number)', 'unique (silo, incident_number, tenant_id)')
    .replace('  silo                silo not null,', `  tenant_id uuid not null default public.current_tenant(),\n  silo                silo not null,`);
  await db.exec(incidents);
  await db.exec(`
    alter table public.incidents
      add column tagged_silos public.silo[] not null default '{}', add column client_ref uuid,
      add column incident_category text, add column region text, add column call_taken_by text;
    create table public.incident_updates (id uuid primary key default gen_random_uuid(), silo public.silo, incident_id uuid,
      message text, created_by uuid, created_by_name text, timestamp timestamptz default clock_timestamp());
    create table public.audit_logs (id uuid primary key default gen_random_uuid(), silo public.silo, user_id uuid,
      user_name text, department text, action_type text, entity_type text, entity_id text, details text);
    create table public.incident_departments (id uuid primary key default gen_random_uuid(), incident_id uuid, silo public.silo,
      lead_id uuid, arrived_at timestamptz);
  `);
  const config = read('0007_v4_alignment.sql');
  await db.exec(config.slice(config.indexOf('create table if not exists public.command_records ('), config.indexOf('create index if not exists command_records_module_idx')));
  await db.exec(`
    alter table public.command_records add column tenant_id uuid not null default '${T}';
    create unique index command_records_module_name_key on public.command_records (module, coalesce(detail1, ''), name);
    insert into public.command_records (module, name, detail1, code, detail2) values
      ('IncidentCategory', 'Crime', null, '10', null),
      ('IncidentCategory', 'Burglary', 'Crime', '10-3', null),
      ('IncidentCategory', 'Assault', 'Crime', 'A-ONE', null),
      ('IncidentCategory', 'Robbery', 'Crime', '10-2', 'Our own question');
  `);
  for (const [tid, name] of [[T, 'eThekwini'], [T2, 'Other organisation']]) {
    await db.query('insert into public.tenants values ($1, $2)', [tid, name]);
  }
  for (const [uid, role, silo, name, tenant] of PEOPLE) {
    await db.query('insert into auth.users values ($1)', [uid]);
    await db.query('insert into public.profiles (id, tenant_id, role, silo, full_name) values ($1, $2, $3, $4, $5)', [uid, tenant, role, silo, name]);
  }
  // Two calls from before 0077 that share a number, as the old per-department counter allowed.
  await db.query(`insert into public.incidents (tenant_id, silo, incident_number, caller_name, caller_number, call_description,
      incident_type, incident_category, location_address, location_lat, location_lng) values
      ($1, 'Ethekwini', 'INC-20261013-0001', 'Old caller', '+27825550000', 'Old call', 'Burglary', 'Crime', 'Somewhere', -29.8, 31.0),
      ($1, 'MetroPolice', 'INC-20261013-0001', 'Other old', '+27825550001', 'Old call', 'Assault', 'Crime', 'Elsewhere', -29.8, 31.0)`, [T]);

  for (const m of ['0076_call_intake.sql', '0077_call_details_numbers.sql', '0077_call_details_numbers.sql']) await db.exec(read(m));
  await db.query('begin');

  await scenario('types and codes: V4 codes, our own, an administrator’s kept, placeholders replaced', async () => {
    const code = async (tid, name) => (await one("select code from public.command_records where tenant_id = $1 and name = $2 and detail1 is not null", [tid, name]))?.code;
    assert.equal(await code(T, 'Burglary'), 'CR-03', '0007’s 10-3 replaced');
    assert.equal(await code(T, 'Assault'), 'A-ONE', 'a code the administrator set is kept');
    assert.equal(await code(T, 'Robbery'), 'CR-02');
    assert.equal(await code(T, 'Crash with injuries'), '10-50 PI');
    assert.equal(await code(T2, 'Emergency / Officer Needs Assistance'), '10-33', 'V4’s types in every organisation');
    assert.equal(await code(T2, 'Livestock on Road'), '10-54');
    const groups = await rows("select name from public.command_records where tenant_id = $1 and detail1 is null order by name", [T2]);
    assert.deepEqual(groups.map((g) => g.name), ['Animals', 'Crime', 'Disaster', 'Fire', 'Medical', 'Police service', 'Public Order', 'Traffic']);
    const n = Number((await one("select count(*)::int as n from public.command_records where tenant_id = $1 and detail1 is not null and status = 'Active'", [T2])).n);
    assert.equal(n, 123);
    const retired = await one("select status from public.command_records where tenant_id = $1 and name = 'Suspicious person or vehicle'", [T2]);
    assert.equal(retired.status, 'Inactive', 'replaced by V4’s two');
    const rob = await one("select detail2 from public.command_records where tenant_id = $1 and name = 'Robbery'", [T]);
    assert.equal(rob.detail2, 'Our own question', 'an administrator’s questions kept');
    const md = await one("select detail2 from public.command_records where tenant_id = $1 and name = 'Malicious damage to property'", [T2]);
    assert.equal(md.detail2, 'What was damaged?\nIs the person still there?', '0076’s questions updated');
    const old = await rows("select incident_code from public.incidents where incident_number = 'INC-20261013-0001' order by incident_type");
    assert.deepEqual(old.map((r) => r.incident_code), ['A-ONE', 'CR-03'], 'calls on record get their code');
  });

  await scenario('the number: departments in pairs, the date and time, the number of the day', async () => {
    const { day } = await sastNow();
    await as(U.logger);
    const a = await logCall();
    const b = await logCall({ tags: '{Medical,MetroFire,MetroPolice}', type: 'Crash with people trapped', category: 'Traffic', patient: false });
    const c = await logCall({ tags: '{EthekwiniDisaster,Medical,MetroFire,MetroPolice}', type: 'Building collapse', category: 'Fire', patient: false });
    const d = await logCall({ tags: '{MetroFire,Medical}', type: 'Fire with people trapped', category: 'Fire', patient: false });
    for (const [inc, prefix, seq] of [[a, 'MP', '0001'], [b, 'MPFD-MD', '0002'], [c, 'MPFD-MDDM', '0003'], [d, 'FDMD', '0004']]) {
      const m = NUMBER.exec(inc.incident_number);
      assert.ok(m, `${inc.incident_number} has the form`);
      assert.equal(m[1], prefix);
      assert.equal(m[2], day, 'today in South Africa');
      assert.equal(m[4], seq);
    }
    assert.equal(a.incident_code, 'CR-03', 'the type’s code is kept on the call');
    assert.equal(b.incident_code, 'TR-02');
    // The other organisation counts its own day.
    await as(U.other);
    const o = await logCall();
    assert.equal(NUMBER.exec(o.incident_number)[4], '0001');
    // Sent early: numbered the moment it is sent.
    await as(U.logger);
    const e = await early(1);
    assert.equal(NUMBER.exec(e.incident_number)[1], 'MPMD');
    assert.equal(NUMBER.exec(e.incident_number)[4], '0005');
    assert.equal(e.incident_code, 'CR-04');
    // Pressing again returns the same call and uses no number.
    assert.equal((await early(1)).incident_number, e.incident_number);
    assert.equal(NUMBER.exec((await logCall()).incident_number)[4], '0006');
  });

  await scenario('South African time, midnight, and more than 9999 calls in a day', async () => {
    await as(U.logger);
    const at = (iso) => one(`select public.next_incident_number('Ethekwini', '{MetroPolice}', $1::timestamptz) as n`, [iso]);
    assert.match((await at('2026-10-10T09:15:00Z')).n, /^MP-20261010-1115-\d{4}$/, '09:15 UTC is 11:15 in South Africa');
    const late = (await at('2026-10-10T21:59:00Z')).n;
    const next = (await at('2026-10-10T22:01:00Z')).n;
    assert.match(late, /^MP-20261010-2359-\d{4}$/);
    assert.match(next, /^MP-20261011-0001-0001$/, 'a new day in South Africa, a new count');
    await db.query("update public.incident_day_counters set last_seq = 9999 where day = '2026-10-11'");
    assert.equal((await at('2026-10-10T22:05:00Z')).n, 'MP-20261011-0005-10000', 'never cut short');
    assert.equal((await one("select public.next_incident_number('Ethekwini') as n")).n.slice(0, 3), 'CR-', 'no department: control room');
  });

  await scenario('an officer’s SOS: the officer’s department, coded 10-33', async () => {
    await as(U.cop);
    const sos = await one('select * from public.raise_panic(-29.85, 31.02, 10, null, null, null)');
    const m = NUMBER.exec(sos.incident_number);
    assert.ok(m, sos.incident_number);
    assert.equal(m[1], 'MP');
    assert.equal(sos.incident_code, '10-33');
    await as(U.firefighter);
    assert.equal(NUMBER.exec((await one('select * from public.raise_panic(null, null, null, null, null, null)')).incident_number)[1], 'FD');
  });

  await scenario('the details: kept apart from the description, checked, and added later', async () => {
    await as(U.logger);
    const c = await logCall({ details: { premises: 'A home', taken: ['Cellphone', 'TV', 7, ''], suspectThere: '  No ', note: { x: 1 } } });
    assert.deepEqual(c.details, { premises: 'A home', taken: ['Cellphone', 'TV'], suspectThere: 'No' }, 'only words and lists of words');
    assert.deepEqual((await logCall()).details, {}, 'none given: none kept');
    await refused(() => logCall({ details: { long: 'x'.repeat(9000) } }), /The details are too long/);
    const e = await early(2, { type: 'Stabbing', details: { suspectThere: 'Yes' } });
    assert.deepEqual(e.details, { suspectThere: 'Yes' });
    const after = await complete(e.id, { details: { suspectThere: 'No', direction: 'towards the rank' } });
    assert.deepEqual(after.details, { suspectThere: 'No', direction: 'towards the rank' });
    const tl = await rows('select message from public.incident_updates where incident_id = $1 order by timestamp', [e.id]);
    assert.match(tl.at(-1).message, /Details added by Lerato Logger: details\./);
    await refused(() => complete(e.id, { details: ['not', 'answers'] }), /The details are a list of answers/);
    // Nothing changed: no line on the timeline.
    const before = tl.length;
    await complete(e.id, { details: { suspectThere: 'No', direction: 'towards the rank' } });
    assert.equal((await rows('select 1 from public.incident_updates where incident_id = $1', [e.id])).length, before);
  });

  await scenario('a new type brings its code; a crew accepting still locks the type', async () => {
    await as(U.logger);
    const e = await early(3, { type: 'Assault', tags: '{MetroPolice}' });
    assert.equal(e.incident_code, 'A-ONE');
    const changed = await complete(e.id, { incident_type: 'Robbery', incident_category: 'Crime' });
    assert.equal(changed.incident_code, 'CR-02');
    await db.query("insert into public.incident_departments (incident_id, silo, lead_id) values ($1, 'MetroPolice', $2)", [e.id, U.cop]);
    await refused(() => complete(e.id, { incident_type: 'Burglary' }), /A crew has accepted/);
  });

  await scenario('numbers are unique; nobody calls the number or details helpers directly', async () => {
    await as(U.logger);
    const a = await logCall();
    await refused(() => db.query(`insert into public.incidents (tenant_id, silo, incident_number, caller_name, caller_number,
        call_description, incident_type, location_address, location_lat, location_lng)
        values ($1, 'MetroPolice', $2, 'x', '+27825550000', 'x', 'Theft', 'x', -29.8, 31.0)`, [T, a.incident_number]), /duplicate key/);
    for (const fn of ['public.next_incident_number(public.silo, public.silo[], timestamptz)', 'public.next_incident_number(public.silo)',
      'public.incident_number_prefix(public.silo[])', 'public.clean_details(jsonb)', 'public.incident_code_for(text, text)']) {
      for (const role of ['anon', 'authenticated']) {
        assert.equal((await one(`select has_function_privilege('${role}', '${fn}', 'execute') as ok`)).ok, false, `${role} cannot call ${fn}`);
      }
    }
    for (const fn of ['public.log_incoming_call(public.silo, text, text, text, text, public.incident_severity, text, double precision, double precision, text, text, text, text, text, text, boolean, text, integer, text, text, uuid, text, text, public.silo[], text[], jsonb)',
      'public.send_call_early(uuid, public.silo, text, public.incident_severity, text, double precision, double precision, public.silo[], text, text, text, text, text, text, text, text, boolean, text, integer, text, text[], text, jsonb)']) {
      assert.equal((await one(`select has_function_privilege('anon', '${fn}', 'execute') as ok`)).ok, false, `anon cannot call ${fn}`);
      assert.equal((await one(`select has_function_privilege('authenticated', '${fn}', 'execute') as ok`)).ok, true, `signed in can call ${fn}`);
    }
    assert.equal((await one("select count(*)::int as n from pg_proc where proname = 'log_incoming_call'")).n, 1, 'one log_incoming_call');
    assert.equal((await one("select count(*)::int as n from pg_proc where proname = 'send_call_early'")).n, 1, 'one send_call_early');
  });

  await db.query('rollback');
  console.log(`\n${checks} scenarios passed; 0076 and 0077 applied, 0077 twice.`);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}
