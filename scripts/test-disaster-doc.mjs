/** Run the Disaster desk the eThekwini way (0112, over 0111) against
 * in-memory Postgres (PGlite): a call gets a short title, a hazard from the
 * Plan's list and its municipalities; Bronze, Silver and Gold are set by the
 * desk, Gold activating the DOC and the SCG, and the highest level is kept;
 * private companies leave the partner list, the public list arrives with
 * whether each number is checked, and only an administrator changes it;
 * shelters are registered, opened for a call, filled and emptied with the
 * relief given, and closed only when empty; Disaster's own officers are
 * called out by the desk, which files their assessment for them; the duty
 * roster and the SCG duty chair; the post-mortem takes the title, hazard,
 * level, municipalities, call-outs and shelters from the record; and no
 * table takes a write except through the functions.
 *
 * CASE_PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node scripts/test-disaster-doc.mjs
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
    create table public.incidents (id uuid primary key, tenant_id uuid default '${T}', silo public.silo, incident_number text,
      status public.incident_status, unit_status text, dispatched_silos public.silo[], tagged_silos public.silo[],
      accepted_by uuid, accepted_at timestamptz, assigned_to uuid, assigned_to_name text, report_filed_at timestamptz,
      unit_id uuid, responding_officer text, dispatch_time timestamptz, arrived_timestamp timestamptz, resolved_at timestamptz,
      resolved_by uuid, disaster_type text, incident_type text, location_address text, updated_at timestamptz);
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
    create table public.audit_logs (tenant_id uuid, silo public.silo, user_id uuid, user_name text, department text, action_type text,
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
  await db.query('begin');

  await scenario('the partner list is public: private companies off, the public list on, each saying if its number is checked', async () => {
    assert.equal((await partner('ER24 Ambulance')).is_active, false);
    assert.equal((await partner('Netcare Umhlanga (Private)')).is_active, false);
    const eskom = await partner('Eskom KZN Control Center');
    assert.equal(eskom.contact_number, '08600 37566');
    assert.equal(eskom.verified, true);
    assert.equal((await partner('Amanzimtoti Fire Station')).verified, false);
    const emacc = await partner('EMACC (Emergency Mobilizing and Communications Centre)');
    assert.equal(emacc.contact_number, '031 361 0000');
    assert.equal(emacc.sector, 'eThekwini');
    assert.equal((await partner('iLembe Disaster Management Centre')).contact_number, '032 437 9319');
    assert.equal((await sql1("select count(*)::int as n from public.mutual_aid_partners where agency_name = 'Eskom KZN Control Center'")).n, 1);
    // Only through the function, and only by an administrator or command.
    await as(U.admin);
    await refused(() => db.query("update public.mutual_aid_partners set contact_number = 'x'"), /permission denied/);
    await refused(() => call(U.desk, 'save_mutual_aid_partner($1, $2::jsonb)', [null, '{"agency_name":"X","resource_type":"Y"}']), /role/);
    await refused(() => call(U.admin, 'save_mutual_aid_partner($1, $2::jsonb)', [null, '{"agency_name":"eskom kzn control center","resource_type":"Utilities"}']), /already on the list/);
    // Each partner once, for the organisation that keeps the list.
    assert.equal((await sql1("select count(distinct tenant_id)::int as n from public.mutual_aid_partners")).n, 1);
    const fixed = await call(U.admin, 'save_mutual_aid_partner($1, $2::jsonb)', [(await partner('Amanzimtoti Fire Station')).id,
      JSON.stringify({ agency_name: 'Amanzimtoti Fire Station', resource_type: 'Fire Stations', contact_number: '031 361 0000', verified: true })]);
    assert.equal(fixed.verified, true);
    assert.equal(fixed.contact_number, '031 361 0000');
  });

  await scenario('a short title, a hazard from the Plan, the municipalities affected', async () => {
    const f = await call(U.desk, 'set_disaster_call($1, $2::jsonb)', [CALL, JSON.stringify({
      short_title: 'Isipingo transformer fire', hazard: 'Failure of critical infrastructure or services',
      municipalities: ['Ugu', 'eThekwini Metro', 'Atlantis'], fcp_location: 'Corner of Main and 3rd' })]);
    assert.equal(f.short_title, 'Isipingo transformer fire');
    assert.equal(f.level, 'Bronze');
    assert.deepEqual(f.municipalities, ['eThekwini Metro', 'Ugu']);
    await refused(() => call(U.desk, 'set_disaster_call($1, $2::jsonb)', [CALL, '{"hazard":"Alien invasion"}']), /from the list/);
    await refused(() => call(U.desk, 'set_disaster_call($1, $2::jsonb)', [CALL, '{"municipalities":[]}']), /at least one/);
    await refused(() => call(U.cop, 'set_disaster_call($1, $2::jsonb)', [CALL, '{"short_title":"x"}']), /Only the Disaster desk/);
    assert.match((await timeline()).at(-1), /^\[DETAILS\] title "Isipingo transformer fire"; hazard Failure of critical/);
  });

  await scenario('Bronze, Silver, Gold: Gold activates the DOC and the SCG; the highest level is kept', async () => {
    await call(U.desk, 'set_coordination_level($1, $2, $3)', [CALL, 'Silver', 'EOC at the substation']);
    const gold = await call(U.sup, 'set_coordination_level($1, $2, $3)', [CALL, 'Gold', null]);
    assert.ok(gold.doc_activated_at && gold.scg_convened_at);
    const down = await call(U.desk, 'set_coordination_level($1, $2, $3)', [CALL, 'Silver', null]);
    assert.equal(down.level, 'Silver');
    assert.equal(down.highest_level, 'Gold');
    const tl = await timeline();
    assert.ok(tl.some((m) => /^\[LEVEL\] Raised to Silver \(operations\): joint EOC on site: EOC at the substation/.test(m)));
    assert.ok(tl.some((m) => /^\[LEVEL\] Raised to Gold \(strategic\): DOC activated and SCG called into session/.test(m)));
    assert.ok(tl.some((m) => /^\[LEVEL\] Stood down to Silver/.test(m)));
    assert.equal((await rows("select * from public.chain where title like '%DOC activated%'")).length, 1);
    await refused(() => call(U.desk, 'set_coordination_level($1, $2, $3)', [CALL, 'Platinum', null]), /Bronze, Silver or Gold/);
  });

  await scenario('shelters: registered, opened, filled and emptied with the relief, closed only when empty', async () => {
    await refused(() => call(U.desk, 'save_disaster_shelter($1, $2::jsonb)', [null, '{"name":""}']), /Name the hall/);
    const hall = await call(U.desk, 'save_disaster_shelter($1, $2::jsonb)', [null, JSON.stringify({
      name: 'Isipingo Community Hall', kind: 'Community hall', ward: '88', capacity: 150, key_holder: 'Mr Naidoo', key_holder_phone: '082 555 0101' })]);
    assert.equal(hall.capacity, 150);
    const r = ref();
    const open = await call(U.desk, 'open_disaster_shelter($1, $2, $3, $4::jsonb)', [CALL, hall.id, r, '{"people":40,"households":12}']);
    assert.equal(open.people_now, 40);
    assert.equal((await call(U.desk, 'open_disaster_shelter($1, $2, $3, $4::jsonb)', [CALL, hall.id, ref(), '{}'])).id, open.id);
    const more = await call(U.desk, 'update_disaster_shelter($1, $2, $3::jsonb)', [open.id, ref(), JSON.stringify({
      arrived: 60, children: 35, elderly: 8, relief: { hot_meals: 100, blankets: 100, nonsense: 5 }, note: 'Red Cross on site' })]);
    assert.equal(more.people_now, 100);
    assert.equal(more.peak_people, 100);
    assert.deepEqual(more.relief, { hot_meals: 100, blankets: 100 });
    await refused(() => call(U.desk, 'update_disaster_shelter($1, $2, $3::jsonb)', [open.id, ref(), '{"left":101}']), /Only 100 people/);
    await refused(() => call(U.desk, 'close_disaster_shelter($1, $2)', [open.id, null]), /100 people are still there/);
    const r2 = ref();
    const out = await call(U.desk, 'update_disaster_shelter($1, $2, $3::jsonb)', [open.id, r2, '{"left":100,"relief":{"blankets":20}}']);
    assert.equal(out.people_now, 0);
    assert.equal(out.peak_people, 100);
    assert.deepEqual(out.relief, { hot_meals: 100, blankets: 120 });
    assert.equal((await call(U.desk, 'update_disaster_shelter($1, $2, $3::jsonb)', [open.id, r2, '{"left":100}'])).people_now, 0);
    const closed = await call(U.desk, 'close_disaster_shelter($1, $2)', [open.id, 'Families moved to TRUs']);
    assert.ok(closed.closed_at);
    const kinds = (await rows('select kind from public.disaster_shelter_entries order by logged_at, kind')).map((x) => x.kind);
    assert.deepEqual(kinds.sort(), ['Arrived', 'Closed', 'Left', 'Opened', 'Relief', 'Relief']);
    assert.ok((await timeline()).some((m) => m.startsWith('[SHELTER] Isipingo Community Hall: 60 arrived; 100 blankets, 100 hot meals: Red Cross on site — 100 people there now')));
    await refused(() => db.query('delete from public.disaster_shelter_entries'), /stays on record/);
  });

  await scenario("Disaster's own officers: called out by the desk, their assessment filed for them", async () => {
    const c = await call(U.desk, 'disaster_call_out($1, $2, $3::jsonb)', [CALL, ref(), JSON.stringify({ officer_id: OFFICER, how: 'Call' })]);
    assert.equal(c.agency_name, 'Senior DMO Sipho Zulu');
    assert.equal(c.contact_number, '+27821112222');
    assert.equal(c.resource_type, 'Disaster Management officer');
    assert.equal((await call(U.desk, 'disaster_call_out($1, $2, $3::jsonb)', [CALL, ref(), JSON.stringify({ officer_id: OFFICER, how: 'Radio' })])).id, c.id);
    await refused(() => call(U.desk, 'disaster_call_out($1, $2, $3::jsonb)', [CALL, ref(), JSON.stringify({ officer_id: id(41), how: 'Call' })]), /not in Disaster Management/);
    const a = await call(U.desk, 'file_disaster_assessment($1, $2, $3::jsonb)', [CALL, ref(), JSON.stringify({
      place: 'Isipingo Hills, block C', hazard: 'Fire', households_affected: 30, people_displaced: 96, homes_destroyed: 6, reported_by: 'Senior DMO Sipho Zulu' })]);
    assert.equal(a.reported_by_name, 'Senior DMO Sipho Zulu');
    assert.ok((await timeline()).some((m) => /^\[ASSESSMENT\] Isipingo Hills, block C: 30 households .* — Senior DMO Sipho Zulu, filed from the desk by Nomsa Metro$/.test(m)));
  });

  await scenario('the duty roster and the SCG duty chair', async () => {
    const d = await call(U.desk, 'save_disaster_duty($1, $2::jsonb)', [null, JSON.stringify({
      personnel_id: OFFICER, duty: 'Principal Disaster Management Stand-by Officer', status: 'On standby',
      starts_at: '2026-10-26 07:00', ends_at: '2026-11-02 07:00' })]);
    assert.equal(d.name, 'Senior DMO Sipho Zulu');
    assert.equal(d.phone, '+27821112222');
    await refused(() => call(U.desk, 'save_disaster_duty($1, $2::jsonb)', [null, JSON.stringify({ name: 'X', duty: 'Chef', status: 'On duty',
      starts_at: '2026-10-26 07:00', ends_at: '2026-10-26 19:00' })]), /duty from the list/);
    await refused(() => call(U.desk, 'save_disaster_duty($1, $2::jsonb)', [null, JSON.stringify({ name: 'X', duty: 'MDMC Duty Officer', status: 'On duty',
      starts_at: '2026-10-26 07:00', ends_at: '2026-12-26 07:00' })]), /a month at most/);
    await refused(() => call(U.desk, 'save_disaster_duty($1, $2::jsonb)', [null, JSON.stringify({ personnel_id: id(41), duty: 'MDMC Duty Officer',
      status: 'On duty', starts_at: '2026-10-26 07:00', ends_at: '2026-10-26 19:00' })]), /not in Disaster Management/);
    const ended = await call(U.desk, 'end_disaster_duty($1)', [d.id]);
    assert.ok(new Date(ended.ends_at) <= new Date(Date.now() + 1000));
    const chair = await call(U.desk, 'set_scg_chair($1, $2, $3, $4)', [2026, 10, 'Deputy City Manager: Community and Emergency Services', '031 311 0000']);
    assert.equal(chair.name, 'Deputy City Manager: Community and Emergency Services');
    assert.equal((await call(U.desk, 'set_scg_chair($1, $2, $3, $4)', [2026, 10, 'City Manager', null])).name, 'City Manager');
    await refused(() => call(U.cop, 'set_scg_chair($1, $2, $3, $4)', [2026, 11, 'X', null]), /Only the Disaster desk/);
  });

  await scenario('the post-mortem takes the call from the record', async () => {
    await call(U.desk, 'set_disaster_call($1, $2::jsonb)', [CALL, JSON.stringify({ short_title: 'Isipingo transformer fire',
      hazard: 'Structure or informal settlement fire', municipalities: ['eThekwini Metro'] })]);
    await call(U.desk, 'set_coordination_level($1, $2, $3)', [CALL, 'Gold', null]);
    const eskom = await partner('Eskom KZN Control Center');
    const c = await call(U.desk, 'disaster_call_out($1, $2, $3::jsonb)', [CALL, ref(), JSON.stringify({ partner_id: eskom.id, how: 'Call' })]);
    await call(U.desk, 'set_callout_status($1, $2, $3::jsonb)', [c.id, 'On scene', '{}']);
    const hall = await call(U.desk, 'save_disaster_shelter($1, $2::jsonb)', [null, '{"name":"Isipingo Community Hall","capacity":150}']);
    await call(U.desk, 'open_disaster_shelter($1, $2, $3, $4::jsonb)', [CALL, hall.id, ref(), '{"people":96}']);
    await refused(() => call(U.desk, 'file_post_mortem($1, $2::jsonb)', [CALL, JSON.stringify({ ...REPORT, homes_destroyed: 'six' })]), /whole numbers/);
    const pm = await call(U.desk, 'file_post_mortem($1, $2::jsonb)', [CALL, JSON.stringify({ ...REPORT, local_disaster_recommended: true })]);
    assert.equal(pm.short_title, 'Isipingo transformer fire');
    assert.equal(pm.hazard, 'Structure or informal settlement fire');
    assert.equal(pm.coordination_level, 'Gold');
    assert.deepEqual(pm.municipalities, ['eThekwini Metro']);
    assert.equal(pm.doc_activated, true);
    assert.equal(pm.scg_convened, true);
    assert.equal(pm.local_disaster_recommended, true);
    assert.equal(pm.homes_destroyed, 6);
    assert.equal(pm.people_sheltered, 96);
    assert.equal(pm.response.callouts[0].name, 'Eskom KZN Control Center');
    assert.equal(pm.response.shelters[0].name, 'Isipingo Community Hall');
    assert.equal(pm.response.shelters[0].peak, 96);
    assert.equal((await sql1('select status from public.incidents where id = $1', [CALL])).status, 'Resolved');
  });

  await scenario('no table takes a write except through the functions; anonymous users get nothing', async () => {
    await as(U.desk);
    for (const t of ['disaster_call_facts', 'disaster_shelters', 'disaster_shelter_openings', 'disaster_shelter_entries', 'disaster_duty', 'disaster_scg_chairs']) {
      await refused(() => db.query(`delete from public.${t}`), /permission denied/);
    }
    await refused(() => db.query('select public.disaster_facts_for(i) from public.incidents i'), /permission denied/);
    await db.query('reset role');
    await db.query('set local role anon');
    for (const f of ["set_coordination_level(null, 'Gold')", 'set_disaster_call(null, null)', 'save_disaster_shelter(null, null)',
      'open_disaster_shelter(null, null, null, null)', 'save_disaster_duty(null, null)', 'set_scg_chair(2026, 1, null)',
      'save_mutual_aid_partner(null, null)']) {
      await refused(() => db.query(`select public.${f}`), /permission denied/);
    }
  });

  await db.query('rollback');
  console.log(`\n${checks} scenarios passed; 0112 applied twice over 0111.`);
} finally {
  await db.close();
}
