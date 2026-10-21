/** Run the real call-logger migration (0094, with 0081's helper) against
 * in-memory Postgres (PGlite): the call logger reads the timeline, the
 * attachments and the files of the calls they logged, and of no other;
 * everyone else reads exactly as before.
 *
 * CASE_PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node scripts/test-call-logger-own-calls.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.CASE_PGLITE_MODULE || '@electric-sql/pglite');

const migration = readFileSync(new URL('../supabase/migrations/0094_call_logger_own_calls.sql', import.meta.url), 'utf8');
const db = new PGlite();
let checks = 0;

const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = '20000000-0000-4000-8000-000000000001';
const U = { logger: id(1), logger2: id(2), dispatcher: id(3) };
const who = { [U.logger]: 'IncidentLogger', [U.logger2]: 'IncidentLogger', [U.dispatcher]: 'Dispatcher' };
const MINE = id(101);
const THEIRS = id(102);

async function as(uid) {
  await db.query('reset role');
  await db.query("select set_config('test.user', $1, true), set_config('test.role', $2, true), set_config('test.tenant', $3, true)", [uid, who[uid], T]);
  await db.query('set local role authenticated');
}
async function scenario(label, work) {
  await db.query('reset role');
  await db.query('savepoint scenario');
  try { await work(); checks++; console.log(`PASS ${label}`); }
  catch (e) { console.log(`FAIL ${label}`); throw e; }
  finally { await db.query('rollback to savepoint scenario'); await db.query('reset role'); }
}
const count = async (sql) => (await db.query(sql)).rows[0].n;

try {
  await db.exec(`
    create role authenticated nologin; create role anon nologin; create role service_role nologin;
    create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user', true), '')::uuid $$;
    create function public.current_tenant() returns uuid language sql stable as $$ select nullif(current_setting('test.tenant', true), '')::uuid $$;
    create function public.role_in(variadic roles text[]) returns boolean language sql stable as $$
      select current_setting('test.role', true) = any (roles) $$;
    create function public.try_uuid(p text) returns uuid language plpgsql immutable as $f$
      begin return p::uuid; exception when others then return null; end $f$;
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
    create table public.incidents (id uuid primary key, tenant_id uuid, created_by uuid, incident_number text,
      call_timestamp timestamptz default now(), status text default 'Pending', caller_number text, location_address text, incident_type text);
    alter table public.incidents enable row level security;
    create policy read_all on public.incidents for select to authenticated using (true);
    -- 0081's helper, as it is.
    create function public.may_add_to_incident(p_incident_id uuid) returns boolean language sql stable security definer set search_path to 'public' as $$
      select not public.role_in('IncidentLogger')
          or exists (select 1 from public.incidents i where i.id = p_incident_id and i.created_by = auth.uid() and i.tenant_id = public.current_tenant())
    $$;
    create table public.incident_updates (id uuid primary key default gen_random_uuid(), incident_id uuid, message text);
    create table public.incident_attachments (id uuid primary key default gen_random_uuid(), incident_id uuid, file_name text);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    -- What already let them read (0002, 0003): everyone signed in, here.
    alter table public.incident_updates enable row level security;
    alter table public.incident_attachments enable row level security;
    alter table storage.objects enable row level security;
    create policy read_all on public.incident_updates for select to authenticated using (true);
    create policy read_all on public.incident_attachments for select to authenticated using (true);
    create policy read_all on storage.objects for select to authenticated using (true);
    grant usage on schema public, auth, storage to authenticated;
    grant select on public.incidents, public.incident_updates, public.incident_attachments, storage.objects to authenticated;
    insert into public.incidents (id, tenant_id, created_by, incident_number, caller_number) values
      ('${MINE}', '${T}', '${U.logger}', 'MP-1', '0821111111'), ('${THEIRS}', '${T}', '${U.dispatcher}', 'MP-2', '0822222222');
    insert into public.incident_updates (incident_id, message) values ('${MINE}', 'mine'), ('${THEIRS}', 'theirs');
    insert into public.incident_attachments (incident_id, file_name) values ('${MINE}', 'a.jpg'), ('${THEIRS}', 'b.jpg');
    insert into storage.objects (bucket_id, name) values
      ('incident-media', 'MetroPolice/${MINE}/photo/a.jpg'), ('incident-media', 'MetroPolice/${THEIRS}/photo/b.jpg'),
      ('incident-attachments', 'MetroPolice/${THEIRS}/doc/c.pdf'), ('avatars', 'someone.png');
  `);
  await db.exec(migration);
  await db.exec(migration); // safe to re-run
  await db.query('begin');

  await scenario('the call logger reads the calls they logged, and of no other', async () => {
    await as(U.logger);
    assert.deepEqual((await db.query('select incident_number from public.incidents')).rows.map((r) => r.incident_number), ['MP-1'], 'calls');
    assert.deepEqual((await db.query('select message from public.incident_updates')).rows.map((r) => r.message), ['mine'], 'timeline');
    assert.deepEqual((await db.query('select file_name from public.incident_attachments')).rows.map((r) => r.file_name), ['a.jpg'], 'attachments');
    assert.deepEqual((await db.query("select name from storage.objects where bucket_id like 'incident-%' order by name")).rows.map((r) => r.name),
      [`MetroPolice/${MINE}/photo/a.jpg`], 'files');
    assert.equal(await count("select count(*)::int as n from storage.objects where bucket_id = 'avatars'"), 1, 'other buckets untouched');
  });

  await scenario('another call logger: none of the first one\'s calls', async () => {
    await as(U.logger2);
    assert.equal(await count('select count(*)::int as n from public.incident_updates'), 0);
    assert.equal(await count('select count(*)::int as n from public.incident_attachments'), 0);
    assert.equal(await count("select count(*)::int as n from storage.objects where bucket_id like 'incident-%'"), 0);
  });

  await scenario('the duplicate check still catches a call another person took, and says only its number', async () => {
    await as(U.logger);
    const r = (await db.query("select * from public.check_duplicate_incident('+27 82 222 2222', null, null)")).rows;
    assert.deepEqual(r.map((x) => [x.reason, x.incident_number]), [['Caller', 'MP-2']]);
  });

  await scenario('everyone else reads exactly as before', async () => {
    await as(U.dispatcher);
    assert.equal(await count('select count(*)::int as n from public.incidents'), 2);
    assert.equal(await count('select count(*)::int as n from public.incident_updates'), 2);
    assert.equal(await count('select count(*)::int as n from public.incident_attachments'), 2);
    assert.equal(await count("select count(*)::int as n from storage.objects where bucket_id like 'incident-%'"), 3);
  });

  await db.query('rollback');
  console.log(`\n${checks} scenarios passed; 0094 applied twice.`);
} finally {
  await db.close();
}
