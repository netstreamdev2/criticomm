/** Run the real route migration (0071) against in-memory Postgres (PGlite):
 * a phone's fixes, sent late or twice, land once each; the marker moves only
 * forward in time and only while on duty; a stretch delivered late reads as
 * recorded offline; and routes are read only by the officer and those who
 * oversee crews they can already see.
 *
 * CASE_PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node scripts/test-duty-tracks.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.CASE_PGLITE_MODULE || '@electric-sql/pglite');

const migration = readFileSync(new URL('../supabase/migrations/0071_duty_tracks.sql', import.meta.url), 'utf8');
const db = new PGlite();
let checks = 0;
const one = async (q, args) => (await db.query(q, args)).rows[0];
const rows = async (q, args) => (await db.query(q, args)).rows;

const T = '20000000-0000-4000-8000-000000000001';
const OTHER_T = '20000000-0000-4000-8000-000000000002';
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const U = { cop: id(1), cop2: id(2), fireDesk: id(3), central: id(4), ff: id(5), viewer: id(6), noRecord: id(7), stranger: id(8), fireSup: id(9) };

async function as(uid, tenant = T) {
  await db.query('reset role');
  await db.query("select set_config('test.user', $1, true), set_config('test.tenant', $2, true)", [uid, tenant]);
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
  finally { await db.query('reset role'); await db.query('rollback to savepoint scenario'); }
}
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
const pt = (min, lat, lng, extra = {}) => ({ t: ago(min), lat, lng, ...extra });
const send = (points) => db.query('select public.record_track($1::jsonb) as n', [JSON.stringify(points)]).then((r) => r.rows[0].n);
const me = (uid) => one('select latitude, longitude, location_at, last_login from public.personnel where user_id = $1', [uid]);

try {
  await db.exec(`
    create role authenticated nologin; create role anon nologin;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user', true), '')::uuid $$;
    create type public.silo as enum ('Ethekwini', 'MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster');
    create type public.user_role as enum ('SystemAdmin', 'SuperAdmin', 'Admin', 'Supervisor', 'Dispatcher', 'ControlRoom',
      'IncidentLogger', 'Viewer', 'System', 'Captain', 'Police', 'FireChief', 'Firefighter', 'Paramedic', 'Doctor',
      'Disaster', 'CaseManager', 'Staff', 'SystemController');
    create function public.current_tenant() returns uuid language sql stable as $$
      select coalesce(nullif(current_setting('test.tenant', true), '')::uuid, '${T}'::uuid) $$;
    create table public.profiles (id uuid primary key, tenant_id uuid not null, role public.user_role, silo public.silo);
    create function public.role_in(variadic roles public.user_role[]) returns boolean language sql stable security definer as $$
      select exists (select 1 from public.profiles where id = auth.uid() and role = any (roles)) $$;
    create function public.current_silo() returns public.silo language sql stable security definer as $$
      select coalesce((select silo from public.profiles where id = auth.uid()), 'Ethekwini') $$;
    -- As 0048 and 0068: desk roles read every department's people; a
    -- department's dispatch desk is fenced to its own department's calls.
    create function public.is_global() returns boolean language sql stable security definer as $$
      select coalesce((select role in ('SystemAdmin','SuperAdmin','Dispatcher','ControlRoom','IncidentLogger','Viewer','System','SystemController')
        from public.profiles where id = auth.uid()), false) $$;
    create function public.desk_silo() returns public.silo language sql stable security definer as $$
      select silo from public.profiles where id = auth.uid()
         and role in ('Dispatcher', 'ControlRoom', 'IncidentLogger') and silo <> 'Ethekwini' $$;
    create table public.personnel (
      id uuid primary key default gen_random_uuid(), tenant_id uuid not null, user_id uuid, silo public.silo not null,
      latitude double precision, longitude double precision, is_on_duty boolean not null default false,
      last_login timestamptz, updated_at timestamptz not null default now());
    alter table public.personnel enable row level security;
    -- As 0002 and 0030: a department's people, the control room sees all, within the tenant.
    create policy personnel_read on public.personnel for select using (
      tenant_id = public.current_tenant() and (silo = public.current_silo() or public.is_global()));
    create table public.app_settings (tenant_id uuid not null, key text not null, value jsonb, primary key (tenant_id, key));
    grant usage on schema public, auth to authenticated;
    grant select on public.personnel, public.profiles to authenticated;
    insert into public.profiles values
      ('${U.cop}', '${T}', 'Police', 'MetroPolice'), ('${U.cop2}', '${T}', 'Police', 'MetroPolice'),
      ('${U.fireDesk}', '${T}', 'Dispatcher', 'MetroFire'), ('${U.central}', '${T}', 'Dispatcher', 'Ethekwini'),
      ('${U.ff}', '${T}', 'Firefighter', 'MetroFire'), ('${U.viewer}', '${T}', 'Viewer', 'Ethekwini'),
      ('${U.noRecord}', '${T}', 'Police', 'MetroPolice'), ('${U.fireSup}', '${T}', 'Supervisor', 'MetroFire'), ('${U.stranger}', '${OTHER_T}', 'Dispatcher', 'Ethekwini');
    insert into public.personnel (tenant_id, user_id, silo, is_on_duty, latitude, longitude, last_login) values
      ('${T}', '${U.cop}', 'MetroPolice', true, null, null, now() - interval '3 hours'),
      ('${T}', '${U.cop2}', 'MetroPolice', true, -29.80, 31.00, now() - interval '3 hours'),
      ('${T}', '${U.ff}', 'MetroFire', false, null, null, null);
  `);
  await db.exec('begin');
  await db.exec(migration);
  await db.exec(migration); // safe to re-run
  await db.exec('grant select on public.duty_tracks to authenticated');

  await scenario('fixes land once each; the marker moves to the newest one and the contact time is stamped', async () => {
    await as(U.cop);
    const route = [pt(30, -29.851, 31.021), pt(29, -29.852, 31.023), pt(28, -29.853, 31.025, { acc: 8.5, spd: 12.3, hdg: 90 })];
    assert.equal(await send(route), 3);
    assert.equal(await send(route), 0, 'a resend after a dropped answer adds nothing');
    assert.equal(await send([...route, pt(27, -29.854, 31.027)]), 1, 'only the new fix is added');
    const p = await me(U.cop);
    assert.equal(p.latitude, -29.854);
    assert.equal(p.longitude, 31.027);
    assert.ok(Math.abs(new Date(p.location_at).getTime() - new Date(ago(27)).getTime()) < 2000, 'when the fix was taken, not when it arrived');
    assert.ok(Date.now() - new Date(p.last_login).getTime() < 60_000, 'contact time is now');
    const kept = await one('select accuracy, speed, heading, silo from public.duty_tracks where user_id = $1 order by recorded_at desc offset 1 limit 1', [U.cop]);
    assert.deepEqual([Number(kept.accuracy.toFixed(1)), Number(kept.speed.toFixed(1)), kept.heading, kept.silo], [8.5, 12.3, 90, 'MetroPolice']);
  });

  await scenario('a stretch delivered late never drags the marker back, and reads as recorded offline', async () => {
    await as(U.cop);
    await send([pt(2, -29.9, 31.1)]);
    // The phone reconnects and delivers what it recorded an hour ago.
    await send([pt(65, -29.7, 30.9), pt(64, -29.71, 30.91)]);
    const p = await me(U.cop);
    assert.deepEqual([p.latitude, p.longitude], [-29.9, 31.1], 'still where the crew is now');
    // Backdate arrival for the live fix as if it arrived on time.
    await db.query('reset role');
    await db.query("update public.duty_tracks set received_at = recorded_at + interval '5 seconds' where lat = -29.9");
    await as(U.cop);
    const route = await rows('select lat, offline from public.list_duty_tracks(now() - interval \'2 hours\') order by recorded_at');
    assert.deepEqual(route.map((r) => [r.lat, r.offline]), [[-29.7, true], [-29.71, true], [-29.9, false]]);
  });

  await scenario('off duty: fixes are kept but the marker is not placed', async () => {
    await as(U.ff);
    assert.equal(await send([pt(5, -29.86, 31.03)]), 1);
    const p = await me(U.ff);
    assert.equal(p.latitude, null);
    assert.equal(p.last_login, null);
  });

  await scenario('bad points are left out; nonsense is refused whole', async () => {
    await as(U.cop);
    const n = await send([
      { t: 'yesterday', lat: -29.8, lng: 31 },
      { t: ago(1), lat: '-29.8', lng: 31 },
      { t: ago(1), lat: 0, lng: 0 },
      { t: ago(1), lat: 95, lng: 31 },
      { t: ago(80 * 60), lat: -29.8, lng: 31 },
      { t: new Date(Date.now() + 3_600_000).toISOString(), lat: -29.8, lng: 31 },
      'not a point',
      pt(1, -29.8, 31.0),
    ]);
    assert.equal(n, 1, 'only the one good fix');
    await refused(() => send({ t: ago(1) }), /as a list/);
    await refused(() => send(Array.from({ length: 1001 }, (_, i) => pt(i / 100, -29.8, 31))), /at most 1,000/);
    await as(U.noRecord);
    await refused(() => send([pt(1, -29.8, 31)]), /No personnel record/);
    await db.query('reset role');
    await db.query("select set_config('test.user', '', true)");
    await db.query('set local role authenticated');
    await refused(() => send([pt(1, -29.8, 31)]), /Sign in first/);
  });

  await scenario('nobody writes routes directly, not even their own', async () => {
    await as(U.cop);
    await refused(() => db.query(
      `insert into public.duty_tracks (silo, user_id, recorded_at, lat, lng) values ('MetroPolice', $1, now(), -29.8, 31)`, [U.cop]),
    /permission denied/);
    await send([pt(3, -29.8, 31)]);
    await refused(() => db.query('update public.duty_tracks set lat = -29.0'), /permission denied/);
    await refused(() => db.query('delete from public.duty_tracks'), /permission denied/);
  });

  await scenario('who reads a route: the officer, and the desks that oversee crews they can see', async () => {
    await as(U.cop); await send([pt(10, -29.81, 31.01)]);
    await as(U.ff); await send([pt(10, -29.82, 31.02)]);
    const whose = async (uid, tenant) => {
      await as(uid, tenant);
      return (await rows('select distinct user_id from public.list_duty_tracks(null)')).map((r) => r.user_id).sort();
    };
    assert.deepEqual(await whose(U.cop), [U.cop], 'an officer sees their own route, not a colleague\'s');
    assert.deepEqual(await whose(U.cop2), [], 'nor does the colleague see theirs');
    assert.deepEqual(await whose(U.central), [U.cop, U.ff].sort(), 'the control room sees every department');
    assert.deepEqual(await whose(U.fireDesk), [U.ff], 'the Fire desk sees its own crews only');
    assert.deepEqual(await whose(U.fireSup), [U.ff], 'a Fire supervisor sees Fire crews');
    assert.deepEqual(await whose(U.viewer), [], 'a viewer does not track crews');
    assert.deepEqual(await whose(U.stranger, OTHER_T), [], 'another organisation sees nothing');
    await as(U.central);
    const onlyFire = await rows('select distinct user_id from public.list_duty_tracks(null, $1::uuid[])', [[U.ff]]);
    assert.deepEqual(onlyFire.map((r) => r.user_id), [U.ff], 'the console asks for the people on its map');
  });

  await scenario('routes are thinned to one fix per 15 seconds and reach back a day at most', async () => {
    await as(U.cop);
    const base = Date.now() - 10 * 60_000;
    const burst = Array.from({ length: 60 }, (_, i) => ({ t: new Date(base + i * 1000).toISOString(), lat: -29.8 - i / 1e4, lng: 31 }));
    assert.equal(await send(burst), 60);
    await send([pt(30 * 60, -29.5, 30.5)]);
    const route = await rows('select recorded_at from public.list_duty_tracks(now() - interval \'3 days\')');
    assert.ok(route.length >= 4 && route.length <= 5, `a minute of fixes every second reads as about four (${route.length})`);
  });

  await scenario('old routes are deleted after the retention set in Operations Settings', async () => {
    await db.query('reset role');
    await db.query(`insert into public.duty_tracks (tenant_id, silo, user_id, recorded_at, lat, lng) values
      ('${T}', 'MetroPolice', '${U.cop}', now() - interval '100 days', -29.8, 31),
      ('${T}', 'MetroPolice', '${U.cop}', now() - interval '20 days', -29.8, 31),
      ('${T}', 'MetroPolice', '${U.cop}', now() - interval '1 day', -29.8, 31)`);
    assert.equal((await one('select public.purge_old_duty_tracks() as n')).n, 1, '90 days by default');
    await db.query(`insert into public.app_settings values ('${T}', 'duty.track_retention_days', '14')`);
    assert.equal((await one('select public.purge_old_duty_tracks() as n')).n, 1, 'then 14 days');
    await db.query(`update public.app_settings set value = '1' where key = 'duty.track_retention_days'`);
    assert.equal((await one('select public.purge_old_duty_tracks() as n')).n, 0, 'never under 7 days');
    await as(U.cop);
    await refused(() => db.query('select public.purge_old_duty_tracks()'), /permission denied/);
  });

  await scenario('an older writer that moves the position stamps when', async () => {
    await db.query('reset role');
    await db.query('update public.personnel set latitude = -29.6, longitude = 30.8 where user_id = $1', [U.cop2]);
    const p = await me(U.cop2);
    assert.ok(Date.now() - new Date(p.location_at).getTime() < 60_000);
  });

  await db.exec('rollback');
  console.log(`\n${checks} scenarios passed`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
