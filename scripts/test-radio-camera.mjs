/** Run the real radio camera migration (0091, on 0083 and 0087) against
 * in-memory Postgres (PGlite): who may open a radio's camera, that the radio
 * is told but not by whom, the passes (the radio sends, viewers only watch),
 * one view per radio, the 10-minute limit, and the audit trail.
 *
 * CASE_PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node scripts/test-radio-camera.mjs
 */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.CASE_PGLITE_MODULE || '@electric-sql/pglite');

const read = (f) => readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), 'utf8');
const db = new PGlite();
let checks = 0;

const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = '20000000-0000-4000-8000-000000000001';
const T2 = '20000000-0000-4000-8000-000000000002';
const SECRET = 'test-secret-0123456789abcdefghijklmnopqrstuvwxyz';
const U = {
  sysadmin: id(1), dispatcher: id(2), cop: id(3), cop2: id(4), policeSup: id(5), fireSup: id(6), viewer: id(7), otherOrg: id(8), firefighter: id(9),
};
const who = {
  [U.sysadmin]: ['SystemAdmin', 'Ethekwini', T, 'Sipho Admin'], [U.dispatcher]: ['Dispatcher', 'Ethekwini', T, 'Disp. Zulu'],
  [U.cop]: ['Police', 'MetroPolice', T, 'Const. Khumalo'], [U.cop2]: ['Police', 'MetroPolice', T, 'Const. Dube'],
  [U.policeSup]: ['Supervisor', 'MetroPolice', T, 'Sgt. Naidoo'], [U.fireSup]: ['Supervisor', 'MetroFire', T, 'Stn Off. Mthembu'],
  [U.viewer]: ['Viewer', 'Ethekwini', T, 'Vusi Viewer'], [U.otherOrg]: ['SystemAdmin', 'Ethekwini', T2, 'Elsewhere'],
  [U.firefighter]: ['Firefighter', 'MetroFire', T, 'FF Ngcobo'],
};
const P = { khumalo: id(101), dube: id(102), ngcobo: id(103) };
const RADIO = 'HT-DBZE-9961';

