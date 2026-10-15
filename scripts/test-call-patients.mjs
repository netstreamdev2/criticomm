/** Run the real migrations 0076, 0077, 0079 and 0080 against in-memory Postgres
 * (PGlite): how the call came in (phone, WhatsApp, in person, other), and each
 * patient with their own severity, apart from the incident's; logged, sent
 * early, corrected, and each change kept.
 *
 * CASE_PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node scripts/test-call-patients.mjs
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
const U = {
  logger: id(1), control: id(2), cop: id(3), policeDesk: id(4), fireDesk: id(5), otherOrg: id(6), viewer: id(7),
};
const PEOPLE = [
  [U.logger, 'IncidentLogger', 'Ethekwini', 'Lerato Logger', T],
  [U.control, 'ControlRoom', 'Ethekwini', 'Control Room', T],
  [U.cop, 'Police', 'MetroPolice', 'Const. Khumalo', T],
  [U.policeDesk, 'Dispatcher', 'MetroPolice', 'Sgt. Naidoo', T],
  [U.fireDesk, 'Dispatcher', 'MetroFire', 'Fire Desk Mthembu', T],
  [U.otherOrg, 'Dispatcher', 'MetroPolice', 'Other Org Desk', T2],
  [U.viewer, 'Viewer', 'Ethekwini', 'Vusi Viewer', T],
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

const logCall = (extra = {}) => db.query(
  `select * from public.log_incoming_call(
     p_silo => 'Ethekwini', p_caller_name => 'Thabo Mkhize', p_caller_number => '+27825550143',
     p_call_description => 'The house is on fire', p_incident_type => 'House fire', p_incident_severity => 'Critical',
     p_location_address => '112 Florida Road', p_location_lat => -29.84, p_location_lng => 31.01,
     p_is_caller_patient => $1, p_tagged_silos => $2::public.silo[], p_incident_category => 'Fire',
     p_call_channel => $3, p_call_channel_other => $4, p_patients => $5::jsonb)`,
  [extra.patient ?? false, extra.tags ?? '{MetroFire,Medical}', extra.channel === undefined ? 'Phone call' : extra.channel,
    extra.other ?? null, extra.patients === undefined ? null : JSON.stringify(extra.patients)]).then((r) => r.rows[0]);
const early = (n, extra = {}) => db.query(
  `select * from public.send_call_early(
     p_client_ref => $1, p_silo => 'Ethekwini', p_incident_type => 'House fire', p_incident_severity => 'Critical',
     p_location_address => '12 West Street', p_location_lat => -29.858, p_location_lng => 31.025,
     p_tagged_silos => '{MetroFire,Medical}'::public.silo[], p_incident_category => 'Fire',
     p_call_channel => $2, p_patients => $3::jsonb)`,
  [`40000000-0000-4000-8000-${String(n).padStart(12, '0')}`, extra.channel ?? 'WhatsApp',
    JSON.stringify(extra.patients ?? [{ name: null, severity: 'High', caller: true }])]).then((r) => r.rows[0]);
const edit = (incident, fields, reason = null) => db.query('select * from public.dispatcher_edit_call($1, $2::jsonb, $3)',
  [incident, JSON.stringify(fields), reason]).then((r) => r.rows[0]);
const complete = (incident, fields) => db.query('select * from public.complete_call_intake($1, $2::jsonb)', [incident, JSON.stringify(fields)])
  .then((r) => r.rows[0]);
const edits = (incident) => rows('select * from public.incident_edits where incident_id = $1 order by edited_at, id', [incident]);

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
    ${sqlFn(read('0068_dispatch_desk_tags.sql'), 'desk_silo')}
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
      lead_id uuid, arrived_at timestamptz, dispatched_at timestamptz);
  `);
  const config = read('0007_v4_alignment.sql');
  await db.exec(config.slice(config.indexOf('create table if not exists public.command_records ('), config.indexOf('create index if not exists command_records_module_idx')));
  await db.exec(`
    alter table public.command_records add column tenant_id uuid not null default '${T}';
    create unique index command_records_module_name_key on public.command_records (module, coalesce(detail1, ''), name);
  `);
  for (const [tid, name] of [[T, 'eThekwini'], [T2, 'Other organisation']]) {
    await db.query('insert into public.tenants values ($1, $2)', [tid, name]);
  }
  for (const [uid, role, silo, name, tenant] of PEOPLE) {
    await db.query('insert into auth.users values ($1)', [uid]);
    await db.query('insert into public.profiles (id, tenant_id, role, silo, full_name) values ($1, $2, $3, $4, $5)', [uid, tenant, role, silo, name]);
  }

  for (const m of ['0076_call_intake.sql', '0077_call_details_numbers.sql', '0079_dispatcher_edits.sql', '0080_call_channel_patients.sql',
    '0080_call_channel_patients.sql']) {
    await db.exec(read(m));
  }
  await db.query('begin');

  await scenario('how the call came in: phone, WhatsApp, in person, or other in a few words', async () => {
    await as(U.logger);
    const a = await logCall();
    assert.equal(a.call_channel, 'Phone call');
    assert.equal(a.call_channel_other, null);
    const b = await logCall({ channel: 'Other', other: '  Radio from a security guard  ' });
    assert.equal(b.call_channel, 'Other');
    assert.equal(b.call_channel_other, 'Radio from a security guard');
    const c = await logCall({ channel: 'In person', other: 'ignored' });
    assert.equal(c.call_channel_other, null, 'a note only for Other');
    await refused(() => logCall({ channel: 'Other', other: ' ' }), /Say how the call came in/);
    await refused(() => logCall({ channel: 'SMS' }), /Choose how the call came in/);
    // An older form sends none: unknown, not refused.
    assert.equal((await logCall({ channel: null })).call_channel, null);
  });

  await scenario('each patient with their own severity, apart from the incident’s', async () => {
    await as(U.logger);
    const c = await logCall({ patients: [
      { name: '  Sipho Dube ', severity: 'Low' }, { name: '', severity: 'Critical' }, { name: 'Ayesha', severity: 'Very bad' }, 'junk',
    ] });
    assert.equal(c.incident_severity, 'Critical', 'the building');
    assert.deepEqual(c.patients, [
      { name: 'Sipho Dube', severity: 'Low', caller: false },
      { name: null, severity: 'Critical', caller: false },
      { name: 'Ayesha', severity: 'Unknown', caller: false },
    ], 'cleaned: an unknown severity is Unknown, anything else is dropped');
    const me = await logCall({ patient: true, patients: [{ name: 'Thabo Mkhize', severity: 'Medium', caller: true }] });
    assert.deepEqual(me.patients, [{ name: 'Thabo Mkhize', severity: 'Medium', caller: true }]);
    const many = await logCall({ patients: Array.from({ length: 25 }, (_, i) => ({ name: `P${i}`, severity: 'Low' })) });
    assert.equal(many.patients.length, 20, 'at most 20');
    assert.deepEqual((await logCall()).patients, [], 'none given: none');
    await refused(() => logCall({ patients: { name: 'x' } }), /The patients are a list/);
  });

  await scenario('sent early: the channel and the patients go with it', async () => {
    await as(U.logger);
    const e = await early(1);
    assert.equal(e.call_channel, 'WhatsApp');
    assert.deepEqual(e.patients, [{ name: null, severity: 'High', caller: true }]);
    await refused(() => early(2, { channel: 'Pigeon' }), /Choose how the call came in/);
  });

  await scenario('the dispatcher and the call taker correct them, and each change is kept', async () => {
    await as(U.logger);
    const c = await logCall({ patients: [{ name: 'Sipho Dube', severity: 'Unknown' }] });
    await as(U.fireDesk);
    const after = await edit(c.id, { patients: [{ name: 'Sipho Dube', severity: 'Low' }], call_channel: 'WhatsApp' }, 'Caller rang back');
    assert.equal(after.call_channel, 'WhatsApp');
    assert.equal(after.patients[0].severity, 'Low');
    const [e] = await edits(c.id);
    assert.deepEqual(e.changes.call_channel, { before: 'Phone call', after: 'WhatsApp' });
    assert.deepEqual(e.changes.patients.before, [{ name: 'Sipho Dube', severity: 'Unknown', caller: false }]);
    assert.deepEqual(e.changes.patients.after, [{ name: 'Sipho Dube', severity: 'Low', caller: false }]);
    const tl = await rows('select message from public.incident_updates where incident_id = $1 order by timestamp', [c.id]);
    assert.match(tl.at(-1).message, /Edited before dispatch by Fire Desk Mthembu: how the call came in, patients\. Why: Caller rang back/);
    await refused(() => edit(c.id, { call_channel: 'Other' }), /Say how the call came in/);
    await refused(() => edit(c.id, { patients: 'Sipho' }), /The patients are a list/);
    await as(U.logger);
    const other = await complete(c.id, { call_channel: 'Other', call_channel_other: 'Walked into the station' });
    assert.equal(other.call_channel_other, 'Walked into the station');
    const back = await complete(c.id, { call_channel: 'Phone call' });
    assert.equal(back.call_channel_other, null, 'the note goes with Other');
    assert.equal((await edits(c.id)).length, 3);
  });

  await scenario('one of each function; the cleaning helper is not callable', async () => {
    assert.equal((await one("select count(*)::int as n from pg_proc where proname = 'log_incoming_call'")).n, 1);
    assert.equal((await one("select count(*)::int as n from pg_proc where proname = 'send_call_early'")).n, 1);
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await one(`select has_function_privilege('${role}', 'public.clean_patients(jsonb)', 'execute') as ok`)).ok, false);
      assert.equal((await one(`select has_function_privilege('${role}', 'public.apply_call_edit(uuid, jsonb, text, text)', 'execute') as ok`)).ok, false);
    }
    const log = "public.log_incoming_call(public.silo, text, text, text, text, public.incident_severity, text, double precision, double precision, text, text, text, text, text, text, boolean, text, integer, text, text, uuid, text, text, public.silo[], text[], jsonb, text, text, jsonb)";
    const sendEarly = "public.send_call_early(uuid, public.silo, text, public.incident_severity, text, double precision, double precision, public.silo[], text, text, text, text, text, text, text, text, boolean, text, integer, text, text[], text, jsonb, text, text, jsonb)";
    for (const fn of [log, sendEarly]) {
      assert.equal((await one(`select has_function_privilege('anon', '${fn}', 'execute') as ok`)).ok, false);
      assert.equal((await one(`select has_function_privilege('authenticated', '${fn}', 'execute') as ok`)).ok, true);
    }
  });

  await db.query('rollback');
  console.log(`\n${checks} scenarios passed; 0076, 0077, 0079 and 0080 applied, 0080 twice.`);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}
