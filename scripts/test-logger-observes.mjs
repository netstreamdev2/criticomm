/** Run the real call-logger migration (0081) against in-memory Postgres
 * (PGlite): the call logger watches every call, adds only to the calls they
 * logged, and reads no department's reports; the case manager reads the
 * police reports; everyone else reads and writes as before.
 *
 * CASE_PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node scripts/test-logger-observes.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.CASE_PGLITE_MODULE || '@electric-sql/pglite');

const migration = readFileSync(new URL('../supabase/migrations/0081_logger_observes.sql', import.meta.url), 'utf8');
const db = new PGlite();
let checks = 0;
const count = async (q, args) => Number((await db.query(q, args)).rows[0].n);

const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = '20000000-0000-4000-8000-000000000001';
const U = {
  logger: id(1), cop: id(2), policeDesk: id(3), cm: id(4), fireDesk: id(5), viewer: id(6), control: id(7), medic: id(8),
};
const who = {
  [U.logger]: ['IncidentLogger', 'Ethekwini'], [U.cop]: ['Police', 'MetroPolice'], [U.policeDesk]: ['Dispatcher', 'MetroPolice'],
  [U.cm]: ['CaseManager', 'Ethekwini'], [U.fireDesk]: ['Dispatcher', 'MetroFire'], [U.viewer]: ['Viewer', 'Ethekwini'],
  [U.control]: ['ControlRoom', 'Ethekwini'], [U.medic]: ['Paramedic', 'Medical'],
};
const INC = { mine: id(101), theirs: id(102) };

async function as(uid) {
  const [role, silo] = who[uid];
  await db.query('reset role');
  await db.query("select set_config('test.user', $1, true), set_config('test.role', $2, true), set_config('test.silo', $3, true)",
    [uid, role, silo]);
  await db.query('set local role authenticated');
}
async function refused(call, message) {
  await db.query('savepoint refused');
  try { await assert.rejects(call(), /row-level security/, message); }
  finally { await db.query('rollback to savepoint refused'); }
}
async function scenario(label, work) {
  await db.query('reset role');
  await db.query('savepoint scenario');
  try { await work(); checks++; console.log(`PASS ${label}`); }
  catch (e) { console.log(`FAIL ${label}`); throw e; }
  finally { await db.query('rollback to savepoint scenario'); await db.query('reset role'); }
}

const addUpdate = (incident) => db.query(
  "insert into public.incident_updates (silo, incident_id, message) values (public.current_silo(), $1, 'note')", [incident]);
const addAttachment = (incident) => db.query(
  "insert into public.incident_attachments (silo, incident_id, file_name) values (public.current_silo(), $1, 'a.jpg')", [incident]);
const addFile = (path, bucket = 'incident-media') => db.query(
  'insert into storage.objects (bucket_id, name) values ($1, $2)', [bucket, path]);
const reports = async (table) => count(`select count(*)::int as n from public.${table}`);

try {
  await db.exec(`
    create role authenticated nologin; create role anon nologin; create role service_role nologin;
    create schema auth; create schema storage;
    create type public.silo as enum ('Ethekwini', 'MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user', true), '')::uuid $$;
    create function public.current_tenant() returns uuid language sql stable as $$ select '${T}'::uuid $$;
    create function public.current_silo() returns public.silo language sql stable as $$
      select coalesce(nullif(current_setting('test.silo', true), ''), 'Ethekwini')::public.silo $$;
    create function public.role_in(variadic roles text[]) returns boolean language sql stable as $$
      select current_setting('test.role', true) = any (roles) $$;
    create function public.is_global() returns boolean language sql stable as $$
      select public.role_in('SystemAdmin','SuperAdmin','Dispatcher','Operator','ControlRoom','IncidentLogger','Viewer','System','SystemController') $$;
    create function public.can_write_global() returns boolean language sql stable as $$
      select public.role_in('SystemAdmin','SuperAdmin','Dispatcher','Operator','ControlRoom','System','SystemController') $$;
    create function public.try_uuid(p text) returns uuid language plpgsql immutable as $f$
      begin return p::uuid; exception when others then return null; end $f$;
    create function storage.foldername(name text) returns text[] language sql immutable as $$
      select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;

    create table public.incidents (id uuid primary key, tenant_id uuid not null, silo public.silo not null,
      dispatched_silos public.silo[] not null default '{}', created_by uuid);
    create function public.can_work_incident(p_incident_id uuid) returns boolean language sql stable security definer
      set search_path = public as $$
      select exists (select 1 from public.incidents i where i.id = p_incident_id and i.tenant_id = public.current_tenant()
        and (public.is_global() or i.silo = public.current_silo() or public.current_silo() = any (i.dispatched_silos))) $$;

    -- The rules as they stand before 0081 (0002, 0019, 0039, 0003).
    create table public.incident_updates (id uuid primary key default gen_random_uuid(), silo public.silo, incident_id uuid, message text);
    create table public.incident_attachments (id uuid primary key default gen_random_uuid(), silo public.silo, incident_id uuid, file_name text);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table public.incident_updates enable row level security;
    alter table public.incident_attachments enable row level security;
    alter table storage.objects enable row level security;
    create policy incident_updates_insert on public.incident_updates for insert with check (
      ((silo = public.current_silo()) or public.can_write_global() or public.role_in('IncidentLogger')) and not public.role_in('Viewer'));
    create policy incident_updates_worked_insert on public.incident_updates for insert to authenticated
      with check (public.can_work_incident(incident_id) and not public.role_in('Viewer'));
    create policy incident_attachments_insert on public.incident_attachments for insert with check (
      ((silo = public.current_silo()) or public.can_write_global() or public.role_in('IncidentLogger')) and not public.role_in('Viewer'));
    create policy incident_attachments_worked_insert on public.incident_attachments for insert to authenticated
      with check (public.can_work_incident(incident_id) and not public.role_in('Viewer'));
    create policy incident_media_insert on storage.objects for insert with check (bucket_id = 'incident-media'
      and auth.uid() is not null and (public.is_global() or public.current_silo()::text = (storage.foldername(name))[1]));
    create policy other_buckets_insert on storage.objects for insert with check (bucket_id <> 'incident-media' and auth.uid() is not null);
  `);
  for (const t of ['metro_reports', 'firefighter_reports', 'paramedic_reports', 'post_mortem_reports']) {
    await db.exec(`
      create table public.${t} (id uuid primary key default gen_random_uuid(), silo public.silo not null, incident_id uuid);
      alter table public.${t} enable row level security;
      create policy before_read on public.${t} for select using (silo = public.current_silo() or public.is_global());
    `);
  }
  await db.exec(`
    grant usage on schema public, storage, auth to authenticated;
    grant select, insert on all tables in schema public to authenticated;
    grant select, insert on all tables in schema storage to authenticated;
    insert into public.incidents values ('${INC.mine}', '${T}', 'Ethekwini', '{MetroPolice}', '${U.logger}'),
                                        ('${INC.theirs}', '${T}', 'Ethekwini', '{Medical}', '${U.control}');
    insert into public.metro_reports (silo, incident_id) values ('MetroPolice', '${INC.mine}'), ('MetroPolice', null);
    insert into public.firefighter_reports (silo, incident_id) values ('MetroFire', '${INC.mine}');
    insert into public.paramedic_reports (silo, incident_id) values ('Medical', '${INC.theirs}');
    insert into public.post_mortem_reports (silo, incident_id) values ('Medical', '${INC.theirs}');
  `);

  await db.query('begin');
  await scenario('before 0081: the call logger adds to any call and reads every report', async () => {
    await as(U.logger);
    await addUpdate(INC.theirs);
    await addFile(`Ethekwini/${INC.theirs}/photo/a.jpg`);
    assert.equal(await reports('paramedic_reports'), 1);
  });

  // 0081 drops the read policies it replaces by name; the stand-ins above go too.
  for (const t of ['metro_reports', 'firefighter_reports', 'paramedic_reports', 'post_mortem_reports']) {
    await db.exec(`drop policy before_read on public.${t}`);
  }
  await db.exec(migration);
  await db.exec(migration); // safe to re-run

  await scenario('the call logger reads no department’s reports', async () => {
    await as(U.logger);
    for (const t of ['metro_reports', 'firefighter_reports', 'paramedic_reports', 'post_mortem_reports']) {
      assert.equal(await reports(t), 0, `${t} is closed to the call logger`);
    }
  });

  await scenario('the call logger adds to the calls they logged, and to no other', async () => {
    await as(U.logger);
    await addUpdate(INC.mine);
    await addAttachment(INC.mine);
    await addFile(`Ethekwini/${INC.mine}/photo/a.jpg`);
    await refused(() => addUpdate(INC.theirs), 'no update on a call they did not log');
    await refused(() => addAttachment(INC.theirs), 'no attachment on a call they did not log');
    await refused(() => addFile(`Ethekwini/${INC.theirs}/photo/a.jpg`), 'no evidence file on a call they did not log');
    await refused(() => addFile('Ethekwini/not-a-call/photo/a.jpg'), 'no file under a made-up path');
    await addFile('me/avatar.png', 'avatars'); // other buckets as before
  });

  await scenario('the case manager reads the police reports, with the others as before', async () => {
    await as(U.cm);
    assert.equal(await reports('metro_reports'), 2);
    assert.equal(await reports('firefighter_reports'), 1);
    assert.equal(await reports('paramedic_reports'), 1);
  });

  await scenario('everyone else reads as before', async () => {
    await as(U.cop);
    assert.equal(await reports('metro_reports'), 2, 'police read their own');
    assert.equal(await reports('paramedic_reports'), 0, 'police do not read patient care on a call they are not on');
    await as(U.medic);
    assert.equal(await reports('paramedic_reports'), 1);
    assert.equal(await reports('metro_reports'), 0);
    await as(U.policeDesk);
    assert.equal(await reports('paramedic_reports'), 1, 'dispatch reads across departments');
    await as(U.viewer);
    assert.equal(await reports('metro_reports'), 2);
  });

  await scenario('everyone else adds as before', async () => {
    await as(U.control);
    await addUpdate(INC.mine);
    await addFile(`Ethekwini/${INC.mine}/photo/b.jpg`);
    await as(U.cop);
    await addUpdate(INC.theirs);
    await addAttachment(INC.theirs);
    await as(U.viewer);
    await refused(() => addUpdate(INC.theirs), 'the viewer still adds nothing');
  });

  await db.query('rollback');
  console.log(`\n${checks} logger checks passed`);
} finally {
  await db.close();
}
