/** Run the real call-intake / shift-vehicle migration (0062) against in-memory
 * Postgres (PGlite). No credentials, no hosted database. It covers the caller
 * number and patient rules at intake, the nine-digit duplicate match, the
 * no-vehicle declaration and the gate that accepts it, and the optional
 * licence and ID photos on the shift record.
 *
 * CASE_PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node scripts/test-shift-intake.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.CASE_PGLITE_MODULE || '@electric-sql/pglite');

const migration = readFileSync(new URL('../supabase/migrations/0062_call_intake_and_shift_vehicles.sql', import.meta.url), 'utf8');
const db = new PGlite();
let checks = 0;
const one = async (query, args) => (await db.query(query, args)).rows[0];
const scalar = async (query, args) => (await one(query, args))?.value;

const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T1 = '20000000-0000-4000-8000-000000000001';
const T2 = '20000000-0000-4000-8000-000000000002';
const U = { logger: id(1), officer: id(2), fire: id(3), other: id(4), officer2: id(5) };
const PEOPLE = [
  [U.logger, T1, 'IncidentLogger', 'Ethekwini', 'Lerato Logger'],
  [U.officer, T1, 'Police', 'MetroPolice', 'Const. Khumalo'],
  [U.officer2, T1, 'Police', 'MetroPolice', 'Const. Mthembu'],
  [U.fire, T1, 'Firefighter', 'MetroFire', 'FF Naidoo'],
  [U.other, T2, 'Police', 'MetroPolice', 'Other Tenant'],
];
const who = Object.fromEntries(PEOPLE.map(([uid, tenant, role, silo]) => [uid, { tenant, role, silo }]));

async function as(uid) {
  const p = who[uid];
  await db.query('reset role');
  await db.query(
    "select set_config('test.user', $1, true), set_config('test.silo', $2, true), set_config('test.role', $3, true), set_config('test.tenant', $4, true)",
    [uid, p.silo, p.role, p.tenant],
  );
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
  finally { await db.query('rollback to savepoint scenario'); }
}

const LOG = `select * from log_incoming_call(
  p_silo => 'Ethekwini', p_caller_name => $1, p_caller_number => $2, p_call_description => 'Break-in',
  p_incident_type => 'Burglary', p_incident_severity => 'High', p_location_address => '1 Smith St',
  p_location_lat => -29.85, p_location_lng => 31.02, p_is_caller_patient => $3)`;
const logCall = (number, patient = false, name = 'Thandi') => db.query(LOG, [name, number, patient]);

const checkBool = (cols) => cols.map((c) => `${c} boolean not null default false`).join(', ');

try {
  await db.exec(`
    create role authenticated nologin; create role anon nologin; create role service_role nologin;
    create schema auth; create table auth.users(id uuid primary key);
    create type public.silo as enum ('Ethekwini','MetroPolice','MetroFire','Medical','EthekwiniDisaster');
    create type public.incident_status as enum ('Pending Dispatch','Pending Analysis','Dispatched','Closed','Resolved');
    create type public.incident_severity as enum ('Low','Medium','High','Critical');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user', true), '')::uuid $$;
    create function public.current_tenant() returns uuid language sql stable as $$ select nullif(current_setting('test.tenant', true), '')::uuid $$;
    create function public.current_silo() returns public.silo language sql stable as $$ select coalesce(nullif(current_setting('test.silo', true), ''), 'Ethekwini')::public.silo $$;
    create function public.role_in(variadic roles text[]) returns boolean language sql stable as $$ select current_setting('test.role', true) = any(roles) $$;
    create function public.require_role(variadic roles text[]) returns void language plpgsql as $$ begin
      if auth.uid() is null or not public.role_in(variadic roles) then raise exception 'Role refused' using errcode='42501'; end if;
    end $$;
    create function public.sa_today_start() returns timestamptz language sql stable as $$ select date_trunc('day', now()) $$;
    create sequence incident_seq;
    create function public.next_incident_number(p_silo public.silo) returns text language sql as $$ select 'INC-' || nextval('incident_seq') $$;

    create table public.profiles(id uuid primary key, full_name text);
    create table public.apparatus(id uuid primary key default gen_random_uuid(), tenant_id uuid, silo public.silo,
      unit_number text, status text not null default 'Available');
    create table public.personnel(id uuid primary key default gen_random_uuid(), user_id uuid, tenant_id uuid, silo public.silo,
      rank text, first_name text, last_name text, assigned_apparatus_id uuid);
    create table public.readiness_ok(user_id uuid primary key);
    create function public.shift_readiness_passed_today() returns boolean language sql stable security definer set search_path = public as $$
      select exists (select 1 from public.readiness_ok where user_id = auth.uid()) $$;
    create table public.vehicle_checklists(id uuid primary key default gen_random_uuid(), user_id uuid, tenant_id uuid,
      apparatus_id uuid, silo public.silo, checked_at timestamptz default now(), form_version text,
      ${checkBool(['officer_submitted', 'declaration_accepted', 'lights_functional', 'tires_condition_ok', 'equipment_stocked',
        'comms_working', 'brakes_responsive', 'scba_checked', 'water_tank_full', 'pump_operational', 'hoses_and_nozzles_stocked',
        'ladders_secured', 'turnout_gear_complete', 'requires_cleaning', 'oxygen_full', 'aed_battery_ok', 'suction_functional',
        'bvm_masks_ok', 'jump_bag_stocked', 'iv_fluids_stocked', 'drug_box_sealed', 'gloves_ppe_stocked'])});
    create table public.incidents(
      id uuid primary key default gen_random_uuid(), tenant_id uuid not null default public.current_tenant(),
      silo public.silo not null, source text, incident_number text, client_ref uuid,
      caller_name text, caller_number text, call_description text, notes text,
      incident_type text, incident_category text, incident_severity public.incident_severity,
      fire_incident_type text, medical_type text, disaster_type text,
      location_address text, suburb text, city text, postal_code text, region text,
      location_lat double precision, location_lng double precision,
      is_caller_patient boolean, patient_name text, number_of_victims integer,
      status public.incident_status, call_timestamp timestamptz, incident_created_at timestamptz,
      call_taken_by text, created_by uuid);
    create table public.audit_logs(id uuid primary key default gen_random_uuid(), tenant_id uuid default public.current_tenant(),
      silo public.silo, user_id uuid, user_name text, department text, action_type text, entity_type text, entity_id text,
      details text);

    alter table incidents enable row level security;
    create policy incidents_read on incidents for select using (true);
    create policy tenant_isolation on incidents as restrictive for all to authenticated
      using (tenant_id = public.current_tenant()) with check (tenant_id = public.current_tenant());

    grant usage on schema auth, public to authenticated, anon;
    grant select on incidents, apparatus, personnel to authenticated;
  `);

  // The migration under test, twice: it must be safe to re-run.
  await db.exec(migration);
  await db.exec(migration);
  await db.exec('grant select on shift_no_vehicle_declarations, shift_identity_documents to authenticated');

  for (const [uid, , , , name] of PEOPLE) {
    await db.query('insert into auth.users(id) values ($1)', [uid]);
    await db.query('insert into profiles(id, full_name) values ($1,$2)', [uid, name]);
  }
  for (const [uid, tenant, , silo, name] of PEOPLE) {
    await db.query('insert into personnel(user_id, tenant_id, silo, rank, first_name, last_name) values ($1,$2,$3,$4,$5,$6)',
      [uid, tenant, silo, 'Const.', name.split(' ')[1] ?? name, 'Test']);
  }
  const car = (await one("insert into apparatus(tenant_id, silo, unit_number, status) values ($1, 'MetroPolice', 'MET-100', 'Available') returning id", [T1])).id;
  await db.exec('begin');

  // ── Call intake ────────────────────────────────────────────────────────────

  await scenario('a caller number without its country code is refused, whatever the console sent', async () => {
    await as(U.logger);
    await refused(() => logCall('0821234567'), /country code/);
    await refused(() => logCall('+27 82'), /country code/, 'too short');
    await refused(() => logCall('+0 821 234 567'), /country code/, 'no country starts with 0');
    await refused(() => logCall(''), /country code/);
  });

  await scenario('a call that does not say whether the caller is the patient is refused', async () => {
    await as(U.logger);
    await refused(() => logCall('+27821234567', null), /caller is the patient/);
  });

  await scenario('a full international number is stored without spaces, for South Africa and abroad', async () => {
    await as(U.logger);
    const sa = (await logCall('+27 82 123 4567', true)).rows[0];
    assert.equal(sa.caller_number, '+27821234567');
    assert.equal(sa.is_caller_patient, true);
    const us = (await logCall('+1 (415) 555-2671')).rows[0];
    assert.equal(us.caller_number, '+14155552671');
    await refused(() => logCall('+27821234567', false, '   '), /caller name/);
  });

  await scenario('the same caller is found however the number was typed', async () => {
    await as(U.logger);
    await logCall('+27 82 123 4567');
    const dup = async (phone) => (await db.query('select * from check_duplicate_incident($1, null, null)', [phone])).rows;
    assert.equal((await dup('082 123 4567'))[0]?.reason, 'Caller', 'national form');
    assert.equal((await dup('+27821234567'))[0]?.reason, 'Caller', 'international form');
    assert.equal((await dup('+1 415 555 2671')).length, 0, 'a different caller');
    assert.equal((await dup(null)).length, 0, 'no number, no caller match');
    assert.equal((await dup('4567')).length, 0, 'a fragment is not a caller');
  });

  // ── No vehicle free ────────────────────────────────────────────────────────

  const declare = (reason = null) => db.query('select * from declare_shift_no_vehicle($1)', [reason]);
  const gate = () => scalar('select shift_vehicle_passed_today() as value');

  await scenario('the officer must pass readiness before declaring no vehicle', async () => {
    await db.query("update apparatus set status = 'In Use' where id = $1", [car]);
    await as(U.officer);
    await refused(() => declare(), /readiness/);
  });

  await scenario('while a vehicle is free the officer must take it', async () => {
    await db.query('insert into readiness_ok values ($1)', [U.officer]);
    await as(U.officer);
    await refused(() => declare(), /A vehicle is available/);
    assert.equal(await gate(), false);
  });

  await scenario('with every vehicle taken, the declaration completes the vehicle step', async () => {
    await db.query("update apparatus set status = 'In Use' where id = $1", [car]);
    await db.query('insert into readiness_ok values ($1)', [U.officer]);
    await as(U.officer);
    assert.equal(await gate(), false, 'not before');
    const row = (await declare('All cars out')).rows[0];
    assert.equal(row.reason, 'All cars out');
    assert.equal(row.silo, 'MetroPolice');
    assert.equal(await gate(), true, 'after');
    await as(U.officer2);
    assert.equal(await gate(), false, 'only for the officer who declared');
    assert.equal(Number(await scalar('select count(*)::int as value from shift_no_vehicle_declarations')), 0, 'and they cannot read it');
  });

  await scenario('a declaration does not stand once the officer holds a vehicle', async () => {
    await db.query("update apparatus set status = 'In Use' where id = $1", [car]);
    await db.query('insert into readiness_ok values ($1)', [U.officer]);
    await as(U.officer);
    await declare();
    await db.query('reset role');
    await db.query('update personnel set assigned_apparatus_id = $1 where user_id = $2', [car, U.officer]);
    await as(U.officer);
    assert.equal(await gate(), false, 'the vehicle they hold must be inspected');
    await refused(() => declare(), /already assigned/);
  });

  await scenario('a vehicle in another tenant does not count as free', async () => {
    await db.query("update apparatus set status = 'In Use' where id = $1", [car]);
    await db.query("insert into apparatus(tenant_id, silo, unit_number) values ($1, 'MetroPolice', 'OTHER-1')", [T2]);
    await db.query('insert into readiness_ok values ($1)', [U.officer]);
    await as(U.officer);
    await declare();
    assert.equal(await gate(), true);
  });

  await scenario('Fire crews still start on an apparatus', async () => {
    await db.query('insert into readiness_ok values ($1)', [U.fire]);
    await as(U.fire);
    await refused(() => declare(), /Fire and EMS/);
  });

  // ── Licence and ID ─────────────────────────────────────────────────────────

  const docs = (licence, idDoc) => db.query('select * from record_shift_documents($1, $2)', [licence, idDoc]);

  await scenario('licence and ID photos go on today\'s record, one row a day, from the officer\'s own folder', async () => {
    await as(U.officer);
    const mine = `${T1}/${U.officer}/shift-docs`;
    await refused(() => docs(`${T1}/${U.officer2}/shift-docs/licence.jpg`, null), /not in your folder/);
    await refused(() => docs(`${mine}/../../x.jpg`, null), /not in your folder/);
    await refused(() => docs(null, null), /licence or an ID/);
    const first = (await docs(`${mine}/licence.jpg`, null)).rows[0];
    assert.equal(first.licence_path, `${mine}/licence.jpg`);
    const second = (await docs(null, `${mine}/id.jpg`)).rows[0];
    assert.equal(second.id, first.id, 'same row');
    assert.equal(second.licence_path, `${mine}/licence.jpg`, 'licence kept');
    assert.equal(second.id_document_path, `${mine}/id.jpg`);
    await as(U.officer2);
    assert.equal(Number(await scalar('select count(*)::int as value from shift_identity_documents')), 0, 'private to the officer');
  });

  console.log(`\n${checks} scenarios passed`);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}
