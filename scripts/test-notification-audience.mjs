/** Run the real notifications migration (0084) against in-memory Postgres
 * (PGlite): each notification reaches its audience and nobody else (a
 * person, a named few, a role in a department, a department, the
 * organisation), who may send what, nobody writes the table directly, a
 * sender takes one back, and read receipts stay each person's own.
 *
 * CASE_PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node scripts/test-notification-audience.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.CASE_PGLITE_MODULE || '@electric-sql/pglite');

const migration = readFileSync(new URL('../supabase/migrations/0084_notification_audience.sql', import.meta.url), 'utf8');
const db = new PGlite();
let checks = 0;

const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = '20000000-0000-4000-8000-000000000001';
const T2 = '20000000-0000-4000-8000-000000000002';
const U = {
  patricia: id(1), stephen: id(2), officer: id(3), fireAdmin: id(4), deskEth: id(5), viewer: id(6),
  sysadmin: id(7), otherOrg: id(8), captain: id(9), gone: id(10),
};
const PEOPLE = [
  [U.patricia, 'Admin', 'MetroPolice', T, 'Patricia'], [U.stephen, 'Admin', 'MetroPolice', T, 'Stephen'],
  [U.officer, 'Police', 'MetroPolice', T, 'Const. Khumalo'], [U.fireAdmin, 'Admin', 'MetroFire', T, 'Fire Admin'],
  [U.deskEth, 'Dispatcher', 'Ethekwini', T, 'Control Desk'], [U.viewer, 'Viewer', 'Ethekwini', T, 'Vusi Viewer'],
  [U.sysadmin, 'SystemAdmin', 'Ethekwini', T, 'Sys Admin'], [U.otherOrg, 'Admin', 'MetroPolice', T2, 'Elsewhere'],
  [U.captain, 'Captain', 'MetroPolice', T, 'Capt. Dube'], [U.gone, 'Police', 'MetroPolice', T, 'Left the service'],
];
const who = Object.fromEntries(PEOPLE.map(([uid, role, silo, tenant]) => [uid, { role, silo, tenant }]));

async function as(uid) {
  const p = who[uid];
  await db.query('reset role');
  await db.query("select set_config('test.user', $1, true), set_config('test.role', $2, true), set_config('test.silo', $3, true), set_config('test.tenant', $4, true)",
    [uid, p.role, p.silo, p.tenant]);
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
const send = (o) => db.query(
  'select * from public.send_notification($1, $2, $3, $4, $5, $6, $7::uuid[], $8::public.user_role[], $9::public.silo, $10, $11)',
  [o.audience, o.title ?? 'Shift briefing at 14:00', o.body ?? null, o.link ?? null, o.severity ?? 'Low', o.user ?? null,
    o.users ? `{${o.users.join(',')}}` : null, o.roles ? `{${o.roles.join(',')}}` : null, o.silo ?? null, o.all ?? false, o.kind ?? 'info'],
).then((r) => r.rows[0]);
const titles = async () => (await db.query('select title from public.alerts order by title')).rows.map((r) => r.title);
const sees = async (uid, title) => { await as(uid); return (await titles()).includes(title); };
/** Who, of these, reads a notification with this title. */
const readers = async (title, uids = Object.values(U)) => {
  const out = [];
  for (const u of uids) if (await sees(u, title)) out.push(Object.keys(U).find((k) => U[k] === u));
  return out.sort();
};

