/** Run the real migrations 0076, 0077 and 0079 against in-memory Postgres
 * (PGlite): a dispatcher edits a call before dispatching it, and every change
 * is kept with who, when, why, and each field before and after. The call
 * taker's own edits keep 0077's rules.
 *
 * CASE_PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node scripts/test-dispatcher-edits.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.CASE_PGLITE_MODULE || '@electric-sql/pglite');

const read = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const sqlFn = (src, name) => {
  const start = src.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `${name} found`);
  const body = src.indexOf('$$', start);
  return src.slice(start, src.indexOf('$$;', body + 2) + 3);
};
const init = read('0001_init.sql');

const db = new PGlite();
let checks = 0;
const one = async (q, args) => (await db.query(q, args)).rows[0];
const rows = async (q, args) => (await db.query(q, args)).rows;

const T = '20000000-0000-4000-8000-000000000001';
const T2 = '20000000-0000-4000-8000-000000000002';
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const U = {
  logger: id(1), control: id(2), cop: id(3), policeDesk: id(4), fireDesk: id(5), otherOrg: id(6), viewer: id(7),
};
const PEOPLE = [
  [U.logger, 'IncidentLogger', 'Ethekwini', 'Lerato Logger', T],
  [U.control, 'ControlRoom', 'Ethekwini', 'Control Room', T],
  [U.cop, 'Police', 'MetroPolice', 'Const. Khumalo', T],
  [U.policeDesk, 'Dispatcher', 'MetroPolice', 'Sgt. Naidoo', T],
  [U.fireDesk, 'Dispatcher', 'MetroFire', 'Fire Desk Mthembu', T],
  [U.otherOrg, 'Dispatcher', 'MetroPolice', 'Other Org Desk', T2],
  [U.viewer, 'Viewer', 'Ethekwini', 'Vusi Viewer', T],
];

async function as(uid) {
  await db.query('reset role');
  await db.query("select set_config('test.user', $1, true)", [uid]);
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

const logCall = (extra = {}) => db.query(
  `select * from public.log_incoming_call(
     p_silo => 'Ethekwini', p_caller_name => 'Thabo Mkhize', p_caller_number => '+27825550143',
     p_call_description => 'Glass breaking next door', p_incident_type => $1, p_incident_severity => 'Medium',
     p_location_address => '112 Florida Road', p_location_lat => -29.84, p_location_lng => 31.01,
     p_is_caller_patient => null, p_tagged_silos => $2::public.silo[], p_incident_category => $3, p_details => $4::jsonb)`,
  [extra.type ?? 'Burglary', extra.tags ?? '{MetroPolice}', extra.category ?? 'Crime',
    JSON.stringify(extra.details ?? { premises: 'A home' })]).then((r) => r.rows[0]);
const edit = (incident, fields, reason = null) => db.query('select * from public.dispatcher_edit_call($1, $2::jsonb, $3)',
  [incident, JSON.stringify(fields), reason]).then((r) => r.rows[0]);
const complete = (incident, fields) => db.query('select * from public.complete_call_intake($1, $2::jsonb)', [incident, JSON.stringify(fields)])
  .then((r) => r.rows[0]);
const edits = (incident) => rows('select * from public.incident_edits where incident_id = $1 order by edited_at, id', [incident]);
const timeline = (incident) => rows('select message from public.incident_updates where incident_id = $1 order by timestamp', [incident]);
const part = (incident, silo, dispatched) => db.query(
  'insert into public.incident_departments (incident_id, silo, dispatched_at) values ($1, $2, $3)', [incident, silo, dispatched ? new Date() : null]);

try {
  await db.exec(`
    create role authenticated nologin; create role anon nologin; create role service_role nologin;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user', true), '')::uuid $$;
    create function public.uuid_generate_v4() returns uuid language sql as $$ select gen_random_uuid() $$;
    create type public.silo as enum ('Ethekwini', 'MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster');
    create type public.user_role as enum ('SystemAdmin', 'SuperAdmin', 'Admin', 'Supervisor', 'Dispatcher', 'Operator',
      'ControlRoom', 'IncidentLogger', 'Viewer', 'System', 'Captain', 'Police', 'Firefighter', 'Paramedic', 'Disaster',
      'CaseManager', 'SystemController', 'FireChief');
    create type public.incident_severity as enum ('Low', 'Medium', 'High', 'Critical');
    create type public.incident_status as enum ('New', 'Pending', 'Pending Dispatch', 'Pending Analysis', 'Dispatched',
      'En Route', 'Arrived', 'On Scene', 'Transporting', 'Active', 'Closed', 'Resolved');
    create table public.tenants (id uuid primary key, name text);
    create table public.profiles (id uuid primary key, tenant_id uuid, role public.user_role, silo public.silo,
      full_name text, deactivated_at timestamptz, contact_number text);
    create function public.current_tenant() returns uuid language sql stable as $$
      select tenant_id from public.profiles where id = auth.uid() $$;
    create function public.current_silo() returns public.silo language sql stable as $$
      select coalesce((select silo from public.profiles where id = auth.uid()), 'Ethekwini') $$;
    create function public.role_in(variadic roles text[]) returns boolean language sql stable as $$
      select exists (select 1 from public.profiles where id = auth.uid() and role::text = any (roles)) $$;
    create function public.require_role(variadic roles text[]) returns void language plpgsql stable as $$
    begin
      if not public.role_in(variadic roles) then raise exception 'Not permitted for your role' using errcode = '42501'; end if;
    end $$;
    ${sqlFn(read('0067_role_fits_department.sql'), 'department_label')}
    ${sqlFn(read('0068_dispatch_desk_tags.sql'), 'desk_silo')}
    create table public.apparatus (id uuid primary key default gen_random_uuid(), unit_number text);
    create table public.personnel (id uuid primary key default gen_random_uuid(), user_id uuid, tenant_id uuid,
      latitude double precision, longitude double precision, last_login timestamptz, updated_at timestamptz,
      assigned_apparatus_id uuid);
    create table public.alerts (id uuid primary key default gen_random_uuid(), tenant_id uuid, silo public.silo,
      target_user_id uuid, kind text, severity text, title text, body text, incident_id uuid, link text,
      presentation text, requires_ack boolean, created_by uuid, created_by_name text);
  `);
  const incidents = init.slice(init.indexOf('create table public.incidents ('), init.indexOf('create index on public.incidents(silo);'))
    .replace('geography(point, 4326)', 'text')
    .replace('unique (silo, incident_number)', 'unique (silo, incident_number, tenant_id)')
    .replace('  silo                silo not null,', `  tenant_id uuid not null default public.current_tenant(),\n  silo                silo not null,`);
  await db.exec(incidents);
  await db.exec(`
    alter table public.incidents
      add column tagged_silos public.silo[] not null default '{}', add column client_ref uuid,
      add column incident_category text, add column region text, add column call_taken_by text;
    create table public.incident_updates (id uuid primary key default gen_random_uuid(), silo public.silo, incident_id uuid,
      message text, created_by uuid, created_by_name text, timestamp timestamptz default clock_timestamp());
    create table public.audit_logs (id uuid primary key default gen_random_uuid(), silo public.silo, user_id uuid,
      user_name text, department text, action_type text, entity_type text, entity_id text, details text);
    create table public.incident_departments (id uuid primary key default gen_random_uuid(), incident_id uuid, silo public.silo,
      lead_id uuid, arrived_at timestamptz, dispatched_at timestamptz);
  `);
  const config = read('0007_v4_alignment.sql');
  await db.exec(config.slice(config.indexOf('create table if not exists public.command_records ('), config.indexOf('create index if not exists command_records_module_idx')));
  await db.exec(`
    alter table public.command_records add column tenant_id uuid not null default '${T}';
    create unique index command_records_module_name_key on public.command_records (module, coalesce(detail1, ''), name);
  `);
  for (const [tid, name] of [[T, 'eThekwini'], [T2, 'Other organisation']]) {
    await db.query('insert into public.tenants values ($1, $2)', [tid, name]);
  }
  for (const [uid, role, silo, name, tenant] of PEOPLE) {
    await db.query('insert into auth.users values ($1)', [uid]);
    await db.query('insert into public.profiles (id, tenant_id, role, silo, full_name) values ($1, $2, $3, $4, $5)', [uid, tenant, role, silo, name]);
  }

  for (const m of ['0076_call_intake.sql', '0077_call_details_numbers.sql', '0079_dispatcher_edits.sql', '0079_dispatcher_edits.sql']) {
    await db.exec(read(m));
  }
  await db.query('begin');

  await scenario('a dispatcher edits before dispatch: each field kept as it was and as it became', async () => {
    await as(U.logger);
    const c = await logCall();
    await as(U.policeDesk);
    const after = await edit(c.id, {
      call_description: 'Two men broke in through the back door.', incident_severity: 'High',
      details: { premises: 'A home', suspectThere: 'Yes' },
    }, 'The caller rang back');
    assert.equal(after.call_description, 'Two men broke in through the back door.');
    assert.equal(after.incident_severity, 'High');
    const [e] = await edits(c.id);
    assert.equal(e.kind, 'dispatch');
    assert.equal(e.edited_by, U.policeDesk);
    assert.equal(e.edited_by_name, 'Sgt. Naidoo');
    assert.equal(e.edited_by_role, 'Dispatcher');
    assert.equal(e.reason, 'The caller rang back');
    assert.deepEqual(e.changes.call_description, { before: 'Glass breaking next door', after: 'Two men broke in through the back door.' });
    assert.deepEqual(e.changes.incident_severity, { before: 'Medium', after: 'High' });
    assert.deepEqual(e.changes.details, { before: { premises: 'A home' }, after: { premises: 'A home', suspectThere: 'Yes' } });
    assert.deepEqual(Object.keys(e.changes).sort(), ['call_description', 'details', 'incident_severity'], 'only what changed');
  });

  await scenario('every edit is in the audit trail and on the timeline, with what it was', async () => {
    await as(U.logger);
    const c = await logCall();
    await as(U.policeDesk);
    await edit(c.id, { caller_name: 'Thabo M. Mkhize' });
    await edit(c.id, { location_address: '114 Florida Road', location_lat: -29.841, location_lng: 31.011 }, 'Wrong house number');
    const audit = await rows("select * from public.audit_logs where action_type = 'DISPATCH_EDIT' and entity_id = $1 order by id", [c.id]);
    assert.equal(audit.length, 2, 'one line per edit');
    const texts = audit.map((a) => a.details).join('\n');
    assert.match(texts, /edited before dispatch by Sgt\. Naidoo \(Dispatcher\)/);
    assert.match(texts, /caller_name: was "Thabo Mkhize", now "Thabo M\. Mkhize"/);
    assert.match(texts, /Why: Wrong house number/);
    assert.match(texts, /112 Florida Road/, 'the old place is in the trail');
    assert.ok(audit.every((a) => a.user_id === U.policeDesk && a.department === 'MetroPolice'));
    const tl = (await timeline(c.id)).map((r) => r.message);
    assert.ok(tl.some((m) => m === '[DISPATCH] Edited before dispatch by Sgt. Naidoo: caller name.'), tl.join(' | '));
    assert.ok(tl.some((m) => m === '[DISPATCH] Place changed by Sgt. Naidoo to 114 Florida Road.'), tl.join(' | '));
    const e = await edits(c.id);
    assert.equal(e.length, 2);
    assert.deepEqual(e[1].changes.location, {
      before: { address: '112 Florida Road', lat: -29.84, lng: 31.01 },
      after: { address: '114 Florida Road', lat: -29.841, lng: 31.011 },
    });
    // Nothing changed: nothing recorded.
    await edit(c.id, { caller_name: 'Thabo M. Mkhize' });
    assert.equal((await edits(c.id)).length, 2);
    assert.equal((await rows("select 1 from public.audit_logs where action_type = 'DISPATCH_EDIT' and entity_id = $1", [c.id])).length, 2);
  });

  await scenario('before dispatch only: a desk until its own crews are sent, the control room until any are', async () => {
    await as(U.logger);
    const c = await logCall({ tags: '{MetroPolice,MetroFire}' });
    await part(c.id, 'MetroPolice', true);
    await part(c.id, 'MetroFire', false);
    await as(U.policeDesk);
    await refused(() => edit(c.id, { notes: 'Gate code 4471' }), /has been dispatched \(Metro Police\): it can no longer be edited here/);
    await as(U.fireDesk);
    assert.equal((await edit(c.id, { notes: 'Gate code 4471' })).notes, 'Gate code 4471', 'Fire has not dispatched yet');
    await as(U.control);
    await refused(() => edit(c.id, { notes: 'x' }), /has been dispatched/);
    // A call from before 0073, with no parts: its status says.
    await as(U.logger);
    const old = await logCall();
    await db.query("update public.incidents set status = 'Dispatched' where id = $1", [old.id]);
    await as(U.policeDesk);
    await refused(() => edit(old.id, { notes: 'x' }), /has been dispatched \(a crew\)/);
    await db.query("update public.incidents set status = 'Closed' where id = $1", [old.id]);
    await refused(() => edit(old.id, { notes: 'x' }), /is already closed/);
  });

  await scenario('only dispatchers, on calls sent to their desk, in their organisation', async () => {
    await as(U.logger);
    const c = await logCall();
    await as(U.fireDesk);
    await refused(() => edit(c.id, { notes: 'x' }), /was not sent to your dispatch desk/);
    await as(U.cop);
    await refused(() => edit(c.id, { notes: 'x' }), /Not permitted for your role/);
    await as(U.viewer);
    await refused(() => edit(c.id, { notes: 'x' }), /Not permitted for your role/);
    await as(U.otherOrg);
    await refused(() => edit(c.id, { notes: 'x' }), /Incident not found/);
    await as(U.policeDesk);
    await refused(() => edit(c.id, { notes: 'x' }, 'y'.repeat(501)), /under 500 characters/);
    await refused(() => edit(c.id, { status: 'Closed' }), /That detail cannot be changed here: status/);
    await refused(() => edit(c.id, { caller_number: '082 555' }), /country code/, '0077’s checks still apply');
    await refused(() => edit(c.id, { call_description: '   ' }), /Enter the description/);
    assert.equal((await edits(c.id)).length, 0, 'a refused edit leaves nothing');
  });

  await scenario('the call taker’s edits keep their rules, and are kept too', async () => {
    await as(U.logger);
    const c = await logCall();
    const after = await complete(c.id, { details: { premises: 'A home', taken: ['TV'] } });
    assert.deepEqual(after.details, { premises: 'A home', taken: ['TV'] });
    const tl = (await timeline(c.id)).map((r) => r.message);
    assert.ok(tl.includes('[INTAKE] Details added by Lerato Logger: details.'), tl.join(' | '));
    const [e] = await edits(c.id);
    assert.equal(e.kind, 'intake');
    assert.equal(e.edited_by_name, 'Lerato Logger');
    assert.deepEqual(e.changes.details.before, { premises: 'A home' });
    assert.equal((await rows("select 1 from public.audit_logs where action_type = 'DISPATCH_EDIT'")).length, 0, 'not a dispatcher’s edit');
    await as(U.policeDesk);
    await refused(() => complete(c.id, { notes: 'x' }), /Not permitted for your role/, 'a dispatcher edits through dispatcher_edit_call');
    await as(U.control);
    assert.equal((await complete(c.id, { notes: 'From the control room' })).notes, 'From the control room');
    await db.query("insert into public.incident_departments (incident_id, silo, lead_id) values ($1, 'MetroPolice', $2)", [c.id, U.cop]);
    await as(U.logger);
    await refused(() => complete(c.id, { incident_type: 'Robbery' }), /A crew has accepted/);
  });

  await scenario('the changes are read only; nobody calls the core or writes them directly', async () => {
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await one(`select has_function_privilege('${role}', 'public.apply_call_edit(uuid, jsonb, text, text)', 'execute') as ok`)).ok, false,
        `${role} cannot call apply_call_edit`);
      for (const priv of ['insert', 'update', 'delete']) {
        assert.equal((await one(`select has_table_privilege('${role}', 'public.incident_edits', '${priv}') as ok`)).ok, false, `${role} cannot ${priv}`);
      }
    }
    assert.equal((await one("select has_table_privilege('anon', 'public.incident_edits', 'select') as ok")).ok, false);
    assert.equal((await one("select has_function_privilege('anon', 'public.dispatcher_edit_call(uuid, jsonb, text)', 'execute') as ok")).ok, false);
    assert.equal((await one("select has_function_privilege('authenticated', 'public.dispatcher_edit_call(uuid, jsonb, text)', 'execute') as ok")).ok, true);
    assert.equal((await one("select relrowsecurity as on from pg_class where relname = 'incident_edits'")).on, true);
    assert.equal((await one("select count(*)::int as n from pg_proc where proname = 'complete_call_intake'")).n, 1);
  });

  await db.query('rollback');
  console.log(`\n${checks} scenarios passed; 0076, 0077 and 0079 applied, 0079 twice.`);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}
