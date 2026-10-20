/** Run the real radio presence migration (0087, on top of 0082) against
 * in-memory Postgres (PGlite): the app reports only for the person signed in,
 * a position is kept only on duty, bad values are left out, a radio handed
 * over is audited, who reads which radios, and the register taking the
 * HikTech app's Radio ID.
 *
 * CASE_PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node scripts/test-radio-presence.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.CASE_PGLITE_MODULE || '@electric-sql/pglite');

const register = readFileSync(new URL('../supabase/migrations/0082_radio_register.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/0087_radio_presence.sql', import.meta.url), 'utf8');
const db = new PGlite();
let checks = 0;

const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = '20000000-0000-4000-8000-000000000001';
const T2 = '20000000-0000-4000-8000-000000000002';
const U = { cop: id(1), cop2: id(2), fire: id(3), dispatcher: id(4), policeDesk: id(5), otherOrg: id(6), sysadmin: id(7), noStaff: id(8) };
const who = {
  [U.cop]: ['Police', 'MetroPolice', T], [U.cop2]: ['Police', 'MetroPolice', T], [U.fire]: ['Firefighter', 'MetroFire', T],
  [U.dispatcher]: ['Dispatcher', 'Ethekwini', T], [U.policeDesk]: ['Supervisor', 'MetroPolice', T],
  [U.otherOrg]: ['Police', 'MetroPolice', T2], [U.sysadmin]: ['SystemAdmin', 'Ethekwini', T], [U.noStaff]: ['Police', 'MetroPolice', T],
};
const P = { khumalo: id(101), dube: id(102), mthembu: id(103), elsewhere: id(104) };
const RADIO = 'HT-4F2K-9QXA';

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
const report = (p) => db.query('select * from public.report_radio_presence($1::jsonb)', [JSON.stringify(p)]).then((r) => r.rows[0]);
const onDuty = async (person, yes) => {
  await db.query('reset role');
  await db.query('update public.personnel set is_on_duty = $2 where id = $1', [person, yes]);
};
const visible = async () => (await db.query('select device_id from public.radio_presence order by device_id')).rows.map((r) => r.device_id);
const fix = { lat: -29.8587, lng: 31.0218, acc: 8.4, fixAt: new Date().toISOString() };

try {
  await db.exec(`
    create role authenticated nologin; create role anon nologin; create role service_role nologin;
    create schema auth;
    create type public.silo as enum ('Ethekwini', 'MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster');
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
    create table public.profiles (id uuid primary key, full_name text);
    create table public.personnel (id uuid primary key, tenant_id uuid not null, user_id uuid, silo public.silo not null,
      first_name text, is_on_duty boolean not null default false);
    create table public.apparatus (id uuid primary key, tenant_id uuid not null, unit_number text);
    create table public.audit_logs (id uuid primary key default gen_random_uuid(), tenant_id uuid, silo public.silo, user_id uuid,
      user_name text, action_type text, entity_type text, entity_id text, details text);
    insert into public.profiles values ('${U.cop}', 'Const. Khumalo'), ('${U.cop2}', 'Const. Dube'), ('${U.sysadmin}', 'Sys Admin');
    insert into public.personnel values
      ('${P.khumalo}', '${T}', '${U.cop}', 'MetroPolice', 'Khumalo', true),
      ('${P.dube}', '${T}', '${U.cop2}', 'MetroPolice', 'Dube', false),
      ('${P.mthembu}', '${T}', '${U.fire}', 'MetroFire', 'Mthembu', true),
      ('${P.elsewhere}', '${T2}', '${U.otherOrg}', 'MetroPolice', 'Elsewhere', true);
    grant usage on schema public, auth to authenticated;
    grant select on public.audit_logs, public.personnel to authenticated;
  `);
  await db.exec(register);
  // A RealPTT radio from before: it leaves the register with 0087.
  await db.exec(`insert into public.radio_devices (tenant_id, provider, account, silo) values ('${T}', 'realptt', 'Nets1', 'MetroPolice')`);
  await db.exec(migration);
  await db.exec(migration); // safe to re-run
  await db.query('begin');

  await scenario('the radio reports its state, for the person signed in; a fix is kept on duty', async () => {
    await as(U.cop);
    const r = await report({
      device: 'ht-4f2k-9qxa', model: 'E977_MB', app: '1.3.0', battery: 63.6, charging: true, network: 'cellular',
      channel: 'dept:MetroPolice', talking: true, queued: 37, ...fix,
    });
    assert.equal(r.queued, 37, 'positions waiting on the radio');
    assert.equal(r.device_id, RADIO, 'upper-cased');
    assert.equal(r.user_id, U.cop);
    assert.equal(r.personnel_id, P.khumalo);
    assert.equal(r.silo, 'MetroPolice');
    assert.equal(r.battery, 64);
    assert.equal(r.charging, true);
    assert.equal(r.talk_channel, 'dept:MetroPolice');
    assert.equal(r.talking, true);
    assert.equal(r.signed_in, true);
    assert.equal(r.lat, fix.lat);
    assert.ok(Math.abs(r.accuracy - 8.4) < 0.01);
    // The next report, with no fix: the last position stays while on duty.
    const again = await report({ device: RADIO, battery: 62, talking: false });
    assert.equal(again.talking, false);
    assert.equal(again.talk_channel, null);
    assert.equal(again.lat, fix.lat, 'kept while on duty');
    assert.equal(again.model, 'E977_MB', 'kept when not sent');
    await db.query('reset role');
    assert.equal((await db.query('select count(*)::int as n from public.radio_presence')).rows[0].n, 1, 'one row per radio');
  });

  await scenario('off duty: no position is kept, and a stale one is cleared', async () => {
    await as(U.cop);
    await report({ device: RADIO, ...fix });
    await onDuty(P.khumalo, false);
    await as(U.cop);
    const off = await report({ device: RADIO, battery: 50, ...fix });
    assert.equal(off.lat, null, 'not tracked off duty');
    assert.equal(off.fix_at, null);
    assert.equal(off.battery, 50, 'the rest still reports');
  });

  await scenario('what is not right is left out; what can never be right is refused', async () => {
    await as(U.cop);
    const r = await report({
      device: RADIO, battery: 140, queued: -4, charging: 'yes', network: 'satellite', talking: 'loud', lat: 0, lng: 0, fixAt: new Date().toISOString(),
    });
    assert.equal(r.battery, null);
    assert.equal(r.queued, null);
    assert.equal(r.charging, null);
    assert.equal(r.network, null);
    assert.equal(r.talking, false);
    assert.equal(r.lat, null, '0,0 is no position');
    const old = await report({ device: RADIO, ...fix, fixAt: '2026-01-01T00:00:00Z' });
    assert.equal(old.lat, null, 'a fix days old is not "now"');
    await refused(() => report({ device: 'HT-OOOO-IIII' }), /not a Radio ID/);
    await refused(() => report({ device: 'radio 1' }), /not a Radio ID/);
    await refused(() => report([]), /as an object/);
    await as(U.noStaff);
    await refused(() => report({ device: RADIO }), /No personnel record/);
  });

  await scenario('nobody writes presence except through the report', async () => {
    await as(U.cop);
    await report({ device: RADIO });
    await refused(() => db.query("update public.radio_presence set battery = 100"), /permission denied/);
    await refused(() => db.query("insert into public.radio_presence (silo, device_id, user_id) values ('MetroPolice', 'HT-AAAA-BBBB', $1)", [U.cop]), /permission denied/);
    await refused(() => db.query('delete from public.radio_presence'), /permission denied/);
  });

  await scenario('a radio handed to the next shift moves to them, on the record', async () => {
    await as(U.cop);
    await report({ device: RADIO, ...fix });
    await as(U.cop2);
    const r = await report({ device: RADIO, battery: 90 });
    assert.equal(r.user_id, U.cop2);
    assert.equal(r.personnel_id, P.dube);
    assert.equal(r.lat, null, 'Dube is off duty: Khumalo’s last position does not follow the radio');
    await db.query('reset role');
    const audit = (await db.query("select action_type, entity_id, details from public.audit_logs where action_type = 'RadioHandedOver'")).rows;
    assert.equal(audit.length, 1);
    assert.equal(audit[0].entity_id, RADIO);
    assert.match(audit[0].details, /Const\. Dube now signed in on HT-4F2K-9QXA/);
  });

  await scenario('who reads presence: the person, their department’s desks, and dispatch', async () => {
    await as(U.cop);
    await report({ device: RADIO });
    await as(U.fire);
    await report({ device: 'HT-FFFF-0001' });
    await as(U.otherOrg);
    await report({ device: 'HT-9999-0002' });

    await as(U.cop);
    assert.deepEqual(await visible(), [RADIO], 'their own only');
    await as(U.cop2);
    assert.deepEqual(await visible(), [], 'another officer sees nobody’s');
    await as(U.policeDesk);
    assert.deepEqual(await visible(), [RADIO], 'a supervisor: their own department');
    await as(U.dispatcher);
    assert.deepEqual(await visible(), [RADIO, 'HT-FFFF-0001'], 'dispatch: every department of this organisation');
    await as(U.sysadmin);
    assert.ok(!(await visible()).includes('HT-9999-0002'), 'never another organisation’s');
  });

  await scenario('RealPTT is gone from the register', async () => {
    await db.query('reset role');
    assert.equal((await db.query("select count(*)::int as n from public.radio_devices where provider = 'realptt'")).rows[0].n, 0);
  });

  await scenario('the register takes the HikTech app, by its Radio ID', async () => {
    await as(U.sysadmin);
    const save = (provider, account) => db.query(
      'select * from public.save_radio_device(null, $1, $2, $3, null, null, null, $4, null, null, null, true)',
      [provider, 'radio', account, 'MetroPolice'],
    ).then((r) => r.rows[0]);
    const r = await save('hiktech', ' ht-4f2k-9qxa ');
    assert.equal(r.provider, 'hiktech');
    assert.equal(r.account, RADIO);
    await refused(() => save('hiktech', 'FIRE ALPHA'), /Radio ID is not right/);
    await refused(() => save('zello', 'X'), /Choose the platform/);
    await refused(() => save('realptt', 'Nets1'), /Choose the platform/, 'RealPTT is gone');
    const poc = await save('pocstar', 'FIRE ALPHA');
    assert.equal(poc.account, 'FIRE ALPHA', 'PocStar accounts are as before');
  });

  await db.query('rollback');
  console.log(`\n${checks} scenarios passed; 0087 applied twice.`);
} finally {
  await db.close();
}
