/** Run hard hat pairing (0105) on top of the kit register (0101) against
 * in-memory Postgres (PGlite): pressing a hard hat's button inside an
 * officer's 20-second window books it to them; two officers at once pairs
 * nobody; a press with no window does nothing; another department's window
 * is not used; the armoury issues kit to an officer, command only.
 *
 * CASE_PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node scripts/test-hat-pairing.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.CASE_PGLITE_MODULE || '@electric-sql/pglite');

const migration = readFileSync(new URL('../supabase/migrations/0101_field_kit.sql', import.meta.url), 'utf8');
const pairing = readFileSync(new URL('../supabase/migrations/0105_hard_hat_pairing.sql', import.meta.url), 'utf8');
const press = async (device) => { await as(U.thabo); return (await db.query('select public.hard_hat_button($1) as r', [device])).rows[0].r; };
const openWindow = async (uid, role = 'Police', silo = 'MetroPolice') => { await as(uid, role, silo); return (await db.query('select public.open_hat_pairing() as w')).rows[0].w; };
const state = async (uid, w) => { await as(uid); return (await db.query('select public.hat_pairing($1) as s', [w.id])).rows[0].s; };
const db = new PGlite();
let checks = 0;

const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = '20000000-0000-4000-8000-000000000001';
const U = { sipho: id(1), thabo: id(2), sgt: id(3), fire: id(4) };
const RADIO_ID = 'HT-AB12-CD34';
const HAT_ID = 'HT-EF56-GH78';

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
async function refused(sql, args, pattern) {
  await db.query('savepoint refused');
  await assert.rejects(db.query(sql, args), pattern);
  await db.query('rollback to savepoint refused');
}
const sgt = () => as(U.sgt, 'Supervisor');
const book = async (uid, args) => {
  await as(uid);
  const r = await db.query('select public.book_field_kit(p_kind => $1, p_asset_no => $2, p_device_id => $3) as b',
    [args.kind ?? null, args.no ?? null, args.device ?? null]);
  return r.rows[0].b;
};
const kit = async (no, kind = 'hard_hat') => {
  await db.query('reset role');
  return (await db.query('select * from public.field_kit where asset_no = $1 and kind = $2', [no, kind])).rows[0];
};
const openOf = async (uid) => {
  await db.query('reset role');
  return (await db.query(`select k.asset_no, b.booked_how from public.field_kit_bookings b join public.field_kit k on k.id = b.kit_id
    where b.user_id = $1 and b.returned_at is null order by k.asset_no`, [uid])).rows.map((r) => `${r.asset_no}:${r.booked_how}`);
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
    create function public.is_global() returns boolean language sql stable as $$ select current_setting('test.role', true) in ('SystemAdmin', 'SystemController') $$;
    create function public.can_manage_armoury(p public.silo) returns boolean language sql stable as $$
      select public.role_in('SystemAdmin') or (p = public.current_silo() and public.role_in('Supervisor', 'Admin')) $$;
    create table public.profiles (id uuid primary key, full_name text);
    create table public.personnel (id uuid primary key default gen_random_uuid(), user_id uuid, tenant_id uuid default '${T}',
      silo public.silo, rank text, first_name text, last_name text);
    create table public.audit_logs (tenant_id uuid, silo public.silo, user_id uuid, user_name text, action_type text,
      entity_type text, entity_id text, details text);
    create table public.told (title text, body text);
    create function public.notify_command(t uuid, s public.silo, title text, body text, sev text, link text) returns void
      language sql as $$ insert into public.told values (title, body) $$;
    grant usage on schema public, auth to authenticated;
    insert into public.profiles values ('${U.sipho}', 'Sipho Khumalo'), ('${U.thabo}', 'Thabo Dube'), ('${U.sgt}', 'Sgt. Naidoo'), ('${U.fire}', 'FF Zulu');
    insert into public.personnel (user_id, silo, rank, first_name, last_name) values
      ('${U.sipho}', 'MetroPolice', 'Const.', 'Sipho', 'Khumalo'), ('${U.thabo}', 'MetroPolice', 'Const.', 'Thabo', 'Dube'),
      ('${U.fire}', 'MetroFire', 'FF', 'Lindo', 'Zulu');
  `);
  await db.exec(migration);
  await db.exec(pairing);
  await db.exec(pairing); // safe to re-run
  await db.query('begin');
  await sgt();
  await db.query("select public.add_field_kit_range('hard_hat', 'HH', 1, 10, 4, 'MetroPolice')");
  await db.query('reset role');
  await db.query(`update public.field_kit set device_id = '${HAT_ID}' where asset_no = 'HH-0007'`);

  await scenario('pressing the hard hat in the officer’s window pairs it to them', async () => {
    const w = await openWindow(U.sipho);
    const r = await press(HAT_ID);
    assert.deepEqual([r.paired, r.name, r.asset_no], [true, 'Const. Sipho Khumalo', 'HH-0007']);
    assert.deepEqual(await openOf(U.sipho), ['HH-0007:paired']);
    assert.deepEqual(await state(U.sipho, w), { state: 'paired', asset_no: 'HH-0007' });
    assert.equal((await press(HAT_ID)).paired, false, 'a later press is just a press');
  });

  await scenario('a press with no window open does nothing', async () => {
    assert.deepEqual(await press(HAT_ID), { paired: false });
    assert.deepEqual(await openOf(U.sipho), []);
  });

  await scenario('two officers at once: nobody is paired, both asked again', async () => {
    const a = await openWindow(U.sipho);
    const b = await openWindow(U.thabo);
    const r = await press(HAT_ID);
    assert.deepEqual([r.paired, r.clash], [false, true]);
    assert.equal((await state(U.sipho, a)).state, 'clash');
    assert.equal((await state(U.thabo, b)).state, 'clash');
    assert.deepEqual(await openOf(U.sipho), []);
  });

  await scenario('another department’s window is not used', async () => {
    await openWindow(U.fire, 'Fire', 'MetroFire');
    assert.deepEqual(await press(HAT_ID), { paired: false });
  });

  await scenario('the armoury issues kit to an officer; officers cannot', async () => {
    await db.query('reset role');
    const kit = (await db.query("select id from public.field_kit where asset_no = 'HH-0003'")).rows[0].id;
    const thabo = (await db.query('select id from public.personnel where user_id = $1', [U.thabo])).rows[0].id;
    await as(U.sipho);
    await refused('select public.issue_field_kit($1, $2)', [kit, thabo], /Only command and the armoury/);
    await sgt();
    const r = (await db.query('select public.issue_field_kit($1, $2) as r', [kit, thabo])).rows[0].r;
    assert.equal(r.asset_no, 'HH-0003');
    assert.deepEqual(await openOf(U.thabo), ['HH-0003:issued']);
  });

  await db.query('rollback');
  console.log(`\n${checks} scenarios passed; 0105 applied twice.`);
} finally {
  await db.close();
}
