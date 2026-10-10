/** Run the real Disaster Management migration (0065) against in-memory
 * Postgres (PGlite), on the real disaster tables from 0001. It covers the
 * readiness-only start of shift, who may file the post-mortem and what it
 * must say, what filing does to the incident, the replay, the guard on a bare
 * Resolved, who may read it, and the record rules.
 *
 * CASE_PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node scripts/test-disaster-flow.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.CASE_PGLITE_MODULE || '@electric-sql/pglite');

const read = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const init = read('0001_init.sql');
const start = init.indexOf('create table public.disaster_logs');
const end = init.indexOf('create table public.relief_stocks');
assert.ok(start > 0 && end > start, 'disaster tables found in 0001');
const disasterTables = init.slice(start, end);
const migration = read('0065_disaster_flow.sql');

const db = new PGlite();
let checks = 0;
const one = async (q, args) => (await db.query(q, args)).rows[0];
const scalar = async (q, args) => (await one(q, args))?.value;

const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T1 = '20000000-0000-4000-8000-000000000001';
const T2 = '20000000-0000-4000-8000-000000000002';
const U = { officer: id(1), officer2: id(2), police: id(3), supervisor: id(4), caseManager: id(5), other: id(6), logger: id(7) };
const PEOPLE = [
  [U.officer, T1, 'Disaster', 'EthekwiniDisaster', 'Azrah Naidoo'],
  [U.officer2, T1, 'Disaster', 'EthekwiniDisaster', 'Sizwe Mkhize'],
  [U.police, T1, 'Police', 'MetroPolice', 'Sipho Khumalo'],
  [U.supervisor, T1, 'Supervisor', 'EthekwiniDisaster', 'Noah Super'],
  [U.caseManager, T1, 'CaseManager', 'Ethekwini', 'Ayanda Case'],
  [U.other, T2, 'Disaster', 'EthekwiniDisaster', 'Other Tenant'],
  [U.logger, T1, 'IncidentLogger', 'EthekwiniDisaster', 'Chloe Logger'],
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

const good = (extra = {}) => ({
  start_time: '2026-10-09 06:00', end_time: '2026-10-09 18:30', injuries: '3', fatalities: '0', displaced_people: '40',
  root_cause: 'Blocked storm drains after heavy rain', lessons_learned: 'Clear drains before the rainy season',
  reporting_officer: 'Azrah Naidoo', ...extra,
});
const file = (incident, fields) => db.query('select * from file_post_mortem($1, $2::jsonb)', [incident, JSON.stringify(fields)]);
const incidentRow = (incident) => one('select * from incidents where id = $1', [incident]);
const bools = (cols) => cols.map((c) => `${c} boolean not null default false`).join(', ');

try {
  await db.exec(`
    create role authenticated nologin; create role anon nologin;
    create schema auth; create table auth.users(id uuid primary key);
    create function public.uuid_generate_v4() returns uuid language sql as $$ select gen_random_uuid() $$;
    create type public.silo as enum ('Ethekwini','MetroPolice','MetroFire','Medical','EthekwiniDisaster');
    create type public.incident_status as enum ('Pending Analysis','Pending Dispatch','Dispatched','En Route','Arrived','On Scene','Transporting','Active','Resolved','Closed');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user', true), '')::uuid $$;
    create function public.current_tenant() returns uuid language sql stable as $$ select nullif(current_setting('test.tenant', true), '')::uuid $$;
    create function public.current_silo() returns public.silo language sql stable as $$ select coalesce(nullif(current_setting('test.silo', true), ''), 'Ethekwini')::public.silo $$;
    create function public.role_in(variadic roles text[]) returns boolean language sql stable as $$ select current_setting('test.role', true) = any(roles) $$;
    create function public.is_global() returns boolean language sql stable as $$ select current_setting('test.role', true) in ('Dispatcher','SystemAdmin','SuperAdmin','IncidentLogger') $$;
    create function public.require_role(variadic roles text[]) returns void language plpgsql as $$ begin
      if auth.uid() is null or not public.role_in(variadic roles) then raise exception 'Role refused' using errcode='42501'; end if;
    end $$;
    create function public.sa_today_start() returns timestamptz language sql stable as $$ select date_trunc('day', now()) $$;

    create table public.profiles(id uuid primary key, full_name text);
    create table public.apparatus(id uuid primary key default gen_random_uuid(), tenant_id uuid, silo public.silo, status text);
    create table public.personnel(id uuid primary key default gen_random_uuid(), user_id uuid, tenant_id uuid, silo public.silo,
      rank text, first_name text, last_name text, assigned_apparatus_id uuid);
    create table public.shift_no_vehicle_declarations(id uuid primary key default gen_random_uuid(), user_id uuid, tenant_id uuid, created_at timestamptz default now());
    create table public.vehicle_checklists(id uuid primary key default gen_random_uuid(), user_id uuid, tenant_id uuid,
      apparatus_id uuid, silo public.silo, checked_at timestamptz default now(), form_version text,
      ${bools(['officer_submitted', 'declaration_accepted', 'lights_functional', 'tires_condition_ok', 'equipment_stocked',
        'comms_working', 'brakes_responsive', 'scba_checked', 'water_tank_full', 'pump_operational', 'hoses_and_nozzles_stocked',
        'ladders_secured', 'turnout_gear_complete', 'requires_cleaning', 'oxygen_full', 'aed_battery_ok', 'suction_functional',
        'bvm_masks_ok', 'jump_bag_stocked', 'iv_fluids_stocked', 'drug_box_sealed', 'gloves_ppe_stocked'])});
    create table public.incidents(
      id uuid primary key, tenant_id uuid not null, silo public.silo not null, dispatched_silos public.silo[] not null default '{}',
      incident_number text not null, incident_type text default 'Flood', disaster_type text, location_address text default 'Umgeni River',
      status public.incident_status not null, accepted_by uuid, unit_status text, report_filed_at timestamptz,
      resolved_at timestamptz, resolved_by uuid, incident_created_at timestamptz default now(), updated_at timestamptz default now());
    create table public.incident_updates(id uuid primary key default gen_random_uuid(), silo public.silo, incident_id uuid,
      message text, created_by uuid, created_by_name text, timestamp timestamptz default now());
    create table public.audit_logs(id uuid primary key default gen_random_uuid(), tenant_id uuid, silo public.silo, user_id uuid,
      user_name text, department text, action_type text, entity_type text, entity_id text, details text);
    create table public.sent(kind text, tenant_id uuid, title text);
    create function public.notify_incident_chain(p_incident public.incidents, p_kind text, p_title text, p_body text) returns void
      language sql as $$ insert into public.sent values (p_kind, p_incident.tenant_id, p_title) $$;
    create function public.can_work_incident(p_incident_id uuid) returns boolean language sql stable as $$
      select exists (select 1 from public.incidents i where i.id = p_incident_id and i.accepted_by = auth.uid()) $$;
  `);
  await db.exec(disasterTables);
  await db.exec(`
    do $$ declare t text; begin
      foreach t in array array['disaster_logs','post_mortem_reports'] loop
        execute format('alter table public.%I add column tenant_id uuid not null default public.current_tenant()', t);
        execute format('alter table public.%I enable row level security', t);
        execute format('create policy tenant_isolation on public.%I as restrictive for all to authenticated using (tenant_id = public.current_tenant()) with check (tenant_id = public.current_tenant())', t);
      end loop;
    end $$;
    create policy disaster_logs_read on public.disaster_logs for select using (silo = public.current_silo() or public.is_global());
    create policy disaster_logs_write on public.disaster_logs for all
      using (silo = public.current_silo() and public.role_in('Disaster','Supervisor','SystemAdmin','SuperAdmin','Admin','IncidentLogger'))
      with check (silo = public.current_silo());
    create policy post_mortem_read on public.post_mortem_reports for select using (silo = public.current_silo() or public.is_global());
    create policy post_mortem_write on public.post_mortem_reports for all
      using (silo = public.current_silo() and public.role_in('Disaster','Supervisor','SystemAdmin','SuperAdmin','Admin'))
      with check (silo = public.current_silo());
    alter table public.incidents enable row level security;
    create policy incidents_all on public.incidents for all using (true) with check (true);
    grant usage on schema auth, public to authenticated;
    grant select, insert, update, delete on all tables in schema public to authenticated;
  `);

  // The migration under test, twice: it must be safe to re-run.
  await db.exec(migration);
  await db.exec(migration);

  for (const [uid, tenant, , silo, name] of PEOPLE) {
    await db.query('insert into auth.users values ($1)', [uid]);
    await db.query('insert into profiles values ($1, $2)', [uid, name]);
    const [first, last] = name.split(' ');
    await db.query('insert into personnel(user_id, tenant_id, silo, first_name, last_name) values ($1,$2,$3,$4,$5)', [uid, tenant, silo, first, last]);
  }
  const INC = { onScene: id(101), enRoute: id(102), pending: id(103), police: id(104), other: id(105), shared: id(106) };
  const incident = (incId, tenant, silo, sent, status, lead, number) => db.query(
    'insert into incidents(id, tenant_id, silo, dispatched_silos, status, accepted_by, incident_number, disaster_type) values ($1,$2,$3,$4,$5::incident_status,$6,$7,$8)',
    [incId, tenant, silo, sent, status, lead, number, silo === 'EthekwiniDisaster' ? 'Flood' : null]);
  await incident(INC.onScene, T1, 'EthekwiniDisaster', '{EthekwiniDisaster}', 'On Scene', U.officer, 'INC-20261009-0101');
  await incident(INC.enRoute, T1, 'EthekwiniDisaster', '{EthekwiniDisaster}', 'En Route', U.officer, 'INC-20261009-0102');
  await incident(INC.pending, T1, 'EthekwiniDisaster', '{}', 'Pending Analysis', null, 'INC-20261009-0103');
  await incident(INC.police, T1, 'MetroPolice', '{MetroPolice}', 'On Scene', U.officer, 'INC-20261009-0104');
  await incident(INC.other, T2, 'EthekwiniDisaster', '{EthekwiniDisaster}', 'On Scene', U.other, 'INC-20261009-0105');
  await incident(INC.shared, T1, 'Ethekwini', '{MetroFire,EthekwiniDisaster}', 'Dispatched', null, 'INC-20261009-0106');
  await db.query("insert into incident_updates(silo, incident_id, message, timestamp) values ('EthekwiniDisaster', $1, '[STATUS] On Scene', '2026-10-09T04:30:00Z')", [INC.onScene]);
  await db.query(`insert into disaster_logs(tenant_id, incident_id, incident_number, incident_type, location, description, resource_type, updates)
    values ($1, $2, 'INC-20261009-0101', 'Flood', 'Umgeni River', 'Boats deployed', 'Water rescue', '[{"timestamp":"2026-10-09 07:00","text":"Two boats on the water"},{"timestamp":"2026-10-09T08:00:00.000Z","text":"Shelter opened"}]')`, [T1, INC.onScene]);
  await db.exec('begin');

  // ── Start of shift ────────────────────────────────────────────────────────

  await scenario('a Disaster officer clears the vehicle step with no vehicle form; Police still needs its 187(c)', async () => {
    await as(U.officer);
    assert.equal(await scalar('select shift_vehicle_passed_today() as value'), true);
    await as(U.police);
    assert.equal(await scalar('select shift_vehicle_passed_today() as value'), false);
  });

  // ── Who may file ──────────────────────────────────────────────────────────

  await scenario('only the officer leading the incident files it, once on scene; command may close out a deployed one', async () => {
    await as(U.officer2);
    await refused(() => file(INC.onScene, good()), /Only the officer leading/);
    await as(U.officer);
    await refused(() => file(INC.enRoute, good()), /Mark yourself on scene/);
    await refused(() => file(INC.police, good()), /not a Disaster Management incident/);
    await as(U.police);
    await refused(() => file(INC.onScene, good()), /Role refused/);
    await as(U.logger);
    await refused(() => file(INC.onScene, good()), /Role refused/);
    await as(U.other);
    await refused(() => file(INC.onScene, good()), /not found/, 'another tenant');
    await as(U.supervisor);
    await refused(() => file(INC.pending, good()), /Deploy resources/, 'not yet deployed');
    const r = (await file(INC.shared, good())).rows[0];
    assert.equal(r.report_number, 'PM-INC-20261009-0106', 'command closes out a deployed, shared incident');
  });

  // ── What it must say ──────────────────────────────────────────────────────

  await scenario('the report needs its times in order, whole counts, the root cause, lessons and officer', async () => {
    await as(U.officer);
    await refused(() => file(INC.onScene, good({ start_time: 'yesterday' })), /Start Time must be/);
    await refused(() => file(INC.onScene, good({ end_time: '' })), /Resolved Time must be/);
    await refused(() => file(INC.onScene, good({ end_time: '2026-10-09 05:00' })), /before Start Time/);
    await refused(() => file(INC.onScene, good({ end_time: '2099-01-01 00:00' })), /future/);
    await refused(() => file(INC.onScene, good({ injuries: '-1' })), /whole numbers/);
    await refused(() => file(INC.onScene, good({ root_cause: ' ' })), /Root Cause/);
    await refused(() => file(INC.onScene, good({ lessons_learned: '' })), /Lessons Learned/);
    await refused(() => file(INC.onScene, good({ reporting_officer: '' })), /Reporting Officer/);
  });

  // ── What filing does ──────────────────────────────────────────────────────

  await scenario('filing records the post-mortem with its timeline and resolves the incident', async () => {
    await as(U.officer);
    const r = (await file(INC.onScene, good())).rows[0];
    assert.equal(r.report_number, 'PM-INC-20261009-0101');
    assert.equal(r.incident_type, 'Flood');
    assert.equal(r.location, 'Umgeni River');
    assert.equal(Number(r.total_duration_hours), 12.5);
    assert.equal(r.displaced_people, 40);
    assert.deepEqual(r.timeline_snapshot.map((e) => e.text), ['[STATUS] On Scene', 'Two boats on the water', 'Shelter opened']);
    assert.equal(r.timeline_snapshot[2].timestamp, '2026-10-09 10:00', 'a console update read in SA time');
    await db.query('reset role');
    const inc = await incidentRow(INC.onScene);
    assert.equal(inc.status, 'Resolved');
    assert.ok(inc.report_filed_at);
    assert.match((await one("select message from incident_updates where incident_id = $1 and message like '[REPORT]%'", [INC.onScene])).message,
      /Post-mortem PM-INC-20261009-0101 filed by Azrah Naidoo — incident resolved \(3 injured, 0 fatalities, 40 displaced\)/);
    assert.equal(await scalar("select count(*)::int as value from sent where kind = 'resolved'"), 1);
  });

  await scenario('a replay returns the report already filed', async () => {
    await as(U.officer);
    const a = (await file(INC.onScene, good())).rows[0];
    const b = (await file(INC.onScene, good({ root_cause: 'Changed' }))).rows[0];
    assert.equal(a.id, b.id);
    assert.equal(b.root_cause, 'Blocked storm drains after heavy rain');
  });

  // ── The guard ─────────────────────────────────────────────────────────────

  await scenario('a Disaster officer cannot close an incident with a bare Resolved', async () => {
    await as(U.officer);
    await refused(() => db.query("update incidents set status = 'Resolved' where id = $1", [INC.onScene]), /File the post-mortem/);
  });

  // ── Who reads and writes ──────────────────────────────────────────────────

  await scenario('Disaster, the crew and case managers read it; Police and another tenant do not; nobody inserts directly', async () => {
    await as(U.officer);
    const r = (await file(INC.onScene, good())).rows[0];
    const sees = async (uid) => { await as(uid); return Number(await scalar('select count(*)::int as value from post_mortem_reports where id = $1', [r.id])); };
    assert.equal(await sees(U.officer2), 1, 'Disaster');
    assert.equal(await sees(U.caseManager), 1, 'case manager');
    assert.equal(await sees(U.police), 0, 'police');
    assert.equal(await sees(U.other), 0, 'another tenant');
    await as(U.officer);
    await refused(() => db.query("insert into post_mortem_reports (silo, incident_number) values ('EthekwiniDisaster', 'X')"), /row-level security|violates/);
    await as(U.police);
    await refused(() => db.query("insert into disaster_logs (silo, incident_number, incident_type, location, description, resource_type) values ('EthekwiniDisaster','X','Flood','Y','Z','Boats')"), /row-level security|violates/);
  });

  // ── Record rules ──────────────────────────────────────────────────────────

  await scenario('a post-mortem can be corrected until the case closes, never deleted or re-linked; the duration follows the times', async () => {
    await as(U.officer);
    const r = (await file(INC.onScene, good())).rows[0];
    const fixed = (await db.query("update post_mortem_reports set end_time = '2026-10-09T20:00:00Z' where id = $1 returning total_duration_hours", [r.id])).rows[0];
    assert.equal(Number(fixed.total_duration_hours), 16, 'recomputed: 06:00 SAST to 20:00 UTC');
    await refused(() => db.query('update post_mortem_reports set incident_id = $2 where id = $1', [r.id, INC.enRoute]), /keeps its incident/);
    // Nobody holds a delete right: the delete removes nothing.
    await db.query('delete from post_mortem_reports where id = $1', [r.id]);
    assert.equal(Number(await scalar('select count(*)::int as value from post_mortem_reports where id = $1', [r.id])), 1, 'still on record');
    await db.query('reset role');
    await db.query("update incidents set status = 'Closed' where id = $1", [INC.onScene]);
    await as(U.officer);
    await refused(() => db.query("update post_mortem_reports set root_cause = 'Late' where id = $1", [r.id]), /case is closed/);
  });

  console.log(`\n${checks} scenarios passed`);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}
