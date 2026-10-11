/** Run the real Criti migration (0070), after 0068, against in-memory Postgres
 * (PGlite): the escalation minutes are shared and nothing else of the rules
 * table, a department's desk writes only to calls sent to it, and a
 * broadcast reaches the people of the departments chosen, from staff allowed
 * to send it there.
 *
 * CASE_PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node scripts/test-criti.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.CASE_PGLITE_MODULE || '@electric-sql/pglite');

const read = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const desks = read('0068_dispatch_desk_tags.sql');
const migration = read('0070_criti.sql');
const db = new PGlite();
let checks = 0;
const one = async (q, args) => (await db.query(q, args)).rows[0];
const rows = async (q, args) => (await db.query(q, args)).rows;

const T = '20000000-0000-4000-8000-000000000001';
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const U = {
  logger: id(1), central: id(2), police: id(3), fire: id(4), fireSup: id(5), officer: id(6),
  ff1: id(7), ff2: id(8), ffGone: id(9), superAdmin: id(10), medic: id(11),
};
const PEOPLE = [
  [U.logger, 'IncidentLogger', 'Ethekwini', 'Lerato Logger', null],
  [U.central, 'Dispatcher', 'Ethekwini', 'Naledi Dispatch', null],
  [U.police, 'Dispatcher', 'MetroPolice', 'Nomsa Metro', null],
  [U.fire, 'Dispatcher', 'MetroFire', 'Fire Control', null],
  [U.fireSup, 'Supervisor', 'MetroFire', 'Station Officer Naidoo', null],
  [U.officer, 'Police', 'MetroPolice', 'Const. Khumalo', null],
  [U.ff1, 'Firefighter', 'MetroFire', 'Firefighter Dube', null],
  [U.ff2, 'Firefighter', 'MetroFire', 'Firefighter Ngcobo', null],
  [U.ffGone, 'Firefighter', 'MetroFire', 'Firefighter Left', '2026-01-01'],
  [U.superAdmin, 'SuperAdmin', 'MetroFire', 'Platform Owner', null],
  [U.medic, 'Paramedic', 'Medical', 'Paramedic Lee', null],
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
  finally { await db.query('reset role'); await db.query('rollback to savepoint scenario'); }
}
const log = (tags, type = 'Burglary') => db.query(
  `select * from public.log_incoming_call(
     'Ethekwini', 'Thabo Caller', '+27821234567', 'Break-in reported', $1, 'High', '1 Main Street', -29.85, 31.02,
     p_is_caller_patient => false, p_tagged_silos => $2::silo[])`,
  [type, tags]).then((r) => r.rows[0]);
const broadcast = (silos, message = 'Road closed at the N2 on-ramp', severity = 'Medium') =>
  db.query('select public.send_broadcast($1::silo[], $2, $3) as n', [silos, message, severity]).then((r) => r.rows[0].n);

try {
  await db.exec(`
    create role authenticated nologin; create role anon nologin; create role service_role nologin;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user', true), '')::uuid $$;
    create type public.silo as enum ('Ethekwini', 'MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster');
    create type public.user_role as enum ('SystemAdmin', 'SuperAdmin', 'Admin', 'Supervisor', 'Dispatcher', 'ControlRoom',
      'IncidentLogger', 'Viewer', 'System', 'Captain', 'Police', 'FireChief', 'Firefighter', 'Paramedic', 'Doctor',
      'Disaster', 'CaseManager', 'Staff', 'SystemController');
    create type public.incident_severity as enum ('Low', 'Medium', 'High', 'Critical');
    create type public.incident_status as enum ('New', 'Pending', 'Pending Dispatch', 'Pending Analysis', 'Dispatched',
      'En Route', 'Arrived', 'On Scene', 'Transporting', 'Active', 'Closed', 'Resolved');
    create function public.current_tenant() returns uuid language sql stable as $$ select '${T}'::uuid $$;
    create table public.profiles (
      id uuid primary key, tenant_id uuid default '${T}', role public.user_role, silo public.silo,
      full_name text, deactivated_at timestamptz);
    create function public.require_role(variadic roles text[]) returns void language plpgsql stable as $$
    begin
      if not exists (select 1 from public.profiles where id = auth.uid() and deactivated_at is null and role::text = any (roles)) then
        raise exception 'Not permitted' using errcode = '42501';
      end if;
    end $$;
    create function public.current_silo() returns public.silo language sql stable as $$
      select coalesce((select silo from public.profiles where id = auth.uid()), 'Ethekwini') $$;
    create function public.is_global() returns boolean language sql stable as $$
      select coalesce((select role in ('SystemAdmin','SuperAdmin','Dispatcher','ControlRoom','IncidentLogger','Viewer','System','SystemController')
        from public.profiles where id = auth.uid()), false) $$;
    create sequence inc_seq;
    create function public.next_incident_number(p_silo public.silo) returns text language sql as $$
      select 'INC-' || lpad(nextval('inc_seq')::text, 4, '0') $$;
    create function public.department_label(p_silo public.silo) returns text language sql immutable as $$
      select case p_silo::text when 'Ethekwini' then 'Control Room' when 'MetroPolice' then 'Metro Police'
        when 'MetroFire' then 'Fire & Rescue' when 'Medical' then 'EMS' when 'EthekwiniDisaster' then 'Disaster Management' end $$;
    create table public.incidents (
      id uuid primary key default gen_random_uuid(), tenant_id uuid not null default '${T}', silo public.silo not null,
      source text, incident_number text not null, client_ref uuid,
      caller_name text, caller_number text, call_description text, notes text,
      incident_type text, incident_category text, incident_severity public.incident_severity,
      fire_incident_type text, medical_type text, disaster_type text,
      location_address text, suburb text, city text, postal_code text, region text, location_lat double precision, location_lng double precision,
      is_caller_patient boolean, patient_name text, number_of_victims int,
      status public.incident_status, call_timestamp timestamptz, incident_created_at timestamptz,
      call_taken_by text, created_by uuid, dispatched_silos public.silo[] not null default '{}', updated_at timestamptz);
    create table public.incident_updates (
      id uuid primary key default gen_random_uuid(), silo public.silo not null, incident_id uuid not null,
      message text not null, created_by uuid, created_by_name text, timestamp timestamptz not null default now());
    create table public.incident_attachments (id uuid primary key default gen_random_uuid(), incident_id uuid not null);
    create table public.incident_responders (id uuid primary key default gen_random_uuid(), incident_id uuid not null);
    create table public.alerts (
      id uuid primary key default gen_random_uuid(), tenant_id uuid, silo public.silo, target_user_id uuid, kind text,
      severity text, title text, body text, incident_id uuid, link text, presentation text, requires_ack boolean,
      created_by uuid, created_by_name text);
    create table public.audit_logs (
      silo public.silo, user_id uuid, user_name text, department text, action_type text, entity_type text, entity_id text, details text);
    create table public.automation_rules (key text primary key, name text, enabled boolean not null default true, config jsonb not null default '{}');
    insert into public.automation_rules (key, name, config) values
      ('sla_unassigned', 'Unassigned call escalation', '{"warn_minutes": 7, "critical_minutes": 15}'),
      ('sla_no_arrival', 'No arrival recorded', '{"minutes": 25}'),
      ('stale_incidents', 'Open incident gone quiet', '{"hours": 3}'),
      ('cert_expiry', 'Certification expiry warnings', '{"windows": "30,7,1"}');
    create table public.integration_settings (key text primary key, label text not null, category text, enabled boolean, config jsonb);
    -- As before 0068 and 0070: everyone on a desk reads every call, and anyone may add to a timeline.
    alter table public.incidents enable row level security;
    create policy incidents_read on public.incidents for select using (
      silo = public.current_silo() or public.is_global() or public.current_silo() = any (dispatched_silos));
    alter table public.incident_updates enable row level security;
    create policy incident_updates_read on public.incident_updates for select using (true);
    create policy incident_updates_insert on public.incident_updates for insert with check (true);
    alter table public.incident_attachments enable row level security;
    create policy incident_attachments_read on public.incident_attachments for select using (true);
    create policy incident_attachments_insert on public.incident_attachments for insert with check (true);
    grant usage on schema public, auth to authenticated;
    grant select on public.incidents, public.alerts, public.profiles to authenticated;
    grant select, insert on public.incident_updates, public.incident_attachments to authenticated;
    grant execute on all functions in schema public, auth to authenticated;
  `);
  for (const [uid, role, silo, name, gone] of PEOPLE) {
    await db.query('insert into public.profiles (id, role, silo, full_name, deactivated_at) values ($1, $2, $3, $4, $5)', [uid, role, silo, name, gone]);
  }
  await db.exec(desks);
  await db.exec(migration);
  await db.exec(migration); // safe to re-run
  await db.query('grant execute on all functions in schema public to authenticated');
  await db.exec('begin');

  await scenario('the escalation minutes are shared, and nothing else of the rules table', async () => {
    await as(U.fire);
    const t = (await one('select public.criti_thresholds() as t')).t;
    assert.deepEqual(Object.keys(t).sort(), ['sla_no_arrival', 'sla_unassigned', 'stale_incidents']);
    assert.deepEqual(t.sla_unassigned, { enabled: true, config: { warn_minutes: 7, critical_minutes: 15 } });
    assert.equal(t.stale_incidents.config.hours, 3);
    await refused(() => db.query('select * from public.automation_rules'), /permission denied/, 'the table itself stays admin-only');
  });

  await scenario('a desk adds notes and files only to calls sent to it', async () => {
    await asDefiner(U.logger);
    const policeCall = await log('{MetroPolice}');
    const fireCall = await log('{MetroFire}', 'Structure Fire');
    await as(U.fire);
    await refused(() => db.query("insert into public.incident_updates (silo, incident_id, message) values ('MetroFire', $1, 'Hello')", [policeCall.id]),
      /row-level security/, 'not a call sent to the fire desk');
    await refused(() => db.query('insert into public.incident_attachments (incident_id) values ($1)', [policeCall.id]), /row-level security/);
    await db.query("insert into public.incident_updates (silo, incident_id, message) values ('Ethekwini', $1, 'Crew on the way')", [fireCall.id]);
    await db.query('insert into public.incident_attachments (incident_id) values ($1)', [fireCall.id]);
    await as(U.central);
    await db.query("insert into public.incident_updates (silo, incident_id, message) values ('Ethekwini', $1, 'Control room note')", [policeCall.id]);
    await as(U.officer);
    await db.query("insert into public.incident_updates (silo, incident_id, message) values ('MetroPolice', $1, 'On my way')", [policeCall.id]);
  });

  await scenario('a department broadcast reaches its own people only', async () => {
    await as(U.fireSup);
    const n = await broadcast('{MetroFire}');
    // Fire Control and two firefighters: not the sender, not the departed, not the platform owner.
    assert.equal(n, 3);
    const got = (await rows('select target_user_id, silo, presentation, requires_ack, title from public.alerts where kind = $1 order by target_user_id', ['broadcast']))
      .map((r) => r.target_user_id);
    assert.deepEqual(got.sort(), [U.fire, U.ff1, U.ff2].sort());
    const a = await one("select * from public.alerts where target_user_id = $1", [U.ff1]);
    assert.deepEqual([a.presentation, a.requires_ack, a.title], ['toast', false, 'Broadcast from Station Officer Naidoo']);
    await db.query('reset role');
    const audit = await one("select action_type, details from public.audit_logs where action_type = 'Broadcast'");
    assert.match(audit.details, /^Fire & Rescue \(Medium, 3 people\): Road closed/);
    await as(U.fireSup);
    await refused(() => broadcast('{MetroPolice}'), /You can broadcast to Fire & Rescue only/);
    await refused(() => broadcast('{MetroFire,Medical}'), /You can broadcast to Fire & Rescue only/);
  });

  await scenario('the control room broadcasts to any department; High and Critical interrupt', async () => {
    await as(U.central);
    const n = await broadcast('{MetroPolice,Medical}', 'Mass casualty on the M4, all units stand by', 'Critical');
    assert.equal(n, 3, 'the police desk, the officer and the paramedic');
    const a = await one('select presentation, requires_ack, severity from public.alerts where target_user_id = $1', [U.medic]);
    assert.deepEqual([a.presentation, a.requires_ack, a.severity], ['modal', true, 'Critical']);
    assert.equal((await rows('select 1 from public.alerts where target_user_id = $1', [U.fire])).length, 0, 'the fire desk was not chosen');
  });

  await scenario('who may not broadcast, and what a broadcast must be', async () => {
    await as(U.officer);
    await refused(() => broadcast('{MetroPolice}'), /Not permitted/, 'officers do not broadcast');
    await as(U.logger);
    await refused(() => broadcast('{MetroPolice}'), /Not permitted/, 'call takers do not broadcast');
    await as(U.central);
    await refused(() => broadcast('{MetroPolice}', 'Hi'), /3 to 500 characters/);
    await refused(() => broadcast('{MetroPolice}', 'Road closed', 'Low'), /Medium, High or Critical/);
    await refused(() => broadcast('{}'), /Choose who receives the broadcast/);
  });

  await scenario('Grok is listed among the AI providers', async () => {
    const g = await one("select label, category, config from public.integration_settings where key = 'grok'");
    assert.equal(g.category, 'AI');
    assert.equal(g.config.model, 'grok-4.7');
  });

  await db.exec('rollback');
  console.log(`\n${checks} scenarios passed`);
} catch (e) {
  console.error(e);
  process.exit(1);
}
