/** Run Disaster Management on standby and the assessment on site (0107)
 * against in-memory Postgres (PGlite): standby needs today's readiness, a
 * number the call centre can dial and the kit answered (a No is recorded, not
 * refused); the register follows the duty switch; standby lasts a week while
 * the other services' duty lasts a shift; an officer leading a call-out stays
 * on standby; and an assessment is filed on site only, checked, put on the
 * timeline, told to dispatch, never filed twice and never changed.
 *
 * CASE_PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node scripts/test-disaster-standby.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.CASE_PGLITE_MODULE || '@electric-sql/pglite');

const migration = readFileSync(new URL('../supabase/migrations/0107_disaster_standby.sql', import.meta.url), 'utf8');
const db = new PGlite();
let checks = 0;

const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = '20000000-0000-4000-8000-000000000001';
const U = { dm: id(1), dm2: id(2), sup: id(3), cop: id(4), desk: id(5) };
const CALL = id(100);
const FIRE_ONLY = id(101);
let refs = 200;
const ref = () => id(refs++);
const KIT = { phone: true, vest: true, rain_gear: true, torch: true, id_card: true, transport: true };

async function as(uid, role = 'Disaster', silo = 'EthekwiniDisaster') {
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
const ready = (uid) => db.query("insert into public.ready values ($1)", [uid]);
const start = (uid, fields) => as(uid).then(() => db.query('select * from public.start_standby($1::jsonb)', [JSON.stringify(fields)])).then((r) => r.rows[0]);
const end = (uid, reason = null) => as(uid).then(() => db.query('select * from public.end_standby($1)', [reason])).then((r) => r.rows[0]);
const register = async () => { await db.query('reset role'); return (await db.query('select * from public.disaster_standby order by started_at, id')).rows; };
const onDuty = async (uid) => { await db.query('reset role'); return (await db.query('select is_on_duty from public.personnel where user_id = $1', [uid])).rows[0].is_on_duty; };
const assess = (uid, fields, clientRef = ref(), role = 'Disaster', call = CALL) =>
  as(uid, role).then(() => db.query('select * from public.file_disaster_assessment($1, $2, $3::jsonb)', [call, clientRef, JSON.stringify(fields)])).then((r) => r.rows[0]);
const timeline = async () => { await db.query('reset role'); return (await db.query('select message from public.incident_updates order by seq')).rows.map((r) => r.message); };
const arrive = (uid) => db.query("insert into public.incident_responders (incident_id, user_id, status, arrived_at) values ($1, $2, 'On Scene', now())", [CALL, uid]);
const place = { place: 'Quarry Road settlement', ward: '25', hazard: 'Flooding', households_affected: 40, people_affected: 160, people_displaced: 120,
  homes_destroyed: 12, homes_damaged: 28, relief: { blankets: 120, food_parcels: 40, nonsense: 9 }, services: ['Electricity', 'Spaceships'],
  needs: ['Food', 'Shelter'], shelter_name: 'Kennedy Road Community Hall', people_sheltered: 120, lat: -29.81, lng: 30.98, accuracy: 12.4 };

try {
  await db.exec(`
    create role authenticated nologin; create role anon nologin; create role service_role nologin;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user', true), '')::uuid $$;
    create type public.silo as enum ('MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster', 'Ethekwini');
    create type public.incident_status as enum ('New', 'Pending', 'Pending Dispatch', 'Pending Analysis', 'Dispatched', 'En Route', 'Arrived', 'On Scene', 'Transporting', 'Resolved', 'Closed');
    create function public.current_tenant() returns uuid language sql stable as $$ select '${T}'::uuid $$;
    create function public.current_silo() returns public.silo language sql stable as $$ select current_setting('test.silo', true)::public.silo $$;
    create function public.role_in(variadic roles text[]) returns boolean language sql stable as $$ select current_setting('test.role', true) = any (roles) $$;
    create function public.is_global() returns boolean language sql stable as $$ select current_setting('test.role', true) in ('ControlRoom', 'SystemAdmin') $$;
    create function public.require_role(variadic roles text[]) returns void language plpgsql as $$
      begin if not (current_setting('test.role', true) = any (roles)) then raise exception 'role' using errcode = '42501'; end if; end $$;
    create table public.ready (user_id uuid);
    create function public.shift_readiness_passed_today() returns boolean language sql stable as $$
      select exists (select 1 from public.ready where user_id = auth.uid()) $$;
    create table public.app_settings (tenant_id uuid, key text, value jsonb, primary key (tenant_id, key));
    create table public.profiles (id uuid primary key, full_name text);
    create table public.personnel (id uuid primary key default gen_random_uuid(), user_id uuid, tenant_id uuid default '${T}', silo public.silo,
      rank text, first_name text, last_name text, work_cellphone text, is_on_duty boolean default false, duty_started_at timestamptz,
      last_login timestamptz);
    -- 0041's stamp and 0073's hold, shortened.
    create table public.held (user_id uuid);
    create function public.duty_rules() returns trigger language plpgsql as $$
    begin
      if old.is_on_duty and not new.is_on_duty and exists (select 1 from public.held h where h.user_id = new.user_id) then
        if auth.uid() is not null then raise exception 'ETK-1 is still open — file its report before going off duty or signing out'; end if;
        new.is_on_duty := true; return new;
      end if;
      if new.is_on_duty and not old.is_on_duty then new.duty_started_at := now(); end if;
      if not new.is_on_duty then new.duty_started_at := null; end if;
      return new;
    end $$;
    create trigger duty_rules before update on public.personnel for each row execute function public.duty_rules();
    create table public.incidents (id uuid primary key, tenant_id uuid default '${T}', silo public.silo, incident_number text,
      status public.incident_status, dispatched_silos public.silo[], tagged_silos public.silo[]);
    create table public.incident_responders (id uuid primary key default gen_random_uuid(), incident_id uuid, user_id uuid,
      status public.incident_status, arrived_at timestamptz);
    create function public.can_work_incident(p uuid) returns boolean language sql stable as $$
      select exists (select 1 from public.incident_responders r where r.incident_id = p and r.user_id = auth.uid()) $$;
    create table public.incident_updates (seq bigint generated always as identity, silo public.silo, incident_id uuid, message text,
      created_by uuid, created_by_name text, timestamp timestamptz default now());
    create table public.audit_logs (tenant_id uuid, silo public.silo, user_id uuid, user_name text, department text, action_type text,
      entity_type text, entity_id text, details text);
    create table public.chain (kind text, title text, body text);
    create function public.notify_incident_chain(i public.incidents, k text, t text, b text) returns integer language sql as $$
      insert into public.chain values (k, t, b); select 1 $$;
    grant usage on schema public, auth to authenticated;
    grant select on public.profiles, public.personnel, public.incidents, public.incident_responders, public.ready, public.held to authenticated;
    -- The duty switch officers flip themselves (0041's self-update path).
    grant update (is_on_duty) on public.personnel to authenticated;
    insert into public.profiles values ('${U.dm}', 'Thandi Mkhize'), ('${U.dm2}', 'Sipho Zulu'), ('${U.sup}', 'Mr Khumalo'),
      ('${U.cop}', 'Const. Dube'), ('${U.desk}', 'Nomsa Metro');
    insert into public.personnel (user_id, silo, rank, first_name, last_name, work_cellphone) values
      ('${U.dm}', 'EthekwiniDisaster', 'Officer', 'Thandi', 'Mkhize', '083 555 0101'),
      ('${U.dm2}', 'EthekwiniDisaster', null, 'Sipho', 'Zulu', 'not a number'),
      ('${U.sup}', 'EthekwiniDisaster', 'Supervisor', 'Bongani', 'Khumalo', null),
      ('${U.cop}', 'MetroPolice', 'Const.', 'Lindiwe', 'Dube', '082 000 0000');
    insert into public.incidents values
      ('${CALL}', '${T}', 'MetroFire', 'ETK-MF-ED-20261023-2200-0001', 'On Scene', '{MetroFire,EthekwiniDisaster}', '{MetroFire,EthekwiniDisaster}'),
      ('${FIRE_ONLY}', '${T}', 'MetroFire', 'ETK-MF-20261023-2200-0002', 'On Scene', '{MetroFire}', '{MetroFire}');
  `);
  await db.exec(migration);
  await db.exec(migration); // safe to re-run
  await db.query('begin');

  await scenario("standby needs today's readiness check first", async () => {
    await refused(() => start(U.dm, { contact_number: '0835550101', kit: KIT }), /readiness check first/);
  });

  await scenario('on standby: the number the call centre dials, the kit, a No recorded not refused, on duty', async () => {
    await ready(U.dm);
    const row = await start(U.dm, { contact_number: '083 555 0101', kit: { ...KIT, torch: false } });
    assert.equal(row.contact_number, '+27835550101');
    assert.deepEqual(row.kit_missing, ['Torch']);
    assert.equal(row.name, 'Officer Thandi Mkhize');
    assert.equal(await onDuty(U.dm), true);
    // A second tap brings the same standby up to date; still one open.
    await start(U.dm, { contact_number: '+27 83 555 0102', kit: KIT });
    const reg = await register();
    assert.equal(reg.length, 1);
    assert.equal(reg[0].contact_number, '+27835550102');
    assert.deepEqual(reg[0].kit_missing, []);
  });

  await scenario('the number must be one that can be dialled; every item of kit answered', async () => {
    await ready(U.dm);
    await refused(() => start(U.dm, { contact_number: '1234', kit: KIT }), /number the call centre can call/);
    await refused(() => start(U.dm, { contact_number: '0835550101', kit: { phone: true } }), /every item of kit/);
  });

  await scenario('only Disaster Management goes on standby', async () => {
    await refused(() => as(U.cop, 'Police', 'MetroPolice').then(() => db.query('select public.start_standby($1::jsonb)', [JSON.stringify({ contact_number: '0820000000', kit: KIT })])), /role/);
    await refused(() => as(U.dm, 'Disaster', 'MetroFire').then(() => db.query('select public.start_standby($1::jsonb)', [JSON.stringify({ contact_number: '0820000000', kit: KIT })])), /Only Disaster Management/);
  });

  await scenario('ending standby closes the register and takes the officer off duty', async () => {
    await ready(U.dm);
    await start(U.dm, { contact_number: '0835550101', kit: KIT });
    const done = await end(U.dm, 'Handed over to Sipho');
    assert.ok(done.ended_at);
    assert.equal(done.end_reason, 'Handed over to Sipho');
    assert.equal(await onDuty(U.dm), false);
  });

  await scenario('the register follows the old duty switch: the work number, then closed when off', async () => {
    await db.query("update public.personnel set is_on_duty = true where user_id = $1", [U.dm]);
    await db.query("update public.personnel set is_on_duty = true where user_id = $1", [U.dm2]);
    let reg = await register();
    assert.equal(reg.length, 2);
    assert.equal(reg.find((r) => r.user_id === U.dm).contact_number, '+27835550101');
    assert.equal(reg.find((r) => r.user_id === U.dm2).contact_number, null, 'a bad work number is not guessed at');
    await as(U.dm);
    await db.query("update public.personnel set is_on_duty = false where user_id = $1", [U.dm]);
    reg = await register();
    assert.equal(reg.find((r) => r.user_id === U.dm).end_reason, 'Off duty');
    // A police officer going on duty has no standby.
    await db.query('reset role');
    await db.query("update public.personnel set is_on_duty = true where user_id = $1", [U.cop]);
    assert.equal((await register()).length, 2);
  });

  await scenario('leading an open call-out: standby cannot end until it is filed', async () => {
    await ready(U.dm);
    await start(U.dm, { contact_number: '0835550101', kit: KIT });
    await db.query('reset role');
    await db.query('insert into public.held values ($1)', [U.dm]);
    await refused(() => end(U.dm), /still open/);
    const [open] = await register();
    assert.equal(open.ended_at, null);
  });

  await scenario('standby lasts a week; the other services expire after a shift', async () => {
    await db.query("update public.personnel set is_on_duty = true where user_id in ($1, $2)", [U.dm, U.cop]);
    await db.query("update public.personnel set duty_started_at = now() - interval '100 hours' where user_id = $1", [U.dm]);
    await db.query("update public.personnel set duty_started_at = now() - interval '15 hours' where user_id = $1", [U.cop]);
    assert.equal((await db.query('select public.expire_stale_duty() as n')).rows[0].n, 1);
    assert.equal(await onDuty(U.dm), true, 'four days into a week of standby');
    assert.equal(await onDuty(U.cop), false, 'a 14-hour shift');
    await db.query("update public.personnel set duty_started_at = now() - interval '200 hours' where user_id = $1", [U.dm]);
    await db.query('select public.expire_stale_duty()');
    assert.equal(await onDuty(U.dm), false);
    const reg = await register();
    assert.equal(reg.find((r) => r.user_id === U.dm).end_reason, 'Ended automatically');
  });

  await scenario('the standby length is an Operations Setting', async () => {
    await db.query(`insert into public.app_settings values ('${T}', 'disaster.max_standby_hours', '24')`);
    await db.query("update public.personnel set is_on_duty = true where user_id = $1", [U.dm]);
    await db.query("update public.personnel set duty_started_at = now() - interval '30 hours' where user_id = $1", [U.dm]);
    await db.query('select public.expire_stale_duty()');
    assert.equal(await onDuty(U.dm), false);
  });

  await scenario('an assessment is filed on site: on the timeline, to dispatch, the figures kept', async () => {
    await refused(() => assess(U.dm, place), /Accept the call-out/);
    await db.query("insert into public.incident_responders (incident_id, user_id, status) values ($1, $2, 'En Route')", [CALL, U.dm]);
    await refused(() => assess(U.dm, place), /not at .* yet/);
    await db.query('reset role');
    await db.query("update public.incident_responders set status = 'On Scene', arrived_at = now() where user_id = $1", [U.dm]);
    const row = await assess(U.dm, place);
    assert.equal(row.households_affected, 40);
    assert.equal(row.people_displaced, 120);
    assert.deepEqual(row.relief, { blankets: 120, mattresses: 0, food_parcels: 40, hygiene_packs: 0, hot_meals: 0 });
    assert.deepEqual(row.services, ['Electricity']);
    assert.deepEqual(row.needs, ['Food', 'Shelter']);
    assert.equal(row.filed_by_name, 'Thandi Mkhize');
    assert.match((await timeline()).at(-1),
      /\[ASSESSMENT\] Quarry Road settlement: 40 households affected, 120 displaced, 12 homes destroyed, 28 damaged; 120 sheltered at Kennedy Road Community Hall — Thandi Mkhize/);
    const chain = (await db.query('select * from public.chain')).rows;
    assert.match(chain[0].title, /assessment at Quarry Road settlement/);
  });

  await scenario('a replay files nothing twice', async () => {
    await arrive(U.dm);
    const r = ref();
    const a = await assess(U.dm, place, r);
    const b = await assess(U.dm, { ...place, place: 'Elsewhere' }, r);
    assert.equal(a.id, b.id);
    await db.query('reset role');
    assert.equal((await db.query('select count(*)::int as n from public.disaster_assessments')).rows[0].n, 1);
  });

  await scenario('the figures are checked: the place, what happened, whole numbers, a named shelter', async () => {
    await arrive(U.dm);
    await refused(() => assess(U.dm, { ...place, place: ' ' }), /Say where you assessed/);
    await refused(() => assess(U.dm, { ...place, hazard: 'Aliens' }), /Choose what happened/);
    await refused(() => assess(U.dm, { ...place, injured: -1 }), /whole numbers/);
    await refused(() => assess(U.dm, { ...place, relief: { blankets: '2.5' } }), /whole numbers/);
    await refused(() => assess(U.dm, { ...place, shelter_name: '' }), /Name the hall or shelter/);
    const none = await assess(U.dm, { place: 'Block B', hazard: 'Fire' });
    assert.equal(none.households_affected, 0);
    assert.deepEqual(none.relief, {});
  });

  await scenario('command files from the desk; not a call Disaster Management was sent; not a closed one', async () => {
    const desk = await assess(U.sup, place, ref(), 'Supervisor');
    assert.equal(desk.place, 'Quarry Road settlement');
    await refused(() => assess(U.sup, place, ref(), 'Supervisor', FIRE_ONLY), /not sent to Disaster Management/);
    await db.query('reset role');
    await db.query("update public.incidents set status = 'Resolved' where id = $1", [CALL]);
    await refused(() => assess(U.sup, place, ref(), 'Supervisor'), /already resolved/);
    await refused(() => assess(U.cop, place, ref(), 'Police'), /role/);
  });

  await scenario('the tables take no writes except through the functions; an assessment never changes', async () => {
    await arrive(U.dm);
    const row = await assess(U.dm, place);
    await as(U.dm);
    await refused(() => db.query("insert into public.disaster_standby (user_id) values ($1)", [U.dm]), /permission denied/);
    await refused(() => db.query("insert into public.disaster_assessments (incident_id, place, hazard) values ($1, 'X', 'Fire')", [CALL]), /permission denied/);
    await db.query('reset role');
    await refused(() => db.query('update public.disaster_assessments set deaths = 9 where id = $1', [row.id]), /cannot be changed/);
  });

  await db.query('rollback');
  console.log(`\n${checks} scenarios passed; 0107 applied twice.`);
} finally {
  await db.close();
}
