/** Run the real call-intake migration (0076) against in-memory Postgres
 * (PGlite): an urgent call sent early with only its type, place and
 * department; the rest added to the same call by the person who logged it;
 * the patient question asked on medical calls only; and every organisation
 * given the full list of incident types.
 *
 * CASE_PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node scripts/test-call-intake.mjs
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
const migration = read('0076_call_intake.sql');

const db = new PGlite();
let checks = 0;
const one = async (q, args) => (await db.query(q, args)).rows[0];
const rows = async (q, args) => (await db.query(q, args)).rows;

const T = '20000000-0000-4000-8000-000000000001';
const T2 = '20000000-0000-4000-8000-000000000002';
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ref = (n) => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const U = { logger: id(1), logger2: id(2), control: id(3), dispatcher: id(4), cop: id(5), other: id(6) };
const PEOPLE = [
  [U.logger, 'IncidentLogger', 'Ethekwini', 'Lerato Logger', T],
  [U.logger2, 'IncidentLogger', 'Ethekwini', 'Sizwe Logger', T],
  [U.control, 'ControlRoom', 'Ethekwini', 'Control Room', T],
  [U.dispatcher, 'Dispatcher', 'MetroPolice', 'Nomsa Metro', T],
  [U.cop, 'Police', 'MetroPolice', 'Const. Khumalo', T],
  [U.other, 'IncidentLogger', 'Ethekwini', 'Other Org Logger', T2],
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

const early = (n, extra = {}) => db.query(
  `select * from public.send_call_early(
     p_client_ref => $1, p_silo => 'Ethekwini', p_incident_type => $2, p_incident_severity => $3::public.incident_severity,
     p_location_address => $4, p_location_lat => $5, p_location_lng => $6, p_tagged_silos => $7::public.silo[],
     p_caller_name => $8, p_caller_number => $9, p_call_description => $10, p_is_caller_patient => $11,
     p_injuries => $12::text[])`,
  [ref(n), extra.type ?? 'Shooting / gunshot wound', extra.severity ?? 'Critical', extra.address ?? '12 West Street, Durban',
    extra.lat ?? -29.858, extra.lng ?? 31.025, extra.tags ?? '{MetroPolice,Medical}', extra.name ?? null, extra.number ?? null,
    extra.description ?? null, extra.patient ?? null, extra.injuries ?? null]).then((r) => r.rows[0]);
const complete = (incident, fields) => db.query('select * from public.complete_call_intake($1, $2::jsonb)', [incident, JSON.stringify(fields)])
  .then((r) => r.rows[0]);
const logCall = (extra = {}) => db.query(
  `select * from public.log_incoming_call(
     p_silo => 'Ethekwini', p_caller_name => 'Thabo Mkhize', p_caller_number => '+27825550143',
     p_call_description => 'Glass breaking next door', p_incident_type => $1, p_incident_severity => 'High',
     p_location_address => '112 Florida Road', p_location_lat => -29.84, p_location_lng => 31.01,
     p_is_caller_patient => $2, p_tagged_silos => $3::public.silo[], p_injuries => $4::text[])`,
  [extra.type ?? 'Burglary', extra.patient ?? null, extra.tags ?? '{MetroPolice}', extra.injuries ?? null]).then((r) => r.rows[0]);
const timeline = async (incident) => (await rows('select message from public.incident_updates where incident_id = $1 order by timestamp, message', [incident]))
  .map((r) => r.message);

try {
  await db.exec(`
    create role authenticated nologin; create role anon nologin; create role service_role nologin;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user', true), '')::uuid $$;
    create function public.uuid_generate_v4() returns uuid language sql as $$ select gen_random_uuid() $$;
    create type public.silo as enum ('Ethekwini', 'MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster');
    create type public.user_role as enum ('SystemAdmin', 'SuperAdmin', 'Admin', 'Supervisor', 'Dispatcher', 'Operator',
      'ControlRoom', 'IncidentLogger', 'Viewer', 'System', 'Captain', 'Police', 'Firefighter', 'Paramedic', 'Disaster',
      'CaseManager', 'SystemController');
    create type public.incident_severity as enum ('Low', 'Medium', 'High', 'Critical');
    create type public.incident_status as enum ('New', 'Pending', 'Pending Dispatch', 'Pending Analysis', 'Dispatched',
      'En Route', 'Arrived', 'On Scene', 'Transporting', 'Active', 'Closed', 'Resolved');
    create table public.tenants (id uuid primary key, name text);
    create table public.profiles (id uuid primary key, tenant_id uuid, role public.user_role, silo public.silo,
      full_name text, deactivated_at timestamptz);
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
    create sequence public.inc_seq;
    create function public.next_incident_number(p_silo public.silo) returns text language sql as $$
      select 'INC-20261014-' || lpad(nextval('public.inc_seq')::text, 4, '0') $$;
    create table public.apparatus (id uuid primary key default gen_random_uuid());
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
  // The configured codes as 0007 made them (one organisation's), with 0030's tenant column.
  const config = read('0007_v4_alignment.sql');
  await db.exec(config.slice(config.indexOf('create table if not exists public.command_records ('), config.indexOf('create index if not exists command_records_module_idx')));
  await db.exec(`
    alter table public.command_records add column tenant_id uuid not null default '${T}';
    create unique index command_records_module_name_key on public.command_records (module, coalesce(detail1, ''), name);
    insert into public.command_records (module, name, detail1, code, detail2) values
      ('IncidentCategory', 'Crime', null, '10', null),
      ('IncidentCategory', 'Burglary', 'Crime', '10-3', null),
      ('IncidentCategory', 'Assault', 'Crime', '10-1', 'Our own question'),
      ('IncidentCategory', 'Theft', 'Crime', null, null);
    update public.command_records set status = 'Inactive' where name = 'Theft';
  `);
  for (const [tid, name] of [[T, 'eThekwini'], [T2, 'Other organisation']]) {
    await db.query('insert into public.tenants values ($1, $2)', [tid, name]);
  }
  for (const [uid, role, silo, name, tenant] of PEOPLE) {
    await db.query('insert into auth.users values ($1)', [uid]);
    await db.query('insert into public.profiles (id, tenant_id, role, silo, full_name) values ($1, $2, $3, $4, $5)', [uid, tenant, role, silo, name]);
  }

  // A call logged before 0076.
  await db.query(`insert into public.incidents (tenant_id, silo, incident_number, caller_name, caller_number, call_description,
      incident_type, location_address, location_lat, location_lng) values
      ($1, 'Ethekwini', 'INC-OLD-0001', 'Old caller', '+27825550000', 'Old call', 'Burglary', 'Somewhere', -29.8, 31.0)`, [T]);

  await db.exec(migration);
  await db.exec(migration);
  await db.query('begin');

  await scenario('every organisation gets the incident types, its own edits kept', async () => {
    const count = async (tid) => Number((await one(
      "select count(*)::int as n from public.command_records where tenant_id = $1 and module = 'IncidentCategory' and detail1 is not null",
      [tid])).n);
    assert.ok(await count(T) >= 85, 'the first organisation');
    assert.ok(await count(T2) >= 85, 'the second organisation, despite the same names');
    assert.equal(Number((await one("select count(*)::int as n from public.command_records where tenant_id = $1 and detail1 is null", [T2])).n), 6, 'six groups');
    const r = await one("select detail2 from public.command_records where tenant_id = $1 and name = 'Assault'", [T]);
    assert.equal(r.detail2, 'Our own question', 'an administrator’s questions are kept');
    const b = await one("select detail2 from public.command_records where tenant_id = $1 and name = 'Burglary'", [T]);
    assert.match(b.detail2, /Are the suspects still inside\?/, 'questions filled in where there were none');
    const theft = await rows("select status from public.command_records where tenant_id = $1 and name = 'Theft'", [T]);
    assert.deepEqual(theft.map((x) => x.status), ['Inactive'], 'a type switched off stays off, and is not added again');
    const s = await one("select detail1, detail2 from public.command_records where tenant_id = $1 and name = 'Shooting / gunshot wound'", [T2]);
    assert.equal(s.detail1, 'Crime');
    assert.equal(s.detail2.split('\n')[0], 'Is the shooter still there?');
    const old = await one("select intake_complete, injuries from public.incidents where incident_number = 'INC-OLD-0001'");
    assert.equal(old.intake_complete, true, 'calls already logged are complete');
    assert.deepEqual(old.injuries, []);
  });

  await scenario('logging a call: the patient question on medical calls only; injuries kept in order, once', async () => {
    await as(U.logger);
    const burglary = await logCall();
    assert.equal(burglary.is_caller_patient, null);
    assert.equal(burglary.intake_complete, true);
    await refused(() => logCall({ type: 'Stabbing', tags: '{MetroPolice,Medical}' }), /Say whether the caller is the patient/);
    const stab = await logCall({ type: 'Stabbing', tags: '{MetroPolice,Medical}', patient: false,
      injuries: '{"Stab wound"," Severe bleeding ","Stab wound",""}' });
    assert.deepEqual(stab.injuries, ['Stab wound', 'Severe bleeding']);
  });

  await scenario('an urgent call goes to dispatch with only its type, place and departments', async () => {
    await as(U.logger);
    const c = await early(1);
    assert.equal(c.status, 'Pending Dispatch');
    assert.equal(c.caller_name, 'Not given yet');
    assert.equal(c.caller_number, '');
    assert.equal(c.call_description, 'Details to follow.');
    assert.equal(c.intake_complete, false);
    assert.equal(c.incident_severity, 'Critical');
    assert.equal(Array.isArray(c.tagged_silos) ? c.tagged_silos.join(',') : String(c.tagged_silos).replace(/[{}]/g, ''), 'MetroPolice,Medical');
    assert.equal(c.created_by, U.logger);
    assert.equal(c.call_taken_by, 'Lerato Logger');
    const t = await timeline(c.id);
    assert.equal(t[0], 'Urgent call sent early by Lerato Logger to the Metro Police, EMS dispatch desks. Details to follow.');
    assert.ok(await one("select 1 from public.audit_logs where entity_id = $1 and details like 'Sent early:%'", [c.id]));
    // Pressed twice: the same call.
    const again = await early(1);
    assert.equal(again.id, c.id);
    assert.equal(Number((await one('select count(*)::int as n from public.incidents where client_ref = $1', [ref(1)])).n), 1);
  });

  await scenario('sending early is refused without its minimum, or when it is not urgent', async () => {
    await as(U.logger);
    await refused(() => early(2, { severity: 'Medium' }), /Only a High or Critical call/);
    await refused(() => early(2, { tags: '{}' }), /Choose the department/);
    await refused(() => early(2, { tags: '{Ethekwini}' }), /Choose the department/, 'never the control room itself');
    await refused(() => early(2, { lat: 0, lng: 0 }), /Place the incident on the map/);
    await refused(() => early(2, { address: '  ' }), /Place the incident on the map/);
    await refused(() => early(2, { type: ' ' }), /Choose the incident type/);
    await refused(() => early(2, { number: '0825550143' }), /country code/);
    await as(U.dispatcher);
    await refused(() => early(2), /Not permitted/, 'a dispatcher does not log calls');
    await as(U.cop);
    await refused(() => early(2), /Not permitted/);
  });

  await scenario('everything known goes with it: complete when caller, number, description and (medical) patient are there', async () => {
    await as(U.logger);
    const c = await early(3, { name: 'Ayanda Zulu', number: '+27 73 918 2204', description: 'Man shot in the leg', patient: false,
      injuries: '{"Gunshot wound"}' });
    assert.equal(c.intake_complete, true);
    assert.equal(c.caller_number, '+27739182204');
    assert.deepEqual(c.injuries, ['Gunshot wound']);
    assert.equal((await timeline(c.id))[0], 'Urgent call sent early by Lerato Logger to the Metro Police, EMS dispatch desks.');
    const d = await early(4, { name: 'Ayanda Zulu', number: '+27739182204', description: 'Man shot' });
    assert.equal(d.intake_complete, false, 'EMS is on it: the patient question is still to come');
  });

  await scenario('the person who logged it adds the rest; the timeline names what was added', async () => {
    await as(U.logger);
    const c = await early(5, { type: 'Armed robbery', tags: '{MetroPolice}' });
    let n = await complete(c.id, { caller_name: ' Thabo Mkhize ', caller_number: '+27 82 555 0143' });
    assert.equal(n.caller_name, 'Thabo Mkhize');
    assert.equal(n.caller_number, '+27825550143');
    assert.equal(n.intake_complete, false, 'no description yet');
    n = await complete(c.id, { call_description: 'Two men with guns at the Engen', incident_severity: 'High' });
    assert.equal(n.intake_complete, true);
    assert.equal(n.incident_severity, 'High');
    const t = await timeline(c.id);
    assert.ok(t.includes('[INTAKE] Details added by Lerato Logger: caller name, caller number.'));
    assert.ok(t.includes('[INTAKE] Details added by Lerato Logger: description, severity (High, was Critical). The call details are complete.'));
    // The same again changes nothing and writes nothing.
    const before = (await timeline(c.id)).length;
    await complete(c.id, { call_description: 'Two men with guns at the Engen' });
    assert.equal((await timeline(c.id)).length, before);
    assert.ok(await one("select 1 from public.audit_logs where entity_id = $1 and action_type = 'INTAKE_UPDATE'", [c.id]));
  });

  await scenario('a medical call is complete only once the patient question is answered', async () => {
    await as(U.logger);
    const c = await early(6);
    let n = await complete(c.id, { caller_name: 'Sipho', caller_number: '+27825551111', call_description: 'Shot in the chest',
      injuries: ['Gunshot wound', 'Severe bleeding'], number_of_victims: 1 });
    assert.equal(n.intake_complete, false);
    assert.deepEqual(n.injuries, ['Gunshot wound', 'Severe bleeding']);
    assert.equal(n.number_of_victims, 1);
    n = await complete(c.id, { is_caller_patient: false, patient_name: 'Unknown man' });
    assert.equal(n.intake_complete, true);
  });

  await scenario('only the person who logged it, the control room, or an organisation administrator adds details', async () => {
    await as(U.logger);
    const c = await early(7);
    await as(U.logger2);
    await refused(() => complete(c.id, { caller_name: 'X' }), /Only the person who logged/);
    await as(U.dispatcher);
    await refused(() => complete(c.id, { caller_name: 'X' }), /Not permitted/);
    await as(U.other);
    await refused(() => complete(c.id, { caller_name: 'X' }), /Incident not found/, 'another organisation never sees it');
    await as(U.control);
    const n = await complete(c.id, { caller_name: 'Told the control room' });
    assert.equal(n.caller_name, 'Told the control room');
  });

  await scenario('what may change, and until when', async () => {
    await as(U.logger);
    const c = await early(8);
    await refused(() => complete(c.id, { status: 'Closed' }), /cannot be changed here: status/);
    await refused(() => complete(c.id, { caller_name: '  ' }), /Enter the caller name/);
    await refused(() => complete(c.id, { caller_number: '082 555' }), /country code/);
    await refused(() => complete(c.id, { incident_severity: 'Extreme' }), /Choose Low, Medium, High or Critical/);
    await refused(() => complete(c.id, { location_lat: -29.9 }), /with its address and its point/);
    await refused(() => complete(c.id, { number_of_victims: -1 }), /whole number/);
    // The type changes until a crew accepts; the place until a crew is on scene.
    let n = await complete(c.id, { incident_type: 'Stabbing', incident_category: 'Crime' });
    assert.equal(n.incident_type, 'Stabbing');
    n = await complete(c.id, { location_address: 'Gateway Theatre of Shopping', location_lat: -29.727, location_lng: 31.066, region: 'North' });
    assert.equal(n.location_address, 'Gateway Theatre of Shopping');
    assert.ok((await timeline(c.id)).includes('[INTAKE] Place changed by Lerato Logger to Gateway Theatre of Shopping.'));
    await db.query("insert into public.incident_departments (incident_id, silo, lead_id) values ($1, 'MetroPolice', $2)", [c.id, U.cop]);
    await refused(() => complete(c.id, { incident_type: 'Assault' }), /A crew has accepted/);
    await db.query('update public.incident_departments set arrived_at = now() where incident_id = $1', [c.id]);
    await refused(() => complete(c.id, { location_address: 'Elsewhere', location_lat: -29.8, location_lng: 31.0 }), /A crew is on scene/);
    n = await complete(c.id, { caller_name: 'Still allowed' });
    assert.equal(n.caller_name, 'Still allowed', 'the caller’s details may still be added');
    await db.query("update public.incidents set status = 'Resolved' where id = $1", [c.id]);
    await refused(() => complete(c.id, { caller_name: 'Late' }), /already resolved/);
  });

  console.log(`${checks} scenarios passed; 0076 applied twice.`);
} finally {
  await db.close();
}
