/** Run the real fire safety inspection migration (0066) against in-memory
 * Postgres (PGlite): who may file, what an inspection must say, the server's
 * stamp and numbering, the FAIL alert, who reads it, and that it is permanent.
 *
 * CASE_PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node scripts/test-fire-inspections.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.CASE_PGLITE_MODULE || '@electric-sql/pglite');

const migration = readFileSync(new URL('../supabase/migrations/0066_fire_safety_inspections.sql', import.meta.url), 'utf8');
const db = new PGlite();
let checks = 0;
const one = async (q, args) => (await db.query(q, args)).rows[0];
const scalar = async (q, args) => (await one(q, args))?.value;

const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T1 = '20000000-0000-4000-8000-000000000001';
const T2 = '20000000-0000-4000-8000-000000000002';
const U = { ff: id(1), chief: id(2), police: id(3), medic: id(4), other: id(5), dispatcher: id(6) };
const PEOPLE = [
  [U.ff, T1, 'Firefighter', 'MetroFire', 'Thabo Mokoena'],
  [U.chief, T1, 'FireChief', 'MetroFire', 'Jenny Chief'],
  [U.police, T1, 'Police', 'MetroPolice', 'Sipho Khumalo'],
  [U.medic, T1, 'Paramedic', 'Medical', 'Priya Pillay'],
  [U.other, T2, 'Firefighter', 'MetroFire', 'Other Tenant'],
  [U.dispatcher, T1, 'Dispatcher', 'Ethekwini', 'Naledi Dispatch'],
];
const who = Object.fromEntries(PEOPLE.map(([uid, tenant, role, silo]) => [uid, { tenant, role, silo }]));

async function as(uid) {
  const p = who[uid];
  await db.query('reset role');
  await db.query(
    "select set_config('test.user', $1, true), set_config('test.silo', $2, true), set_config('test.role', $3, true), set_config('test.tenant', $4, true)",
    [uid, p.silo, p.role, p.tenant],
  );
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
  finally { await db.query('rollback to savepoint scenario'); }
}

const good = { business_name: 'Skyline Mall', address: '1 Main Street', contact_person: 'Mr Naidoo', extinguishers: 'Yes', exits: 'Yes', notes: null, result: 'PASS' };
const insert = (row) => db.query(
  `insert into fire_safety_inspections (business_name, address, contact_person, extinguishers, exits, notes, result)
   values ($1,$2,$3,$4,$5,$6,$7) returning *`,
  [row.business_name, row.address, row.contact_person, row.extinguishers, row.exits, row.notes, row.result]);

try {
  await db.exec(`
    create role authenticated nologin; create role anon nologin;
    create schema auth; create table auth.users(id uuid primary key);
    create type public.silo as enum ('Ethekwini','MetroPolice','MetroFire','Medical','EthekwiniDisaster');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user', true), '')::uuid $$;
    create function public.current_tenant() returns uuid language sql stable as $$ select nullif(current_setting('test.tenant', true), '')::uuid $$;
    create function public.current_silo() returns public.silo language sql stable as $$ select coalesce(nullif(current_setting('test.silo', true), ''), 'Ethekwini')::public.silo $$;
    create function public.role_in(variadic roles text[]) returns boolean language sql stable as $$ select current_setting('test.role', true) = any(roles) $$;
    create function public.is_global() returns boolean language sql stable as $$ select current_setting('test.role', true) in ('Dispatcher','SystemAdmin','SuperAdmin') $$;
    create table public.profiles(id uuid primary key, full_name text);
    create table public.personnel(id uuid primary key default gen_random_uuid(), user_id uuid, tenant_id uuid, first_name text, last_name text);
    create table public.audit_logs(id uuid primary key default gen_random_uuid(), tenant_id uuid, silo public.silo, user_id uuid,
      user_name text, department text, action_type text, entity_type text, entity_id text, details text);
    create table public.sent(title text, severity text);
    create function public.notify_command(p_tenant uuid, p_silo public.silo, p_title text, p_body text, p_severity text, p_link text) returns void
      language sql as $$ insert into public.sent values (p_title, p_severity) $$;
    grant usage on schema auth, public to authenticated;
  `);
  await db.exec(migration);
  await db.exec(migration);
  await db.exec('grant select, insert on public.audit_logs, public.sent, public.profiles, public.personnel to authenticated');
  for (const [uid, tenant, , , name] of PEOPLE) {
    await db.query('insert into auth.users values ($1)', [uid]);
    await db.query('insert into profiles values ($1, $2)', [uid, name]);
    const [first, last] = name.split(' ');
    await db.query('insert into personnel(user_id, tenant_id, first_name, last_name) values ($1,$2,$3,$4)', [uid, tenant, first, last]);
  }
  await db.exec('begin');

  await scenario('Fire files inspections; Police, EMS and dispatch do not', async () => {
    await as(U.ff);
    assert.ok((await insert(good)).rows[0].id);
    await as(U.chief);
    assert.ok((await insert(good)).rows[0].id);
    for (const uid of [U.police, U.medic, U.dispatcher]) {
      await as(uid);
      await refused(() => insert(good), /row-level security|violates/, who[uid].role);
    }
  });

  await scenario('the server stamps the reference, the inspector and the time; numbers run per day', async () => {
    await as(U.ff);
    const a = (await insert(good)).rows[0];
    const b = (await insert(good)).rows[0];
    assert.match(a.inspection_ref, /^INSP-\d{8}-0001$/);
    assert.match(b.inspection_ref, /^INSP-\d{8}-0002$/);
    assert.equal(a.inspector_name, 'Thabo Mokoena');
    assert.equal(a.inspector_id, U.ff);
    await db.query('reset role');
    assert.equal(await scalar("select count(*)::int as value from audit_logs where action_type = 'FireInspectionFiled'"), 2);
  });

  await scenario('an inspection must name the site, contact and address, and a violation needs notes', async () => {
    await as(U.ff);
    await refused(() => insert({ ...good, business_name: ' ' }), /Business \/ Site Name/);
    await refused(() => insert({ ...good, contact_person: '' }), /Contact Person/);
    await refused(() => insert({ ...good, address: '' }), /Site Address/);
    await refused(() => insert({ ...good, result: 'FAIL' }), /Detail the violations/);
    await refused(() => insert({ ...good, exits: 'No' }), /Detail the violations/);
    await refused(() => insert({ ...good, extinguishers: 'Maybe' }), /check constraint|violates/);
  });

  await scenario('a FAIL tells fire command', async () => {
    await as(U.ff);
    await insert({ ...good, result: 'FAIL', exits: 'No', notes: 'Fire exit chained shut' });
    await db.query('reset role');
    const s = await one('select * from sent');
    assert.match(s.title, /Fire safety inspection failed: Skyline Mall/);
    assert.equal(s.severity, 'Medium');
  });

  await scenario('Fire and the tenant-wide tier read them; Police and another tenant do not', async () => {
    await as(U.ff);
    await insert(good);
    const sees = async (uid) => { await as(uid); return Number(await scalar('select count(*)::int as value from fire_safety_inspections')); };
    assert.equal(await sees(U.chief), 1);
    assert.equal(await sees(U.dispatcher), 1);
    assert.equal(await sees(U.police), 0);
    assert.equal(await sees(U.other), 0);
  });

  await scenario('a filed inspection cannot be changed or deleted', async () => {
    await as(U.ff);
    const r = (await insert(good)).rows[0];
    await db.query('reset role');
    await refused(() => db.query("update fire_safety_inspections set result = 'FAIL' where id = $1", [r.id]), /cannot be changed/);
    await refused(() => db.query('delete from fire_safety_inspections where id = $1', [r.id]), /cannot be changed/);
  });

  console.log(`\n${checks} scenarios passed`);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}
