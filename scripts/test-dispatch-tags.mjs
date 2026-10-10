/** Run the real dispatch-desk migration (0068) against in-memory Postgres
 * (PGlite): a call reaches only the dispatch desks it was tagged for, the
 * control room sees every call, a desk dispatches its own crews only, and
 * another department is brought in through its desk.
 *
 * CASE_PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node scripts/test-dispatch-tags.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.CASE_PGLITE_MODULE || '@electric-sql/pglite');

const migration = readFileSync(new URL('../supabase/migrations/0068_dispatch_desk_tags.sql', import.meta.url), 'utf8');
const db = new PGlite();
let checks = 0;
const one = async (q, args) => (await db.query(q, args)).rows[0];
const rows = async (q, args) => (await db.query(q, args)).rows;

const T = '20000000-0000-4000-8000-000000000001';
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const U = { logger: id(1), central: id(2), police: id(3), fire: id(4), ems: id(5), officer: id(6) };
const PEOPLE = [
  [U.logger, 'IncidentLogger', 'Ethekwini', 'Lerato Logger'],
  [U.central, 'Dispatcher', 'Ethekwini', 'Naledi Dispatch'],
  [U.police, 'Dispatcher', 'MetroPolice', 'Nomsa Metro'],
  [U.fire, 'Dispatcher', 'MetroFire', 'Fire Control'],
  [U.ems, 'Dispatcher', 'Medical', 'EMS Control'],
  [U.officer, 'Police', 'MetroPolice', 'Const. Khumalo'],
];

async function as(uid) {
  await db.query('reset role');
  await db.query("select set_config('test.user', $1, true)", [uid]);
  await db.query('set local role authenticated');
}
async function asDefiner(uid) {
  // The dispatch functions are SECURITY DEFINER: they bypass the policies, not the trigger.
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
const visible = async (uid) => {
  await as(uid);
  const r = (await rows('select incident_number from public.incidents order by incident_number')).map((x) => x.incident_number);
  await db.query('reset role');
  return r;
};

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
      if not exists (select 1 from public.profiles where id = auth.uid() and role::text = any (roles)) then
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
    -- As 0067.
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
    -- The policies before 0068: everyone on a desk reads every call.
    alter table public.incidents enable row level security;
    create policy incidents_read on public.incidents for select using (
      silo = public.current_silo() or public.is_global() or public.current_silo() = any (dispatched_silos));
    create policy incidents_dispatcher_update on public.incidents for update using (public.is_global()) with check (public.is_global());
    alter table public.incident_updates enable row level security;
    create policy incident_updates_read on public.incident_updates for select using (true);
    grant usage on schema public, auth to authenticated;
    grant select, update on public.incidents to authenticated;
    grant select on public.incident_updates, public.alerts, public.profiles to authenticated;
    grant execute on all functions in schema public, auth to authenticated;
  `);
  for (const [uid, role, silo, name] of PEOPLE) {
    await db.query('insert into public.profiles (id, role, silo, full_name) values ($1, $2, $3, $4)', [uid, role, silo, name]);
  }
  await db.exec(migration);
  await db.exec(migration); // safe to re-run
  await db.exec('begin');

  await scenario('a call is not logged until it is sent to a department', async () => {
    await asDefiner(U.logger);
    await refused(() => log(null), /Choose the department this call is for/);
    await refused(() => log('{Ethekwini}'), /Choose the department this call is for/, 'the control room is not a department desk');
    const inc = await log('{MetroPolice,MetroPolice}');
    assert.deepEqual(inc.tagged_silos, '{MetroPolice}');
    const t = await one('select message from public.incident_updates where incident_id = $1', [inc.id]);
    assert.equal(t.message, 'Call logged by Lerato Logger and sent to the Metro Police dispatch desk.');
  });

  await scenario('only the tagged desks receive the call; the control room sees every call', async () => {
    await asDefiner(U.logger);
    const burglary = await log('{MetroPolice}');
    const fire = await log('{MetroFire}', 'Structure Fire');
    const crash = await log('{MetroPolice,Medical}', 'Motor Vehicle Accident');
    assert.deepEqual(await visible(U.police), [burglary.incident_number, crash.incident_number].sort());
    assert.deepEqual(await visible(U.fire), [fire.incident_number]);
    assert.deepEqual(await visible(U.ems), [crash.incident_number]);
    assert.deepEqual(await visible(U.central), [burglary.incident_number, fire.incident_number, crash.incident_number].sort());
    // Its timeline goes with it.
    await as(U.police);
    assert.equal((await rows('select 1 from public.incident_updates where incident_id = $1', [fire.id])).length, 0, 'not the fire call');
    assert.equal((await rows('select 1 from public.incident_updates where incident_id = $1', [burglary.id])).length, 1);
  });

  await scenario('a desk cannot reach a call that was not sent to it, by any route', async () => {
    await asDefiner(U.logger);
    const fire = await log('{MetroFire}', 'Structure Fire');
    await as(U.police);
    const r = await db.query("update public.incidents set notes = 'mine now' where id = $1", [fire.id]);
    assert.equal(r.affectedRows, 0, 'the policy hides it');
    await asDefiner(U.police);
    await refused(() => db.query("update public.incidents set notes = 'mine now' where id = $1", [fire.id]),
      /was not sent to your dispatch desk/, 'and the trigger stops the dispatch functions');
    await refused(() => db.query("select public.tag_incident_departments($1, '{MetroPolice}')", [fire.id]), /No such call on your desk/);
  });

  await scenario('a desk dispatches its own crews; another department comes in through its desk', async () => {
    await asDefiner(U.logger);
    const crash = await log('{MetroPolice}', 'Motor Vehicle Accident');
    await asDefiner(U.police);
    await refused(() => db.query("update public.incidents set dispatched_silos = '{MetroFire}' where id = $1", [crash.id]),
      /Your desk dispatches Metro Police crews only\. Send the call to the Fire & Rescue dispatch desk to bring them in\./);
    await db.query("update public.incidents set dispatched_silos = '{MetroPolice}', status = 'Dispatched' where id = $1", [crash.id]);
    const tagged = await one("select (public.tag_incident_departments($1, '{Medical}', 'Two injured')).tagged_silos", [crash.id]);
    assert.deepEqual(tagged.tagged_silos, '{MetroPolice,Medical}');
    const alert = await one("select target_user_id, title, presentation from public.alerts where incident_id = $1", [crash.id]);
    assert.deepEqual([alert.target_user_id, alert.title, alert.presentation], [U.ems, `${crash.incident_number} sent to your desk`, 'modal']);
    assert.match((await one("select message from public.incident_updates where incident_id = $1 and message like 'Sent to%'", [crash.id])).message,
      /Sent to the EMS dispatch desk by Nomsa Metro: Two injured/);
    assert.ok((await visible(U.ems)).includes(crash.incident_number), 'EMS now has it');
    assert.ok(!(await visible(U.fire)).includes(crash.incident_number), 'Fire still does not');
  });

  await scenario('the desks a call was sent to stay on its record', async () => {
    await asDefiner(U.logger);
    const inc = await log('{MetroPolice,Medical}');
    await asDefiner(U.central);
    await refused(() => db.query("update public.incidents set tagged_silos = '{MetroPolice}' where id = $1", [inc.id]),
      /stay on its record/);
    await asDefiner(U.police);
    await refused(() => db.query("update public.incidents set silo = 'MetroPolice' where id = $1", [inc.id]),
      /does not move a call to another department/);
  });

  await scenario('field officers and the control room are unchanged', async () => {
    await asDefiner(U.logger);
    const inc = await log('{MetroPolice}');
    assert.deepEqual(await visible(U.officer), [], 'a logged call is not on officers’ phones until it is dispatched');
    await asDefiner(U.central);
    await db.query("update public.incidents set dispatched_silos = '{MetroFire}' where id = $1", [inc.id]);
    assert.deepEqual(await visible(U.fire), [inc.incident_number], 'the control room may send any crews; their desk then sees it');
  });

  await db.exec('rollback');
  console.log(`\n${checks} scenarios passed`);
} catch (e) {
  console.error(e);
  process.exit(1);
}
