/** Run the hard hat and radio register (0101) against in-memory Postgres
 * (PGlite): a run of 300 numbers in one go; a radio books itself to whoever
 * starts the shift on it; a hard hat by its number; one of each at a time;
 * a forgotten booking is taken over and noted; handing back fine, damaged or
 * lost; end of shift hands everything back; only command looks after the
 * register; officers see only their own bookings.
 *
 * CASE_PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node scripts/test-field-kit.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.CASE_PGLITE_MODULE || '@electric-sql/pglite');

const migration = readFileSync(new URL('../supabase/migrations/0101_field_kit.sql', import.meta.url), 'utf8');
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
  await db.exec(migration); // safe to re-run
  await db.query('begin');
  // The register every scenario starts from: HH-0001 … HH-0300, two radios.
  await sgt();
  const added = (await db.query("select public.add_field_kit_range('hard_hat', 'hh', 1, 300, 4, 'MetroPolice', 'Smart hat') as n")).rows[0].n;
  assert.equal(added, 300);
  assert.equal((await db.query("select public.add_field_kit_range('hard_hat', 'HH', 299, 302, 4, 'MetroPolice') as n")).rows[0].n, 2, 'numbers already there are skipped');
  await db.query(`select public.save_field_kit($1::jsonb)`, [JSON.stringify({ kind: 'radio', asset_no: 'rd 14', serial: 'E977-0001', device_id: RADIO_ID, silo: 'MetroPolice' })]);
  await db.query(`select public.save_field_kit($1::jsonb)`, [JSON.stringify({ kind: 'radio', asset_no: 'RD-15', silo: 'MetroPolice' })]);
  await db.query('reset role');
  await db.query(`update public.field_kit set device_id = '${HAT_ID}' where asset_no = 'HH-0007'`);

  await scenario('the register: numbered, unique, and only command looks after it', async () => {
    assert.equal((await kit('RD-14', 'radio')).serial, 'E977-0001', '"rd 14" is stored as RD-14');
    await sgt();
    await refused(`select public.save_field_kit($1::jsonb)`, [JSON.stringify({ kind: 'radio', asset_no: 'RD-14', silo: 'MetroPolice' })], /already in the register/);
    await refused(`select public.save_field_kit($1::jsonb)`, [JSON.stringify({ kind: 'radio', asset_no: 'RD-16', serial: 'e977-0001', silo: 'MetroPolice' })], /Serial E977-0001|Serial e977-0001/);
    await refused(`select public.save_field_kit($1::jsonb)`, [JSON.stringify({ kind: 'radio', asset_no: 'RD-17', device_id: 'nonsense', silo: 'MetroPolice' })], /HT-XXXX-XXXX/);
    await as(U.sipho);
    await refused(`select public.save_field_kit($1::jsonb)`, [JSON.stringify({ kind: 'radio', asset_no: 'RD-18', silo: 'MetroPolice' })], /Only command/);
    await refused('insert into public.field_kit (silo, kind, asset_no) values ($1, $2, $3)', ['MetroPolice', 'radio', 'RD-19'], /permission denied/);
    await as(U.sgt, 'Supervisor', 'MetroFire');
    await refused(`select public.save_field_kit($1::jsonb)`, [JSON.stringify({ kind: 'radio', asset_no: 'RD-20', silo: 'MetroPolice' })], /Only command/);
  });

  await scenario('a radio running the app books itself to whoever starts the shift on it', async () => {
    const b = await book(U.sipho, { device: RADIO_ID.toLowerCase() });
    assert.equal(b.booked, true);
    assert.equal(b.asset_no, 'RD-14');
    assert.deepEqual(await openOf(U.sipho), ['RD-14:device']);
    assert.equal((await kit('RD-14', 'radio')).status, 'in_use');
    assert.equal((await book(U.sipho, { device: RADIO_ID })).already, true, 'starting again changes nothing');
    assert.deepEqual(await book(U.sipho, { device: 'HT-ZZZZ-ZZZZ' }), { booked: false }, 'a phone that is not kit books nothing');
  });

  await scenario('a hard hat by its number; one of each at a time', async () => {
    assert.equal((await book(U.sipho, { kind: 'hard_hat', no: 'hh-0042' })).asset_no, 'HH-0042');
    await book(U.sipho, { kind: 'hard_hat', no: 'HH 0043' });
    assert.deepEqual(await openOf(U.sipho), ['HH-0043:number'], 'the first hard hat went back');
    assert.equal((await kit('HH-0042')).status, 'available');
    await as(U.sipho);
    await refused("select public.book_field_kit(p_kind => 'hard_hat', p_asset_no => 'HH-9999')", [], /no hard hat HH-9999/);
  });

  await scenario('a smart hard hat books itself the same way', async () => {
    assert.equal((await book(U.thabo, { device: HAT_ID })).asset_no, 'HH-0007');
    assert.deepEqual(await openOf(U.thabo), ['HH-0007:device']);
  });

  await scenario('a hard hat still booked to someone who forgot is taken over, and that is noted', async () => {
    await book(U.sipho, { kind: 'hard_hat', no: 'HH-0050' });
    const b = await book(U.thabo, { kind: 'hard_hat', no: 'HH-0050' });
    assert.equal(b.taken_from, 'Const. Sipho Khumalo');
    assert.deepEqual(await openOf(U.sipho), []);
    assert.deepEqual(await openOf(U.thabo), ['HH-0050:number']);
    const old = (await db.query("select return_condition, return_note from public.field_kit_bookings where user_id = $1", [U.sipho])).rows[0];
    assert.deepEqual([old.return_condition, old.return_note], ['taken_over', 'Taken by Const. Thabo Dube']);
    assert.match((await db.query("select details from public.audit_logs where action_type = 'KitBookedOut' order by details desc limit 1")).rows[0].details, /taken over from Const\. Sipho Khumalo/);
  });

  await scenario('another department’s kit, or kit in repair, cannot be booked', async () => {
    await as(U.fire, 'Fire', 'MetroFire');
    await refused("select public.book_field_kit(p_kind => 'hard_hat', p_asset_no => 'HH-0001')", [], /no hard hat HH-0001/);
    await refused('select public.book_field_kit(p_device_id => $1)', [RADIO_ID], /another department/);
    await sgt();
    const k = await kit('HH-0060');
    await sgt();
    await db.query('select public.save_field_kit($1::jsonb)', [JSON.stringify({ id: k.id, kind: 'hard_hat', asset_no: 'HH-0060', silo: 'MetroPolice', status: 'repair', status_note: 'Camera cracked' })]);
    await as(U.sipho);
    await refused("select public.book_field_kit(p_kind => 'hard_hat', p_asset_no => 'HH-0060')", [], /in for repair/);
  });

  await scenario('handed back damaged or lost: repair or lost, and command is told', async () => {
    const b = await book(U.sipho, { kind: 'hard_hat', no: 'HH-0070' });
    await as(U.sipho);
    await refused("select public.return_field_kit($1, 'damaged')", [b.booking_id], /Say what happened/);
    await as(U.thabo);
    await refused("select public.return_field_kit($1, 'fine')", [b.booking_id], /Only the person who has it/);
    await as(U.sipho);
    await db.query("select public.return_field_kit($1, 'damaged', 'Visor cracked')", [b.booking_id]);
    assert.deepEqual([(await kit('HH-0070')).status, (await kit('HH-0070')).status_note], ['repair', 'Visor cracked']);
    const r = await book(U.sipho, { kind: 'radio', no: 'RD-15' });
    await sgt();
    await db.query("select public.return_field_kit($1, 'lost', 'Fell off the bakkie on the N3')", [r.booking_id]);
    assert.equal((await kit('RD-15', 'radio')).status, 'lost');
    await db.query('reset role');
    assert.deepEqual((await db.query('select title from public.told order by title')).rows.map((x) => x.title),
      ['Hard hat HH-0070 handed back damaged', 'Radio RD-15 reported lost']);
  });

  await scenario('end of shift hands everything back', async () => {
    await book(U.sipho, { device: RADIO_ID });
    await book(U.sipho, { kind: 'hard_hat', no: 'HH-0080' });
    await as(U.sipho);
    assert.equal((await db.query('select public.return_my_field_kit() as n')).rows[0].n, 2);
    assert.deepEqual(await openOf(U.sipho), []);
    assert.equal((await kit('RD-14', 'radio')).status, 'available');
  });

  await scenario('officers see only their own bookings; command sees the department', async () => {
    await book(U.sipho, { kind: 'hard_hat', no: 'HH-0090' });
    await book(U.thabo, { kind: 'hard_hat', no: 'HH-0091' });
    await as(U.sipho);
    assert.equal((await db.query('select count(*)::int as n from public.field_kit_bookings')).rows[0].n, 1);
    assert.equal((await db.query('select count(*)::int as n from public.field_kit')).rows[0].n, 304, 'the register is visible to pick from');
    await sgt();
    assert.equal((await db.query('select count(*)::int as n from public.field_kit_bookings')).rows[0].n, 2);
    await as(U.fire, 'Fire', 'MetroFire');
    assert.equal((await db.query('select count(*)::int as n from public.field_kit')).rows[0].n, 0);
  });

  await scenario('kit out with someone cannot be retired; retired kit is kept', async () => {
    const b = await book(U.sipho, { kind: 'hard_hat', no: 'HH-0100' });
    const k = await kit('HH-0100');
    await sgt();
    await refused("select public.retire_field_kit($1, 'Broken')", [k.id], /out with someone/);
    await db.query("select public.return_field_kit($1, 'fine')", [b.booking_id]);
    await db.query("select public.retire_field_kit($1, 'Broken beyond repair')", [k.id]);
    const after = await kit('HH-0100');
    assert.equal(after.status, 'retired');
    assert.ok(after.retired_at);
  });

  await db.query('rollback');
  console.log(`\n${checks} scenarios passed; 0101 applied twice.`);
} finally {
  await db.close();
}
