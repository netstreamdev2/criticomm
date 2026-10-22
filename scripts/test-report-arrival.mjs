/** Run "no report until the arrival is proven" (0102) on top of 0099 against
 * in-memory Postgres (PGlite): a report is refused while the officer's own
 * arrival is flagged not verified, goes through once dispatch confirms it
 * (with a note) or once the phone's fixes prove it, and arrivals by GPS are
 * never held up.
 *
 * CASE_PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node scripts/test-report-arrival.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.CASE_PGLITE_MODULE || '@electric-sql/pglite');

const migration = readFileSync(new URL('../supabase/migrations/0099_gps_arrival.sql', import.meta.url), 'utf8');
const gate = readFileSync(new URL('../supabase/migrations/0102_report_needs_arrival.sql', import.meta.url), 'utf8');
const file = (uid) => as(uid).then(() => db.query("insert into public.metro_reports (incident_id) values ($1)", [CALL]));
async function refusedFile(uid) {
  await as(uid);
  await db.query('savepoint f');
  await assert.rejects(db.query("insert into public.metro_reports (incident_id) values ($1)", [CALL]), /not confirmed yet/);
  await db.query('rollback to savepoint f');
}
const db = new PGlite();
let checks = 0;

const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = '20000000-0000-4000-8000-000000000001';
const U = { lead: id(1), backup: id(2), desk: id(3) };
const CALL = id(100);
const NOWHERE = id(101); // a call with no map position
// The scene, and points a given number of metres north of it (1° of latitude ≈ 111,195 m).
const SCENE = { lat: -29.8, lng: 30.9 };
const north = (m) => ({ lat: SCENE.lat + m / 111195, lng: SCENE.lng });
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();

async function as(uid, role = 'Police', silo = 'MetroPolice') {
  await db.query('reset role');
  await db.query("select set_config('test.user', $1, true), set_config('test.role', $2, true), set_config('test.silo', $3, true)", [uid, role, silo]);
  await db.query('set local role authenticated');
}
async function scenario(label, work) {
  await db.query('reset role');
  await db.query('savepoint scenario');
  try { await work(); checks++; console.log(`PASS ${label}`); }
  catch (e) { console.log(`FAIL ${label}`); throw e; }
  finally { await db.query('rollback to savepoint scenario'); await db.query('reset role'); }
}
const accept = (uid, at = ago(20)) => as(uid).then(() => db.query("select public.update_responder_status($1, 'En Route', $2)", [CALL, at]));
const press = (uid, at = null, reason = null, call = CALL) =>
  as(uid).then(() => db.query("select public.update_responder_status($1, 'On Scene', $2, $3)", [call, at, reason]));
const upload = (uid, points) => as(uid).then(() => db.query('select public.record_track($1::jsonb)',
  [JSON.stringify(points.map(([at, p, acc = 8]) => ({ t: at, lat: p.lat, lng: p.lng, acc })))]));
const responder = async (uid) => {
  await db.query('reset role');
  return (await db.query('select status, arrived_at, arrived_by, arrived_distance_m, arrived_verified, arrive_note, start_distance_m from public.incident_responders where user_id = $1 and incident_id = $2', [uid, CALL])).rows[0];
};
const part = async () => (await db.query("select status, arrived_at, arrived_by, arrived_distance_m, arrived_verified from public.incident_departments where incident_id = $1 and silo = 'MetroPolice'", [CALL])).rows[0];
const timeline = async () => (await db.query('select message from public.incident_updates where incident_id = $1 order by seq', [CALL])).rows.map((r) => r.message);
const told = async () => (await db.query("select title, body from public.chain where title like '%not verified%'")).rows;

try {
  await db.exec(`
    create role authenticated nologin; create role anon nologin; create role service_role nologin;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user', true), '')::uuid $$;
    create type public.silo as enum ('MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster', 'Ethekwini');
    create type public.incident_status as enum ('New', 'Pending', 'Pending Dispatch', 'Dispatched', 'En Route', 'Arrived', 'On Scene', 'Transporting', 'Resolved', 'Closed');
    create function public.current_tenant() returns uuid language sql stable as $$ select '${T}'::uuid $$;
    create function public.current_silo() returns public.silo language sql stable as $$ select current_setting('test.silo', true)::public.silo $$;
    create function public.role_in(variadic roles text[]) returns boolean language sql stable as $$ select current_setting('test.role', true) = any (roles) $$;
    create function public.require_role(variadic roles text[]) returns void language plpgsql as $$
      begin if not (current_setting('test.role', true) = any (roles)) then raise exception 'role' using errcode = '42501'; end if; end $$;
    create function public.desk_silo() returns public.silo language sql stable as $$ select null::public.silo $$;
    create function public.can_direct_department(p public.silo) returns boolean language sql stable as $$ select true $$;
    create function public.department_label(s public.silo) returns text language sql immutable as $$
      select case s when 'MetroPolice' then 'Metro Police' else s::text end $$;
    create function public.department_open(s text) returns boolean language sql immutable as $$
      select s in ('Waiting', 'Dispatched', 'En Route', 'Arrived', 'On Scene', 'Transporting') $$;
    create function public.department_step_rank(s text) returns int language sql immutable as $$
      select case s when 'Waiting' then 0 when 'Dispatched' then 1 when 'En Route' then 2 when 'Arrived' then 3
                    when 'On Scene' then 4 when 'Transporting' then 5 else 9 end $$;
    create table public.app_settings (tenant_id uuid, key text, value jsonb, primary key (tenant_id, key));
    create table public.profiles (id uuid primary key, full_name text);
    create table public.apparatus (id uuid primary key, unit_number text);
    create table public.personnel (id uuid primary key default gen_random_uuid(), user_id uuid, tenant_id uuid default '${T}', silo public.silo,
      is_on_duty boolean default true, assigned_apparatus_id uuid, latitude double precision, longitude double precision,
      location_at timestamptz, last_login timestamptz);
    create table public.incidents (id uuid primary key, tenant_id uuid default '${T}', silo public.silo, incident_number text,
      status public.incident_status, incident_type text, location_address text, incident_severity text,
      location_lat double precision, location_lng double precision, acceptance boolean, accepted_by uuid, accepted_at timestamptz,
      unit_id uuid, arrived_timestamp timestamptz, responding_officer text, updated_at timestamptz, dispatched_by_id uuid);
    create table public.incident_departments (id uuid primary key default gen_random_uuid(), incident_id uuid, silo public.silo,
      status text, lead_id uuid, lead_name text, accepted_at timestamptz, arrived_at timestamptz, assigned_to uuid, updated_at timestamptz);
    create table public.incident_responders (id uuid primary key default gen_random_uuid(), tenant_id uuid default '${T}',
      incident_id uuid, user_id uuid, silo public.silo, name text, unit_id uuid, role text, status public.incident_status default 'En Route',
      joined_at timestamptz default now(), updated_at timestamptz default now(), unique (incident_id, user_id));
    create table public.incident_updates (seq bigint generated always as identity, silo public.silo, incident_id uuid, message text,
      created_by uuid, created_by_name text, timestamp timestamptz default now());
    create table public.alerts (tenant_id uuid, silo public.silo, target_user_id uuid, kind text, severity text, title text, body text,
      incident_id uuid, link text, presentation text, requires_ack boolean, created_by uuid, created_by_name text);
    create table public.duty_tracks (id bigint generated always as identity, tenant_id uuid default '${T}', silo public.silo, user_id uuid,
      recorded_at timestamptz, lat double precision, lng double precision, accuracy real, speed real, heading real,
      unique (tenant_id, user_id, recorded_at));
    create table public.chain (title text, body text);
    create table public.audit_logs (tenant_id uuid, silo public.silo, user_id uuid, user_name text, action_type text, entity_type text, entity_id text, details text);
    create table public.metro_reports (id bigint generated always as identity, incident_id uuid);
    create table public.firefighter_reports (id bigint generated always as identity, incident_id uuid);
    create table public.paramedic_reports (id bigint generated always as identity, incident_id uuid);
    grant insert, select on public.metro_reports to authenticated;
    create function public.notify_incident_chain(i public.incidents, k text, t text, b text) returns void language sql as $$
      insert into public.chain values (t, b) $$;
    create function public.ensure_incident_departments(i public.incidents) returns void language sql as $$ select $$;
    -- The call's status follows its furthest department (0073's rule, shortened).
    create function public.sync_incident_from_departments(p uuid) returns public.incidents language sql as $$
      update public.incidents i set status = d.status::public.incident_status
        from (select status from public.incident_departments where incident_id = p order by public.department_step_rank(status) desc limit 1) d
       where i.id = p returning i.* $$;
    grant usage on schema public, auth to authenticated;
    insert into public.profiles values ('${U.lead}', 'Const. Khumalo'), ('${U.backup}', 'Const. Dube'), ('${U.desk}', 'Nomsa Metro');
    insert into public.personnel (user_id, silo) values ('${U.lead}', 'MetroPolice'), ('${U.backup}', 'MetroPolice');
    insert into public.incidents (id, silo, incident_number, status, incident_type, location_address, incident_severity, location_lat, location_lng)
      values ('${CALL}', 'MetroPolice', 'ETK-MP-20261022-1000-0001', 'Dispatched', 'Assault', '10 Village Road', 'High', ${SCENE.lat}, ${SCENE.lng}),
             ('${NOWHERE}', 'MetroPolice', 'ETK-MP-20261022-1000-0002', 'Dispatched', 'Assault', 'Somewhere', 'High', null, null);
    insert into public.incident_departments (incident_id, silo, status) values
      ('${CALL}', 'MetroPolice', 'Dispatched'), ('${NOWHERE}', 'MetroPolice', 'Dispatched');
  `);
  await db.exec(migration);
  await db.exec(gate);
  await db.exec(gate); // safe to re-run
  await db.query('begin');

  await scenario('a press from across town cannot file the report', async () => {
    await accept(U.lead);
    await upload(U.lead, [[ago(3), north(3000)]]);
    await press(U.lead, ago(2), 'I am at the scene');
    assert.equal((await responder(U.lead)).arrived_verified, false);
    await refusedFile(U.lead);
  });

  await scenario('dispatch confirms it, with a note, and the report goes through', async () => {
    await accept(U.lead);
    await press(U.lead, ago(2), 'GPS not working');
    await as(U.desk, 'Dispatcher');
    await db.query('savepoint n');
    await assert.rejects(db.query("select public.confirm_arrival($1, 'MetroPolice', '')", [CALL]), /Say how you know/);
    await db.query('rollback to savepoint n');
    await db.query("select public.confirm_arrival($1, 'MetroPolice', 'Called the officer, sirens heard')", [CALL]);
    const r = await responder(U.lead);
    assert.equal(r.arrived_verified, true);
    assert.match(r.arrive_note, /Confirmed by Nomsa Metro: Called the officer/);
    assert.match((await timeline()).at(-1), /Arrival confirmed by dispatch · Metro Police — Nomsa Metro: Called the officer/);
    await file(U.lead);
  });

  await scenario('the phone proving it later clears the way too', async () => {
    await accept(U.lead);
    await press(U.lead, ago(4), 'GPS not working');
    await refusedFile(U.lead);
    await upload(U.lead, [[ago(4), north(30)]]);
    assert.equal((await responder(U.lead)).arrived_verified, true);
    await file(U.lead);
  });

  await scenario('arrived by GPS: filed without a hold-up', async () => {
    await accept(U.lead);
    await upload(U.lead, [[ago(5), north(20)]]);
    await file(U.lead);
  });

  await db.query('rollback');
  console.log(`\n${checks} scenarios passed; 0102 applied twice.`);
} finally {
  await db.close();
}
