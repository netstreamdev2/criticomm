/** Run the real radio register migration (0082) against in-memory Postgres
 * (PGlite): who may add and change radios, who reads which, the checks on
 * what is entered, and the audit trail.
 *
 * CASE_PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node scripts/test-radio-register.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.CASE_PGLITE_MODULE || '@electric-sql/pglite');

const migration = readFileSync(new URL('../supabase/migrations/0082_radio_register.sql', import.meta.url), 'utf8');
const db = new PGlite();
let checks = 0;

const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = '20000000-0000-4000-8000-000000000001';
const T2 = '20000000-0000-4000-8000-000000000002';
const U = { sysadmin: id(1), policeAdmin: id(2), fireAdmin: id(3), dispatcher: id(4), cop: id(5), otherOrg: id(6), controller: id(7) };
const who = {
  [U.sysadmin]: ['SystemAdmin', 'Ethekwini', T], [U.policeAdmin]: ['Admin', 'MetroPolice', T], [U.fireAdmin]: ['Admin', 'MetroFire', T],
  [U.dispatcher]: ['Dispatcher', 'MetroPolice', T], [U.cop]: ['Police', 'MetroPolice', T], [U.otherOrg]: ['SystemAdmin', 'Ethekwini', T2],
  [U.controller]: ['SystemController', 'Ethekwini', T],
};
const P = { khumalo: id(101), otherOrgPerson: id(102) };
const V = { mp12: id(201) };

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
const save = (o) => db.query(
  'select * from public.save_radio_device($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)',
  [o.id ?? null, o.provider ?? 'pocstar', o.kind ?? 'radio', o.account ?? 'FIRE ALPHA', o.label ?? null, o.uid ?? null, o.imei ?? null,
    o.silo ?? 'MetroPolice', o.person ?? null, o.vehicle ?? null, o.notes ?? null, o.active ?? true],
).then((r) => r.rows[0]);
const visible = async () => (await db.query('select account from public.radio_devices order by account')).rows.map((r) => r.account);

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
    create table public.personnel (id uuid primary key, tenant_id uuid not null, first_name text);
    create table public.apparatus (id uuid primary key, tenant_id uuid not null, unit_number text);
    create table public.audit_logs (id uuid primary key default gen_random_uuid(), tenant_id uuid, silo public.silo, user_id uuid,
      user_name text, action_type text, entity_type text, entity_id text, details text);
    insert into public.profiles values ('${U.sysadmin}', 'Sys Admin'), ('${U.policeAdmin}', 'Police Admin');
    insert into public.personnel values ('${P.khumalo}', '${T}', 'Khumalo'), ('${P.otherOrgPerson}', '${T2}', 'Elsewhere');
    insert into public.apparatus values ('${V.mp12}', '${T}', 'MP-12');
    grant usage on schema public, auth to authenticated;
    grant select on public.audit_logs to authenticated;
  `);
  await db.exec(migration);
  await db.exec(migration); // safe to re-run
  await db.query('begin');

  await scenario('the system administrator adds radios and hard hats for any department, audited', async () => {
    await as(U.sysadmin);
    const r = await save({ account: '  FIRE ALPHA ', silo: 'MetroFire', imei: '86 1234 5678 9012 3', person: P.khumalo });
    assert.equal(r.account, 'FIRE ALPHA', 'trimmed');
    assert.equal(r.imei, '861234567890123', 'spaces taken out');
    assert.equal(r.tenant_id, T);
    const hat = await save({ account: 'HAT-07', kind: 'hard_hat', silo: 'MetroPolice', vehicle: V.mp12 });
    assert.equal(hat.kind, 'hard_hat');
    await db.query('reset role');
    const audit = (await db.query("select action_type, details from public.audit_logs order by details")).rows;
    assert.deepEqual(audit.map((a) => a.action_type), ['RadioAdded', 'RadioAdded']);
    assert.ok(audit.some((a) => /pocstar radio "FIRE ALPHA"/.test(a.details)));
  });

  await scenario('a department’s administrator: their own department only', async () => {
    await as(U.policeAdmin);
    await save({ account: 'MP-01', silo: 'MetroPolice' });
    await refused(() => save({ account: 'FIRE-02', silo: 'MetroFire' }), /your own department/);
    await as(U.fireAdmin);
    const fire = await save({ account: 'FIRE-02', silo: 'MetroFire' });
    await as(U.policeAdmin);
    await refused(() => save({ id: fire.id, account: 'FIRE-02', silo: 'MetroPolice' }), /your own department/, 'cannot take another department’s radio');
  });

  await scenario('dispatchers and officers read radios, and change none', async () => {
    await as(U.sysadmin);
    await save({ account: 'MP-01', silo: 'MetroPolice' });
    await save({ account: 'FIRE-02', silo: 'MetroFire' });
    await as(U.dispatcher);
    assert.deepEqual(await visible(), ['FIRE-02', 'MP-01'], 'dispatch sees every department');
    await refused(() => save({ account: 'X' }), /Not permitted/);
    await refused(() => db.query("insert into public.radio_devices (provider, account, silo) values ('pocstar', 'X', 'MetroPolice')"), /permission denied/);
    await refused(() => db.query("update public.radio_devices set account = 'Y'"), /permission denied/);
    await as(U.cop);
    assert.deepEqual(await visible(), ['MP-01'], 'an officer sees their own department’s');
    await refused(() => db.query('delete from public.radio_devices'), /permission denied/);
  });

  await scenario('another organisation sees none of ours, and cannot link our people', async () => {
    await as(U.sysadmin);
    await save({ account: 'MP-01' });
    await as(U.otherOrg);
    assert.deepEqual(await visible(), []);
    await refused(() => save({ account: 'MP-01', person: P.khumalo }), /not on the staff register/);
    await as(U.sysadmin);
    await refused(() => save({ account: 'MP-09', person: P.otherOrgPerson }), /not on the staff register/);
  });

  await scenario('what is entered is checked: platform, kind, account, IMEI, duplicates', async () => {
    await as(U.controller);
    await save({ account: 'Nets1', provider: 'realptt' });
    await refused(() => save({ account: 'nets1x', provider: 'zello' }), /PocStar or RealPTT/);
    await refused(() => save({ account: 'A', kind: 'phone' }), /radio, a hard hat or a dispatcher seat/);
    await refused(() => save({ account: '   ' }), /Enter the account/);
    await refused(() => save({ account: 'A', imei: '1234' }), /IMEI is 15 digits/);
    await refused(() => save({ account: 'Nets1', provider: 'realptt' }), /already in the register/);
    // The same name on the other platform is a different radio.
    await save({ account: 'Nets1', provider: 'pocstar' });
  });

  await scenario('retired, not deleted: the history still reads', async () => {
    await as(U.sysadmin);
    const r = await save({ account: 'OLD-1' });
    const retired = await save({ id: r.id, account: 'OLD-1', active: false });
    assert.equal(retired.active, false);
    assert.deepEqual(await visible(), ['OLD-1']);
    await db.query('reset role');
    assert.equal((await db.query("select action_type from public.audit_logs where action_type = 'RadioRetired'")).rows.length, 1);
  });

  await db.query('rollback');
  console.log(`\n${checks} scenarios passed; 0082 applied twice.`);
} finally {
  await db.close();
}
