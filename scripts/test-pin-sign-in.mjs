/** Run PIN sign-in on a registered device (0108, 0109, 0110) against
 * in-memory Postgres (PGlite, with pgcrypto for bcrypt): what was hashed on
 * the web server before 0110 is cleared; only a supervisor or an
 * administrator registers a device, the database makes its key, and
 * registering it again ends the old registration and its sign-ins; a PIN is
 * chosen straight from the phone, proven by the current PIN, the password or
 * a password sign-in in the last 30 minutes, with only the obvious rules; a
 * PIN is tried only on a live device with its key, for an active officer of
 * the device's department who has a PIN; five wrong PINs lock it until a
 * supervisor unlocks it or the officer proves it with their password; a
 * reset clears it and ends the officer's device sign-ins; removing a device
 * ends every sign-in made on it; device sign-ins end after 14 hours; the
 * device lists its officers by department and name; the PIN checks are the
 * server's alone, and no table takes a write except through the functions.
 *
 * Needs PGlite 0.3 or later (pgcrypto):
 * CASE_PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node scripts/test-pin-sign-in.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const base = process.env.CASE_PGLITE_MODULE || '@electric-sql/pglite';
const { PGlite } = await import(base);
const { pgcrypto } = await import(base.endsWith('index.js') ? base.replace(/index\.js$/, 'contrib/pgcrypto.js') : `${base}/contrib/pgcrypto`);

const sql = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const db = new PGlite({ extensions: { pgcrypto } });
let checks = 0;

const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = '20000000-0000-4000-8000-000000000001';
const OTHER_T = '20000000-0000-4000-8000-000000000002';
const U = { cop: id(1), cop2: id(2), sgt: id(3), admin: id(4), medic: id(5), gone: id(6), dup1: id(7), dup2: id(8), staffOnly: id(9), stranger: id(10), fireSgt: id(11) };
const S = { a: id(101), b: id(102), c: id(103) };
const PIN = '482139';
const PASSWORD = 'Durban-Station-7';
const OLD_DEVICE = id(900);
const now = () => Math.floor(Date.now() / 1000);
/** A token from a password sign-in `minutesAgo` minutes ago. */
const passwordJwt = (session = null, minutesAgo = 1) => ({ session_id: session, amr: [{ method: 'password', timestamp: now() - minutesAgo * 60 }] });
const pinJwt = (session = null) => ({ session_id: session, amr: [{ method: 'otp', timestamp: now() }] });

