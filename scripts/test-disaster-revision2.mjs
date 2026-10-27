/** Run Disaster revision 2 (0115 to 0121, over 0111 to 0114) against
 * in-memory Postgres (PGlite), signed in as each user: the JOC and the top
 * ten risks; SAWS warnings taken through the process, read from the feed by
 * the server only; councillors; levels that need a reason and a JOC that
 * needs a listed authoriser; the statuses, recovery and the review; relief
 * by ward and relief stock no longer written from the browser; past records;
 * readiness; tours kept per account and practice incidents kept private.
 *
 * CASE_PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node scripts/test-disaster-revision2.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.CASE_PGLITE_MODULE || '@electric-sql/pglite');

const sql = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const db = new PGlite();
let checks = 0;

const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = '20000000-0000-4000-8000-000000000001';
const U = { desk: id(1), cop: id(3), dm: id(4), sup: id(5), admin: id(6) };
const OFFICER = id(40);
const CALL = id(100);
let refs = 500;
const ref = () => id(refs++);

const WHO = {
  [U.desk]: ['Dispatcher', 'EthekwiniDisaster'], [U.cop]: ['Dispatcher', 'MetroPolice'],
  [U.dm]: ['Disaster', 'EthekwiniDisaster'], [U.sup]: ['Supervisor', 'EthekwiniDisaster'], [U.admin]: ['Admin', 'EthekwiniDisaster'],
};
async function as(uid) {
  const [role, silo] = WHO[uid];
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
async function refused(work, pattern) {
  await db.query('savepoint r');
  await assert.rejects(work(), pattern);
  await db.query('rollback to savepoint r');
}
const one = (r) => r.rows[0];
const call = (uid, fn, args) => as(uid).then(() => db.query(`select * from public.${fn}`, args)).then(one);
const sql1 = async (q, a = []) => { await db.query('reset role'); return one(await db.query(q, a)); };
const rows = async (q, a = []) => { await db.query('reset role'); return (await db.query(q, a)).rows; };
const timeline = async () => (await rows('select message from public.incident_updates order by seq')).map((r) => r.message);
const partner = (name) => sql1('select * from public.mutual_aid_partners where agency_name = $1', [name]);
const REPORT = { start_time: '2026-10-26 08:00', end_time: '2026-10-26 09:30', injuries: 2, fatalities: 0, displaced_people: 96,
  households_affected: 30, homes_destroyed: 6, homes_damaged: 24, people_sheltered: 96,
  root_cause: 'Transformer fire spread to homes', lessons_learned: 'Call Eskom first', reporting_officer: 'N. Metro' };

try {
  await db.exec(`
    create role authenticated nologin; create role anon nologin; create role service_role nologin;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user', true), '')::uuid $$;
    create type public.silo as enum ('MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster', 'Ethekwini');
    create type public.incident_severity as enum ('Low', 'Medium', 'High', 'Critical');
    create type public.incident_status as enum ('New', 'Pending', 'Pending Dispatch', 'Pending Analysis', 'Dispatched', 'En Route', 'Arrived', 'On Scene', 'Transporting', 'Active', 'Resolved', 'Closed');
    create function public.current_tenant() returns uuid language sql stable as $$ select '${T}'::uuid $$;
    create function public.current_silo() returns public.silo language sql stable as $$ select current_setting('test.silo', true)::public.silo $$;
    create function public.role_in(variadic roles text[]) returns boolean language sql stable as $$ select current_setting('test.role', true) = any (roles) $$;
    create function public.is_global() returns boolean language sql stable as $$ select current_setting('test.role', true) in ('SystemAdmin') $$;
    create function public.require_role(variadic roles text[]) returns void language plpgsql as $$
      begin if not (current_setting('test.role', true) = any (roles)) then raise exception 'role' using errcode = '42501'; end if; end $$;
    create table public.tenants (id uuid primary key);
    -- Two organisations, as on the live database.
    insert into public.tenants values ('${T}'), ('30000000-0000-4000-8000-000000000002');
    create table public.profiles (id uuid primary key, full_name text, role text, silo public.silo, deactivated_at timestamptz);
    create table public.personnel (id uuid primary key default gen_random_uuid(), user_id uuid, tenant_id uuid default '${T}',
      silo public.silo, rank text, first_name text, last_name text, work_cellphone text);
    create function public.can_direct_department(p_silo public.silo) returns boolean
    language sql stable security definer set search_path to 'public' as $$
      select exists (select 1 from public.profiles p where p.id = auth.uid() and p.deactivated_at is null
        and (p.role in ('SystemAdmin', 'SuperAdmin', 'SystemController', 'System')
             or (p.role in ('Dispatcher', 'ControlRoom', 'Operator', 'Supervisor', 'Captain', 'FireChief', 'Chief', 'Admin')
                 and p.silo in ('Ethekwini', p_silo)))) $$;
    create table public.incidents (id uuid primary key default gen_random_uuid(), tenant_id uuid default '${T}', silo public.silo, incident_number text,
      status public.incident_status, unit_status text, dispatched_silos public.silo[], tagged_silos public.silo[],
      accepted_by uuid, accepted_at timestamptz, assigned_to uuid, assigned_to_name text, report_filed_at timestamptz,
      unit_id uuid, responding_officer text, dispatch_time timestamptz, arrived_timestamp timestamptz, resolved_at timestamptz,
      resolved_by uuid, disaster_type text, incident_type text, location_address text, updated_at timestamptz,
      source text, client_ref uuid, caller_name text, caller_number text, call_description text, incident_severity public.incident_severity,
      suburb text, city text, location_lat double precision, location_lng double precision, number_of_victims int,
      call_timestamp timestamptz, incident_created_at timestamptz, call_taken_by text, created_by uuid, intake_complete boolean);
    create sequence public.etk_seq;
    create function public.next_incident_number(p_silo public.silo, p_tags public.silo[], p_at timestamptz default now()) returns text
      language sql as $$ select 'ETK-ED-' || nextval('public.etk_seq') $$;
    create table public.incident_responders (incident_id uuid, user_id uuid, unit_id uuid, status public.incident_status, arrived_at timestamptz);
    create table public.incident_departments (id uuid primary key default gen_random_uuid(), tenant_id uuid default '${T}',
      incident_id uuid, silo public.silo, status text default 'Waiting', dispatched_at timestamptz, dispatched_by uuid,
      dispatched_by_name text, assigned_to uuid, assigned_to_name text, lead_id uuid, lead_name text, accepted_at timestamptz,
      arrived_at timestamptz, arrived_by text, report_filed_at timestamptz, finished_at timestamptz, finished_by uuid,
      finished_by_name text, updated_at timestamptz, unique (incident_id, silo));
    create function public.department_step_rank(p_status text) returns integer language sql immutable as $$
      select case p_status when 'Waiting' then 0 when 'Dispatched' then 1 when 'En Route' then 2
        when 'Arrived' then 3 when 'On Scene' then 4 when 'Transporting' then 5 end $$;
    create function public.department_open(p_status text) returns boolean language sql immutable as $$
      select p_status in ('Waiting', 'Dispatched', 'En Route', 'Arrived', 'On Scene', 'Transporting') $$;
    create function public.ensure_incident_departments(p public.incidents) returns void language sql as $$
      insert into public.incident_departments (incident_id, silo)
      select distinct p.id, x from unnest(coalesce(p.tagged_silos, '{}') || coalesce(p.dispatched_silos, '{}') || array[p.silo]) x
       where x <> 'Ethekwini' on conflict do nothing $$;
    create function public.sync_incident_from_departments(p_incident_id uuid)
    returns public.incidents language plpgsql security definer set search_path to 'public' as $$
    declare v public.incidents; v_any boolean; v_open integer; v_top integer; v_filed timestamptz; v_sent boolean; v_status public.incident_status;
    begin
      select * into v from public.incidents where id = p_incident_id for update;
      if not found or v.status = 'Closed' then return v; end if;
      select count(*) > 0, count(*) filter (where public.department_open(d.status)),
             max(public.department_step_rank(d.status)) filter (where public.department_open(d.status)),
             max(d.report_filed_at), coalesce(bool_or(d.dispatched_at is not null), false)
        into v_any, v_open, v_top, v_filed, v_sent from public.incident_departments d where d.incident_id = p_incident_id;
      if not v_any then return v; end if;
      if v_open = 0 then
        if v_filed is null then return v; end if;
        v_status := 'Resolved';
      elsif v_top = 0 then
        v_status := case when v.status in ('New', 'Pending', 'Pending Dispatch', 'Pending Analysis') and not v_sent then v.status else 'Dispatched' end;
      else
        v_status := (array['Dispatched', 'En Route', 'Arrived', 'On Scene', 'Transporting']::public.incident_status[])[v_top];
      end if;
      update public.incidents set status = v_status, unit_status = v_status::text, updated_at = now(),
        report_filed_at = case when v_status = 'Resolved' then coalesce(report_filed_at, v_filed) else report_filed_at end
       where id = p_incident_id returning * into v;
      return v;
    end $$;
    create function public.incident_for_department(p public.incidents, p_silo public.silo)
    returns public.incidents language plpgsql stable as $$
    declare d public.incident_departments; v public.incidents := p;
    begin
      select * into d from public.incident_departments where incident_id = p.id and silo = p_silo;
      if not found then v.accepted_by := null; v.report_filed_at := null; v.status := 'Pending Dispatch'; return v; end if;
      v.status := case when d.status = 'Waiting' then 'Pending Dispatch' when d.status in ('Not needed', 'Cancelled') then 'Closed'
                       else d.status::public.incident_status end;
      v.accepted_by := d.lead_id; v.report_filed_at := d.report_filed_at;
      return v;
    end $$;
    create function public.finish_department_by_report(p_incident_id uuid, p_silo public.silo, p_at timestamptz)
    returns public.incidents language plpgsql as $$
    begin
      update public.incident_departments set status = 'Resolved', report_filed_at = p_at, finished_at = p_at
       where incident_id = p_incident_id and silo = p_silo;
      return public.sync_incident_from_departments(p_incident_id);
    end $$;
    create function public.radio_filer(p_incident_id uuid, p_silo public.silo, p_fields jsonb, p_lead uuid) returns uuid
      language sql as $$ select nullif(p_fields ->> 'radioed_by', '')::uuid $$;
    create function public.note_radio_filing(p_incident_id uuid, p_silo public.silo, p_by uuid) returns void language sql as $$ select $$;
    create function public.can_work_incident(p uuid) returns boolean language sql stable as $$ select false $$;
    create table public.mutual_aid_partners (id uuid primary key default gen_random_uuid(), tenant_id uuid default '${T}',
      silo public.silo default 'EthekwiniDisaster', agency_name text, resource_type text, contact_number text, radio_frequency text,
      commander_name text, is_active boolean default true);
    -- 0006's: a partner's name is unique across the system.
    create unique index mutual_aid_partners_agency_name_key on public.mutual_aid_partners (agency_name);
    -- 0002's, which 0112 retires.
    alter table public.mutual_aid_partners enable row level security;
    create policy mutual_aid_read on public.mutual_aid_partners for select using (true);
    create policy mutual_aid_admin on public.mutual_aid_partners for all using (public.role_in('Disaster','Admin')) with check (public.role_in('Disaster','Admin'));
    grant select, insert, update, delete on public.mutual_aid_partners to authenticated;
    create table public.post_mortem_reports (id uuid primary key default gen_random_uuid(), tenant_id uuid, silo public.silo,
      incident_id uuid, incident_number text, report_number text, filed_by uuid, incident_type text, location text,
      start_time timestamptz, end_time timestamptz, total_duration_hours numeric, injuries int, fatalities int,
      displaced_people int, root_cause text, lessons_learned text, timeline_snapshot jsonb, reporting_officer text,
      report_filed_at timestamptz);
    -- 0107's assessment table, as written.
    create table public.disaster_assessments (id uuid primary key default gen_random_uuid(), tenant_id uuid not null default '${T}',
      silo public.silo not null default 'EthekwiniDisaster', incident_id uuid not null, client_ref uuid, place text not null, ward text,
      hazard text not null, households_affected int not null default 0, people_affected int not null default 0,
      people_displaced int not null default 0, injured int not null default 0, deaths int not null default 0, missing int not null default 0,
      homes_destroyed int not null default 0, homes_damaged int not null default 0, services text[] not null default '{}',
      needs text[] not null default '{}', relief jsonb not null default '{}', shelter_name text, people_sheltered int not null default 0,
      notes text, lat double precision, lng double precision, accuracy real, filed_by uuid not null, filed_by_name text,
      filed_at timestamptz not null default now());
    create table public.disaster_logs (incident_id uuid, updates jsonb);
    create table public.incident_updates (seq bigint generated always as identity, silo public.silo, incident_id uuid, message text,
      created_by uuid, created_by_name text, timestamp timestamptz default now());
    create table public.audit_logs (timestamp timestamptz not null default now(), tenant_id uuid, silo public.silo, user_id uuid, user_name text, department text, action_type text,
      entity_type text, entity_id text, details text);
    create table public.chain (kind text, title text, body text);
    create function public.notify_incident_chain(i public.incidents, k text, t text, b text) returns integer language sql as $$
      insert into public.chain values (k, t, b); select 1 $$;
    grant usage on schema public, auth to authenticated, anon;
    grant select on public.profiles, public.incidents, public.personnel to authenticated;
    insert into public.profiles values ('${U.desk}', 'Nomsa Metro', 'Dispatcher', 'EthekwiniDisaster', null),
      ('${U.cop}', 'Const. Dube', 'Dispatcher', 'MetroPolice', null), ('${U.dm}', 'Thandi Mkhize', 'Disaster', 'EthekwiniDisaster', null),
      ('${U.sup}', 'Mr Khumalo', 'Supervisor', 'EthekwiniDisaster', null), ('${U.admin}', 'DM Admin', 'Admin', 'EthekwiniDisaster', null);
    insert into public.personnel (id, silo, rank, first_name, last_name, work_cellphone) values
      ('${OFFICER}', 'EthekwiniDisaster', 'Senior DMO', 'Sipho', 'Zulu', '+27821112222'),
      ('${id(41)}', 'MetroPolice', 'Const.', 'Lindiwe', 'Dube', '+27820000000');
    insert into public.mutual_aid_partners (agency_name, resource_type, contact_number, is_active) values
      ('ER24 Ambulance', 'Ambulance & EMS', '084 124', true), ('Netcare Umhlanga (Private)', 'Hospitals', '031 560 5500', true),
      ('Amanzimtoti Fire Station', 'Fire Stations', '031 311 5880', true), ('Eskom KZN Control Center', 'Utilities', '0860 037 566', true);
    insert into public.incidents (id, silo, incident_number, status, dispatched_silos, tagged_silos, incident_type, location_address) values
      ('${CALL}', 'Ethekwini', 'ETK-ED-20261026-0954-0002', 'Pending Dispatch', '{}', '{EthekwiniDisaster}', 'Electrical fire', 'Jelf Taylor Crescent');
  `);
  await db.exec(sql('0111_disaster_desk.sql'));
  await db.exec(sql('0112_disaster_doc.sql'));
  await db.exec(sql('0112_disaster_doc.sql')); // safe to re-run
  await db.exec(sql('0113_disaster_operations.sql'));
  await db.exec(sql('0113_disaster_operations.sql')); // safe to re-run
  await db.exec(sql('0114_disaster_checks.sql'));
  await db.exec(sql('0114_disaster_checks.sql')); // safe to re-run
  // Before 0115: a duty row under the 2012 name, renamed by 0115.
  await db.exec(`insert into public.disaster_duty (tenant_id, name, phone, duty, status, starts_at, ends_at, created_by)
    values ('${T}', 'Nomsa Mthembu', '082 555 0101', 'DOC Commander', 'On duty', now() - interval '1 hour', now() + interval '1 day', '${U.dm}'),
           ('${T}', 'Bheki Ngcobo', '082 555 0102', 'Principal Disaster Management Stand-by Officer', 'On standby', now() - interval '1 hour', now() + interval '1 day', '${U.dm}')`);
  // 0001's relief stock and 0002's policy that let the browser write it; 0118 closes it.
  await db.exec(`
    create table public.relief_stocks (id uuid primary key default gen_random_uuid(), silo public.silo not null default 'EthekwiniDisaster',
      item_name text not null, category text, quantity int not null, unit_of_measure text, last_inventory_check timestamptz not null default now(),
      tenant_id uuid not null default public.current_tenant());
    alter table public.relief_stocks enable row level security;
    create policy relief_stocks_rw on public.relief_stocks for all
      using (silo = public.current_silo() and public.role_in('Disaster','Supervisor','SystemAdmin','SuperAdmin','Admin'))
      with check (silo = public.current_silo() and public.role_in('Disaster','Supervisor','SystemAdmin','SuperAdmin','Admin'));
    grant select, insert, update, delete on public.relief_stocks to authenticated;
    create table auth.users (id uuid primary key);
    insert into auth.users select id from public.profiles;
  `);
  for (const m of ['0115_disaster_joc.sql', '0116_disaster_warnings.sql', '0117_disaster_joc_activation.sql', '0118_disaster_relief.sql',
    '0119_disaster_records.sql', '0120_disaster_readiness.sql', '0121_guides_and_practice.sql']) {
    await db.exec(sql(m));
    await db.exec(sql(m)); // safe to re-run
  }
  await db.query('begin');

  await scenario('0115: the top ten risks lead, the 2012 names still count, the DOC Commander is the JOC Commander', async () => {
    assert.equal((await sql1("select public.disaster_hazard_group('Floods') as g")).g, 'Top ten priority risks');
    assert.equal((await sql1("select public.disaster_priority_risk('Storm tide') as r")).r, 'Storm surge');
    assert.equal((await sql1("select duty from public.disaster_duty where name = 'Nomsa Mthembu'")).duty, 'JOC Commander');
    const inc = await call(U.desk, 'open_disaster_incident($1, $2::jsonb)', [ref(),
      '{"short_title":"Umlazi floods","hazard":"Floods","severity":"High","location_address":"Umlazi","lat":-29.96,"lng":30.88,"first_report":"Homes flooded"}']);
    assert.ok(inc.id);
    await call(U.desk, 'open_disaster_incident($1, $2::jsonb)', [ref(),
      '{"short_title":"Old name","hazard":"Flood","location_address":"Isipingo","lat":-29.99,"lng":30.93,"first_report":"x"}']);
  });

  await scenario('0116: a warning taken through the steps, the JOC readiness session and an incident from it; only the desk', async () => {
    await refused(() => call(U.cop, 'record_disaster_warning($1, $2::jsonb)', [ref(), '{"hazard":"Disruptive rain","level":"4","valid_until":"2026-12-01 10:00","areas":"eThekwini"}']), /Only the Disaster desk/);
    const w = await call(U.desk, 'record_disaster_warning($1, $2::jsonb)', [ref(),
      '{"hazard":"Disruptive rain","level":"6","colour":"","valid_from":"2026-10-27 10:00","valid_until":"2026-10-28 10:00","areas":"eThekwini, Ndwedwe","impacts":"Flooding of roads"}']);
    assert.equal(w.colour, 'Orange');
    await refused(() => call(U.desk, 'record_disaster_warning($1, $2::jsonb)', [ref(), '{"hazard":"Volcano","level":"4","valid_until":"2026-12-01 10:00","areas":"x"}']), /hazard from the list/);
    assert.ok((await call(U.desk, 'set_warning_step($1, $2, $3)', [w.id, 'fews', true])).steps.fews);
    assert.equal((await call(U.desk, 'set_warning_colour($1, $2)', [w.id, 'Red'])).colour, 'Red');
    await refused(() => call(U.desk, 'hold_readiness_session($1, $2, $3::jsonb)', [w.id, ref(), '{}']), /what the JOC decided/);
    assert.equal((await call(U.desk, 'hold_readiness_session($1, $2, $3::jsonb)', [w.id, ref(), '{"outcome":"Respond"}'])).outcome, 'Respond');
    const inc = await call(U.desk, 'open_incident_from_warning($1, $2, $3::jsonb)', [w.id, ref(),
      '{"short_title":"Quarry Road flooding","hazard":"Floods","location_address":"Quarry Road","lat":-29.8,"lng":30.97,"first_report":"Water rising"}']);
    assert.equal((await sql1('select warning_id, reported_through from public.disaster_call_facts where incident_id = $1', [inc.id])).warning_id, w.id);
    assert.ok((await call(U.desk, 'log_warning_sms($1, $2, $3, $4)', [w.id, 180, 2, 'SA Weather Service: …'])).steps.sms_councillors);
    // No signed-in user writes the warnings directly, or passes one off as from SAWS.
    await as(U.desk);
    await refused(() => db.query("update public.disaster_warnings set level = 9"), /permission denied/);
    await refused(() => call(U.desk, 'ingest_saws_warning($1, $2::jsonb)', [T, '{"key":"k","file":"f","touches":true}']), /permission denied/);
  });

  await scenario('0116: SAWS files, read by the server only: a re-issue updates, a file twice changes nothing, a cancel cancels', async () => {
    const f = { key: 'KZN|Severe thunderstorms|2026-10-27T12:00:00+02:00', msg_type: 'Alert', touches: true, hazard: 'Severe thunderstorms', level: 2,
      valid_from: '2026-10-27T12:00:00+02:00', valid_until: '2026-10-27T22:59:59+02:00', areas: 'Ethekwini / King Shaka Airport' };
    const ingest = async (extra) => {
      await db.query('reset role');
      await db.query('set local role service_role');
      return (await db.query('select public.ingest_saws_warning($1, $2::jsonb) as id', [T, JSON.stringify({ ...f, ...extra })])).rows[0].id;
    };
    const id = await ingest({ file: 'KZN_CAP_SevereThunderstorms_1.xml' });
    await ingest({ file: 'KZN_CAP_SevereThunderstorms_2.xml', level: 5, msg_type: 'Update' });
    await ingest({ file: 'KZN_CAP_SevereThunderstorms_1.xml', level: 9 });
    const w = await sql1('select level, colour, status from public.disaster_warnings where id = $1', [id]);
    assert.deepEqual([w.level, w.colour, w.status], [5, 'Orange', 'Active']);
    await ingest({ file: 'KZN_CAP_SevereThunderstorms_3.xml', msg_type: 'Cancel' });
    assert.equal((await sql1('select status from public.disaster_warnings where id = $1', [id])).status, 'Cancelled');
  });

  await scenario('0116: councillors, a ward each, numbers checked, a spreadsheet counted; only the desk reads them', async () => {
    assert.equal((await call(U.desk, 'save_councillor($1, $2::jsonb)', [null, '{"ward":"Ward 23","name":"Sipho Ndlovu","phone":"082 123 4567"}'])).ward, 23);
    await refused(() => call(U.desk, 'save_councillor($1, $2::jsonb)', [null, '{"ward":"23","name":"Someone Else"}']), /already has a councillor/);
    const r = await call(U.desk, 'import_councillors($1::jsonb)', ['[{"ward":"23","name":"Sipho Ndlovu","phone":"082 123 9999"},{"ward":"5","name":"Lindiwe Zulu"},{"ward":"999","name":"Wrong Ward"}]']);
    assert.deepEqual(r.import_councillors, { added: 1, changed: 1, skipped: 1 });
    await as(U.cop);
    assert.equal((await db.query('select count(*)::int as n from public.disaster_councillors')).rows[0].n, 0, 'police do not read councillors’ numbers');
  });

  await scenario('0117: up a level needs a reason, Gold a listed authoriser; statuses, recovery hand-over and the review', async () => {
    const inc = await call(U.desk, 'open_disaster_incident($1, $2::jsonb)', [ref(),
      '{"short_title":"Inanda floods","hazard":"Floods","severity":"Critical","location_address":"Inanda","lat":-29.7,"lng":30.95,"first_report":"Homes flooded"}']);
    await refused(() => call(U.desk, 'escalate_incident($1, $2, $3::jsonb)', [inc.id, 'Silver', '{}']), /at least one reason/);
    await refused(() => call(U.desk, 'set_coordination_level($1, $2, $3)', [inc.id, 'Silver', null]), /at least one reason/);
    assert.equal((await call(U.desk, 'escalate_incident($1, $2, $3::jsonb)', [inc.id, 'Silver', '{"triggers":["s_unified"],"place":"Inanda Hall","commander":"Capt. Naidoo, Station 3"}'])).eoc_location, 'Inanda Hall');
    await refused(() => call(U.desk, 'escalate_incident($1, $2, $3::jsonb)', [inc.id, 'Gold', '{"triggers":["g_saws4"],"authoriser_role":"Dispatcher","authorised_by":"A B","reason":"r"}']), /listed roles/);
    const gold = await call(U.desk, 'escalate_incident($1, $2, $3::jsonb)', [inc.id, 'Gold',
      '{"triggers":["g_saws4","g_public"],"authoriser_role":"Principal Disaster Management Stand-by Officer","authorised_by":"Bheki Ngcobo","reason":"Level 6 rain"}']);
    assert.equal(gold.joc_authoriser_on_roster, true);
    assert.ok((await timeline()).some((m) => m.startsWith('[LEVEL] Raised to Gold (strategic): the JOC activated at the DOC')));
    await refused(() => call(U.cop, 'set_incident_check($1, $2, $3)', [inc.id, 'joc_core_team', true]), /Only the Disaster desk/);
    assert.ok((await call(U.desk, 'set_incident_check($1, $2, $3)', [inc.id, 'joc_core_team', true])).checks.joc_core_team);
    await refused(() => call(U.desk, 'set_dm_status($1, $2, $3::jsonb)', [inc.id, 'In recovery', '{"reason":"x"}']), /cannot go to in recovery directly/);
    await call(U.desk, 'set_dm_status($1, $2, $3::jsonb)', [inc.id, 'Stood down', '{"reason":"Response complete"}']);
    await call(U.desk, 'set_dm_status($1, $2, $3::jsonb)', [inc.id, 'In recovery', '{"reason":"Rebuilding"}']);
    await refused(() => call(U.desk, 'set_dm_status($1, $2, $3::jsonb)', [inc.id, 'Closed', '{"reason":"Done"}']), /handed over/);
    assert.equal((await call(U.desk, 'set_dm_status($1, $2, $3::jsonb)', [inc.id, 'Closed', '{"reason":"Handed over","handover":true}'])).dm_status, 'Closed');
    await refused(() => call(U.desk, 'sign_disaster_review($1, $2, $3)', [inc.id, 'shared', true]), /Write the review first/);
    await call(U.desk, 'save_disaster_review($1, $2::jsonb)', [inc.id, '{"lead_reviewer":"Sadha Govender","what_happened":"Floods in Inanda"}']);
    for (const k of ['shared', 'pdmc_ndmc', 'forum']) await call(U.desk, 'sign_disaster_review($1, $2, $3)', [inc.id, k, true]);
    assert.ok((await call(U.desk, 'sign_disaster_review($1, $2, $3)', [inc.id, 'director', true])).signed_off_at);
  });

  await scenario('0118: relief by ward (counts only), the vulnerable never more than the people; stock no longer written from the browser', async () => {
    const inc = await call(U.desk, 'open_disaster_incident($1, $2::jsonb)', [ref(),
      '{"short_title":"Shack fires","hazard":"Fires in formal and informal settlements","location_address":"Inanda","lat":-29.7,"lng":30.95,"first_report":"40 shacks"}']);
    await refused(() => call(U.desk, 'save_ward_relief($1, $2::jsonb)', [inc.id, '{"ward":"57","people":"10","disabled":"12"}']), /cannot be more/);
    const r = await call(U.desk, 'save_ward_relief($1, $2::jsonb)', [inc.id, '{"ward":"57","people":"160","households":"40","blankets":"160"}']);
    assert.equal(r.people, 160);
    assert.equal((await call(U.desk, 'set_relief_stock($1, $2, $3)', ['blankets', 450, 300])).minimum, 300);
    await as(U.dm);
    await refused(() => db.query("insert into public.relief_stocks (item_name, quantity) values ('x', 1)"), /permission denied/);
  });

  await scenario('0119 to 0121: past records loaded once, readiness kept, tours per account, practice private', async () => {
    const r = await call(U.desk, 'import_past_events($1, $2::jsonb)', ['SA Weather Service records',
      '[{"source_ref":"1","year":2024,"event":"Heavy rain","priority_risk":"Floods","ward":"13","deaths":"1"},{"source_ref":"2","year":"x","event":"Bad"}]']);
    assert.deepEqual(r.import_past_events, { loaded: 1, skipped: 1 });
    assert.equal((await call(U.desk, 'set_disaster_population($1, $2)', [4300000, 'Stats SA'])).population, 4300000);
    assert.equal((await call(U.desk, 'set_task_team_chair($1, $2, $3)', ['social_relief', 'Nomsa Dube', '082 555 1212'])).chair, 'Nomsa Dube');
    await refused(() => call(U.cop, 'set_framework_status($1, $2, $3)', ['2.1a', 'Achieved', null]), /Only the Disaster desk/);
    assert.equal((await call(U.desk, 'set_framework_status($1, $2, $3)', ['2.1a', 'Achieved', null])).status, 'Achieved');
    // A tour answer is the person's own.
    await call(U.desk, 'set_guide_status($1, $2)', ['disaster.tour', 'dismissed']);
    await as(U.dm);
    assert.equal((await db.query('select count(*)::int as n from public.user_guides')).rows[0].n, 0, 'nobody sees another’s tour answer');
    // A practice incident is its owner's alone and never a live call.
    const p = await call(U.dm, 'start_practice_incident($1::jsonb)', ['{"title":"Practice: flooding","hazard":"Floods","severity":"High","ward":"88"}']);
    await refused(() => call(U.dm, 'practice_step($1, $2, $3::jsonb)', [p.id, 'escalate', '{"to":"Silver"}']), /at least one reason/);
    assert.equal((await call(U.dm, 'practice_step($1, $2, $3::jsonb)', [p.id, 'escalate', '{"to":"Silver","triggers":["s_unified"]}'])).level, 'Silver');
    await refused(() => call(U.desk, 'practice_step($1, $2, $3::jsonb)', [p.id, 'update', '{"text":"not mine"}']), /not there any more/);
    assert.equal((await sql1("select count(*)::int as n from public.incidents where incident_type = 'Practice: flooding'")).n, 0);
  });

  await db.query('rollback');
  console.log(`\n${checks} scenarios passed; 0115 to 0121 applied twice over 0111 to 0114.`);
} finally {
  await db.close();
}
