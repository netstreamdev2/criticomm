/** Run the real Talk migration (0083) against in-memory Postgres (PGlite):
 * the pass the database signs is a valid LiveKit token (checked here with
 * Node's own HMAC, as the voice server checks it), who may listen and speak
 * in each talk group, the secret never readable, and the talk log.
 *
 * CASE_PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node scripts/test-talk.mjs
 */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.CASE_PGLITE_MODULE || '@electric-sql/pglite');

const migration = readFileSync(new URL('../supabase/migrations/0083_talk.sql', import.meta.url), 'utf8');
// 0088: on All call the radios speak too.
const allCall = readFileSync(new URL('../supabase/migrations/0088_talk_all_call.sql', import.meta.url), 'utf8');
const db = new PGlite();
let checks = 0;

const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = '20000000-0000-4000-8000-000000000001';
const T2 = '20000000-0000-4000-8000-000000000002';
const SECRET = 'test-secret-0123456789abcdefghijklmnopqrstuvwxyz';
const U = {
  sysadmin: id(1), dispatcher: id(2), cop: id(3), firefighter: id(4), logger: id(5), viewer: id(6), otherOrg: id(7), captain: id(8),
};
const who = {
  [U.sysadmin]: ['SystemAdmin', 'Ethekwini', T, 'Sys Admin'], [U.dispatcher]: ['Dispatcher', 'MetroPolice', T, 'Sgt. Naidoo'],
  [U.cop]: ['Police', 'MetroPolice', T, 'Const. Khumalo'], [U.firefighter]: ['Firefighter', 'MetroFire', T, 'FF Mthembu'],
  [U.logger]: ['IncidentLogger', 'Ethekwini', T, 'Lerato Logger'], [U.viewer]: ['Viewer', 'Ethekwini', T, 'Vusi Viewer'],
  [U.otherOrg]: ['Dispatcher', 'MetroPolice', T2, 'Elsewhere'], [U.captain]: ['Captain', 'MetroPolice', T, 'Capt. Dube'],
};
const INC = { police: id(101), closed: id(102) };

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
const access = async (channel) => (await db.query('select public.talk_access($1) as a', [channel])).rows[0].a;
const pass = async (channel) => (await db.query('select public.talk_pass($1) as p', [channel])).rows[0].p;
const b64 = (s) => Buffer.from(s, 'base64url');
function verify(token, secret) {
  const [h, b, s] = token.split('.');
  const expected = createHmac('sha256', secret).update(`${h}.${b}`).digest('base64url');
  assert.equal(s, expected, 'signed with the secret, HS256');
  return { header: JSON.parse(b64(h).toString()), body: JSON.parse(b64(b).toString()) };
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
    create function public.can_work_incident(p uuid) returns boolean language sql stable security definer set search_path = public as $$
      select exists (select 1 from public.incidents i where i.id = p and i.tenant_id = public.current_tenant()
        and (public.is_global() or i.silo = public.current_silo() or public.current_silo() = any (i.dispatched_silos))) $$;
    create table public.audit_logs (id uuid primary key default gen_random_uuid(), tenant_id uuid, silo public.silo, user_id uuid,
      user_name text, action_type text, entity_type text, entity_id text, details text);
    insert into public.incidents values ('${INC.police}', '${T}', 'MetroPolice', 'MP-20261016-0001', 'Dispatched', '{}'),
                                        ('${INC.closed}', '${T}', 'MetroPolice', 'MP-20261016-0002', 'Closed', '{}');
    grant usage on schema public, auth to authenticated;
  `);
  for (const [uid, [role, , , name]] of Object.entries(who)) {
    await db.query('insert into public.profiles values ($1, $2, $3)', [uid, name, role]);
  }
  await db.exec(migration);
  await db.exec(migration); // safe to re-run
  await db.exec(allCall);
  await db.exec(allCall);
  await db.query('begin');

  await scenario('only a system administrator sets the voice server; the secret is never readable', async () => {
    await as(U.dispatcher);
    await refused(() => db.query("select public.set_talk_server('wss://x.livekit.cloud', 'APIkey1', $1)", [SECRET]), /Not permitted/);
    await as(U.sysadmin);
    await refused(() => db.query("select public.set_talk_server('https://x', 'APIkey1', $1)", [SECRET]), /starts with wss/);
    await db.query("select public.set_talk_server('wss://hiktech-test.livekit.cloud/', 'APIkey1', $1)", [SECRET]);
    const status = (await db.query('select public.talk_server_status() as s')).rows[0].s;
    assert.deepEqual([status.configured, status.url], [true, 'wss://hiktech-test.livekit.cloud']);
    assert.equal(JSON.stringify(status).includes(SECRET), false);
    await refused(() => db.query('select * from public.talk_server'), /permission denied/);
    await db.query('reset role');
    const audit = (await db.query("select details from public.audit_logs where action_type = 'TalkServerSet'")).rows;
    assert.equal(audit.length, 1);
    assert.equal(audit[0].details.includes(SECRET), false, 'the secret is not audited');
  });

  await db.query('reset role');
  await db.query("select set_config('test.user', $1, true), set_config('test.role', 'SystemAdmin', true), set_config('test.tenant', $2, true)", [U.sysadmin, T]);
  await db.query("select public.set_talk_server('wss://hiktech-test.livekit.cloud', 'APIkey1', $1)", [SECRET]);

  await scenario('the pass is a LiveKit token the voice server accepts', async () => {
    await as(U.cop);
    const p = await pass('dept:MetroPolice');
    assert.equal(p.url, 'wss://hiktech-test.livekit.cloud');
    assert.equal(p.name, 'Metro Police');
    assert.equal(p.canSpeak, true);
    const { header, body } = verify(p.token, SECRET);
    assert.deepEqual(header, { alg: 'HS256', typ: 'JWT' });
    assert.equal(body.iss, 'APIkey1');
    assert.equal(body.sub, U.cop);
    assert.equal(body.name, 'Const. Khumalo');
    assert.equal(body.video.room, `${T}:dept:MetroPolice`, 'one room per organisation');
    assert.equal(body.video.roomJoin, true);
    assert.equal(body.video.canPublish, true);
    assert.deepEqual(body.video.canPublishSources, ['microphone']);
    assert.ok(body.exp - body.nbf <= 2 * 3600 + 10, 'two hours');
    assert.deepEqual(JSON.parse(body.metadata), { role: 'Police', silo: 'MetroPolice' });
    // A wrong secret does not verify.
    assert.throws(() => verify(p.token, 'another-secret-entirely-xxxxxxxx'));
    await db.query('reset role');
    assert.equal((await db.query("select count(*)::int as n from public.audit_logs where action_type = 'TalkJoined'")).rows[0].n, 1);
  });

  await scenario('a department’s channel: its people and dispatch; not another department', async () => {
    await as(U.firefighter);
    assert.deepEqual(await access('dept:MetroPolice'), { listen: false, speak: false, name: 'Metro Police', priority: false });
    await refused(() => pass('dept:MetroPolice'), /may not join/);
    assert.equal((await access('dept:MetroFire')).speak, true);
    await as(U.dispatcher);
    assert.equal((await access('dept:MetroFire')).speak, true, 'dispatch speaks to any department');
    assert.equal((await access('dept:MetroFire')).priority, true, 'and may talk over a radio');
    assert.equal((await access('dept:Nonsense')).listen, false);
  });

  await scenario('All call: everyone listens and speaks, except those who only watch (0088)', async () => {
    await as(U.cop);
    assert.deepEqual(await access('all'), { listen: true, speak: true, name: 'All call', priority: false }, 'a radio answers on All call');
    const p = await pass('all');
    assert.equal(verify(p.token, SECRET).body.video.canPublish, true);
    await as(U.captain);
    assert.equal((await access('all')).speak, true);
    await as(U.dispatcher);
    assert.deepEqual(await access('all'), { listen: true, speak: true, name: 'All call', priority: true }, 'the desk still talks over a radio');
    await as(U.logger);
    assert.equal((await access('all')).speak, false, 'the call logger only listens');
    await as(U.viewer);
    assert.equal(verify((await pass('all')).token, SECRET).body.video.canPublish, false, 'the viewer gets a listen-only pass');
  });

  await scenario('a call’s channel: whoever works the call; closed calls are listen-only', async () => {
    await as(U.cop);
    assert.deepEqual(await access(`incident:${INC.police}`), { listen: true, speak: true, name: 'Call MP-20261016-0001', priority: false });
    assert.equal((await access(`incident:${INC.closed}`)).speak, false);
    await as(U.firefighter);
    assert.equal((await access(`incident:${INC.police}`)).listen, false, 'not on the call');
    assert.equal((await access('incident:not-a-uuid')).listen, false);
    await as(U.otherOrg);
    assert.equal((await access(`incident:${INC.police}`)).listen, false, 'another organisation');
  });

  await scenario('the call logger and the viewer listen, and never speak', async () => {
    for (const u of [U.logger, U.viewer]) {
      await as(u);
      const a = await access('dept:MetroPolice');
      assert.deepEqual([a.listen, a.speak], [true, false]);
      assert.equal(verify((await pass('dept:MetroPolice')).token, SECRET).body.video.canPublish, false);
      await refused(() => db.query("select public.log_talk('dept:MetroPolice', now() - interval '5 seconds', now())"), /may not speak/);
    }
  });

  await scenario('the talk log: who spoke, how long, read by whoever may listen', async () => {
    await as(U.cop);
    const row = (await db.query("select * from public.log_talk('dept:MetroPolice', now() - interval '4.5 seconds', now())")).rows[0];
    assert.equal(Number(row.seconds), 4.5);
    assert.equal(row.user_name, 'Const. Khumalo');
    await refused(() => db.query("select public.log_talk('dept:MetroPolice', now(), now() - interval '1 second')"), /not right/);
    await refused(() => db.query("select public.log_talk('dept:MetroPolice', now() - interval '20 minutes', now())"), /not right/);
    await refused(() => db.query("insert into public.talk_log (channel, user_id, started_at, ended_at) values ('all', $1, now(), now())", [U.cop]), /permission denied/);
    await as(U.dispatcher);
    assert.equal((await db.query('select count(*)::int as n from public.talk_log')).rows[0].n, 1);
    await as(U.firefighter);
    assert.equal((await db.query('select count(*)::int as n from public.talk_log')).rows[0].n, 0, 'not their department');
  });

  await scenario('no voice server yet: a clear message, not a broken pass', async () => {
    await db.query('reset role');
    await db.query('delete from public.talk_server');
    await as(U.cop);
    await refused(() => pass('dept:MetroPolice'), /not set up yet/);
  });

  await db.query('rollback');
  console.log(`\n${checks} scenarios passed; 0083 applied twice.`);
} finally {
  await db.close();
}
