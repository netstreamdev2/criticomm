/** Run the real department-parts migration (0073) against in-memory Postgres
 * (PGlite), on the real report tables from 0001 and the dispatch desk wall
 * (0068): a call sent to several departments stays in each desk's queue until
 * that desk dispatches it, each department leads and reports its own part,
 * the call is resolved only when every department has finished, a department
 * is stood down with a reason, and a desk reads its own crews only. Then the
 * officer's close (0074): the lead closes their own part once its report is
 * filed, and dispatch hears which departments are still on the call. And
 * filing by radio (0075): the desk files and closes for a crew without a phone.
 *
 * CASE_PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node scripts/test-department-parts.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.CASE_PGLITE_MODULE || '@electric-sql/pglite');

const read = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const fn = (src, name) => {
  const start = src.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `${name} found`);
  return src.slice(start, src.indexOf('end $$;', start) + 7);
};
const sqlFn = (src, name) => {
  const start = src.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `${name} found`);
  const body = src.indexOf('$$', start);
  return src.slice(start, src.indexOf('$$;', body + 2) + 3);
};
const init = read('0001_init.sql');
const slice = (from, to) => {
  const a = init.indexOf(`create table public.${from}`);
  const b = init.indexOf(`create table public.${to}`);
  assert.ok(a > 0 && b > a, `${from}..${to} found in 0001`);
  return init.slice(a, b);
};
const migration = read('0073_department_parts.sql');
const officerClose = read('0074_officer_close.sql');
const radioFiling = read('0075_desk_radio_filing.sql');
const m0068 = read('0068_dispatch_desk_tags.sql');
const wall = m0068.slice(m0068.indexOf('create or replace function public.desk_silo()'), m0068.indexOf('-- ── Intake'));

const db = new PGlite();
let checks = 0;
const one = async (q, args) => (await db.query(q, args)).rows[0];
const rows = async (q, args) => (await db.query(q, args)).rows;

const T = '20000000-0000-4000-8000-000000000001';
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const inc = (n) => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const U = {
  central: id(1), policeDesk: id(2), fireDesk: id(3), emsDesk: id(4), cop: id(5), cop2: id(6), fireman: id(7),
  medic: id(8), emsSup: id(9), caseMgr: id(10), disaster: id(11), fireman2: id(12),
};
// [id, role, silo, name, on duty in the field]
const PEOPLE = [
  [U.central, 'Dispatcher', 'Ethekwini', 'Naledi Control', false],
  [U.policeDesk, 'Dispatcher', 'MetroPolice', 'Nomsa Metro', false],
  [U.fireDesk, 'Dispatcher', 'MetroFire', 'Fire Control', false],
  [U.emsDesk, 'Dispatcher', 'Medical', 'EMS Control', false],
  [U.cop, 'Police', 'MetroPolice', 'Const. Khumalo', true],
  [U.cop2, 'Police', 'MetroPolice', 'Const. Dlamini', true],
  [U.fireman, 'Firefighter', 'MetroFire', 'FF Naidoo', true],
  [U.fireman2, 'Firefighter', 'MetroFire', 'FF Mokoena', true],
  [U.medic, 'Paramedic', 'Medical', 'Priya Pillay', true],
  [U.emsSup, 'Supervisor', 'Medical', 'EMS Supervisor', false],
  [U.caseMgr, 'CaseManager', 'Ethekwini', 'Case Manager', false],
  [U.disaster, 'Disaster', 'EthekwiniDisaster', 'DM Officer', true],
];

async function as(uid) {
  await db.query('reset role');
  await db.query("select set_config('test.user', $1, true)", [uid]);
  await db.query('set local role authenticated');
}
async function asDefiner(uid) {
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

const newCall = (n, tags, silo = 'Ethekwini', extra = {}) => db.query(
  `insert into public.incidents (id, silo, tagged_silos, incident_number, caller_name, caller_number, call_description,
     incident_type, location_address, location_lat, location_lng, status, source, created_by)
   values ($1, $2, $3::public.silo[], $4, 'Caller', '+27821234567', 'Truck on fire, driver trapped', 'Vehicle fire',
     '1 Main Street', -29.85, 31.02, 'Pending Dispatch', $5, $6)`,
  [inc(n), silo, tags, `INC-0073-${n}`, extra.source ?? 'Master', extra.createdBy ?? null]);
const route = (uid, n, silos) => asDefiner(uid).then(() => db.query('select * from public.route_incident($1, $2::public.silo[])', [inc(n), silos]));
const assign = (uid, n, who) => asDefiner(uid).then(() => db.query('select * from public.assign_incident($1, $2)', [inc(n), who]));
const step = (uid, n, status) => asDefiner(uid).then(() => db.query('select * from public.update_responder_status($1, $2)', [inc(n), status]));
const standDown = (uid, n, silo, reason) => asDefiner(uid).then(() =>
  db.query('select * from public.stand_down_department($1, $2, $3)', [inc(n), silo, reason]));
const parts = async (n) => Object.fromEntries((await rows(
  'select silo, status, lead_id, report_filed_at, assigned_to from public.incident_departments where incident_id = $1', [inc(n)],
)).map((r) => [r.silo, r]));
const call = (n) => one('select * from public.incidents where id = $1', [inc(n)]);
const queue = async (uid, silo) => {
  await as(uid);
  const r = (await rows(
    `select i.incident_number from public.incidents i
      where exists (select 1 from public.incident_departments d where d.incident_id = i.id and d.status = 'Waiting'
                     and ($1::public.silo is null or d.silo = $1::public.silo))
      order by 1`, [silo])).map((x) => x.incident_number);
  await db.query('reset role');
  return r;
};

const policeReport = (n) => asDefiner(U.cop).then(() => db.query(
  'select * from public.file_incident_report($1, $2, $3::jsonb)',
  [inc(n), 'incident', JSON.stringify({ officer_narrative: 'Scene secured, traffic diverted, statements taken from two witnesses.' })]));
const fireReport = (n, uid = U.fireman) => asDefiner(uid).then(() => db.query(
  'select * from public.file_fire_report($1, $2::jsonb)',
  [inc(n), JSON.stringify({
    type_of_incident: 'Vehicle fire', narrative_summary: 'Truck cab fire extinguished, driver extricated and handed to EMS.',
    fire_cause: 'Electrical fault', no_photo_reason: 'Night, no light',
  })]));
const SIG = 'data:image/png;base64,iVBORw0KGgo=';
const pcr = (n) => asDefiner(U.medic).then(() => db.query(
  'select * from public.file_pcr($1, $2::jsonb)',
  [inc(n), JSON.stringify({
    patient_name: 'Thandi Zulu', chief_complaint: 'Burns to the arm', level_of_care: 'ALS', patient_response: 'Improved',
    transport_mode: 'Ambulance (Ground)', destination_hospital: 'Addington Hospital',
    gcs_eye: '4 - Spontaneously', gcs_verbal: '5 - Oriented', gcs_motor: '6 - Obeys Commands',
    departure_time: '14:05', arrival_time: '14:30', responder_signature_image_base64: SIG, requires_cleaning: 'false',
    handover_doctor_name: 'Dr Dale Naidoo', handover_patient_status: 'Stable, GCS 15', doctor_signature_image_base64: SIG,
    inv_oxygen: 'true', inv_bvm: 'true', inv_suction: 'true', inv_iv: 'true', inv_bandages: 'true',
    inv_aed: 'true', inv_drugs: 'true', inv_sharps: 'true', inv_ppe: 'true',
  })]));
const postMortem = (n) => asDefiner(U.disaster).then(() => db.query(
  'select * from public.file_post_mortem($1, $2::jsonb)',
  [inc(n), JSON.stringify({
    start_time: '2026-10-12 08:00', end_time: '2026-10-12 09:00', injuries: '1', fatalities: '0', displaced_people: '4',
    root_cause: 'Electrical fault in the truck', lessons_learned: 'Faster road closure', reporting_officer: 'DM Officer',
  })]));

try {
  await db.exec(`
    create role authenticated nologin; create role anon nologin; create role service_role nologin;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user', true), '')::uuid $$;
    create function public.uuid_generate_v4() returns uuid language sql as $$ select gen_random_uuid() $$;
    create type public.silo as enum ('Ethekwini', 'MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster');
    create type public.user_role as enum ('SystemAdmin', 'SuperAdmin', 'Admin', 'Supervisor', 'Dispatcher', 'Operator',
      'ControlRoom', 'IncidentLogger', 'Viewer', 'System', 'Captain', 'Police', 'Officer', 'Metro', 'Security', 'Chief',
      'FireChief', 'Firefighter', 'Paramedic', 'Doctor', 'Disaster', 'CaseManager', 'Staff', 'SystemController', 'Responder');
    create type public.incident_severity as enum ('Low', 'Medium', 'High', 'Critical');
    create type public.incident_status as enum ('New', 'Pending', 'Pending Dispatch', 'Pending Analysis', 'Dispatched',
      'En Route', 'Arrived', 'On Scene', 'Transporting', 'Active', 'Closed', 'Resolved');
    create domain public.silo_d as public.silo;
    create table public.profiles (
      id uuid primary key, tenant_id uuid default '${T}', role public.user_role, silo public.silo,
      full_name text, deactivated_at timestamptz);
    create function public.current_tenant() returns uuid language sql stable as $$ select '${T}'::uuid $$;
    create function public.current_silo() returns public.silo language sql stable security definer as $$
      select coalesce((select silo from public.profiles where id = auth.uid()), 'Ethekwini') $$;
    create function public.role_in(variadic roles text[]) returns boolean language sql stable security definer as $$
      select exists (select 1 from public.profiles where id = auth.uid() and role::text = any (roles)) $$;
    create function public.require_role(variadic roles text[]) returns void language plpgsql stable as $$
    begin
      if not public.role_in(variadic roles) then raise exception 'Not permitted for your role' using errcode = '42501'; end if;
    end $$;
    ${sqlFn(read('0048_account_safety_rules.sql'), 'is_global')}
    ${sqlFn(read('0067_role_fits_department.sql'), 'department_label')}
    create table public.apparatus (id uuid primary key default gen_random_uuid(), tenant_id uuid default '${T}', silo public.silo,
      unit_number text, status text default 'In Use', status_note text, status_changed_at timestamptz, status_changed_by_name text);
    create table public.personnel (id uuid primary key default gen_random_uuid(), user_id uuid, tenant_id uuid default '${T}',
      silo public.silo, rank text, first_name text, last_name text, badge_number text, station text,
      is_on_duty boolean default false, assigned_apparatus_id uuid, updated_at timestamptz default now());
  `);
  // The call itself, as 0001 made it and later migrations grew it.
  const incidents = init.slice(init.indexOf('create table public.incidents ('), init.indexOf('create index on public.incidents(silo);'))
    .replace('geography(point, 4326)', 'text');
  await db.exec(incidents);
  await db.exec(`
    alter table public.incidents
      add column tenant_id uuid not null default '${T}', add column tagged_silos public.silo[] not null default '{}',
      add column accepted_by uuid, add column accepted_at timestamptz, add column dispatched_by text, add column dispatched_by_id uuid,
      add column assigned_to uuid, add column assigned_to_name text, add column assigned_at timestamptz, add column assigned_by uuid,
      add column resolved_at timestamptz, add column resolved_by uuid, add column report_filed_at timestamptz,
      add column closed_by uuid, add column closed_by_name text, add column close_kind text, add column close_reason text;
    create table public.incident_responders (
      id uuid primary key default gen_random_uuid(), tenant_id uuid not null default '${T}',
      incident_id uuid not null references public.incidents(id) on delete cascade, user_id uuid not null, silo public.silo not null,
      name text, unit_id uuid, role text not null check (role in ('lead', 'backup')),
      status public.incident_status not null default 'En Route', joined_at timestamptz not null default now(),
      updated_at timestamptz not null default now(), unique (incident_id, user_id));
    create table public.incident_updates (id uuid primary key default gen_random_uuid(), tenant_id uuid default '${T}',
      silo public.silo, incident_id uuid, message text, created_by uuid, created_by_name text, timestamp timestamptz default now());
    create table public.incident_attachments (id uuid primary key default gen_random_uuid(), incident_id uuid, kind text);
    create table public.alerts (id uuid primary key default gen_random_uuid(), tenant_id uuid default '${T}', silo public.silo,
      target_user_id uuid, kind text, severity text, title text, body text, incident_id uuid, link text, presentation text,
      requires_ack boolean, created_by uuid, created_by_name text);
    create table public.audit_logs (id uuid primary key default gen_random_uuid(), tenant_id uuid default '${T}', silo public.silo,
      user_id uuid, user_name text, department text, action_type text, entity_type text, entity_id text, details text);
    create table public.sent (kind text, title text);
    create function public.notify_incident_chain(p_incident public.incidents, p_kind text, p_title text, p_body text)
      returns integer language sql as $$ insert into public.sent values (p_kind, p_title); select 1 $$;
    create function public.notify_command(p_tenant uuid, p_silo public.silo, p_title text, p_body text, p_severity text, p_link text)
      returns void language sql as $$ insert into public.sent values ('command', p_title) $$;
    create function public.can_work_incident(p_incident_id uuid) returns boolean language sql stable as $$ select true $$;
  `);
  await db.exec(slice('metro_reports', 'firearm_authorizations'));
  await db.exec(slice('firefighter_reports', 'public_incident_reports'));
  await db.exec(slice('medical_histories', 'relief_stocks'));
  await db.exec(`
    alter table public.metro_reports add column report_type text, add column details jsonb not null default '{}'::jsonb,
      add column filed_by uuid, add column filed_at timestamptz;
    alter table public.paramedic_reports add column report_number text, add column filed_by uuid, add column filed_at timestamptz,
      add column ambulance_id uuid, add column total_response_seconds bigint,
      add column handover_doctor_name text, add column handover_patient_status text;
    alter table public.post_mortem_reports add column report_number text, add column filed_by uuid;
    do $$ declare t text; begin
      foreach t in array array['metro_reports', 'firefighter_reports', 'medical_histories', 'assessment_findings', 'vital_signs',
        'interventions', 'paramedic_reports', 'legal_handovers', 'ambulance_restocks', 'disaster_logs', 'post_mortem_reports'] loop
        execute format('alter table public.%I add column tenant_id uuid not null default %L', t, '${T}');
      end loop;
    end $$;
  `);
  // What 0073 builds on: the SOS raiser (0044), the desks' wall (0068), the
  // report guards (0059, 0063, 0065) and close_case (0061).
  const sos = read('0044_sos_not_to_raiser.sql');
  const sosStart = sos.indexOf('create or replace function public.sos_raiser(');
  await db.exec(sos.slice(sosStart, sos.indexOf('$$;', sos.indexOf('$$', sosStart) + 2) + 3));
  await db.exec(wall);
  for (const [file, name] of [['0059_fire_incident_flow.sql', 'guard_fire_resolution'], ['0063_ems_incident_flow.sql', 'guard_ems_resolution'],
    ['0065_disaster_flow.sql', 'guard_disaster_resolution']]) {
    await db.exec(fn(read(file), name));
    await db.exec(`create trigger ${name} before update of status on public.incidents for each row execute function public.${name}()`);
  }
  await db.exec(fn(read('0061_case_review_and_close.sql'), 'close_case'));
  await db.exec(`
    alter table public.incidents enable row level security;
    create policy incidents_read on public.incidents for select to authenticated using (
      public.is_global() or silo = public.current_silo() or public.current_silo() = any (dispatched_silos));
    alter table public.personnel enable row level security;
    create policy personnel_read on public.personnel for select using (silo = public.current_silo() or public.is_global());
    grant usage on schema public, auth to authenticated;
    grant select on all tables in schema public to authenticated;
    grant select on auth.users to authenticated;
  `);

  // A call from before 0073: Police and Fire dispatched, a police officer
  // leading, a firefighter on it as backup.
  for (const [uid, role, silo, name, field] of PEOPLE) {
    await db.query('insert into auth.users values ($1)', [uid]);
    await db.query('insert into public.profiles (id, role, silo, full_name) values ($1, $2, $3, $4)', [uid, role, silo, name]);
    const [first, ...last] = name.split(' ');
    await db.query('insert into public.personnel (user_id, silo, first_name, last_name, is_on_duty) values ($1, $2, $3, $4, $5)',
      [uid, silo, first, last.join(' '), field]);
  }
  await newCall(90, '{MetroPolice,MetroFire}');
  await db.query(`update public.incidents set status = 'On Scene', dispatched_silos = '{MetroPolice,MetroFire}', dispatch_time = now(),
    accepted_by = $2, accepted_at = now(), arrived_timestamp = now(), responding_officer = 'Const. Dlamini' where id = $1`, [inc(90), U.cop2]);
  await db.query(`insert into public.incident_responders (incident_id, user_id, silo, name, role, status) values
    ($1, $2, 'MetroPolice', 'Const. Dlamini', 'lead', 'On Scene'), ($1, $3, 'MetroFire', 'FF Mokoena', 'backup', 'En Route')`,
    [inc(90), U.cop2, U.fireman2]);
  await newCall(91, '{MetroPolice}');
  await db.query(`update public.incidents set status = 'Resolved', dispatched_silos = '{MetroPolice}', report_filed_at = now(),
    resolved_at = now(), resolved_by = $2, accepted_by = $2 where id = $1`, [inc(91), U.cop]);

  // The migration under test, twice: it must be safe to re-run.
  await db.exec(migration);
  await db.exec(migration);
  await db.exec(officerClose);
  await db.exec(officerClose);
  await db.exec(radioFiling);
  await db.exec(radioFiling);
  // 0039's trigger, on the function 0073 replaces.
  await db.exec('create trigger hold_duty_during_call before update of is_on_duty, assigned_apparatus_id on public.personnel for each row execute function public.hold_duty_during_call()');
  await db.query('begin');

  await scenario('calls already on record get their parts: each department leads its own, a finished call is finished', async () => {
    const p = await parts(90);
    assert.equal(p.MetroPolice.status, 'On Scene');
    assert.equal(p.MetroPolice.lead_id, U.cop2);
    assert.equal(p.MetroFire.status, 'En Route', 'the firefighter already on it');
    assert.equal(p.MetroFire.lead_id, U.fireman2, 'leads Fire now');
    assert.equal((await one('select role from public.incident_responders where incident_id = $1 and user_id = $2', [inc(90), U.fireman2])).role, 'lead');
    const f = await parts(91);
    assert.equal(f.MetroPolice.status, 'Resolved');
    assert.ok(f.MetroPolice.report_filed_at);
    assert.equal(Number((await one('select count(*)::int as n from public.incident_departments')).n), 3, 'rerun added nothing');
  });

  await scenario('a new call is waiting in each desk it was sent to', async () => {
    await newCall(1, '{MetroPolice,MetroFire}');
    const p = await parts(1);
    assert.deepEqual(Object.keys(p).sort(), ['MetroFire', 'MetroPolice']);
    assert.equal(p.MetroPolice.status, 'Waiting');
    assert.ok((await queue(U.policeDesk, 'MetroPolice')).includes('INC-0073-1'));
    assert.ok((await queue(U.fireDesk, 'MetroFire')).includes('INC-0073-1'));
    assert.ok(!(await queue(U.emsDesk, 'Medical')).includes('INC-0073-1'), 'not sent to EMS');
  });

  await scenario('Police dispatching leaves the call in the Fire queue; Fire can still dispatch after Police leads', async () => {
    await newCall(1, '{MetroPolice,MetroFire}');
    await route(U.policeDesk, 1, '{MetroPolice}');
    let p = await parts(1);
    assert.equal(p.MetroPolice.status, 'Dispatched');
    assert.equal(p.MetroFire.status, 'Waiting');
    assert.equal((await call(1)).status, 'Dispatched');
    assert.deepEqual((await call(1)).dispatched_silos, '{MetroPolice}');
    assert.ok(!(await queue(U.policeDesk, 'MetroPolice')).includes('INC-0073-1'), 'gone from the Police queue');
    assert.ok((await queue(U.fireDesk, 'MetroFire')).includes('INC-0073-1'), 'still in the Fire queue');

    await step(U.cop, 1, 'En Route');
    assert.equal((await parts(1)).MetroPolice.lead_id, U.cop);
    // The Fire desk sends its own crews only, and may now.
    await refused(() => route(U.fireDesk, 1, '{MetroPolice,MetroFire}'), /dispatches Fire & Rescue crews only/);
    await route(U.fireDesk, 1, '{MetroFire}');
    p = await parts(1);
    assert.equal(p.MetroFire.status, 'Dispatched');
    assert.equal((await one("select array_to_string(array(select x::text from unnest(dispatched_silos) x order by 1), ',') as s from public.incidents where id = $1", [inc(1)])).s, 'MetroFire,MetroPolice', 'added, never replaced');
    assert.ok(!(await queue(U.fireDesk, 'MetroFire')).includes('INC-0073-1'));
    // Police is led: not sent again.
    await refused(() => route(U.policeDesk, 1, '{MetroPolice}'), /Metro Police is led by Const. Khumalo/);
  });

  await scenario('the first firefighter to respond leads Fire; the next is backup to them, not to Police', async () => {
    await newCall(1, '{MetroPolice,MetroFire}');
    await route(U.central, 1, '{MetroPolice,MetroFire}');
    await step(U.cop, 1, 'En Route');
    await step(U.fireman, 1, 'En Route');
    await step(U.fireman2, 1, 'En Route');
    const roles = Object.fromEntries((await rows('select user_id, role from public.incident_responders where incident_id = $1', [inc(1)]))
      .map((r) => [r.user_id, r.role]));
    assert.equal(roles[U.cop], 'lead');
    assert.equal(roles[U.fireman], 'lead');
    assert.equal(roles[U.fireman2], 'backup');
    assert.equal((await parts(1)).MetroFire.lead_id, U.fireman);
    assert.equal((await call(1)).accepted_by, U.cop, 'the call keeps its first lead');
    // Backup tells the department's lead.
    assert.ok(await one("select 1 from public.alerts where kind = 'backup' and target_user_id = $1", [U.fireman]));
    // A department not dispatched is not the crew's to respond to.
    await newCall(2, '{MetroPolice,MetroFire}');
    await route(U.policeDesk, 2, '{MetroPolice}');
    await refused(() => step(U.fireman, 2, 'En Route'), /was not sent to you/);
    await refused(() => step(U.cop, 1, 'Resolved'), /finishes INC-0073-1 with its report/);
  });

  await scenario('the police report finishes Police only; the fire report then resolves the call', async () => {
    const car = (await one("insert into public.apparatus (silo, unit_number) values ('MetroPolice', 'MP-12') returning id")).id;
    const engine = (await one("insert into public.apparatus (silo, unit_number) values ('MetroFire', 'ENG-4') returning id")).id;
    await db.query('update public.personnel set assigned_apparatus_id = $2 where user_id = $1', [U.cop, car]);
    await db.query('update public.personnel set assigned_apparatus_id = $2 where user_id = $1', [U.fireman, engine]);
    await newCall(1, '{MetroPolice,MetroFire}');
    await route(U.central, 1, '{MetroPolice,MetroFire}');
    await step(U.cop, 1, 'En Route');
    await step(U.cop, 1, 'On Scene');
    await step(U.fireman, 1, 'En Route');
    await policeReport(1);
    let p = await parts(1);
    assert.equal(p.MetroPolice.status, 'Resolved');
    assert.ok(p.MetroPolice.report_filed_at);
    let c = await call(1);
    assert.equal(c.status, 'En Route', 'Fire is still on the way');
    assert.equal(c.report_filed_at, null);
    assert.ok(await one("select 1 from public.incident_updates where incident_id = $1 and message = '[DEPARTMENT] Metro Police has finished. Still working: Fire & Rescue.'", [inc(1)]));
    assert.ok(await one("select 1 from public.sent where kind = 'report_filed' and title = 'INC-0073-1: police report filed by Const. Khumalo'"));
    assert.ok(!(await one("select 1 as x from public.sent where kind = 'resolved'")), 'case managers not told yet');
    // A replay of the same report is returned, not filed again.
    await policeReport(1);
    assert.equal(Number((await one('select count(*)::int as n from public.metro_reports where incident_id = $1', [inc(1)])).n), 1);
    // Fire is not finished by it: the firefighter still works the call.
    await step(U.fireman, 1, 'On Scene');
    // Police may sign off; the firefighter may not.
    await asDefiner(U.cop);
    await db.query('update public.personnel set is_on_duty = false where user_id = $1', [U.cop]);
    await asDefiner(U.fireman);
    await refused(() => db.query('update public.personnel set is_on_duty = false where user_id = $1', [U.fireman]), /still open/);
    // The case cannot be reviewed while Fire works it.
    await asDefiner(U.caseMgr);
    await refused(() => db.query('select public.close_case($1)', [inc(1)]), /still live/);

    await fireReport(1);
    p = await parts(1);
    assert.equal(p.MetroFire.status, 'Resolved');
    assert.equal((await one('select apparatus_id from public.firefighter_reports where incident_id = $1', [inc(1)])).apparatus_id, engine,
      'the fire report names the fire engine, not the police car');
    c = await call(1);
    assert.equal(c.status, 'Resolved');
    assert.ok(c.report_filed_at && c.resolved_at);
    assert.ok(await one("select 1 from public.sent where kind = 'resolved'"));
    assert.ok(await one("select 1 from public.incident_updates where incident_id = $1 and message like '[RESOLVED] Fire & Rescue has finished.%'", [inc(1)]));
    await asDefiner(U.caseMgr);
    assert.equal((await one('select (public.close_case($1)).status as s', [inc(1)])).s, 'Closed');
  });

  await scenario('each crew files only its own department: the patient report and the post-mortem finish their parts', async () => {
    await newCall(1, '{MetroFire,Medical,EthekwiniDisaster}');
    await route(U.central, 1, '{MetroFire,Medical,EthekwiniDisaster}');
    for (const [uid] of [[U.fireman], [U.medic], [U.disaster]]) {
      await step(uid, 1, 'En Route');
      await step(uid, 1, 'On Scene');
    }
    // A firefighter cannot file EMS's report, nor a medic Fire's.
    await refused(() => fireReport(1, U.fireman2), /Only the firefighter leading/);
    await pcr(1);
    assert.equal((await parts(1)).Medical.status, 'Resolved');
    assert.equal((await call(1)).status, 'On Scene');
    await postMortem(1);
    assert.equal((await parts(1)).EthekwiniDisaster.status, 'Resolved');
    assert.equal((await call(1)).status, 'On Scene');
    await fireReport(1);
    assert.equal((await call(1)).status, 'Resolved');
  });

  await scenario('Not needed: with a reason, by the desk before the scene, by command on it, never the last one', async () => {
    await newCall(1, '{MetroPolice,Medical}');
    await refused(() => standDown(U.emsDesk, 1, 'Medical', 'no'), /Say why EMS is not needed/);
    await refused(() => standDown(U.fireDesk, 1, 'Medical', 'Caller says nobody is hurt at all'), /Only EMS dispatch or command/);
    await standDown(U.emsDesk, 1, 'Medical', 'Caller says nobody is hurt at all');
    assert.equal((await parts(1)).Medical.status, 'Not needed');
    assert.ok(!(await queue(U.emsDesk, 'Medical')).includes('INC-0073-1'), 'off the EMS queue');
    // Police is the last department and has filed nothing: cancel the call instead.
    await refused(() => standDown(U.policeDesk, 1, 'MetroPolice', 'Caller cancelled, nobody needed'), /Cancel the call instead/);

    await newCall(2, '{MetroPolice,Medical}');
    await route(U.central, 2, '{MetroPolice,Medical}');
    await step(U.medic, 2, 'En Route');
    await step(U.medic, 2, 'On Scene');
    await refused(() => standDown(U.emsDesk, 2, 'Medical', 'Patient refused treatment on scene'), /EMS is on scene/);
    await standDown(U.emsSup, 2, 'Medical', 'Patient refused treatment on scene');
    assert.ok(await one("select 1 from public.alerts where kind = 'stand_down' and target_user_id = $1", [U.medic]));
    // The medic is free to sign off; the stood-down part takes no report.
    await refused(() => pcr(2), /already closed|Mark yourself on scene/);
    // Police finishing now resolves the call.
    await step(U.cop, 2, 'En Route');
    await step(U.cop, 2, 'On Scene');
    await policeReport(2);
    assert.equal((await call(2)).status, 'Resolved');
  });

  await scenario('cancelling a live call: never while another department has it, unless you direct them all', async () => {
    await newCall(1, '{MetroPolice,MetroFire}');
    await route(U.policeDesk, 1, '{MetroPolice}');
    await asDefiner(U.policeDesk);
    await refused(() => db.query('select public.close_case($1, $2)', [inc(1), 'Hoax call, caller admitted it']),
      /Fire & Rescue still has INC-0073-1/);
    await asDefiner(U.central);
    await db.query('select public.close_case($1, $2)', [inc(1), 'Hoax call, caller admitted it']);
    const p = await parts(1);
    assert.equal(p.MetroPolice.status, 'Cancelled');
    assert.equal(p.MetroFire.status, 'Cancelled');
  });

  await scenario('assigning: per department, never the SOS raiser, and another department\'s lead does not block it', async () => {
    await newCall(1, '{MetroPolice,MetroFire}');
    await route(U.central, 1, '{MetroPolice}');
    await step(U.cop, 1, 'En Route');
    await assign(U.fireDesk, 1, U.fireman);
    let p = await parts(1);
    assert.equal(p.MetroFire.status, 'Dispatched');
    assert.equal(p.MetroFire.assigned_to, U.fireman);
    assert.equal((await call(1)).assigned_to, null, 'the call\'s own assignment stays the first department\'s');
    await refused(() => assign(U.fireDesk, 1, U.cop2), /dispatches Fire & Rescue crews only/);
    await refused(() => assign(U.central, 1, U.cop2), /already led by Const. Khumalo for Metro Police/);
    // The assigned firefighter leads; another firefighter is backup.
    await step(U.fireman2, 1, 'En Route');
    await step(U.fireman, 1, 'En Route');
    p = await parts(1);
    assert.equal(p.MetroFire.lead_id, U.fireman);

    await newCall(2, '{MetroPolice}', 'MetroPolice', { source: 'Responder-Panic', createdBy: U.cop });
    await refused(() => assign(U.policeDesk, 2, U.cop), /raised this SOS/);
  });

  await scenario('the desk marks its own department\'s crew, forwards only, and not a department not dispatched', async () => {
    await newCall(1, '{MetroPolice,MetroFire}');
    await route(U.central, 1, '{MetroPolice}');
    await asDefiner(U.fireDesk);
    await refused(() => db.query("select public.set_department_status($1, 'MetroPolice', 'On Scene')", [inc(1)]), /Only Metro Police dispatch/);
    await refused(() => db.query("select public.set_department_status($1, 'MetroFire', 'On Scene')", [inc(1)]), /has not dispatched/);
    await asDefiner(U.policeDesk);
    await db.query('select public.update_responder_status($1, $2)', [inc(1), 'On Scene']);
    assert.equal((await parts(1)).MetroPolice.status, 'On Scene');
    await db.query('select public.update_responder_status($1, $2)', [inc(1), 'En Route']);
    assert.equal((await parts(1)).MetroPolice.status, 'On Scene', 'never backwards');
    assert.equal((await call(1)).status, 'On Scene');
  });

  await scenario('a desk reads its own crews; the control room reads every department\'s', async () => {
    const crews = async (uid) => {
      await as(uid);
      const r = (await rows('select distinct silo::text as s from public.personnel order by 1')).map((x) => x.s);
      await db.query('reset role');
      return r;
    };
    assert.deepEqual(await crews(U.policeDesk), ['MetroPolice']);
    assert.deepEqual(await crews(U.fireDesk), ['MetroFire']);
    assert.ok((await crews(U.central)).length >= 4);
  });

  await scenario('the parts are read with the call and written only by the functions', async () => {
    await newCall(1, '{MetroPolice}');
    await newCall(2, '{MetroFire}');
    await as(U.policeDesk);
    const seen = (await rows('select distinct incident_id from public.incident_departments where incident_id = any ($1::uuid[])', [[inc(1), inc(2)]]))
      .map((r) => r.incident_id);
    assert.deepEqual(seen, [inc(1)], 'the Fire call is behind the desk wall');
    await refused(() => db.query("update public.incident_departments set status = 'Resolved' where incident_id = $1", [inc(1)]), /permission denied/);
    await refused(() => db.query('select public.sync_incident_from_departments($1)', [inc(1)]), /permission denied/);
  });

  const closePart = (uid, n) => asDefiner(uid).then(() => db.query('select * from public.close_department_part($1)', [inc(n)]));
  const closed = (n, silo) => one('select closed_at, closed_by, closed_by_name from public.incident_departments where incident_id = $1 and silo = $2', [inc(n), silo]);

  await scenario('0074: the lead closes their part after the report; dispatch hears who is still on the call', async () => {
    await newCall(1, '{MetroPolice,MetroFire}');
    await route(U.policeDesk, 1, '{MetroPolice}');
    await route(U.fireDesk, 1, '{MetroFire}');
    await step(U.cop, 1, 'En Route');
    await step(U.cop, 1, 'On Scene');
    await step(U.cop2, 1, 'En Route');
    await step(U.fireman, 1, 'En Route');

    await refused(() => closePart(U.cop, 1), /File the report on INC-0073-1 before you close it/);
    await policeReport(1);
    await refused(() => closePart(U.cop2, 1), /Only the lead on INC-0073-1 closes it for Metro Police/, 'backup');
    await refused(() => closePart(U.fireman, 1), /File the report on INC-0073-1/, 'Fire has not filed');
    await refused(() => closePart(U.policeDesk, 1), /Not permitted/, 'dispatch does not close for the crew');
    await refused(() => closePart(U.caseMgr, 1), /Not permitted/);

    await closePart(U.cop, 1);
    const c = await closed(1, 'MetroPolice');
    assert.ok(c.closed_at);
    assert.equal(c.closed_by, U.cop);
    assert.equal(c.closed_by_name, 'Const. Khumalo');
    assert.ok(await one("select 1 from public.incident_updates where incident_id = $1 and message = '[CLOSED ON SCENE] Metro Police closed by Const. Khumalo. Waiting on Fire & Rescue.'", [inc(1)]));
    assert.ok(await one("select 1 from public.sent where kind = 'officer_closed' and title = 'INC-0073-1: Metro Police closed by Const. Khumalo. Waiting on Fire & Rescue'"));
    // The police dispatcher sent the police crew: told directly. The fire
    // dispatcher dispatched last, so is the call's dispatcher: told by the chain.
    assert.ok(await one("select 1 from public.alerts where kind = 'officer_closed' and target_user_id = $1", [U.policeDesk]));
    assert.ok(!(await one("select 1 as x from public.alerts where kind = 'officer_closed' and target_user_id = $1", [U.fireDesk])));
    assert.ok(await one("select 1 from public.audit_logs where action_type = 'DEPARTMENT_CLOSED' and entity_id = $1", [inc(1)]));
    assert.equal((await call(1)).status, 'En Route', 'Fire still works the call');

    // A retry is a no-op.
    await closePart(U.cop, 1);
    assert.equal(Number((await one("select count(*)::int as n from public.incident_updates where incident_id = $1 and message like '[CLOSED ON SCENE]%'", [inc(1)])).n), 1);

    await step(U.fireman, 1, 'On Scene');
    await fireReport(1);
    assert.equal((await call(1)).status, 'Resolved');
    await closePart(U.fireman, 1);
    assert.ok(await one("select 1 from public.incident_updates where incident_id = $1 and message = '[CLOSED ON SCENE] Fire & Rescue closed by FF Naidoo. Every department has closed. Ready for case review.'", [inc(1)]));
    assert.ok(await one("select 1 from public.sent where kind = 'officer_closed' and title = 'INC-0073-1: closed by every department'"));

    // Case review still closes the case; a late close after that changes nothing.
    assert.equal((await call(1)).status, 'Resolved', 'the officers do not close the case');
    await asDefiner(U.caseMgr);
    assert.equal((await one('select (public.close_case($1)).status as s', [inc(1)])).s, 'Closed');
    await closePart(U.cop, 1);
  });

  await scenario('0074: a department still waiting at its desk is waited on; a stood-down one is not', async () => {
    await newCall(1, '{MetroPolice,MetroFire,Medical}');
    await route(U.policeDesk, 1, '{MetroPolice}');
    await standDown(U.emsDesk, 1, 'Medical', 'Caller says nobody is hurt at all');
    await step(U.cop, 1, 'En Route');
    await step(U.cop, 1, 'On Scene');
    await policeReport(1);
    await closePart(U.cop, 1);
    assert.ok(await one("select 1 from public.incident_updates where incident_id = $1 and message = '[CLOSED ON SCENE] Metro Police closed by Const. Khumalo. Waiting on Fire & Rescue.'", [inc(1)]));
  });

  await scenario('0074: the close is written only through the function, never by anon', async () => {
    await newCall(1, '{MetroPolice}');
    await as(U.cop);
    await refused(() => db.query('update public.incident_departments set closed_at = now() where incident_id = $1', [inc(1)]), /permission denied/);
    await db.query('reset role');
    assert.equal((await one("select has_function_privilege('anon', 'public.close_department_part(uuid, text, timestamptz)', 'EXECUTE') as ok")).ok, false);
  });

  const narrative = 'Scene secured, traffic diverted, statements taken from two witnesses.';
  const radioPolice = (uid, n, officer) => asDefiner(uid).then(() => db.query(
    'select * from public.file_incident_report($1, $2, $3::jsonb)',
    [inc(n), 'incident', JSON.stringify({ officer_narrative: narrative, radioed_by: officer })]));
  const deskMark = (uid, n, silo, status) => asDefiner(uid).then(() =>
    db.query('select * from public.set_department_status($1, $2, $3)', [inc(n), silo, status]));
  const deskClose = (uid, n, silo) => asDefiner(uid).then(() =>
    db.query('select * from public.close_department_part_from_desk($1, $2)', [inc(n), silo]));

  await scenario('0075: the desk files a police report as radioed in, in the member\'s name, and closes it', async () => {
    await newCall(1, '{MetroPolice}');
    await route(U.policeDesk, 1, '{MetroPolice}');
    await refused(() => radioPolice(U.policeDesk, 1, U.cop2), /Mark Metro Police on scene first/);
    await deskMark(U.policeDesk, 1, 'MetroPolice', 'On Scene');
    await radioPolice(U.policeDesk, 1, U.cop2);

    const p = await one('select * from public.incident_departments where incident_id = $1 and silo = $2', [inc(1), 'MetroPolice']);
    assert.equal(p.status, 'Resolved');
    assert.equal(p.lead_id, U.cop2, 'the member who radioed it in leads');
    assert.equal(p.radio_filed_by, U.policeDesk);
    assert.equal(p.radio_filed_by_name, 'Nomsa Metro');
    assert.equal(p.radioed_by, U.cop2);
    assert.equal(p.radioed_by_name, 'Const. Dlamini');
    const r = await one('select officer_name, filed_by from public.metro_reports where incident_id = $1', [inc(1)]);
    assert.equal(r.officer_name, 'Const. Dlamini', 'the report is in the member\'s name');
    assert.equal(r.filed_by, U.policeDesk, 'and says who typed it');
    assert.ok(await one("select 1 from public.incident_updates where incident_id = $1 and message = '[RADIO] Metro Police report filed from the desk by Nomsa Metro, as radioed in by Const. Dlamini.'", [inc(1)]));
    assert.ok(await one("select 1 from public.audit_logs where action_type = 'REPORT_FILED_BY_RADIO' and user_id = $1", [U.policeDesk]));
    assert.equal((await call(1)).status, 'Resolved');
    assert.equal((await call(1)).responding_officer, 'Const. Dlamini');

    await refused(() => deskClose(U.fireDesk, 1, 'MetroPolice'), /Only Metro Police dispatch or command/);
    await deskClose(U.policeDesk, 1, 'MetroPolice');
    assert.ok((await one('select closed_at from public.incident_departments where incident_id = $1 and silo = $2', [inc(1), 'MetroPolice'])).closed_at);
    assert.ok(await one("select 1 from public.incident_updates where incident_id = $1 and message = '[CLOSED ON SCENE] Metro Police closed from the desk by Nomsa Metro. Every department has closed. Ready for case review.'", [inc(1)]));
    await deskClose(U.policeDesk, 1, 'MetroPolice');
    assert.equal(Number((await one("select count(*)::int as n from public.incident_updates where incident_id = $1 and message like '[CLOSED ON SCENE]%'", [inc(1)])).n), 1, 'a repeat changes nothing');
  });

  await scenario('0075: who may file by radio, and for whom', async () => {
    await newCall(1, '{MetroPolice,MetroFire}');
    await route(U.central, 1, '{MetroPolice,MetroFire}');
    await deskMark(U.central, 1, 'MetroPolice', 'On Scene');
    // Another department's desk, a field officer, a member of another department.
    await refused(() => radioPolice(U.fireDesk, 1, U.cop2), /Only Metro Police dispatch or command/);
    await refused(() => radioPolice(U.cop, 1, U.cop2), /Only Metro Police dispatch or command/);
    await refused(() => radioPolice(U.policeDesk, 1, U.fireman), /Choose a member of Metro Police/);
    await refused(() => asDefiner(U.policeDesk).then(() => db.query('select * from public.file_incident_report($1, $2, $3::jsonb)',
      [inc(1), 'incident', JSON.stringify({ officer_narrative: narrative, radioed_by: 'not-a-uuid' })])), /Choose who radioed it in/);
    // Someone already leads Police from the phone: the desk files only as radioed in by them.
    await step(U.cop, 1, 'En Route');
    await step(U.cop, 1, 'On Scene');
    await refused(() => radioPolice(U.policeDesk, 1, U.cop2), /Const. Khumalo leads INC-0073-1 for Metro Police/);
    // The control room files for the member who leads.
    await radioPolice(U.central, 1, U.cop);
    const p = await parts(1);
    assert.equal(p.MetroPolice.status, 'Resolved');
    assert.equal(p.MetroFire.status, 'Dispatched', 'Fire is untouched');
    // Without radioed_by a desk user is not the lead: the phone's rule stands.
    await newCall(2, '{MetroPolice}');
    await route(U.policeDesk, 2, '{MetroPolice}');
    await deskMark(U.policeDesk, 2, 'MetroPolice', 'On Scene');
    await refused(() => asDefiner(U.policeDesk).then(() => db.query('select * from public.file_incident_report($1, $2, $3::jsonb)',
      [inc(2), 'incident', JSON.stringify({ officer_narrative: narrative })])), /Only the officer who accepted/);
  });

  await scenario('0075: the control room files a patient report by radio, without signatures', async () => {
    await newCall(1, '{Medical}');
    await route(U.central, 1, '{Medical}');
    await deskMark(U.central, 1, 'Medical', 'On Scene');
    await asDefiner(U.central);
    await db.query('select * from public.file_pcr($1, $2::jsonb)', [inc(1), JSON.stringify({
      patient_name: 'Thandi Zulu', chief_complaint: 'Burns to the arm', level_of_care: 'ALS', patient_response: 'Improved',
      transport_mode: 'Ambulance (Ground)', destination_hospital: 'Addington Hospital', arrival_time: '14:30',
      handover_doctor_name: 'Dr Dale Naidoo', handover_patient_status: 'Stable, GCS 15', requires_cleaning: 'false',
      radioed_by: U.medic,
    })]);
    const r = await one('select paramedic_names, responder_signature_image_base64, filed_by from public.paramedic_reports where incident_id = $1', [inc(1)]);
    assert.equal(r.paramedic_names, 'Priya Pillay');
    assert.equal(r.responder_signature_image_base64, null);
    assert.equal(r.filed_by, U.central);
    assert.equal((await parts(1)).Medical.status, 'Resolved');
    // The phone still needs the signature.
    await newCall(2, '{Medical}');
    await route(U.central, 2, '{Medical}');
    await step(U.medic, 2, 'En Route');
    await step(U.medic, 2, 'On Scene');
    await refused(() => asDefiner(U.medic).then(() => db.query('select * from public.file_pcr($1, $2::jsonb)', [inc(2), JSON.stringify({
      chief_complaint: 'Burns', level_of_care: 'ALS', patient_response: 'Improved', requires_cleaning: 'false',
    })])), /The lead paramedic must sign/);
  });

  await scenario('0075: Fire and Disaster by radio; the helpers are not callable directly', async () => {
    await newCall(1, '{MetroFire,EthekwiniDisaster}');
    await route(U.central, 1, '{MetroFire,EthekwiniDisaster}');
    await deskMark(U.central, 1, 'MetroFire', 'On Scene');
    await deskMark(U.central, 1, 'EthekwiniDisaster', 'On Scene');
    await asDefiner(U.fireDesk);
    await db.query('select * from public.file_fire_report($1, $2::jsonb)', [inc(1), JSON.stringify({
      type_of_incident: 'Vehicle fire', narrative_summary: 'Truck cab fire extinguished, driver extricated and handed to EMS.',
      fire_cause: 'Electrical fault', no_photo_reason: 'Radio only', radioed_by: U.fireman2,
    })]);
    assert.equal((await one('select reporting_officer_name from public.firefighter_reports where incident_id = $1', [inc(1)])).reporting_officer_name, 'FF Mokoena');
    await asDefiner(U.central);
    await db.query('select * from public.file_post_mortem($1, $2::jsonb)', [inc(1), JSON.stringify({
      start_time: '2026-10-12 08:00', end_time: '2026-10-12 09:00', injuries: '1', fatalities: '0', displaced_people: '4',
      root_cause: 'Electrical fault in the truck', lessons_learned: 'Faster road closure', reporting_officer: 'DM Officer',
      radioed_by: U.disaster,
    })]);
    assert.equal((await call(1)).status, 'Resolved');
    await as(U.policeDesk);
    await refused(() => db.query('select public.radio_filer($1, $2, $3::jsonb, null)', [inc(1), 'MetroPolice', '{}']), /permission denied/);
    await refused(() => db.query('select public.note_radio_filing($1, $2, $3)', [inc(1), 'MetroPolice', U.cop]), /permission denied/);
    await db.query('reset role');
  });

  console.log(`${checks} scenarios passed; 0073, 0074 and 0075 applied twice.`);
} finally {
  await db.close();
}
