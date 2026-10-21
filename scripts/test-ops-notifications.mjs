/** Run the operations-notifications migration (0097) against in-memory
 * Postgres (PGlite): a new call and each live-feed step reach the dispatch
 * desks of the call's departments and the control room, nobody else; steps
 * that are not on the feed say nothing; an SOS is left to its own alarm.
 *
 * CASE_PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node scripts/test-ops-notifications.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.CASE_PGLITE_MODULE || '@electric-sql/pglite');

const migration = readFileSync(new URL('../supabase/migrations/0097_operations_notifications.sql', import.meta.url), 'utf8');
const db = new PGlite();
let checks = 0;

const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = '20000000-0000-4000-8000-000000000001';
const U = {
  policeDesk: id(1), fireDesk: id(2), controlRoom: id(3), officer: id(4), medicalDesk: id(5),
};
const people = [
  [U.policeDesk, 'Dispatcher', 'MetroPolice'],
  [U.fireDesk, 'Dispatcher', 'MetroFire'],
  [U.medicalDesk, 'ControlRoom', 'Medical'],
  [U.controlRoom, 'Dispatcher', 'Ethekwini'],
  [U.officer, 'Police', 'MetroPolice'],
];

async function as(uid) {
  await db.query('reset role');
  await db.query("select set_config('test.user', $1, true)", [uid]);
  await db.query('set local role authenticated');
}
async function scenario(label, work) {
  await db.query('reset role');
  await db.query('savepoint scenario');
  try { await work(); checks++; console.log(`PASS ${label}`); }
  catch (e) { console.log(`FAIL ${label}`); throw e; }
  finally { await db.query('rollback to savepoint scenario'); await db.query('reset role'); }
}
const titlesFor = async (uid) => {
  await as(uid);
  const r = (await db.query('select title from public.alerts order by seq')).rows.map((x) => x.title);
  await db.query('reset role');
  return r;
};
async function call({ tags = [], silo = 'Ethekwini', source = 'Phone', severity = 'Critical' } = {}) {
  return (await db.query(
    `insert into public.incidents (incident_number, silo, tagged_silos, source, incident_severity, incident_type, location_address)
     values ('ETK-MP-MD-20261021-1206-0001', $1::silo, $2::silo[], $3, $4, 'Assault', '10 Village Road') returning id`,
    [silo, `{${tags.join(',')}}`, source, severity])).rows[0].id;
}
const status = (incident, s) => db.query('update public.incidents set status = $2 where id = $1', [incident, s]);
const count = async () => (await db.query('select count(*)::int as n from public.alerts')).rows[0].n;

try {
  await db.exec(`
    create role authenticated nologin; create role anon nologin; create role service_role nologin;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user', true), '')::uuid $$;
    create type public.silo as enum ('MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster', 'Ethekwini');
    create type public.user_role as enum ('Dispatcher', 'ControlRoom', 'Police', 'SuperAdmin');
    create table public.profiles (id uuid primary key, role public.user_role, silo public.silo, deactivated_at timestamptz);
    create table public.incidents (
      id uuid primary key default gen_random_uuid(), tenant_id uuid default '${T}', incident_number text,
      silo public.silo not null, tagged_silos public.silo[] not null default '{}', dispatched_silos public.silo[] not null default '{}',
      status text not null default 'Pending', source text, incident_severity text, incident_type text, location_address text);
    create table public.alerts (
      id uuid primary key default gen_random_uuid(), seq bigint generated always as identity, tenant_id uuid, silo public.silo not null, target_user_id uuid,
      kind text not null default 'info', severity text not null default 'Medium', title text not null, body text,
      incident_id uuid, link text, presentation text not null default 'toast', requires_ack boolean not null default false,
      created_by uuid, created_by_name text, created_at timestamptz not null default clock_timestamp(), expires_at timestamptz,
      audience text, target_users uuid[], target_roles public.user_role[], all_departments boolean not null default false,
      withdrawn_at timestamptz);
    -- 0084's read rule, as it is.
    create function public.alert_is_for_me(p_audience text, p_silo public.silo, p_target uuid, p_users uuid[], p_roles public.user_role[], p_all boolean)
    returns boolean language sql stable security definer set search_path to 'public' as $$
      select case p_audience
        when 'person' then p_target = auth.uid()
        when 'role' then exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.deactivated_at is null
                                  and pr.role = any (p_roles) and (p_all or pr.silo = p_silo))
        else false end $$;
    alter table public.alerts enable row level security;
    create policy alerts_read on public.alerts for select to authenticated
      using (withdrawn_at is null and public.alert_is_for_me(audience, silo, target_user_id, target_users, target_roles, all_departments));
    grant usage on schema public, auth to authenticated;
    grant select on public.alerts to authenticated;
    insert into public.profiles (id, role, silo) values ${people.map(([u, r, s]) => `('${u}', '${r}', '${s}')`).join(', ')};
  `);
  await db.exec(migration);
  await db.exec(migration); // safe to re-run
  await db.query('begin');

  await scenario('a new call reaches the desks of its departments and the control room, nobody else', async () => {
    await call({ tags: ['MetroPolice', 'Medical'] });
    const want = ['New Critical call ETK-MP-MD-20261021-1206-0001'];
    assert.deepEqual(await titlesFor(U.policeDesk), want, 'Metro Police desk');
    assert.deepEqual(await titlesFor(U.medicalDesk), want, 'EMS desk');
    assert.deepEqual(await titlesFor(U.controlRoom), want, 'control room');
    assert.deepEqual(await titlesFor(U.fireDesk), [], 'Fire was not sent it');
    assert.deepEqual(await titlesFor(U.officer), [], 'an officer is not a desk');
    const row = (await db.query("select body, link, kind, severity, presentation, expires_at > now() + interval '6 days' as week from public.alerts limit 1")).rows[0];
    assert.equal(row.body, 'Assault · 10 Village Road');
    assert.equal(row.kind, 'incident_new');
    assert.equal(row.severity, 'Critical');
    assert.equal(row.presentation, 'toast');
    assert.ok(row.link.startsWith('/incidents/'));
    assert.equal(row.week, true, 'kept for 7 days');
  });

  await scenario('each live-feed step is told; on scene once; steps off the feed say nothing', async () => {
    const c = await call({ tags: ['MetroPolice'] });
    await status(c, 'Pending Dispatch');
    await status(c, 'Dispatched');
    await status(c, 'Dispatched'); // no change
    await status(c, 'En Route');
    await status(c, 'Arrived');
    await status(c, 'On Scene');
    await status(c, 'Transporting');
    await status(c, 'Resolved');
    await status(c, 'Closed');
    assert.deepEqual((await titlesFor(U.policeDesk)).map((x) => x.replace('ETK-MP-MD-20261021-1206-0001', 'N')), [
      'New Critical call N', 'N · Unit dispatched', 'N · Unit en route', 'N · Unit on scene',
      'N · Transporting', 'N · Call resolved', 'N · Call closed',
    ]);
  });

  await scenario('a department the call is sent to later hears its steps from then on', async () => {
    const c = await call({ tags: ['MetroPolice'] });
    assert.deepEqual(await titlesFor(U.fireDesk), []);
    await db.query("update public.incidents set dispatched_silos = '{MetroFire}' where id = $1", [c]);
    await status(c, 'En Route');
    assert.deepEqual((await titlesFor(U.fireDesk)).length, 1);
  });

  await scenario('an officer SOS is left to its own alarm', async () => {
    await call({ tags: ['MetroPolice'], silo: 'MetroPolice', source: 'Responder-Panic' });
    assert.equal(await count(), 0);
  });

  await db.query('rollback');
  console.log(`\n${checks} scenarios passed; 0097 applied twice.`);
} finally {
  await db.close();
}
