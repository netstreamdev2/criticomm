/** Run the real talk-wake migration (0095) against in-memory Postgres
 * (PGlite): who may call the radios, one open call per talk group kept on by
 * each press, and only the radios that may hear a group see its call.
 *
 * CASE_PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node scripts/test-talk-wake.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.CASE_PGLITE_MODULE || '@electric-sql/pglite');

const migration = readFileSync(new URL('../supabase/migrations/0095_talk_wake.sql', import.meta.url), 'utf8');
const db = new PGlite();
let checks = 0;

const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = '20000000-0000-4000-8000-000000000001';
const OTHER_T = '20000000-0000-4000-8000-000000000002';
const U = { desk: id(1), police: id(2), fire: id(3), logger: id(4), elsewhere: id(5) };
const who = {
  [U.desk]: ['Dispatcher', 'Ethekwini', T],
  [U.police]: ['Police', 'MetroPolice', T],
  [U.fire]: ['Firefighter', 'MetroFire', T],
  [U.logger]: ['IncidentLogger', 'MetroPolice', T],
  [U.elsewhere]: ['Police', 'MetroPolice', OTHER_T],
};

async function as(uid) {
  await db.query('reset role');
  const [role, silo, tenant] = who[uid];
  await db.query("select set_config('test.user', $1, true), set_config('test.role', $2, true), set_config('test.silo', $3, true), set_config('test.tenant', $4, true)", [uid, role, silo, tenant]);
  await db.query('set local role authenticated');
}
async function scenario(label, work) {
  await db.query('reset role');
  await db.query('savepoint scenario');
  try { await work(); checks++; console.log(`PASS ${label}`); }
  catch (e) { console.log(`FAIL ${label}`); throw e; }
  finally { await db.query('rollback to savepoint scenario'); await db.query('reset role'); }
}
const call = async (channel) => (await db.query('select public.call_radios($1) as r', [channel])).rows[0].r;
const open = async () => (await db.query('select public.open_talk_wakes() as r')).rows[0].r;
const refused = async (work, code) => {
  await db.query('savepoint try');
  try { await work(); } catch (e) { await db.query('rollback to savepoint try'); assert.equal(e.code, code, e.message); return; }
  throw new Error('expected a refusal');
};

try {
  await db.exec(`
    create role authenticated nologin; create role anon nologin;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user', true), '')::uuid $$;
    create function public.current_tenant() returns uuid language sql stable as $$ select nullif(current_setting('test.tenant', true), '')::uuid $$;
    create type public.silo as enum ('MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster', 'Ethekwini');
    create function public.current_silo() returns public.silo language sql stable as $$ select nullif(current_setting('test.silo', true), '')::public.silo $$;
    -- 0088's rule, in short: a department hears its own group (the control room every group), All call is everyone's;
    -- the call logger and the viewer only listen.
    create function public.talk_access(p_channel text) returns jsonb language sql stable as $$
      select jsonb_build_object('listen', l, 'speak', l and current_setting('test.role', true) not in ('IncidentLogger', 'Viewer'),
                                'name', p_channel)
        from (select p_channel = 'all' or p_channel = 'dept:' || current_setting('test.silo', true)
                     or (current_setting('test.silo', true) = 'Ethekwini' and p_channel like 'dept:%') as l) x $$;
    create table public.profiles (id uuid primary key, full_name text);
    create table public.audit_logs (tenant_id uuid, silo public.silo, user_id uuid, user_name text, action_type text,
      entity_type text, entity_id text, details text, created_at timestamptz default now());
    grant usage on schema public, auth to authenticated;
    insert into public.profiles values ('${U.desk}', 'Nomsa Metro'), ('${U.police}', 'Const. Khumalo'), ('${U.fire}', 'FF Naidoo');
  `);
  await db.exec(migration);
  await db.exec(migration); // safe to re-run
  await db.query('begin');

  await scenario('the desk calls the radios of a group: one call, on the record', async () => {
    await as(U.desk);
    const r = await call('dept:MetroPolice');
    assert.equal(r.new, true);
    await db.query('reset role');
    const audit = (await db.query("select user_name, action_type, entity_id, details from public.audit_logs")).rows;
    assert.deepEqual(audit, [{ user_name: 'Nomsa Metro', action_type: 'TalkRadiosCalled', entity_id: 'dept:MetroPolice',
      details: 'Nomsa Metro called the radios on dept:MetroPolice' }]);
  });

  await scenario('pressing again keeps the same call on, and is not audited again', async () => {
    await as(U.desk);
    const first = await call('dept:MetroPolice');
    // Nearly over: the next press keeps it on a minute more.
    await db.query('reset role');
    await db.query("update public.talk_wakes set until = now() + interval '10 seconds'");
    await as(U.desk);
    const again = await call('dept:MetroPolice');
    assert.equal(again.id, first.id);
    assert.equal(again.new, false);
    assert.ok(Date.parse(again.until) > Date.now() + 50_000, 'kept on about a minute');
    await db.query('reset role');
    assert.equal((await db.query('select count(*)::int as n from public.talk_wakes')).rows[0].n, 1);
    assert.equal((await db.query('select count(*)::int as n from public.audit_logs')).rows[0].n, 1);
  });

  await scenario('a call that has ended is not heard; the next press is a new call', async () => {
    await as(U.desk);
    const first = await call('all');
    await db.query('reset role');
    await db.query("update public.talk_wakes set started_at = now() - interval '5 minutes', until = now() - interval '1 second'");
    await as(U.police);
    assert.deepEqual(await open(), []);
    await as(U.desk);
    const next = await call('all');
    assert.notEqual(next.id, first.id);
    assert.equal(next.new, true);
  });

  await scenario('only the radios that may hear a group see its call', async () => {
    await as(U.desk);
    await call('dept:MetroPolice');
    await as(U.police);
    assert.deepEqual((await open()).map((w) => w.channel), ['dept:MetroPolice']);
    assert.equal((await db.query('select count(*)::int as n from public.talk_wakes')).rows[0].n, 1, 'the table, as the live link reads it');
    await as(U.fire);
    assert.deepEqual(await open(), []);
    assert.equal((await db.query('select count(*)::int as n from public.talk_wakes')).rows[0].n, 0);
    await as(U.elsewhere);
    assert.deepEqual(await open(), [], 'another organisation');
  });

  await scenario('who may not call: the call logger, another department, nobody signed in', async () => {
    await as(U.logger);
    await refused(() => call('dept:MetroPolice'), '42501');
    await as(U.fire);
    await refused(() => call('dept:MetroPolice'), '42501');
    await db.query('reset role');
    await db.query("select set_config('test.user', '', true), set_config('test.tenant', '', true)");
    await db.query('set local role authenticated');
    await refused(() => call('all'), '42501');
  });

  await scenario('a radio answering on its own group may call the others', async () => {
    await as(U.police);
    assert.equal((await call('dept:MetroPolice')).new, true);
  });

  await scenario('nobody writes a call directly', async () => {
    await as(U.desk);
    await refused(() => db.query(`insert into public.talk_wakes (channel, called_by, until) values ('all', '${U.desk}', now() + interval '1 hour')`), '42501');
    await call('all');
    await refused(() => db.query("update public.talk_wakes set until = now() + interval '1 day'"), '42501');
  });

  await db.query('rollback');
  console.log(`\n${checks} scenarios passed; 0095 applied twice.`);
} finally {
  await db.close();
}
