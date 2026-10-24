/** Run "Talk per device" (0103) against in-memory Postgres (PGlite): each
 * device joins Talk under its own name, so a radio and a hard hat on one
 * account both stay on; a device's own group ("radio:<Radio ID>") is open
 * to the person on it and the desk that sees it, and to nobody else; a call
 * with only the channel still works for older apps.
 *
 * CASE_PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node scripts/test-talk-device.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.CASE_PGLITE_MODULE || '@electric-sql/pglite');

const migration = readFileSync(new URL('../supabase/migrations/0103_talk_per_device.sql', import.meta.url), 'utf8');
const db = new PGlite();
let checks = 0;

const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = '20000000-0000-4000-8000-000000000001';
const U = { sipho: id(1), thabo: id(2), desk: id(3), fireDesk: id(4) };
const HAT = 'HT-D1WN-NY6E';
const RADIO = 'HT-AB12-CD34';

async function as(uid, role = 'Police', silo = 'MetroPolice') {
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
const access = async (channel) => (await db.query('select public.talk_access($1) as a', [channel])).rows[0].a;
const claims = async (args) => {
  const pass = (await db.query(`select public.talk_pass(${args}) as p`)).rows[0].p;
  const body = pass.token.split('.')[1];
  return { pass, jwt: JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) };
};

try {
  await db.exec(`
    create role authenticated nologin; create role anon nologin;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user', true), '')::uuid $$;
    create type public.silo as enum ('MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster', 'Ethekwini');
    create function public.current_tenant() returns uuid language sql stable as $$ select '${T}'::uuid $$;
    create function public.current_silo() returns public.silo language sql stable as $$ select current_setting('test.silo', true)::public.silo $$;
    create function public.role_in(variadic roles text[]) returns boolean language sql stable as $$ select current_setting('test.role', true) = any (roles) $$;
    create function public.is_global() returns boolean language sql stable as $$ select current_setting('test.role', true) = 'SystemController' $$;
    create function public.try_uuid(t text) returns uuid language plpgsql immutable as $$ begin return t::uuid; exception when others then return null; end $$;
    create table public.incidents (id uuid primary key, tenant_id uuid, incident_number text, status text);
    create function public.can_work_incident(i uuid) returns boolean language sql stable as $$ select true $$;
    create table public.profiles (id uuid primary key, full_name text, role text);
    create table public.personnel (id uuid primary key default gen_random_uuid(), user_id uuid, rank text, first_name text, last_name text);
    create table public.radio_presence (tenant_id uuid, silo public.silo, device_id text, user_id uuid, personnel_id uuid);
    create table public.field_kit (tenant_id uuid, kind text, asset_no text, device_id text);
    create function public.field_kit_word(k text) returns text language sql immutable as $$ select case k when 'hard_hat' then 'Hard hat' else 'Radio' end $$;
    create table public.talk_server (id int primary key, url text, api_key text, api_secret text);
    create table public.audit_logs (tenant_id uuid, silo public.silo, user_id uuid, user_name text, action_type text, entity_type text, entity_id text, details text);
    create function public.talk_b64url(b bytea) returns text language sql immutable as $$
      select rtrim(translate(replace(encode(b, 'base64'), E'\\n', ''), '+/', '-_'), '=') $$;
    create function public.talk_hmac_sha256(k bytea, m bytea) returns bytea language sql immutable as $$ select sha256(k || m) $$;
    create function public.talk_pass(p_channel text) returns jsonb language sql as $$ select '{}'::jsonb $$;
    grant usage on schema public, auth to authenticated;
    insert into public.talk_server values (1, 'wss://voice.example', 'key', 'secret');
    insert into public.profiles values ('${U.sipho}', 'Sipho Khumalo', 'Police'), ('${U.thabo}', 'Thabo Dube', 'Police'),
      ('${U.desk}', 'Nomsa Metro', 'Dispatcher'), ('${U.fireDesk}', 'Fire Desk', 'Dispatcher');
    insert into public.personnel (id, user_id, rank, first_name, last_name) values ('${id(50)}', '${U.sipho}', 'Const.', 'Sipho', 'Khumalo');
    insert into public.radio_presence values ('${T}', 'MetroPolice', '${HAT}', '${U.sipho}', '${id(50)}'), ('${T}', 'MetroPolice', '${RADIO}', '${U.sipho}', '${id(50)}');
    insert into public.field_kit values ('${T}', 'hard_hat', 'HH-0001', '${HAT}');
  `);
  await db.exec(migration);
  await db.exec(migration); // safe to re-run
  await db.query('begin');

  await scenario('each device joins under its own name, and says which device it is', async () => {
    await as(U.sipho);
    const hat = await claims(`'dept:MetroPolice', '${HAT.toLowerCase()}'`);
    const radio = await claims(`'dept:MetroPolice', '${RADIO}'`);
    assert.equal(hat.jwt.sub, `${U.sipho}:${HAT}`);
    assert.equal(radio.jwt.sub, `${U.sipho}:${RADIO}`);
    assert.notEqual(hat.jwt.sub, radio.jwt.sub, 'both stay on');
    assert.equal(hat.jwt.name, 'Sipho Khumalo · hard hat HH-0001');
    assert.equal(radio.jwt.name, `Sipho Khumalo · ${RADIO}`);
    assert.equal(JSON.parse(hat.jwt.metadata).device, HAT);
  });

  await scenario('an older app (channel only) or a phone still joins as the person', async () => {
    await as(U.sipho);
    assert.equal((await claims(`'dept:MetroPolice'`)).jwt.sub, U.sipho);
    assert.equal((await claims(`'dept:MetroPolice', 'not-a-radio-id'`)).jwt.sub, U.sipho);
  });

  await scenario('a device’s own group: the person on it and the desk that sees it, nobody else', async () => {
    await as(U.sipho);
    const mine = await access(`radio:${HAT}`);
    assert.deepEqual([mine.listen, mine.speak], [true, true]);
    assert.equal(mine.name, 'Const. Sipho Khumalo (hard hat HH-0001) only');
    await as(U.thabo);
    assert.equal((await access(`radio:${HAT}`)).listen, false, 'another officer');
    await as(U.desk, 'Dispatcher', 'MetroPolice');
    const desk = await access(`radio:${HAT.toLowerCase()}`);
    assert.deepEqual([desk.listen, desk.speak, desk.priority], [true, true, true]);
    await as(U.fireDesk, 'Dispatcher', 'MetroFire');
    assert.equal((await access(`radio:${HAT}`)).listen, false, 'another department’s desk');
    await as(U.desk, 'SystemController', 'Ethekwini');
    assert.equal((await access(`radio:${HAT}`)).listen, true, 'those who see every department');
    await as(U.desk, 'Dispatcher', 'MetroPolice');
    assert.equal((await access('radio:HT-ZZZZ-ZZZZ')).listen, false, 'a device not heard from');
  });

  await scenario('the other groups work as before', async () => {
    await as(U.sipho);
    assert.equal((await access('dept:MetroPolice')).speak, true);
    assert.equal((await access('dept:MetroFire')).listen, false);
    assert.equal((await access('all')).listen, true);
  });

  await db.query('rollback');
  console.log(`\n${checks} scenarios passed; 0103 applied twice.`);
} finally {
  await db.close();
}
