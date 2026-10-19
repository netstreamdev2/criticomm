/** Run the duty office migration (0085) after the schedules migration (0072)
 * against in-memory Postgres (PGlite) and try every rule: access per person
 * and per screen (and that rostering follows it), the grants carried over,
 * stations and sections, call signs, the member's record and who reads the
 * private part, endorsements, absence codes, leave captured by the office,
 * duty allocation over a date range, duty maintenance, and nothing for anon.
 *
 * CASE_PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node scripts/test-duty-office.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.CASE_PGLITE_MODULE || '@electric-sql/pglite');

const schedules = readFileSync(new URL('../supabase/migrations/0072_schedules.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/0085_duty_office.sql', import.meta.url), 'utf8');
const db = new PGlite();
let checks = 0;
const one = async (q, args) => (await db.query(q, args)).rows[0];
const rows = async (q, args) => (await db.query(q, args)).rows;

const T = '20000000-0000-4000-8000-000000000001';
const T2 = '20000000-0000-4000-8000-000000000002';
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const U = {
  cop1: id(1), cop2: id(2), cop3: id(3), sup: id(4), polAdmin: id(5), ff1: id(6), fireSup: id(7),
  controller: id(8), hr: id(9), stranger: id(10), noRoster: id(11),
};
const PEOPLE = [
  [U.cop1, 'Police', 'MetroPolice', 'Const. Thandi Dlamini', 'A'],
  [U.cop2, 'Police', 'MetroPolice', 'Const. Sipho Ngcobo', 'A'],
  [U.cop3, 'Police', 'MetroPolice', 'Const. Lerato Khumalo', 'B'],
  [U.sup, 'Supervisor', 'MetroPolice', 'Sgt. Pillay', 'A'],
  [U.polAdmin, 'Admin', 'MetroPolice', 'Police Admin', null],
  [U.ff1, 'Firefighter', 'MetroFire', 'FF Mthembu', 'Red'],
  [U.fireSup, 'Supervisor', 'MetroFire', 'Stn Officer Zulu', 'Red'],
  [U.controller, 'SystemController', 'Ethekwini', 'Dianne Controller', null],
  [U.hr, 'SystemAdmin', 'Ethekwini', 'HR Admin', null],
  [U.stranger, 'Supervisor', 'MetroPolice', 'Other Org Sgt', 'A', T2],
  [U.noRoster, 'Police', 'MetroPolice', 'Const. Office Only', 'A'],
];

async function as(uid, tenant = T) {
  await db.query('reset role');
  await db.query("select set_config('test.user', $1, true), set_config('test.tenant', $2, true)", [uid ?? '', tenant]);
  await db.query('set local role authenticated');
}
async function system() {
  await db.query('reset role');
  await db.query("select set_config('test.user', '', true), set_config('test.tenant', '', true)");
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
  catch (e) { console.error(`FAIL ${label}`); throw e; }
  finally { await db.query('rollback to savepoint scenario'); await db.query('reset role'); }
}

const saToday = () => new Date(Date.now() + 2 * 3_600_000).toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const levels = async (uid) => Object.fromEntries((await rows('select module, level from public.my_modules()')).map((r) => [r.module, r.level]));
const personnelOf = async (uid) => (await one('select id from public.personnel where user_id = $1', [uid])).id;

try {
  await db.exec(`
    create role authenticated nologin; create role anon nologin; create role service_role nologin;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user', true), '')::uuid $$;
    create type public.silo as enum ('Ethekwini', 'MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster');
    create type public.user_role as enum ('SystemAdmin', 'SuperAdmin', 'Admin', 'Supervisor', 'Dispatcher', 'ControlRoom',
      'IncidentLogger', 'Viewer', 'System', 'Captain', 'Police', 'FireChief', 'Firefighter', 'Paramedic', 'Doctor',
      'Disaster', 'CaseManager', 'Staff', 'SystemController');
    create table public.tenants (id uuid primary key, slug text, name text);
    insert into public.tenants values ('${T}', 'ethekwini', 'eThekwini'), ('${T2}', 'other', 'Other');
    create function public.current_tenant() returns uuid language sql stable as $$
      select coalesce(nullif(current_setting('test.tenant', true), '')::uuid, '${T}'::uuid) $$;
    create table public.profiles (
      id uuid primary key, tenant_id uuid not null, role public.user_role, silo public.silo,
      full_name text, badge_number text, station text, deactivated_at timestamptz);
    create function public.current_silo() returns public.silo language sql stable security definer as $$
      select coalesce((select silo from public.profiles where id = auth.uid()), 'Ethekwini') $$;
    create function public.is_global() returns boolean language sql stable security definer as $$
      select coalesce((select role in ('SystemAdmin','SuperAdmin','Dispatcher','ControlRoom','IncidentLogger','Viewer','System','SystemController')
        from public.profiles where id = auth.uid() and deactivated_at is null), false) $$;
    create function public.department_label(p_silo public.silo) returns text language sql immutable as $$
      select case p_silo::text when 'Ethekwini' then 'the Control Room' when 'MetroPolice' then 'Metro Police'
        when 'MetroFire' then 'Fire & Rescue' when 'Medical' then 'EMS' else 'Disaster Management' end $$;
    create table public.personnel (
      id uuid primary key default gen_random_uuid(), tenant_id uuid not null default public.current_tenant(), user_id uuid,
      silo public.silo not null, first_name text not null default '', last_name text not null default '',
      badge_number text not null default '', rank text not null default '', station text, platoon text,
      force_number text, service_number text, work_email text, work_cellphone text,
      is_on_duty boolean not null default false, duty_started_at timestamptz, left_at timestamptz,
      updated_at timestamptz not null default now());
    create table public.shifts (id uuid primary key default gen_random_uuid(), tenant_id uuid default public.current_tenant(),
      silo public.silo not null, shift_name text, start_time timestamptz, end_time timestamptz);
    create table public.sections (id uuid primary key default gen_random_uuid(), tenant_id uuid not null default public.current_tenant(),
      silo public.silo not null default 'MetroPolice', code text not null, name text not null, region text,
      active boolean not null default true, created_at timestamptz not null default now(), unique (tenant_id, silo, code));
    create table public.duty_posts (id uuid primary key default gen_random_uuid(), tenant_id uuid not null default public.current_tenant(),
      silo public.silo not null, name text not null, station text, sector text, vehicle text, call_sign text,
      activity_type text, min_staff int not null default 1, active boolean not null default true);
    create table public.leave_entries (
      id uuid primary key default gen_random_uuid(), tenant_id uuid not null default public.current_tenant(),
      silo public.silo not null, user_id uuid, leave_seq text, eff_from date not null, eff_to date not null, absence text,
      status text not null, reason text, approved_by text, approved_at timestamptz, created_at timestamptz not null default now());
    create table public.rosters (
      id uuid primary key default gen_random_uuid(), tenant_id uuid not null default public.current_tenant(),
      silo public.silo not null, user_id uuid, user_name text not null, badge_number text,
      shift_id uuid references public.shifts(id) on delete cascade, station text not null, activity_type text not null,
      description text, created_by_supervisor_id text, created_by_supervisor_name text, created_at timestamptz not null default now(),
      call_sign text, shift_group_code text, special_instructions text, vehicle text, sector text,
      status text not null default 'Present', duty_date date, start_at timestamptz, end_at timestamptz, post text,
      published boolean not null default true, published_at timestamptz, acknowledged_at timestamptz,
      post_id uuid references public.duty_posts(id) on delete set null);
    create table public.endorsements (id uuid primary key default gen_random_uuid(), tenant_id uuid not null default public.current_tenant(),
      silo public.silo not null, user_id uuid, employee_name text, badge_number text, type text not null, details text,
      start_date date not null, end_date date, is_active boolean not null default true, created_by text,
      created_at timestamptz not null default now());
    create table public.alerts (id uuid primary key default gen_random_uuid(), tenant_id uuid default public.current_tenant(),
      silo public.silo not null, target_user_id uuid, kind text not null default 'info', severity text, title text not null,
      body text, incident_id uuid, link text, presentation text, requires_ack boolean, created_by uuid, created_by_name text,
      created_at timestamptz not null default clock_timestamp(), expires_at timestamptz);
    create table public.push_tokens (id uuid primary key default gen_random_uuid(), user_id uuid not null, token text not null);
    create table public.reporting_lines (id uuid primary key default gen_random_uuid(), silo public.silo not null,
      member_kind text not null, member_id uuid not null, manager_kind text, manager_id uuid);
    create table public.attendance_events (id uuid primary key default gen_random_uuid(), tenant_id uuid not null default public.current_tenant(),
      silo public.silo not null default public.current_silo(), user_id uuid not null default auth.uid(), user_name text,
      kind text not null check (kind in ('clock_in','clock_out')), at timestamptz not null default now(),
      source text not null default 'console', note text);
    create table public.command_records (id uuid primary key default gen_random_uuid(), tenant_id uuid not null default public.current_tenant(),
      silo public.silo not null default 'Ethekwini', module text not null, code text, name text, detail1 text, detail2 text,
      detail3 text, status text not null default 'Active', created_by text, created_at timestamptz not null default now());
    create table public.audit_logs (id uuid primary key default gen_random_uuid(), tenant_id uuid default public.current_tenant(),
      silo public.silo not null, user_id uuid, user_name text, department text, action_type text not null,
      entity_type text, entity_id text, details text, timestamp timestamptz not null default now());
    create table public.automation_rules (key text primary key, name text not null, description text not null,
      enabled boolean not null default true, interval_minutes int not null default 5, config jsonb not null default '{}',
      last_run_at timestamptz, last_status text, last_detail text, updated_at timestamptz not null default now());
    create table public.automation_runs (id bigserial primary key, rule_key text, triggered_by uuid, finished_at timestamptz,
      status text, affected int, detail text);
    create table public.automation_events (id bigserial primary key, rule_key text not null, entity_id text not null,
      bucket text not null, created_at timestamptz not null default now());
    create unique index on public.automation_events (rule_key, entity_id, bucket);
    create function public.automation_claim(p_rule text, p_entity text, p_bucket text) returns boolean
      language plpgsql security definer as $$
      begin insert into public.automation_events (rule_key, entity_id, bucket) values (p_rule, p_entity, p_bucket); return true;
      exception when unique_violation then return false; end $$;
    create function public.automation_cfg_int(p_config jsonb, p_key text, p_default int) returns int language sql immutable as $$
      select coalesce(nullif(p_config ->> p_key, '')::int, p_default) $$;

    -- The founding tenant's data as 0033 and 0007 left it.
    insert into public.sections (tenant_id, silo, code, name, region) values
      ('${T}', 'MetroPolice', 'NR', 'North Region', 'North'), ('${T}', 'MetroPolice', 'W', 'Inner West', 'West'),
      ('${T}', 'MetroPolice', 'DR', 'Durban Central', 'Central'), ('${T}', 'MetroPolice', 'B', 'Beachfront', 'Central'),
      ('${T}', 'MetroPolice', 'CH', 'Chatsworth', 'South'), ('${T}', 'MetroPolice', 'OR', 'Operational Response Services', 'Metro-wide');
    insert into public.command_records (tenant_id, module, name, detail3) values
      ('${T}', 'LeaveType', 'Annual', '22'), ('${T}', 'LeaveType', 'Sick', '30'),
      ('${T}', 'LeaveType', 'Family Responsibility', '3'), ('${T}', 'LeaveType', 'Study', '5');

    alter table public.rosters enable row level security;
    alter table public.leave_entries enable row level security;
    alter table public.endorsements enable row level security;
    alter table public.sections enable row level security;
    create policy sections_read on public.sections for select to authenticated using (true);
    create policy sections_write on public.sections for all to authenticated using (true) with check (true);
    create policy tenant_isolation on public.sections as restrictive for all to authenticated
      using (tenant_id = public.current_tenant()) with check (tenant_id = public.current_tenant());
    alter table public.personnel enable row level security;
    create policy personnel_read on public.personnel for select to authenticated using (true);
    alter table public.attendance_events enable row level security;
    create policy attendance_insert_self on public.attendance_events for insert to authenticated with check (user_id = auth.uid());
    alter table public.shifts enable row level security;
    create policy shifts_read on public.shifts for select using (true);
    grant usage on schema public, auth to authenticated, anon;
    grant all on all tables in schema public to authenticated;
    grant all on all sequences in schema public to authenticated;
    alter default privileges in schema public grant all on tables to authenticated, anon;
    alter default privileges in schema public grant all on sequences to authenticated;
  `);
  for (const [uid, role, silo, name, team, tenant = T] of PEOPLE) {
    await db.query('insert into public.profiles values ($1, $2, $3, $4, $5, $6, $7, null)', [uid, tenant, role, silo, name, `B${uid.slice(-3)}`, 'Station 4']);
    const [first, ...rest] = name.split(' ');
    await db.query('insert into public.personnel (tenant_id, user_id, silo, first_name, last_name, badge_number, station, platoon, rank) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [tenant, uid, silo, first, rest.join(' '), `B${uid.slice(-3)}`, 'B', team, role === 'Police' ? 'AO' : 'ST']);
  }

  await db.exec('begin');
  await db.exec(schedules);
  await db.exec(migration);
  await db.exec(migration); // safe to re-run
  const NOW = new Date((await one('select now() as n')).n).getTime();
  const hoursAgo = (h) => new Date(NOW - h * 3_600_000).toISOString();
  const today = saToday();
  const day1 = addDays(today, 3);
  const day3 = addDays(today, 5);

  await scenario('grants carried over once: rostering people keep what they do today; members get nothing', async () => {
    await as(U.sup);
    assert.deepEqual(await levels(), { DUTA: 'Edit', DUTM: 'Edit', DUTR: 'View', ENTM: 'Edit', LEAM: 'Edit', CSNM: 'View', SECM: 'View', ABSM: 'View' });
    await as(U.polAdmin);
    const a = await levels();
    assert.equal(a.CSNM, 'Edit'); assert.equal(a.SECM, 'Edit'); assert.equal(a.STFM, 'Edit');
    await as(U.cop1);
    assert.deepEqual(await levels(), {});
    await as(U.controller);
    const c = await levels();
    assert.equal(Object.keys(c).length, 9); assert.ok(Object.values(c).every((l) => l === 'Edit'));
    await system();
    // A third run after the controller takes access away does not give it back.
    await as(U.controller);
    await db.query("select public.set_module_access($1, 'DUTA', null)", [U.sup]);
    await system();
    await db.exec(migration);
    await as(U.sup);
    assert.equal((await levels()).DUTA, undefined);
  });

  await scenario('rostering follows the Duty Allocation grant, not rank', async () => {
    await as(U.sup);
    assert.equal((await one("select public.can_manage_roster('MetroPolice') as ok")).ok, true);
    assert.equal((await one("select public.can_manage_roster('MetroFire') as ok")).ok, false);
    await as(U.controller);
    await db.query("select public.set_module_access($1, 'DUTA', 'View')", [U.sup]);
    await db.query("select public.set_module_access($1, 'DUTA', 'Edit')", [U.cop3]);
    await as(U.sup);
    assert.equal((await one("select public.can_manage_roster('MetroPolice') as ok")).ok, false);
    await as(U.cop3);
    assert.equal((await one("select public.can_manage_roster('MetroPolice') as ok")).ok, true, 'a constable roster clerk, as in Oracle');
    assert.equal((await one("select public.can_manage_roster('MetroFire') as ok")).ok, false, 'own department only');
    await system();
    const audit = await rows("select details from public.audit_logs where action_type = 'AccessChanged'");
    assert.ok(audit.some((a) => a.details === 'Const. Lerato Khumalo: Duty Allocation Edit'), 'audited');
  });

  await scenario('only the controller tier gives access; screens and levels are checked', async () => {
    await as(U.sup);
    await refused(() => db.query("select public.set_module_access($1, 'DUTA', 'Edit')", [U.cop1]), /Only the systems controller/);
    await as(U.polAdmin);
    await refused(() => db.query("select public.set_module_access($1, 'STFM', 'Edit')", [U.cop1]), /Only the systems controller/);
    await as(U.hr);
    await refused(() => db.query("select public.set_module_access($1, 'XXXX', 'Edit')", [U.cop1]), /Unknown screen/);
    await refused(() => db.query("select public.set_module_access($1, 'DUTA', 'Admin')", [U.cop1]), /View or Edit/);
    await refused(() => db.query("select public.set_module_access($1, 'DUTA', 'Edit')", [U.stranger]), /no account here/);
    await as(U.cop1);
    await refused(() => db.query("insert into public.module_access (user_id, module, level) values ($1, 'DUTA', 'Edit')", [U.cop1]), /permission denied|row-level/);
  });

  await scenario('stations copied from the old sections; those sections retired; sections saved through the function', async () => {
    await as(U.cop1);
    const st = await rows("select code from public.stations where silo = 'MetroPolice' order by code");
    assert.deepEqual(st.map((s) => s.code), ['B', 'CH', 'DR', 'NR', 'OR', 'W']);
    assert.equal((await one("select count(*)::int as n from public.sections where active")).n, 0);
    await as(U.sup);
    await refused(() => db.query("select public.save_section(null, 'MetroPolice', 'HE', 'Hawkers Enforcement', null, 'DR', 'Central', 'B', '011')"), /do not maintain sections/);
    await as(U.polAdmin);
    await refused(() => db.query("select public.save_section(null, 'MetroPolice', 'HE', 'Hawkers Enforcement', null, 'ZZ', 'Central', 'B', '011')"), /not on the list/);
    await refused(() => db.query("select public.save_section(null, 'MetroFire', 'HE', 'Hawkers', null, null, null, null, null)"), /do not maintain sections for Fire/);
    const sid = (await one("select public.save_section(null, 'MetroPolice', 'he', 'HAWKERS ENFORCEMENT', 'HAWKERS ENFOR', 'dr', 'Central', 'B', '011') as id")).id;
    const s = await one('select code, station_code, region, division, overtime_code from public.sections where id = $1', [sid]);
    assert.deepEqual(s, { code: 'HE', station_code: 'DR', region: 'Central', division: 'B', overtime_code: '011' });
    await refused(() => db.query("select public.save_section(null, 'MetroPolice', 'HE', 'Again', null, null, null, null, null)"), /already exists/);
    await refused(() => db.query("insert into public.sections (silo, code, name) values ('MetroPolice', 'XX', 'Direct')"), /row-level|permission/);
  });

  // Shared set-up for the duty scenarios.
  async function setUpBeachfront() {
    await as(U.polAdmin);
    const section = (await one("select public.save_section(null, 'MetroPolice', 'V', 'BYLAWS UNIT A', null, 'B', 'Central', null, null) as id")).id;
    const sgt = (await one("select public.save_call_sign(null, 'MetroPolice', 's.hawk  b1', 'b', $1, '07:00', '16:00', '11:00', 'ST', 'Captain in Charge of Hawkers Beachfront') as id", [section])).id;
    const b1 = (await one("select public.save_call_sign(null, 'MetroPolice', 'HAWK B1', 'B', $1, '07:00', '16:00', '11:00', 'AO', 'Hawkers Beachfront — AO') as id", [section])).id;
    const night = (await one("select public.save_call_sign(null, 'MetroPolice', 'HAWK N1', 'B', $1, '23:00', '07:00', null, 'AO', 'Night') as id", [section])).id;
    return { section, sgt, b1, night };
  }

  await scenario('call signs: start, stop, break and rank; unique while in use; Edit only', async () => {
    const { sgt, night } = await setUpBeachfront();
    const c = await one('select call_sign, name, station, rank, break_time::text as brk from public.duty_posts where id = $1', [sgt]);
    assert.deepEqual(c, { call_sign: 'S.HAWK B1', name: 'S.HAWK B1', station: 'B', rank: 'ST', brk: '11:00:00' });
    assert.ok(night);
    await refused(() => db.query("select public.save_call_sign(null, 'MetroPolice', 'hawk b1', 'B', null, '07:00', '16:00', null, null, null)"), /already in use/);
    await refused(() => db.query("select public.save_call_sign(null, 'MetroPolice', 'HAWK B9', 'B', null, null, '16:00', null, null, null)"), /start and stop/);
    await as(U.sup);
    await refused(() => db.query("select public.save_call_sign(null, 'MetroPolice', 'HAWK B9', 'B', null, '07:00', '16:00', null, null, null)"), /do not maintain call signs/);
  });

  await scenario('staff record: Oracle fields saved; private part read only by Staff Maintenance and the member', async () => {
    const cop1 = await personnelOf(U.cop1);
    await as(U.polAdmin);
    await db.query(`select public.save_staff_record($1, 'MetroPolice', $2::jsonb, $3::jsonb)`, [cop1,
      JSON.stringify({ force_number: '594', service_number: 'D152030', persal_number: '41002', weekend_group: 'a', duty_allocation: true, region: 'CENTRAL', join_date: '2015-03-01' }),
      JSON.stringify({ id_number: '9001015009087', address_1: '42 Sea View Rd', nok_name: 'Yusuf Fohan', nok_phone: '0799012292' })]);
    const p = await one('select force_number, persal_number, weekend_group, region, join_date::text as jd from public.personnel where id = $1', [cop1]);
    assert.deepEqual(p, { force_number: '594', persal_number: '41002', weekend_group: 'A', region: 'CENTRAL', jd: '2015-03-01' });
    await refused(() => db.query(`select public.save_staff_record($1, 'MetroPolice', '{"weekend_group":"C"}'::jsonb)`, [cop1]), /A or B/);
    const added = (await one(`select public.save_staff_record(null, 'MetroPolice', '{"first_name":"Yusuf","last_name":"Fohan","badge_number":"3471","rank":"PC"}'::jsonb) as id`)).id;
    assert.ok(added);
    await refused(() => db.query(`select public.save_staff_record(null, 'MetroPolice', '{"first_name":"No","last_name":"Number"}'::jsonb)`), /staff number/);
    await refused(() => db.query(`select public.save_staff_record(null, 'MetroFire', '{"first_name":"A","last_name":"B","badge_number":"9"}'::jsonb)`), /do not maintain staff for Fire/);

    await as(U.cop1);
    assert.equal((await one('select id_number from public.staff_private where personnel_id = $1', [cop1])).id_number, '9001015009087', 'the member reads their own');
    await as(U.cop2);
    assert.equal((await rows('select 1 from public.staff_private where personnel_id = $1', [cop1])).length, 0, 'a colleague does not');
    await as(U.sup);
    assert.equal((await rows('select 1 from public.staff_private where personnel_id = $1', [cop1])).length, 0, 'a supervisor without Staff Maintenance does not');
    await refused(() => db.query(`select public.save_staff_record($1, 'MetroPolice', '{"rank":"OC"}'::jsonb)`, [cop1]), /do not maintain staff/);
    await as(U.fireSup);
    await refused(() => db.query(`select public.save_staff_record($1, 'MetroPolice', '{"rank":"OC"}'::jsonb)`, [cop1]), /do not maintain staff/);

    await as(U.polAdmin);
    const leo = (await one("select public.add_leo_record($1, '515', '2008-12-19', null, 'CENTRAL', 'CENTRAL') as id", [cop1])).id;
    await refused(() => db.query("select public.add_leo_record($1, '515', '2010-01-01', '2009-01-01', null, null)", [cop1]), /before eff from/);
    await as(U.cop2);
    assert.equal((await rows('select 1 from public.leo_records where id = $1', [leo])).length, 0);
    await as(U.polAdmin);
    await db.query('select public.remove_leo_record($1)', [leo]);
    assert.equal((await rows('select 1 from public.leo_records where id = $1', [leo])).length, 0);
  });

  await scenario('endorsements: numbered, issued by the office, court dates block allocation', async () => {
    const { section, b1 } = await setUpBeachfront();
    await as(U.sup);
    const eid = (await one("select public.issue_endorsement($1, 'Court Attendance', '325', 'ATTEND DURBAN COURT 21', $2::date, null) as id", [U.cop1, day1])).id;
    const e = await one('select seq, code, end_date::text as ed, issued_by_name from public.endorsements where id = $1', [eid]);
    assert.ok(Number(e.seq) > 100000); assert.equal(e.code, '325'); assert.equal(e.ed, day1, 'court is one day'); assert.equal(e.issued_by_name, 'Sgt. Pillay');
    await refused(() => db.query("select public.issue_endorsement($1, 'Haircut', null, 'xx yy', $2::date, null)", [U.cop1, day1]), /type/);
    await as(U.cop2);
    await refused(() => db.query("select public.issue_endorsement($1, 'Special Event', null, 'Comrades', $2::date, null)", [U.cop1, day1]), /do not issue endorsements/);
    await as(U.sup);
    const res = (await one('select public.allocate_duty($1, $2::date, $3::date, $4::jsonb) as r', [section, day1, day3,
      JSON.stringify([{ post_id: b1, user_id: U.cop1 }])])).r;
    assert.equal(res.created, 2);
    assert.equal(res.skipped.length, 1);
    assert.match(res.skipped[0].reason, /court/i);
    await db.query('select public.withdraw_endorsement($1)', [eid]);
    assert.equal((await one('select is_active from public.endorsements where id = $1', [eid])).is_active, false);
  });

  await scenario('duty allocation: section, date range, call signs and staff; issued; told once; re-run adds nothing', async () => {
    const { section, sgt, b1, night } = await setUpBeachfront();
    await as(U.sup);
    const pairs = [{ post_id: sgt, user_id: U.sup }, { post_id: b1, user_id: U.cop1 }, { post_id: night, user_id: U.cop2 }];
    const r1 = (await one('select public.allocate_duty($1, $2::date, $3::date, $4::jsonb) as r', [section, day1, day3, JSON.stringify(pairs)])).r;
    assert.equal(r1.created, 9); assert.equal(r1.skipped.length, 0);
    const lines = await rows("select call_sign, sector, station, activity_type, published, to_char(start_at at time zone 'Africa/Johannesburg', 'HH24:MI') as s, to_char(end_at at time zone 'Africa/Johannesburg', 'HH24:MI') as e, (end_at - start_at) as len from public.rosters where user_id = $1 order by start_at", [U.cop2]);
    assert.equal(lines.length, 3);
    assert.deepEqual([lines[0].call_sign, lines[0].sector, lines[0].station, lines[0].activity_type, lines[0].published, lines[0].s, lines[0].e],
      ['HAWK N1', 'V', 'B', 'BYLAWS UNIT A', true, '23:00', '07:00'], 'night call sign runs into the next morning');
    await system();
    const told = await rows("select title from public.alerts where target_user_id = $1 and kind = 'shift_published'", [U.cop1]);
    assert.equal(told.length, 1); assert.match(told[0].title, /3 shifts/);
    assert.equal((await rows("select 1 from public.alerts where target_user_id = $1 and kind = 'shift_changed'", [U.cop1])).length, 0, 'no alert per shift');
    assert.deepEqual(await rows("select kind, title from public.alerts where target_user_id = $1", [U.sup]), [], "not told about your own");
    await as(U.sup);
    const r2 = (await one('select public.allocate_duty($1, $2::date, $3::date, $4::jsonb) as r', [section, day1, day3, JSON.stringify(pairs)])).r;
    assert.equal(r2.created, 0);
    // A member on two call signs at the same hours is a double booking.
    const r3 = (await one('select public.allocate_duty($1, $2::date, $2::date, $3::jsonb) as r', [section, day1, JSON.stringify([{ post_id: sgt, user_id: U.cop1 }])])).r;
    assert.equal(r3.created, 0); assert.match(r3.skipped[0].reason, /already|shift/i);
    // Custom times from the wizard.
    const r4 = (await one("select public.allocate_duty($1, $2::date, $2::date, $3::jsonb, '06:00', '18:00') as r", [section, addDays(today, 9), JSON.stringify([{ post_id: b1, user_id: U.cop3 }])])).r;
    assert.equal(r4.created, 1);
  });

  await scenario('duty allocation refuses: no access, another department, staff not for allocation, more than two months', async () => {
    const { section, b1 } = await setUpBeachfront();
    await as(U.cop1);
    await refused(() => db.query('select public.allocate_duty($1, $2::date, $2::date, $3::jsonb)', [section, day1, JSON.stringify([{ post_id: b1, user_id: U.cop2 }])]), /do not allocate duty/);
    await as(U.fireSup);
    await refused(() => db.query('select public.allocate_duty($1, $2::date, $2::date, $3::jsonb)', [section, day1, JSON.stringify([{ post_id: b1, user_id: U.cop2 }])]), /do not allocate duty for Metro Police/);
    await as(U.sup);
    await refused(() => db.query('select public.allocate_duty($1, $2::date, $2::date, $3::jsonb)', [section, day1, JSON.stringify([{ post_id: b1, user_id: U.ff1 }])]), /not in Metro Police/);
    await refused(() => db.query('select public.allocate_duty($1, $2::date, $3::date, $4::jsonb)', [section, day1, addDays(day1, 70), JSON.stringify([{ post_id: b1, user_id: U.cop2 }])]), /two months/);
    await as(U.polAdmin);
    await db.query(`select public.save_staff_record($1, 'MetroPolice', '{"duty_allocation":false}'::jsonb)`, [await personnelOf(U.noRoster)]);
    await as(U.sup);
    const r = (await one('select public.allocate_duty($1, $2::date, $2::date, $3::jsonb) as r', [section, day1, JSON.stringify([{ post_id: b1, user_id: U.noRoster }])])).r;
    assert.equal(r.created, 0); assert.match(r.skipped[0].reason, /Not for duty allocation/);
  });

  await scenario('duty maintenance: change call sign or member of a future duty; a started duty keeps its member', async () => {
    const { section, sgt, b1 } = await setUpBeachfront();
    await as(U.sup);
    await db.query('select public.allocate_duty($1, $2::date, $2::date, $3::jsonb)', [section, day1, JSON.stringify([{ post_id: b1, user_id: U.cop1 }])]);
    const line = (await one('select id from public.rosters where user_id = $1', [U.cop1])).id;
    await db.query('select public.change_duty($1, $2, $3, null, null)', [line, sgt, U.cop3]);
    const l = await one('select call_sign, user_id, user_name from public.rosters where id = $1', [line]);
    assert.deepEqual(l, { call_sign: 'S.HAWK B1', user_id: U.cop3, user_name: 'Const. Lerato Khumalo' });
    await system();
    const started = (await one(`insert into public.rosters (tenant_id, silo, user_id, user_name, station, activity_type, start_at, end_at, published, post_id, call_sign)
      values ($1, 'MetroPolice', $2, '', 'B', 'BYLAWS UNIT A', $3, $4, true, $5, 'HAWK B1') returning id`, [T, U.cop2, hoursAgo(2), hoursAgo(-6), b1])).id;
    await as(U.sup);
    await refused(() => db.query('select public.change_duty($1, null, $2, null, null)', [started, U.cop1]), /has started/);
    await db.query('select public.change_duty($1, $2, null, null, null)', [started, sgt]);
    await as(U.cop1);
    await refused(() => db.query('select public.change_duty($1, $2, null, null, null)', [line, b1]), /do not maintain duty/);
  });

  await scenario('absence codes: Oracle codes added; members cannot ask for office-only codes; the office maintains them', async () => {
    await as(U.cop1);
    const codes = await rows("select code, name, detail2 from public.command_records where module = 'LeaveType' order by code");
    const byCode = Object.fromEntries(codes.map((c) => [c.code, c]));
    assert.equal(byCode.AL.name, 'Annual'); assert.equal(byCode.SL.name, 'Sick'); assert.equal(byCode.AW.detail2, 'Office');
    assert.equal(byCode.SU.detail2, 'Office'); assert.equal(byCode.CL.detail2, null);
    assert.equal(codes.length, 14, 'four existing types coded, ten Oracle codes added, once');
    await refused(() => db.query("insert into public.leave_entries (silo, user_id, eff_from, eff_to, absence, status) values ('MetroPolice', $1, $2, $2, 'AWOL', 'Pending')", [U.cop1, day1]), /leave type/);
    await db.query("insert into public.leave_entries (silo, user_id, eff_from, eff_to, absence, status) values ('MetroPolice', $1, $2, $2, 'Compassionate', 'Pending')", [U.cop1, day1]);
    await as(U.sup);
    await refused(() => db.query("select public.save_absence_code(null, 'XX', 'Something', false, null)"), /do not maintain absence codes/);
    await as(U.controller);
    const xid = (await one("select public.save_absence_code(null, 'ex', 'Exam leave extra', false, 5) as id")).id;
    assert.equal((await one('select code, detail3 from public.command_records where id = $1', [xid])).code, 'EX');
    await refused(() => db.query("select public.save_absence_code(null, 'AL', 'Another', false, null)"), /already used/);
  });

  await scenario('leave captured by the office: approved as captured, duty marked, form Y/N, never your own', async () => {
    const { section, b1 } = await setUpBeachfront();
    await as(U.sup);
    await db.query('select public.allocate_duty($1, $2::date, $3::date, $4::jsonb)', [section, day1, day3, JSON.stringify([{ post_id: b1, user_id: U.cop1 }])]);
    // A constable clerk with Maintain Leave only (no rostering).
    await as(U.controller);
    await db.query("select public.set_module_access($1, 'LEAM', 'Edit')", [U.cop3]);
    await as(U.cop3);
    const lv = await one("select * from public.capture_leave($1, 'sl', $2::date, $3::date, true, 'Doctor''s note')", [U.cop1, day1, addDays(day1, 1)]);
    assert.equal(lv.status, 'Approved'); assert.equal(lv.absence, 'Sick'); assert.equal(lv.absence_code, 'SL');
    assert.equal(lv.form_submitted, true); assert.equal(lv.captured_by_name, 'Const. Lerato Khumalo'); assert.ok(Number(lv.leave_seq) > 500000);
    assert.equal(Number(lv.days), 2);
    await system();
    const st = await rows('select status from public.rosters where user_id = $1 order by start_at', [U.cop1]);
    assert.deepEqual(st.map((s) => s.status), ['Sick', 'Sick', 'Present']);
    assert.equal((await rows("select 1 from public.alerts where target_user_id = $1 and title = 'Leave captured'", [U.cop1])).length, 1);
    await as(U.cop3);
    await refused(() => db.query("select public.capture_leave($1, 'AL', $2::date, $2::date, false)", [U.cop1, day1]), /already has approved leave/);
    await refused(() => db.query("select public.capture_leave($1, 'AL', $2::date, $2::date, false)", [U.cop3, day1]), /your own/);
    await refused(() => db.query("select public.capture_leave($1, 'ZZ', $2::date, $2::date, false)", [U.cop2, day1]), /absence code/);
    await refused(() => db.query("select public.capture_leave($1, 'AL', $2::date, $2::date, false)", [U.ff1, day1]), /do not maintain leave for Fire/);
    // AWOL marks the duty Absent.
    const aw = await one("select id from public.capture_leave($1, 'AW', $2::date, $2::date, false)", [U.cop1, day3]);
    await system();
    assert.equal((await one("select status from public.rosters where user_id = $1 and duty_date = $2", [U.cop1, day3])).status, 'Absent');
    await as(U.cop3);
    await db.query('select public.set_leave_form($1, true)', [aw.id]);
    assert.equal((await one('select form_submitted from public.leave_entries where id = $1', [aw.id])).form_submitted, true);
    assert.ok((await rows("select 1 from public.leave_entries where user_id = $1", [U.cop1])).length >= 2, 'the clerk reads the leave they maintain');
    await as(U.cop2);
    await refused(() => db.query('select public.set_leave_form($1, false)', [aw.id]), /do not maintain leave/);
    assert.equal((await rows("select 1 from public.leave_entries where user_id = $1", [U.cop1])).length, 0, 'a colleague reads none of it');
  });

  await scenario('another organisation sees nothing; anon has nothing', async () => {
    await setUpBeachfront();
    await as(U.stranger, T2);
    assert.equal((await rows('select 1 from public.stations')).length, 0);
    const seen = await rows('select user_id, tenant_id from public.module_access');
    assert.ok(seen.length > 0 && seen.every((r) => r.user_id === U.stranger && r.tenant_id === T2), 'only their own grants, from their own organisation');
    await as(U.stranger, T2);
    const sid = (await one('select id from public.sections limit 1'))?.id ?? null;
    assert.equal(sid, null, 'none of the other organisation\'s sections');
    await system();
    for (const t of ['module_access', 'stations', 'staff_private', 'leo_records']) {
      assert.equal((await one(`select has_table_privilege('anon', 'public.${t}', 'select') as ok`)).ok, false, t);
    }
  });

  await db.exec('rollback');
  console.log(`\n${checks} scenarios passed.`);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}