try {
  await db.exec(`
    create role authenticated nologin; create role anon nologin; create role service_role nologin;
    create schema auth;
    create type public.silo as enum ('Ethekwini', 'MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster');
    create type public.user_role as enum ('SystemAdmin', 'SuperAdmin', 'Admin', 'Supervisor', 'Dispatcher', 'ControlRoom',
      'IncidentLogger', 'Viewer', 'System', 'Captain', 'Police', 'Firefighter', 'Paramedic', 'Disaster', 'CaseManager',
      'SystemController', 'FireChief', 'Operator');
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
    create table public.profiles (id uuid primary key, tenant_id uuid, role public.user_role, silo public.silo, full_name text, deactivated_at timestamptz);
    create table public.audit_logs (id uuid primary key default gen_random_uuid(), tenant_id uuid, silo public.silo, user_id uuid,
      user_name text, action_type text, entity_type text, entity_id text, details text);

    -- As 0010 and 0030 left it.
    create table public.alerts (
      id uuid primary key default gen_random_uuid(), tenant_id uuid not null default public.current_tenant(),
      silo public.silo not null, target_user_id uuid, kind text not null default 'info', severity text not null default 'Medium',
      title text not null, body text, incident_id uuid, link text, presentation text not null default 'toast',
      requires_ack boolean not null default false, created_by uuid, created_by_name text,
      created_at timestamptz not null default now(), expires_at timestamptz);
    alter table public.alerts enable row level security;
    create policy alerts_read on public.alerts for select using (
      target_user_id = auth.uid() or (target_user_id is null and (silo = public.current_silo() or public.is_global())));
    create policy alerts_write on public.alerts for insert with check (public.role_in('Dispatcher','ControlRoom','Admin','SystemAdmin','Captain'));
    create policy alerts_update on public.alerts for update using (public.role_in('Admin','SystemAdmin'));
    create policy tenant_isolation on public.alerts as restrictive for all to authenticated
      using (tenant_id = public.current_tenant()) with check (tenant_id = public.current_tenant());
    create table public.alert_reads (alert_id uuid not null references public.alerts (id) on delete cascade, user_id uuid not null,
      read_at timestamptz not null default now(), acknowledged boolean not null default false, primary key (alert_id, user_id));
    alter table public.alert_reads enable row level security;
    create policy alert_reads_own on public.alert_reads for all using (user_id = auth.uid()) with check (user_id = auth.uid());
    create function public.raise_dispatch_alerts(p_incident_id uuid, p_silos public.silo[], p_by_name text) returns integer
      language sql as $$ select 0 $$;
    grant usage on schema public, auth to authenticated;
    grant select, insert, update, delete on public.alerts, public.alert_reads to authenticated;
    grant execute on function public.raise_dispatch_alerts(uuid, public.silo[], text) to authenticated;
    -- From before 0084: a personal alert and a department broadcast, as the old functions wrote them.
    insert into public.alerts (tenant_id, silo, target_user_id, title) values ('${T}', 'MetroPolice', '${U.officer}', 'Old: assigned to the officer');
    insert into public.alerts (tenant_id, silo, title) values ('${T}', 'MetroPolice', 'Old: police broadcast');
  `);
  for (const [uid, role, silo, tenant, name] of PEOPLE) {
    await db.query('insert into public.profiles values ($1, $2, $3, $4, $5, $6)', [uid, tenant, role, silo, name, uid === U.gone ? new Date() : null]);
  }
  await db.exec(migration);
  await db.exec(migration); // safe to re-run
  await db.query('begin');

  await scenario('what was there before keeps its reach, less the organisation-wide roles', async () => {
    assert.deepEqual(await readers('Old: assigned to the officer'), ['officer']);
    // Police only: the control room desk and the viewer no longer read a department's broadcast.
    assert.deepEqual(await readers('Old: police broadcast'), ['captain', 'gone', 'officer', 'patricia', 'stephen']);
  });

  await scenario('to one person: Patricia, and nobody else', async () => {
    await as(U.officer);
    await send({ audience: 'person', user: U.patricia, title: 'For Patricia' });
    assert.deepEqual(await readers('For Patricia'), ['patricia']);
  });

  await scenario('to a named few: Patricia and Stephen, each with their own read', async () => {
    await as(U.captain);
    const n = await send({ audience: 'people', users: [U.patricia, U.stephen, U.patricia], title: 'For the two admins' });
    assert.equal(n.target_users.length, 2, 'repeats are dropped');
    assert.deepEqual(await readers('For the two admins'), ['patricia', 'stephen']);
    await as(U.patricia);
    await db.query('insert into public.alert_reads (alert_id, user_id) values ($1, $2)', [n.id, U.patricia]);
    await as(U.stephen);
    assert.equal((await db.query('select count(*)::int as n from public.alert_reads')).rows[0].n, 0, 'Stephen has not read it');
  });

  await scenario('to a role in a department: Metro Police admins (Patricia and Stephen), not Fire’s admin', async () => {
    await as(U.patricia);
    await send({ audience: 'role', roles: ['Admin'], title: 'Metro Police admins' });
    assert.deepEqual(await readers('Metro Police admins'), ['patricia', 'stephen']);
    await as(U.patricia);
    await refused(() => send({ audience: 'role', roles: ['Admin'], silo: 'MetroFire', title: 'x' }), /your own department/);
  });

  await scenario('to a department, and to the organisation', async () => {
    await as(U.patricia);
    await send({ audience: 'department', title: 'All of Metro Police' });
    assert.deepEqual(await readers('All of Metro Police'), ['captain', 'gone', 'officer', 'patricia', 'stephen']);
    await as(U.patricia);
    await refused(() => send({ audience: 'organisation', title: 'x' }), /administrators send to everyone/);
    await as(U.sysadmin);
    await send({ audience: 'organisation', title: 'Everyone' });
    const all = await readers('Everyone');
    assert.ok(all.includes('viewer') && all.includes('fireAdmin') && all.includes('officer'));
    assert.ok(!all.includes('otherOrg'), 'never another organisation');
    await as(U.sysadmin);
    await send({ audience: 'role', roles: ['Captain', 'Admin'], all: true, title: 'Every admin and captain' });
    assert.deepEqual(await readers('Every admin and captain'), ['captain', 'fireAdmin', 'patricia', 'stephen']);
  });

  await scenario('who may send what', async () => {
    await as(U.officer);
    await refused(() => send({ audience: 'department', title: 'x' }), /one person at a time/);
    await refused(() => send({ audience: 'people', users: [U.patricia], title: 'x' }), /one person at a time/);
    await refused(() => send({ audience: 'person', user: U.otherOrg, title: 'x' }), /not in your organisation/);
    await refused(() => send({ audience: 'person', user: U.gone, title: 'x' }), /not in your organisation/, 'nor someone who has left');
    await as(U.patricia);
    await refused(() => send({ audience: 'people', users: [U.stephen, U.fireAdmin], title: 'x' }), /your own department only/);
    await as(U.deskEth);
    await send({ audience: 'department', silo: 'MetroFire', title: 'Central desk to Fire' });
    assert.deepEqual(await readers('Central desk to Fire'), ['fireAdmin']);
  });

  await scenario('never an emergency, never a link out', async () => {
    await as(U.sysadmin);
    await refused(() => send({ audience: 'person', user: U.officer, severity: 'Critical' }), /Low, Medium or High/);
    await refused(() => send({ audience: 'person', user: U.officer, kind: 'sos' }), /raised by HikTech itself/);
    await refused(() => send({ audience: 'person', user: U.officer, link: 'https://evil.example' }), /inside HikTech/);
    await refused(() => send({ audience: 'person', user: U.officer, link: '//evil.example' }), /inside HikTech/);
    const n = await send({ audience: 'person', user: U.officer, link: '/incidents/map' });
    assert.deepEqual([n.presentation, n.requires_ack], ['toast', false]);
    await refused(() => send({ audience: 'person', user: U.officer, title: 'x'.repeat(141) }), /140/);
    await db.query('reset role');
    assert.ok((await db.query("select count(*)::int as n from public.audit_logs where action_type = 'NotificationSent'")).rows[0].n >= 1);
  });

  await scenario('nobody writes the table directly; read receipts only for what you can see', async () => {
    await as(U.sysadmin);
    await refused(() => db.query("insert into public.alerts (silo, title) values ('MetroPolice', 'Forged')"), /permission denied/);
    await refused(() => db.query("update public.alerts set title = 'Changed'"), /permission denied/);
    await refused(() => db.query('delete from public.alerts'), /permission denied/);
    await refused(() => db.query("select public.raise_dispatch_alerts(gen_random_uuid(), '{MetroPolice}', 'x')"), /permission denied/);
    await as(U.patricia);
    const p = await send({ audience: 'person', user: U.stephen, title: 'Only Stephen' });
    await as(U.officer);
    await refused(() => db.query('insert into public.alert_reads (alert_id, user_id) values ($1, $2)', [p.id, U.officer]), /row-level security/);
  });

  await scenario('the database’s own notifications are read as before', async () => {
    await db.query('reset role');
    await db.query(`insert into public.alerts (tenant_id, silo, target_user_id, kind, severity, title, presentation, requires_ack)
      values ('${T}', 'MetroPolice', '${U.officer}', 'sos', 'Critical', 'SOS from the database', 'modal', true)`);
    assert.equal((await db.query("select audience from public.alerts where title = 'SOS from the database'")).rows[0].audience, 'person');
    assert.deepEqual(await readers('SOS from the database'), ['officer']);
  });

  await scenario('the sender takes one back; it is gone for everyone', async () => {
    await as(U.patricia);
    const n = await send({ audience: 'role', roles: ['Admin'], title: 'Sent by mistake' });
    await as(U.stephen);
    await refused(() => db.query('select public.withdraw_notification($1)', [n.id]), /Only the sender/);
    await as(U.patricia);
    await db.query('select public.withdraw_notification($1)', [n.id]);
    assert.deepEqual(await readers('Sent by mistake'), []);
    await as(U.patricia);
    assert.equal((await db.query('select count(*)::int as n from public.my_sent_notifications() where id = $1', [n.id])).rows[0].n, 1, 'still in what I sent');
    await db.query('reset role');
    const sos = (await db.query("insert into public.alerts (tenant_id, silo, target_user_id, kind, title) values ($1, 'MetroPolice', $2, 'sos', 'An SOS') returning id", [T, U.officer])).rows[0].id;
    await as(U.sysadmin);
    await refused(() => db.query('select public.withdraw_notification($1)', [sos]), /stay on the record/);
  });

  await scenario('System Status counts the organisation’s notifications for administrators only', async () => {
    await as(U.sysadmin);
    const n = (await db.query("select public.notification_activity(now() - interval '1 day') as n")).rows[0].n;
    assert.ok(n >= 2);
    await as(U.officer);
    await refused(() => db.query("select public.notification_activity(now() - interval '1 day')"), /Not permitted/);
  });

  await db.query('rollback');
  console.log(`\n${checks} scenarios passed; 0084 applied twice.`);
} finally {
  await db.close();
}