async function as(uid, role = 'Officer', silo = 'MetroPolice', jwt = null) {
  await db.query('reset role');
  await db.query(
    "select set_config('test.user', $1, true), set_config('test.role', $2, true), set_config('test.silo', $3, true), set_config('test.jwt', $4, true)",
    [uid, role, silo, jwt ? JSON.stringify(jwt) : ''],
  );
  await db.query('set local role authenticated');
}
async function server() {
  await db.query('reset role');
  await db.query("select set_config('test.user', '', true), set_config('test.role', '', true), set_config('test.jwt', '', true)");
  await db.query('set local role service_role');
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
const one = async (q, params = []) => (await db.query(q, params)).rows[0];
const register = async (uid, role, silo, label = 'RD-0014', radio = 'HT-AB12-CD34') => {
  await as(uid, role, silo);
  return (await one('select public.register_sign_in_device($1, $2) as r', [label, radio])).r;
};
const choose = async (uid, pin = PIN, { current = null, password = null, jwt = passwordJwt() } = {}) => {
  await as(uid, 'Officer', 'MetroPolice', jwt);
  return (await one('select public.set_my_sign_in_pin($1, $2, $3) as r', [pin, current, password])).r;
};
const setPin = async (uid, pin = PIN) => assert.deepEqual(await choose(uid, pin), { ok: true });
const lookup = async (device, key, user, badge) => {
  await server();
  return (await one('select public.sign_in_pin_lookup($1, $2, $3, $4) as r', [device, key, user, badge])).r;
};
const attempt = async (device, key, user, pin) => {
  await server();
  return (await one('select public.sign_in_pin_attempt($1, $2, $3, $4) as r', [device, key, user, pin])).r;
};
const officers = async (device, key) => {
  await server();
  return (await one('select public.sign_in_device_officers($1, $2) as r', [device, key])).r;
};
const audits = async () => { await db.query('reset role'); return (await db.query('select action_type from public.audit_logs order by seq')).rows.map((r) => r.action_type); };
const sessions = async () => { await db.query('reset role'); return (await db.query('select id from auth.sessions order by id')).rows.map((r) => r.id); };
const noteSession = async (uid, device, session) => {
  await as(uid, 'Officer', 'MetroPolice', pinJwt(session));
  await db.query('select public.record_sign_in_device_session($1)', [device]);
};

try {
  await db.exec(`
    create role authenticated nologin; create role anon nologin; create role service_role nologin;
    create schema extensions;
    create extension pgcrypto with schema extensions;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user', true), '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('test.jwt', true), '')::jsonb $$;
    create table auth.users (id uuid primary key, email text, encrypted_password text);
    create table auth.sessions (id uuid primary key, user_id uuid);
    create type public.silo as enum ('MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster', 'Ethekwini');
    create function public.current_tenant() returns uuid language sql stable as $$ select '${T}'::uuid $$;
    create function public.current_silo() returns public.silo language sql stable as $$ select nullif(current_setting('test.silo', true), '')::public.silo $$;
    create function public.role_in(variadic roles text[]) returns boolean language sql stable as $$ select current_setting('test.role', true) = any (roles) $$;
    -- 0051's rule, as it reads.
    create function public.can_manage_armoury(p_silo public.silo) returns boolean language sql stable as $$
      select public.role_in('SystemAdmin', 'SuperAdmin', 'SystemController')
          or (p_silo = public.current_silo() and public.role_in('Admin', 'System', 'Supervisor', 'Captain', 'FireChief')) $$;
    -- 0049's.
    create function public.normalise_badge(p_badge text) returns text language sql immutable as $$
      select upper(regexp_replace(coalesce(p_badge, ''), '[^A-Za-z0-9]', '', 'g')) $$;
    create table public.rl (k text, at timestamptz default now());
    create function public.rate_limit_hit_key(p_key text, p_limit int, p_window_seconds int)
      returns table (allowed boolean, remaining int, reset_at timestamptz) language plpgsql security definer as $$
      begin
        insert into public.rl (k) values ('key:' || p_key);
        return query select (select count(*) from public.rl where k = 'key:' || p_key) <= p_limit, 0, now();
      end $$;
    create table public.profiles (id uuid primary key, tenant_id uuid, silo public.silo, role text, full_name text,
      badge_number text, deactivated_at timestamptz);
    create table public.personnel (id uuid primary key default gen_random_uuid(), user_id uuid, badge_number text);
    create table public.audit_logs (seq bigint generated always as identity, tenant_id uuid, silo public.silo not null, user_id uuid,
      user_name text, department text, action_type text not null, entity_type text, entity_id text, details text);
    grant usage on schema public, auth, extensions to authenticated, service_role, anon;
    grant select on public.profiles to authenticated;
    insert into public.profiles values
      ('${U.cop}', '${T}', 'MetroPolice', 'Officer', 'Const. Lindiwe Dube', 'MP-1042', null),
      ('${U.cop2}', '${T}', 'MetroPolice', 'Officer', 'Const. Sipho Zulu', 'MP-1043', null),
      ('${U.sgt}', '${T}', 'MetroPolice', 'Supervisor', 'Sgt. Khumalo', 'MP-0007', null),
      ('${U.admin}', '${T}', 'Ethekwini', 'SystemAdmin', 'Nomsa Admin', null, null),
      ('${U.medic}', '${T}', 'Medical', 'Paramedic', 'Thandi Mkhize', 'EM-3007', null),
      ('${U.gone}', '${T}', 'MetroPolice', 'Officer', 'Left the service', 'MP-0999', now()),
      ('${U.dup1}', '${T}', 'MetroPolice', 'Officer', 'Twin one', 'MP-5000', null),
      ('${U.dup2}', '${T}', 'MetroPolice', 'Officer', 'Twin two', 'mp 5000', null),
      ('${U.staffOnly}', '${T}', 'MetroPolice', 'Officer', 'Badge on the staff record', null, null),
      ('${U.stranger}', '${OTHER_T}', 'MetroPolice', 'Officer', 'Other municipality', 'MP-1042X', null),
      ('${U.fireSgt}', '${T}', 'MetroFire', 'Supervisor', 'Captain Naidoo', 'MF-0001', null);
    insert into public.personnel (user_id, badge_number) values ('${U.staffOnly}', 'MP-2024');
    insert into auth.users
      select id, lower(coalesce(public.normalise_badge(badge_number), 'x')) || '@ethekwini.badge.internal',
             extensions.crypt('${PASSWORD}', extensions.gen_salt('bf', 6))
        from public.profiles;
  `);
  await db.exec(sql('0108_pin_sign_in.sql'));
  await db.exec(sql('0108_pin_sign_in.sql')); // safe to re-run
  await db.exec(sql('0109_pin_sign_in_officers.sql'));
  // Set up the 0108 way (hashed on the web server), to see 0110 clear it.
  await db.exec(`
    insert into public.sign_in_devices (id, tenant_id, silo, label, radio_id, secret_hash, registered_by)
    values ('${OLD_DEVICE}', '${T}', 'MetroPolice', 'Old phone', 'HT-AAA1-AAA1', repeat('a', 64), '${U.sgt}');
    insert into public.sign_in_pins (user_id, tenant_id, pin_hash) values ('${U.cop}', '${T}', repeat('1', 64));
    insert into auth.sessions values ('${S.c}', '${U.cop}');
    insert into public.sign_in_device_sessions (session_id, device_id, user_id) values ('${S.c}', '${OLD_DEVICE}', '${U.cop}');
  `);
  await db.exec(sql('0110_pin_sign_in_simpler.sql'));
  await db.exec(sql('0110_pin_sign_in_simpler.sql')); // safe to re-run
  await db.query('begin');

  await scenario('0110 clears what was hashed on the web server: old devices removed (their sign-ins ended), old PINs cleared', async () => {
    await db.query('reset role');
    const old = await one('select removed_at, removed_reason, key_kind from public.sign_in_devices where id = $1', [OLD_DEVICE]);
    assert.ok(old.removed_at);
    assert.match(old.removed_reason, /Register it again/);
    assert.equal(old.key_kind, 'server');
    assert.deepEqual(await sessions(), [], 'the sign-in made on it has ended');
    assert.equal((await one('select count(*)::int as n from public.sign_in_pins')).n, 0);
  });

  await scenario('only a supervisor or an administrator registers a device; the database makes its key and keeps only its hash', async () => {
    await refused(() => register(U.cop, 'Officer', 'MetroPolice'), /Only a supervisor or an administrator/);
    const dept = await register(U.sgt, 'Supervisor', 'MetroPolice');
    assert.equal(dept.silo, 'MetroPolice');
    assert.match(dept.key, /^[0-9a-f]{64}$/);
    const all = await register(U.admin, 'SystemAdmin', 'Ethekwini', 'Station test phone', 'HT-ZZ99-ZZ99');
    assert.equal(all.silo, null, 'a tenant-wide administrator registers for every department');
    assert.notEqual(all.key, dept.key);
    await db.query('reset role');
    const row = await one('select secret_hash, key_kind from public.sign_in_devices where id = $1', [dept.id]);
    assert.notEqual(row.secret_hash, dept.key, 'the key itself is not kept');
    assert.equal(row.key_kind, 'database');
    assert.deepEqual((await audits()).slice(-2), ['SignInDeviceRegistered', 'SignInDeviceRegistered']);
  });

  await scenario('a device needs a name and a proper Radio ID; registering it again ends the old one and its sign-ins', async () => {
    await refused(() => register(U.sgt, 'Supervisor', 'MetroPolice', '  '), /Give the device a name/);
    await refused(() => register(U.sgt, 'Supervisor', 'MetroPolice', 'RD-1', 'RADIO-1'), /HT-XXXX-XXXX/);
    const first = await register(U.sgt, 'Supervisor', 'MetroPolice');
    await db.query('reset role');
    await db.query('insert into auth.sessions values ($1, $2)', [S.a, U.cop]);
    await noteSession(U.cop, first.id, S.a);
    const again = await register(U.sgt, 'Supervisor', 'MetroPolice');
    assert.notEqual(again.id, first.id);
    assert.equal((await lookup(first.id, first.key, U.cop, null)).state, 'device');
    assert.deepEqual(await sessions(), []);
  });

  await scenario('a PIN is chosen straight from the phone: just after a password sign-in nothing more is asked; later, proof is', async () => {
    assert.deepEqual(await choose(U.cop, PIN, { jwt: passwordJwt(null, 2) }), { ok: true });
    await db.query('reset role');
    const kept = await one('select pin_hash from public.sign_in_pins where user_id = $1', [U.cop]);
    assert.match(kept.pin_hash, /^\$2/, 'bcrypt, never the PIN');
    assert.ok(!kept.pin_hash.includes(PIN));
    assert.deepEqual(await choose(U.cop2, PIN, { jwt: passwordJwt(null, 45) }), { ok: false, state: 'proof', has_pin: false });
    assert.deepEqual(await choose(U.cop2, PIN, { jwt: pinJwt() }), { ok: false, state: 'proof', has_pin: false }, 'a PIN sign-in is not a password sign-in');
    assert.equal((await audits()).at(-1), 'PinSet');
  });

  await scenario('changing a PIN: the current PIN is enough; a wrong one counts toward the lock; the password always works', async () => {
    await setPin(U.cop);
    const later = { jwt: pinJwt() };
    assert.deepEqual(await choose(U.cop, '905317', { ...later, current: PIN }), { ok: true });
    assert.equal((await choose(U.cop, '111222', { ...later, current: PIN })).state, 'wrong_pin', 'the old PIN no longer works');
    assert.deepEqual(await choose(U.cop, '246810', { ...later, password: 'not it' }), { ok: false, state: 'wrong_password' });
    assert.deepEqual(await choose(U.cop, '246810', { ...later, password: PASSWORD }), { ok: true });
    assert.equal((await audits()).filter((a) => a === 'PinChanged').length, 2);
  });

  await scenario('five wrong current PINs lock it; the password unlocks it by choosing a new one', async () => {
    await setPin(U.cop);
    const later = { jwt: pinJwt() };
    for (const left of [4, 3, 2, 1]) {
      // Each try passes the five-a-quarter-hour limit: cleared between tries here.
      await db.query('reset role'); await db.query('delete from public.rl');
      assert.deepEqual(await choose(U.cop, '905317', { ...later, current: '000001' }), { ok: false, state: 'wrong_pin', tries_left: left });
    }
    await db.query('reset role'); await db.query('delete from public.rl');
    assert.deepEqual(await choose(U.cop, '905317', { ...later, current: '000001' }), { ok: false, state: 'locked', tries_left: 0 });
    await db.query('reset role'); await db.query('delete from public.rl');
    assert.equal((await choose(U.cop, '905317', { ...later, current: PIN })).state, 'locked', 'the right PIN does not get past a lock');
    assert.deepEqual(await choose(U.cop, '905317', { ...later, password: PASSWORD }), { ok: true });
    const dev = await register(U.sgt, 'Supervisor', 'MetroPolice');
    assert.equal((await attempt(dev.id, dev.key, U.cop, '905317')).state, 'ok', 'unlocked and working');
  });

  await scenario('proof can be tried five times a quarter hour, so a password cannot be guessed here', async () => {
    await setPin(U.cop);
    for (let i = 0; i < 5; i++) await choose(U.cop, '905317', { jwt: pinJwt(), password: `guess ${i}` });
    assert.deepEqual(await choose(U.cop, '905317', { jwt: pinJwt(), password: PASSWORD }), { ok: false, state: 'busy' });
  });

  await scenario('the PIN rules are the obvious ones only', async () => {
    await refused(() => choose(U.cop, '12345'), /6 digits/);
    await refused(() => choose(U.cop, '12345a'), /6 digits/);
    await refused(() => choose(U.cop, '777777'), /one digit six times/);
    await refused(() => choose(U.cop, '123456'), /123456 or 654321/);
    await refused(() => choose(U.cop, '654321'), /123456 or 654321/);
    for (const fine of ['121212', '104200', '112233', '159753']) {
      await db.query('savepoint p');
      assert.deepEqual(await choose(U.cop, fine), { ok: true }, `${fine} is allowed now`);
      await db.query('rollback to savepoint p');
    }
    await refused(() => choose(U.gone, PIN), /deactivated/);
  });

  await scenario('a PIN is tried only on a live device with its own key', async () => {
    const dev = await register(U.sgt, 'Supervisor', 'MetroPolice');
    await setPin(U.cop);
    assert.equal((await lookup(dev.id, dev.key, U.cop, null)).state, 'ok');
    assert.equal((await lookup(dev.id, 'f'.repeat(64), U.cop, null)).state, 'device');
    assert.equal((await lookup(id(999), dev.key, U.cop, null)).state, 'device');
    await as(U.sgt, 'Supervisor', 'MetroPolice');
    await db.query('select public.remove_sign_in_device($1, $2)', [dev.id, 'Lost on patrol']);
    assert.equal((await attempt(dev.id, dev.key, U.cop, PIN)).state, 'device', 'a removed device signs nobody in');
  });

  await scenario('the officer is found by id or badge, however typed; never guessed; deactivated, no PIN and elsewhere told apart', async () => {
    const dev = await register(U.admin, 'SystemAdmin', 'Ethekwini', 'Shared', 'HT-ZZ99-ZZ99');
    await setPin(U.cop);
    await setPin(U.staffOnly);
    assert.equal((await lookup(dev.id, dev.key, null, ' mp 1042 ')).user_id, U.cop);
    assert.equal((await lookup(dev.id, dev.key, null, 'MP-2024')).user_id, U.staffOnly);
    assert.equal((await lookup(dev.id, dev.key, null, 'MP-5000')).state, 'unknown', 'two accounts with one badge');
    assert.equal((await lookup(dev.id, dev.key, null, 'MP-1042X')).state, 'unknown', 'another municipality');
    assert.equal((await lookup(dev.id, dev.key, U.gone, null)).state, 'inactive');
    assert.equal((await lookup(dev.id, dev.key, U.cop2, null)).state, 'no_pin');
    const police = await register(U.sgt, 'Supervisor', 'MetroPolice');
    await setPin(U.medic);
    assert.equal((await lookup(police.id, police.key, U.medic, null)).state, 'elsewhere');
    assert.equal((await lookup(dev.id, dev.key, U.medic, null)).state, 'ok', 'a device for every department');
  });

  await scenario('the right PIN signs in with the sign-in email and clears wrong tries; five wrong lock it until a supervisor unlocks', async () => {
    const dev = await register(U.sgt, 'Supervisor', 'MetroPolice');
    await setPin(U.cop);
    assert.equal((await attempt(dev.id, dev.key, U.cop, '000001')).tries_left, 4);
    const ok = await attempt(dev.id, dev.key, U.cop, PIN);
    assert.equal(ok.state, 'ok');
    assert.equal(ok.email, 'mp1042@ethekwini.badge.internal');
    assert.equal((await lookup(dev.id, dev.key, U.cop, null)).tries_left, 5);
    for (let i = 0; i < 4; i++) await attempt(dev.id, dev.key, U.cop, '000001');
    assert.equal((await attempt(dev.id, dev.key, U.cop, '000001')).state, 'locked');
    assert.equal((await attempt(dev.id, dev.key, U.cop, PIN)).state, 'locked');
    await as(U.fireSgt, 'Supervisor', 'MetroFire');
    await refused(() => db.query('select public.unlock_sign_in_pin($1)', [U.cop]), /Only a supervisor or an administrator unlocks/);
    await as(U.sgt, 'Supervisor', 'MetroPolice');
    await db.query('select public.unlock_sign_in_pin($1)', [U.cop]);
    assert.equal((await attempt(dev.id, dev.key, U.cop, PIN)).state, 'ok');
  });

  await scenario('a reset clears the PIN and ends the officer\'s device sign-ins; removing a device ends every sign-in on it', async () => {
    const dev = await register(U.sgt, 'Supervisor', 'MetroPolice');
    await setPin(U.cop);
    await db.query('reset role');
    await db.query('insert into auth.sessions values ($1, $2), ($3, $4)', [S.a, U.cop, S.b, U.cop2]);
    await noteSession(U.cop, dev.id, S.a);
    await noteSession(U.cop2, dev.id, S.b);
    await as(U.sgt, 'Supervisor', 'MetroPolice');
    await db.query('select public.reset_sign_in_pin($1, $2)', [U.cop, 'Forgot it']);
    assert.equal((await lookup(dev.id, dev.key, U.cop, null)).state, 'no_pin');
    assert.deepEqual(await sessions(), [S.b]);
    await as(U.sgt, 'Supervisor', 'MetroPolice');
    await db.query('select public.remove_sign_in_device($1, $2)', [dev.id, 'Lost']);
    assert.deepEqual(await sessions(), []);
  });

  await scenario('device sign-ins end after 14 hours, at the server', async () => {
    const dev = await register(U.sgt, 'Supervisor', 'MetroPolice');
    await db.query('reset role');
    await db.query('insert into auth.sessions values ($1, $2), ($3, $4)', [S.a, U.cop, S.b, U.cop2]);
    await db.query("insert into public.sign_in_device_sessions values ($1, $2, $3, now() - interval '15 hours'), ($4, $2, $5, now() - interval '13 hours')",
      [S.a, dev.id, U.cop, S.b, U.cop2]);
    await server();
    assert.equal((await one('select public.end_stale_sign_in_sessions() as n')).n, 1);
    assert.deepEqual(await sessions(), [S.b]);
  });

  await scenario('a registered device lists its department\'s officers who have a PIN, for its own key only (0109)', async () => {
    const police = await register(U.sgt, 'Supervisor', 'MetroPolice');
    for (const u of [U.cop, U.cop2, U.medic, U.admin]) await setPin(u);
    const list = await officers(police.id, police.key);
    assert.deepEqual(list.officers.map((o) => o.user_id).sort(), [U.cop, U.cop2, U.admin].sort());
    assert.equal((await officers(police.id, 'f'.repeat(64))).state, 'device');
  });

  await scenario('the console board never shows a hash; the PIN checks are the server\'s alone; no table takes a write', async () => {
    const dev = await register(U.sgt, 'Supervisor', 'MetroPolice');
    await setPin(U.cop);
    await as(U.sgt, 'Supervisor', 'MetroPolice');
    const board = (await db.query('select * from public.sign_in_pin_board()')).rows;
    assert.ok(!Object.keys(board[0]).some((k) => /hash/.test(k)));
    assert.equal(board.find((r) => r.user_id === U.cop).has_pin, true);
    await as(U.cop, 'Officer', 'MetroPolice');
    await refused(() => db.query('select public.sign_in_pin_lookup($1, $2, $3, null)', [dev.id, dev.key, U.cop]), /permission denied/);
    await refused(() => db.query('select public.sign_in_pin_attempt($1, $2, $3, $4)', [dev.id, dev.key, U.cop, PIN]), /permission denied/);
    await refused(() => db.query('select public.sign_in_device_officers($1, $2)', [dev.id, dev.key]), /permission denied/);
    await refused(() => db.query('select * from public.sign_in_pins'), /permission denied/);
    await refused(() => db.query("update public.sign_in_pins set failed_count = 0"), /permission denied/);
    assert.equal((await db.query('select * from public.sign_in_devices')).rows.length, 0, 'an officer reads no devices');
    await db.query('reset role');
    await db.query("select set_config('test.user', '', true)");
    await db.query('set local role anon');
    await refused(() => db.query("select public.register_sign_in_device('x', null)"), /permission denied/);
    await refused(() => db.query("select public.set_my_sign_in_pin('482139')"), /permission denied/);
  });

  await db.query('rollback');
  console.log(`\n${checks} scenarios passed; 0108, 0109 and 0110 applied (0108 and 0110 twice).`);
} finally {
  await db.close();
}
