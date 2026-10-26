/** Run the Disaster desk (0111) against in-memory Postgres (PGlite): only
 * the Disaster desk calls partners out, on calls sent to Disaster; the
 * first call-out dispatches Disaster's part and the first partner on scene
 * puts it on scene, as the desk; a partner is called out once while still
 * working the call; progress only goes forward; updates say how they came in
 * and from whom, go on the call's timeline and never change; Criti's notes
 * are saved once a minute per reading; the desk files the post-mortem itself
 * once it has called a partner out, which stands the partners down; and no
 * table takes a write except through the functions.
 *
 * CASE_PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node scripts/test-disaster-desk.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.CASE_PGLITE_MODULE || '@electric-sql/pglite');

const migration = readFileSync(new URL('../supabase/migrations/0111_disaster_desk.sql', import.meta.url), 'utf8');
const db = new PGlite();
let checks = 0;

const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = '20000000-0000-4000-8000-000000000001';
const U = { desk: id(1), control: id(2), cop: id(3), dm: id(4), sup: id(5) };
const CALL = id(100);
const FIRE_ONLY = id(101);
const P = { eskom: id(300), toti: id(301), sassa: id(302), gone: id(303) };
let refs = 500;
const ref = () => id(refs++);

const WHO = {
  [U.desk]: ['Dispatcher', 'EthekwiniDisaster'], [U.control]: ['Dispatcher', 'Ethekwini'], [U.cop]: ['Dispatcher', 'MetroPolice'],
  [U.dm]: ['Disaster', 'EthekwiniDisaster'], [U.sup]: ['Supervisor', 'EthekwiniDisaster'],
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
const callOut = (uid, fields, clientRef = ref(), call = CALL) =>
  as(uid).then(() => db.query('select * from public.disaster_call_out($1, $2, $3::jsonb)', [call, clientRef, JSON.stringify(fields)])).then(one);
const progress = (uid, callout, status, fields = {}) =>
  as(uid).then(() => db.query('select * from public.set_callout_status($1, $2, $3::jsonb)', [callout, status, JSON.stringify(fields)])).then(one);
const update = (uid, fields, clientRef = ref()) =>
  as(uid).then(() => db.query('select * from public.log_disaster_update($1, $2, $3::jsonb)', [CALL, clientRef, JSON.stringify(fields)])).then(one);
const brief = (uid, marker, body) =>
  as(uid).then(() => db.query('select * from public.save_disaster_ai_brief($1, $2, $3, $4::jsonb)', [CALL, 'gemini', marker, JSON.stringify(body)])).then(one);
const postMortem = (uid, fields) =>
  as(uid).then(() => db.query('select * from public.file_post_mortem($1, $2::jsonb)', [CALL, JSON.stringify(fields)])).then(one);
const sql1 = async (q, a = []) => { await db.query('reset role'); return one(await db.query(q, a)); };
const timeline = async () => { await db.query('reset role'); return (await db.query('select message from public.incident_updates order by seq')).rows.map((r) => r.message); };
const part = () => sql1("select * from public.incident_departments where incident_id = $1 and silo = 'EthekwiniDisaster'", [CALL]);
const call = () => sql1('select * from public.incidents where id = $1', [CALL]);
const REPORT = { start_time: '2026-10-26 08:00', end_time: '2026-10-26 09:30', injuries: 2, fatalities: 0, displaced_people: 96,
  root_cause: 'Overloaded transformer caught fire', lessons_learned: 'Call Eskom first on electrical fires', reporting_officer: 'N. Metro' };

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
    create table public.profiles (id uuid primary key, full_name text, role text, silo public.silo, deactivated_at timestamptz);
    create table public.personnel (id uuid primary key default gen_random_uuid(), user_id uuid, tenant_id uuid default '${T}');
    -- 0073's, as written.
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
    create table public.incident_responders (incident_id uuid, user_id uuid, unit_id uuid);
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
    -- 0073's, as written.
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
    create table public.mutual_aid_partners (id uuid primary key, tenant_id uuid default '${T}', silo public.silo default 'EthekwiniDisaster',
      agency_name text, resource_type text, contact_number text, radio_frequency text, commander_name text, is_active boolean default true);
    create table public.post_mortem_reports (id uuid primary key default gen_random_uuid(), tenant_id uuid, silo public.silo,
      incident_id uuid, incident_number text, report_number text, filed_by uuid, incident_type text, location text,
      start_time timestamptz, end_time timestamptz, total_duration_hours numeric, injuries int, fatalities int,
      displaced_people int, root_cause text, lessons_learned text, timeline_snapshot jsonb, reporting_officer text,
      report_filed_at timestamptz);
    create table public.disaster_logs (incident_id uuid, updates jsonb);
    create table public.incident_updates (seq bigint generated always as identity, silo public.silo, incident_id uuid, message text,
      created_by uuid, created_by_name text, timestamp timestamptz default now());
    create table public.audit_logs (tenant_id uuid, silo public.silo, user_id uuid, user_name text, department text, action_type text,
      entity_type text, entity_id text, details text);
    create table public.chain (kind text, title text, body text);
    create function public.notify_incident_chain(i public.incidents, k text, t text, b text) returns integer language sql as $$
      insert into public.chain values (k, t, b); select 1 $$;
    grant usage on schema public, auth to authenticated, anon;
    grant select on public.profiles, public.incidents, public.mutual_aid_partners to authenticated;
    insert into public.profiles values ('${U.desk}', 'Nomsa Metro', 'Dispatcher', 'EthekwiniDisaster', null),
      ('${U.control}', 'Ravi Pillay', 'Dispatcher', 'Ethekwini', null), ('${U.cop}', 'Const. Dube', 'Dispatcher', 'MetroPolice', null),
      ('${U.dm}', 'Thandi Mkhize', 'Disaster', 'EthekwiniDisaster', null), ('${U.sup}', 'Mr Khumalo', 'Supervisor', 'EthekwiniDisaster', null);
    insert into public.mutual_aid_partners (id, agency_name, resource_type, contact_number, radio_frequency, is_active) values
      ('${P.eskom}', 'Eskom KZN Control Center', 'Utilities', '0860 037 566', 'National Grid Ops', true),
      ('${P.toti}', 'Amanzimtoti Fire Station', 'Fire Stations', '031 311 5880', 'Fire Tac 4', true),
      ('${P.sassa}', 'SASSA (Relief Funds/Grants)', 'Government', '033 846 3300', 'Mobile Cell', true),
      ('${P.gone}', 'Old partner', 'Other', null, null, false);
    insert into public.incidents (id, silo, incident_number, status, dispatched_silos, tagged_silos, incident_type, location_address) values
      ('${CALL}', 'Ethekwini', 'ETK-ED-20261026-0800-0001', 'Pending Dispatch', '{}', '{EthekwiniDisaster}', 'Electrical fire', 'Isipingo Hills'),
      ('${FIRE_ONLY}', 'MetroFire', 'ETK-MF-20261026-0800-0002', 'Pending Dispatch', '{MetroFire}', '{MetroFire}', 'Fire', 'Umlazi');
  `);
  await db.exec(migration);
  await db.exec(migration); // safe to re-run
  await db.query('begin');

  await scenario('only the Disaster desk calls partners out, and only on calls sent to Disaster', async () => {
    await refused(() => callOut(U.cop, { partner_id: P.eskom, how: 'Call' }), /Only the Disaster desk/);
    await refused(() => callOut(U.desk, { partner_id: P.eskom, how: 'Call' }, ref(), FIRE_ONLY), /not sent to Disaster/);
    await refused(() => callOut(U.desk, { partner_id: P.eskom, how: 'Pigeon' }), /call, radio, WhatsApp or other/);
    await refused(() => callOut(U.desk, { partner_id: P.gone, how: 'Call' }), /not in the directory/);
    await refused(() => callOut(U.desk, { how: 'Call' }), /Choose who you called out/);
    await refused(() => callOut(U.desk, { partner_id: P.eskom, how: 'Call', eta_minutes: 'soon' }), /in minutes/);
    await refused(() => callOut(U.desk, { partner_id: P.eskom, how: 'Call', eta_minutes: 5000 }), /in minutes/);
  });

  await scenario('the first call-out dispatches Disaster; on the timeline and the audit log; called once', async () => {
    const r = ref();
    const c = await callOut(U.desk, { partner_id: P.eskom, how: 'Call', eta_minutes: 25, reason: 'Transformer on fire', suggested_by_ai: true }, r);
    assert.equal(c.agency_name, 'Eskom KZN Control Center');
    assert.equal(c.contact_number, '0860 037 566');
    assert.equal(c.status, 'Called');
    assert.equal(c.suggested_by_ai, true);
    assert.equal((await part()).status, 'Dispatched');
    assert.equal((await part()).dispatched_by_name, 'Nomsa Metro');
    const inc = await call();
    assert.equal(inc.status, 'Dispatched');
    assert.deepEqual(inc.dispatched_silos, '{EthekwiniDisaster}');
    assert.ok(inc.dispatch_time);
    assert.match((await timeline())[0], /^\[CALL-OUT\] Eskom KZN Control Center called out by phone, expected in 25 min: Transformer on fire — Nomsa Metro$/);
    const audit = await sql1("select * from public.audit_logs where action_type = 'DISASTER_CALL_OUT'");
    assert.match(audit.details, /suggested by Criti/);
    // A replay, or the same partner again while still on the call: the same call-out.
    assert.equal((await callOut(U.desk, { partner_id: P.eskom, how: 'Call' }, r)).id, c.id);
    assert.equal((await callOut(U.control, { partner_id: P.eskom, how: 'Radio' })).id, c.id);
    // Someone not in the directory, by name; and the central control room works the desk too.
    const other = await callOut(U.control, { agency_name: 'Isipingo ward councillor', how: 'WhatsApp', contact_number: '082 111 2222' });
    assert.equal(other.partner_id, null);
    assert.equal(other.how, 'WhatsApp');
    assert.equal((await sql1('select count(*)::int as n from public.disaster_callouts')).n, 2);
  });

  await scenario('progress goes forward; the first partner on scene puts Disaster on scene, as the desk', async () => {
    const eskom = await callOut(U.desk, { partner_id: P.eskom, how: 'Call' });
    const toti = await callOut(U.dm, { partner_id: P.toti, how: 'Radio' });
    await refused(() => progress(U.desk, toti.id, 'Left scene'), /on scene first/);
    await refused(() => progress(U.desk, toti.id, 'Arrived'), /Choose On the way/);
    await refused(() => progress(U.cop, toti.id, 'On the way'), /Only the Disaster desk/);
    const way = await progress(U.desk, toti.id, 'On the way', { eta_minutes: 12, how: 'Radio' });
    assert.equal(way.eta_minutes, 12);
    assert.ok(way.on_way_at);
    const there = await progress(U.desk, toti.id, 'On scene', { how: 'Radio', note: 'Two engines, attacking the fire' });
    assert.ok(there.on_scene_at);
    const p = await part();
    assert.equal(p.status, 'On Scene');
    assert.equal(p.arrived_by, 'desk');
    assert.equal((await call()).status, 'On Scene');
    assert.ok((await call()).arrived_timestamp);
    // Backward is a no-op; the call does not slip back.
    assert.equal((await progress(U.desk, toti.id, 'On the way')).status, 'On scene');
    assert.equal((await progress(U.desk, eskom.id, 'On scene')).status, 'On scene');
    assert.equal((await part()).status, 'On Scene');
    const left = await progress(U.desk, toti.id, 'Left scene', { how: 'Call', note: 'Fire out' });
    assert.ok(left.left_at);
    await refused(() => progress(U.desk, toti.id, 'On scene'), /already left the scene/);
    assert.equal((await progress(U.desk, toti.id, 'Left scene')).status, 'Left scene');
    // Left: the same partner can be called out again.
    const again = await callOut(U.desk, { partner_id: P.toti, how: 'Call', reason: 'Flare-up' });
    assert.notEqual(again.id, toti.id);
    const tl = await timeline();
    assert.ok(tl.some((m) => m === '[PARTNER] Amanzimtoti Fire Station: on the way, about 12 min away (by radio) — Nomsa Metro'));
    assert.ok(tl.some((m) => m === '[PARTNER] Amanzimtoti Fire Station: left scene (by phone): Fire out — Nomsa Metro'));
  });

  await scenario('updates say how they came in and from whom, go on the timeline and never change', async () => {
    const toti = await callOut(U.desk, { partner_id: P.toti, how: 'Radio' });
    await refused(() => update(U.desk, { source: 'Telepathy', text: 'x' }), /call, radio, WhatsApp or other/);
    await refused(() => update(U.desk, { source: 'Radio', text: '  ' }), /Write what they said/);
    await refused(() => update(U.desk, { source: 'Radio', text: 'x'.repeat(2001) }), /under 2000/);
    await refused(() => update(U.cop, { source: 'Radio', text: 'Hello' }), /Only the Disaster desk/);
    const r = ref();
    const u = await update(U.desk, { source: 'Radio', callout_id: toti.id, from_name: 'ignored', text: '30 homes affected, 6 burning' }, r);
    assert.equal(u.from_name, 'Amanzimtoti Fire Station');
    assert.equal((await update(U.desk, { source: 'Radio', text: 'again' }, r)).id, u.id);
    const w = await update(U.dm, { source: 'WhatsApp', from_name: 'Ward councillor', text: 'Community hall open for families' });
    assert.equal(w.from_name, 'Ward councillor');
    const tl = await timeline();
    assert.ok(tl.includes('[UPDATE · Radio · Amanzimtoti Fire Station] 30 homes affected, 6 burning — logged by Nomsa Metro'));
    assert.ok(tl.includes('[UPDATE · WhatsApp · Ward councillor] Community hall open for families — logged by Thandi Mkhize'));
    await refused(() => db.query('update public.disaster_desk_updates set text = $1', ['changed']), /cannot be changed/);
    await refused(() => db.query('delete from public.disaster_desk_updates'), /cannot be changed/);
    await refused(() => db.query('delete from public.disaster_callouts'), /stays on record/);
  });

  await scenario("Criti's notes: saved once a minute per reading, the desk's only, the right shape", async () => {
    const a = await brief(U.desk, '3u-2c', { summary: 'Electrical fire', callouts: [] });
    assert.equal((await brief(U.control, '3u-2c', { summary: 'again' })).id, a.id);
    const b = await brief(U.desk, '4u-2c', { summary: 'Fire spreading' });
    assert.notEqual(b.id, a.id);
    await refused(() => brief(U.cop, '5u', { summary: 'x' }), /Only the Disaster desk/);
    await refused(() => as(U.desk).then(() => db.query("select public.save_disaster_ai_brief($1, 'grok', 'x', '[1,2]'::jsonb)", [CALL])), /expected shape/);
  });

  await scenario('the desk files the post-mortem itself once it has called a partner out; the partners stand down', async () => {
    await refused(() => postMortem(U.desk, REPORT), /Call a partner out to ETK-ED-20261026-0800-0001 before/);
    const eskom = await callOut(U.desk, { partner_id: P.eskom, how: 'Call' });
    const toti = await callOut(U.desk, { partner_id: P.toti, how: 'Radio' });
    await progress(U.desk, toti.id, 'On scene');
    await refused(() => postMortem(U.cop, REPORT), /role|Only Disaster Management/);
    await refused(() => postMortem(U.desk, { ...REPORT, root_cause: '' }), /Root Cause/);
    const pm = await postMortem(U.desk, REPORT);
    assert.equal(pm.report_number, 'PM-ETK-ED-20261026-0800-0001');
    assert.equal(pm.displaced_people, 96);
    assert.equal((await call()).status, 'Resolved');
    const after = (await db.query('select agency_name, status from public.disaster_callouts order by called_at, agency_name')).rows;
    assert.deepEqual(after.map((r) => [r.agency_name, r.status]).sort(), [
      ['Amanzimtoti Fire Station', 'Left scene'], ['Eskom KZN Control Center', 'Stood down']]);
    assert.equal((await sql1("select count(*)::int as n from public.audit_logs where details like '%from the Disaster desk%'")).n, 1);
    // Filed: no more call-outs or updates on it.
    await refused(() => callOut(U.desk, { partner_id: P.sassa, how: 'Call' }), /already resolved/);
    void eskom;
  });

  await scenario('the tables take no writes except through the functions; anonymous users get nothing', async () => {
    await as(U.desk);
    await refused(() => db.query("insert into public.disaster_callouts (incident_id, agency_name, how) values ($1, 'X', 'Call')", [CALL]), /permission denied/);
    await refused(() => db.query("insert into public.disaster_desk_updates (incident_id, source, text) values ($1, 'Call', 'X')", [CALL]), /permission denied/);
    await refused(() => db.query("insert into public.disaster_ai_briefs (incident_id, brief) values ($1, '{}')", [CALL]), /permission denied/);
    await refused(() => db.query('select public.disaster_desk_incident($1)', [CALL]), /permission denied/);
    await db.query('reset role');
    await db.query('set local role anon');
    for (const f of ['disaster_call_out(null, null, null)', 'log_disaster_update(null, null, null)', "set_callout_status(null, 'On scene')",
      'save_disaster_ai_brief(null, null, null, null)', 'file_post_mortem(null, null)']) {
      await refused(() => db.query(`select public.${f}`), /permission denied/);
    }
    await refused(() => db.query('select * from public.disaster_callouts'), /permission denied/);
  });

  await db.query('rollback');
  console.log(`\n${checks} scenarios passed; 0111 applied twice.`);
} finally {
  await db.close();
}