async function as(uid) {
  const [role, silo, tenant] = who[uid];
  await db.query('reset role');
  await db.query("select set_config('test.user', $1, true), set_config('test.role', $2, true), set_config('test.silo', $3, true), set_config('test.tenant', $4, true)",
    [uid, role, silo, tenant]);
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
  catch (e) { console.log(`FAIL ${label}`); throw e; }
  finally { await db.query('rollback to savepoint scenario'); await db.query('reset role'); }
}
const start = (device = RADIO) => db.query('select * from public.start_radio_camera($1)', [device]).then((r) => r.rows[0]);
const end = (view) => db.query('select * from public.end_radio_camera($1)', [view]).then((r) => r.rows[0]);
const mine = (device = RADIO) => db.query('select public.my_radio_camera($1) as v', [device]).then((r) => r.rows[0].v);
const pass = (view) => db.query('select public.radio_camera_pass($1) as p', [view]).then((r) => r.rows[0].p);
const report = (p) => db.query('select * from public.report_radio_presence($1::jsonb)', [JSON.stringify(p)]);
function verify(token) {
  const [h, b, s] = token.split('.');
  assert.equal(s, createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url'), 'signed with the voice server secret');
  return JSON.parse(Buffer.from(b, 'base64url').toString());
}

try {
  await db.exec(`
    create role authenticated nologin; create role anon nologin; create role service_role nologin;
    create schema auth;
    create type public.silo as enum ('Ethekwini', 'MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster');
    create type public.incident_status as enum ('New', 'Dispatched', 'On Scene', 'Resolved', 'Closed');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user', true), '')::uuid $$;
    create function public.current_tenant() returns uuid language sql stable as $$ select nullif(current_setting('test.tenant', true), '')::uuid $$;
    create function public.current_silo() returns public.silo language sql stable as $$
      select coalesce(nullif(current_setting('test.silo', true), ''), 'Ethekwini')::public.silo $$;
    create function public.role_in(variadic roles text[]) returns boolean language sql stable as $$
      select current_setting('test.role', true) = any (roles) $$;
    create function public.require_role(variadic roles text[]) returns void language plpgsql as $$ begin
      if auth.uid() is null or not public.role_in(variadic roles) then raise exception 'Not permitted for your role' using errcode = '42501'; end if;
    end $$;
    create function public.is_global() returns boolean language sql stable as $$
      select public.role_in('SystemAdmin','SuperAdmin','Dispatcher','Operator','ControlRoom','IncidentLogger','Viewer','System','SystemController') $$;
    create function public.try_uuid(p text) returns uuid language plpgsql immutable as $f$
      begin return p::uuid; exception when others then return null; end $f$;
    create table public.profiles (id uuid primary key, full_name text, role text);
    create table public.incidents (id uuid primary key, tenant_id uuid, silo public.silo, incident_number text,
      status public.incident_status, dispatched_silos public.silo[] default '{}');
    create function public.can_work_incident(p uuid) returns boolean language sql stable as $$ select false $$;
    create table public.personnel (id uuid primary key, tenant_id uuid not null, user_id uuid, silo public.silo not null,
      first_name text, is_on_duty boolean not null default false);
    create table public.apparatus (id uuid primary key, tenant_id uuid not null, unit_number text);
    create table public.audit_logs (id uuid primary key default gen_random_uuid(), tenant_id uuid, silo public.silo, user_id uuid,
      user_name text, action_type text, entity_type text, entity_id text, details text);
    insert into public.personnel values
      ('${P.khumalo}', '${T}', '${U.cop}', 'MetroPolice', 'Khumalo', true),
      ('${P.dube}', '${T}', '${U.cop2}', 'MetroPolice', 'Dube', true),
      ('${P.ngcobo}', '${T}', '${U.firefighter}', 'MetroFire', 'Ngcobo', true);
    grant usage on schema public, auth to authenticated;
  `);
  for (const [uid, [role, , , name]] of Object.entries(who)) await db.query('insert into public.profiles values ($1, $2, $3)', [uid, name, role]);
  for (const f of ['0083_talk.sql', '0082_radio_register.sql', '0087_radio_presence.sql']) await db.exec(read(f));
  await db.exec(read('0091_radio_camera.sql'));
  await db.exec(read('0091_radio_camera.sql')); // safe to re-run
  await db.query('begin');
  await db.query("select set_config('test.user', $1, true), set_config('test.role', 'SystemAdmin', true), set_config('test.tenant', $2, true)", [U.sysadmin, T]);
  await db.query("select public.set_talk_server('wss://hiktech-test.livekit.cloud', 'APIkey1', $1)", [SECRET]);
  // Khumalo's radio is on; a firefighter's radio too.
  await as(U.cop);
  await report({ device: RADIO, model: 'E977' });
  await as(U.firefighter);
  await report({ device: 'HT-FFFF-0001', model: 'E977' });

  await scenario('the control room opens a radio’s camera; the radio is told, not by whom', async () => {
    await as(U.sysadmin);
    const v = await start();
    assert.equal(v.device_id, RADIO);
    assert.equal(v.officer_id, U.cop);
    assert.equal(v.viewer_name, 'Sipho Admin');
    assert.ok(new Date(v.ends_by) - new Date(v.started_at) <= 10 * 60_000 + 1000, 'ten minutes at most');
    await as(U.cop);
    const told = await mine();
    assert.equal(told.id, v.id);
    assert.equal(JSON.stringify(told).includes('Sipho'), false, 'never who');
    await as(U.cop2);
    assert.equal(await mine(), null, 'another officer cannot ask about this radio');
    await db.query('reset role');
    const audit = (await db.query("select action_type, details from public.audit_logs where action_type like 'RadioCamera%'")).rows;
    assert.deepEqual(audit.map((a) => a.action_type), ['RadioCameraStarted']);
    assert.match(audit[0].details, /Sipho Admin opened Const\. Khumalo's camera \(HT-DBZE-9961\)/);
  });

  await scenario('the passes: the radio sends camera and microphone; the viewer only watches', async () => {
    await as(U.sysadmin);
    const v = await start();
    const viewer = verify((await pass(v.id)).token);
    assert.equal(viewer.video.room, `${T}:camera:${v.id}`, 'its own room, per organisation');
    assert.equal(viewer.video.canPublish, false);
    assert.deepEqual(viewer.video.canPublishSources, []);
    await as(U.cop);
    const radio = verify((await pass(v.id)).token);
    assert.equal(radio.video.canPublish, true);
    assert.deepEqual(radio.video.canPublishSources, ['camera', 'microphone']);
    assert.ok(radio.exp - radio.nbf <= 15 * 60 + 10, 'fifteen minutes');
    await as(U.cop2);
    await refused(() => pass(v.id), /Not permitted/, 'another officer cannot watch');
  });

  await scenario('who may open a camera', async () => {
    await as(U.dispatcher);
    await start();
    await as(U.policeSup);
    await start();
    await refused(() => start('HT-FFFF-0001'), /Not permitted/, 'a police supervisor, a fire radio');
    await as(U.fireSup);
    await start('HT-FFFF-0001');
    for (const u of [U.cop2, U.viewer, U.firefighter]) {
      await as(u);
      await refused(() => start(), /Not permitted/, who[u][0]);
    }
    await as(U.otherOrg);
    await refused(() => start(), /Radio not found/, 'another organisation');
    await as(U.sysadmin);
    await refused(() => start('HT-ZZZZ-0000'), /Radio not found/);
  });

  await scenario('one view per radio: a second viewer joins it; on the record', async () => {
    await as(U.sysadmin);
    const a = await start();
    await as(U.dispatcher);
    const b = await start();
    assert.equal(b.id, a.id, 'the same view and room');
    await db.query('reset role');
    assert.deepEqual((await db.query("select action_type from public.audit_logs where action_type like 'RadioCamera%' order by action_type desc")).rows.map((r) => r.action_type),
      ['RadioCameraStarted', 'RadioCameraJoined']);
  });

  await scenario('closed by the viewer, with how long; the radio stops', async () => {
    await as(U.sysadmin);
    const v = await start();
    await as(U.cop2);
    await refused(() => end(v.id), /Not permitted/);
    await as(U.sysadmin);
    const closed = await end(v.id);
    assert.ok(closed.ended_at);
    assert.equal(closed.ended_by, U.sysadmin);
    await refused(() => pass(v.id), /has ended/);
    await as(U.cop);
    assert.equal(await mine(), null, 'the radio stops');
    await db.query('reset role');
    assert.match((await db.query("select details from public.audit_logs where action_type = 'RadioCameraEnded'")).rows[0].details, /closed after \d+ seconds/);
  });

  await scenario('ten minutes, then it closes by itself', async () => {
    await as(U.sysadmin);
    const v = await start();
    await db.query('reset role');
    await db.query("update public.radio_camera_views set started_at = now() - interval '11 minutes', ends_by = now() - interval '1 minute' where id = $1", [v.id]);
    await as(U.cop);
    assert.equal(await mine(), null, 'expired');
    await as(U.sysadmin);
    await refused(() => pass(v.id), /has ended/);
    const fresh = await start();
    assert.notEqual(fresh.id, v.id, 'a new view');
    await db.query('reset role');
    assert.ok((await db.query('select ended_at from public.radio_camera_views where id = $1', [v.id])).rows[0].ended_at, 'the old one is closed');
  });

  await scenario('a radio that is off, or your own, cannot be opened', async () => {
    await db.query('reset role');
    await db.query("update public.radio_presence set last_seen_at = now() - interval '10 minutes' where device_id = $1", [RADIO]);
    await as(U.sysadmin);
    await refused(() => start(), /This radio is off/);
    await db.query('reset role');
    await db.query("update public.radio_presence set last_seen_at = now(), signed_in = false where device_id = $1", [RADIO]);
    await as(U.sysadmin);
    await refused(() => start(), /This radio is off/, 'signed out');
    await db.query('reset role');
    await db.query("update public.radio_presence set signed_in = true, user_id = $2 where device_id = $1", [RADIO, U.policeSup]);
    await as(U.policeSup);
    await refused(() => start(), /your own radio/);
  });

  await scenario('no direct writes; officers do not read the views list', async () => {
    await as(U.sysadmin);
    await start();
    await refused(() => db.query('update public.radio_camera_views set ends_by = now() + interval \'9 hours\''), /permission denied/);
    await refused(() => db.query('delete from public.radio_camera_views'), /permission denied/);
    await as(U.cop);
    assert.equal((await db.query('select count(*)::int as n from public.radio_camera_views')).rows[0].n, 0, 'the officer asks my_radio_camera, not the list');
    await as(U.policeSup);
    assert.equal((await db.query('select count(*)::int as n from public.radio_camera_views')).rows[0].n, 1, 'command reads it');
  });

  await db.query('rollback');
  console.log(`\n${checks} scenarios passed; 0091 applied twice.`);
} finally {
  await db.close();
}
