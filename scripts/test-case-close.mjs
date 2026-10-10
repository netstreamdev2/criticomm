/** Run the real case-review migration (0061) against in-memory Postgres (PGlite).
 * No credentials, no hosted database. It covers the end of a call's life:
 * responding, the report rule, closing after review or cancelling with a
 * reason, who hears about it, and who can see the case at all.
 *
 * CASE_PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node scripts/test-case-close.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// CASE_PGLITE_MODULE points at @electric-sql/pglite when it is installed outside this repo.
const { PGlite } = await import(process.env.CASE_PGLITE_MODULE || '@electric-sql/pglite');

const ROOT = new URL('../supabase/migrations/', import.meta.url);
const sql = (name) => readFileSync(new URL(name, ROOT), 'utf8');
const functionSql = (source, name) => {
  const match = source.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`, 'i'));
  assert.ok(match, `function ${name} exists`);
  return match[0];
};
const db = new PGlite();
let checks = 0;
const one = async (query, args) => (await db.query(query, args)).rows[0];
const scalar = async (query, args) => (await one(query, args))?.value;

const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T1 = '20000000-0000-4000-8000-000000000001';
const T2 = '20000000-0000-4000-8000-000000000002';
const U = {
  officer: id(1), captain: id(2), medic: id(3), dispatcher: id(4), cmEth: id(5), cmEth2: id(6),
  cmPolice: id(7), cmFire: id(8), logger: id(9), viewer: id(10), fireAdmin: id(11), cmOther: id(12),
  supervisor: id(13), officer2: id(14),
};
const PEOPLE = [
  [U.officer, T1, 'Police', 'MetroPolice', 'Const. Khumalo'],
  [U.officer2, T1, 'Police', 'MetroPolice', 'Const. Mthembu'],
  [U.captain, T1, 'Captain', 'MetroPolice', 'Capt. Dube'],
  [U.medic, T1, 'Paramedic', 'Medical', 'Medic Pillay'],
  [U.dispatcher, T1, 'Dispatcher', 'Ethekwini', 'Naledi Dispatch'],
  [U.cmEth, T1, 'CaseManager', 'Ethekwini', 'Ayanda Case'],
  [U.cmEth2, T1, 'CaseManager', 'Ethekwini', 'Second Case'],
  [U.cmPolice, T1, 'CaseManager', 'MetroPolice', 'Police Case'],
  [U.cmFire, T1, 'CaseManager', 'MetroFire', 'Fire Case'],
  [U.logger, T1, 'IncidentLogger', 'Ethekwini', 'Lerato Logger'],
  [U.viewer, T1, 'Viewer', 'Ethekwini', 'Zinhle Viewer'],
  [U.fireAdmin, T1, 'Admin', 'MetroFire', 'Pieter Fire'],
  [U.cmOther, T2, 'CaseManager', 'Ethekwini', 'Other Tenant'],
  [U.supervisor, T1, 'Supervisor', 'MetroPolice', 'Mandla Supervisor'],
];
const who = Object.fromEntries(PEOPLE.map(([uid, tenant, role, silo]) => [uid, { tenant, role, silo }]));

const INC = {
  policeLogged: id(101),  // logged by the control room, sent to Metro Police
  policeOwned: id(102),   // owned by Metro Police
  fire: id(103),
  ems: id(104),
  pending: id(105),       // logged, never dispatched
  other: id(106),         // another tenant
};

async function as(uid) {
  const p = who[uid];
  await db.query('reset role');
  await db.query(
    "select set_config('test.user', $1, true), set_config('test.silo', $2, true), set_config('test.role', $3, true), set_config('test.tenant', $4, true)",
    [uid, p.silo, p.role, p.tenant],
  );
  await db.query('set local role authenticated');
}
const asOwner = () => db.query('reset role');
const status = (incident, s, at = null) => db.query('select status from update_responder_status($1, $2, $3)', [incident, s, at]);
const close = (incident, reason = null) => db.query('select * from close_case($1, $2)', [incident, reason]);
const visible = async (incident) => Number(await scalar('select count(*)::int as value from incidents where id = $1', [incident]));
const alertsFor = async (uid, incident, kind) => Number(await scalar(
  'select count(*)::int as value from alerts where target_user_id = $1 and incident_id = $2 and kind = $3', [uid, incident, kind]));

/** Expect a refusal. A refused call aborts the transaction, so it runs inside its own savepoint. */
async function refused(call, pattern, message) {
  await db.query('savepoint refused');
  try { await assert.rejects(call(), pattern, message); }
  finally { await db.query('rollback to savepoint refused'); }
}

async function scenario(label, work) {
  await db.query('reset role');
  await db.query('savepoint scenario');
  try { await work(); checks++; console.log(`PASS ${label}`); }
  // A refused call aborts the transaction; only the rollback may run after it.
  finally { await db.query('rollback to savepoint scenario'); }
}

try {
  await db.exec(`
    create role authenticated nologin; create role anon nologin;
    create schema auth;
    create type public.silo as enum ('Ethekwini','MetroPolice','MetroFire','Medical','EthekwiniDisaster');
    create type public.incident_status as enum ('New','Pending','Pending Dispatch','Pending Analysis','Dispatched',
      'En Route','Arrived','On Scene','Transporting','Active','Closed','Resolved');
    create type public.incident_severity as enum ('Low','Medium','High','Critical');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user', true), '')::uuid $$;
    create function public.current_tenant() returns uuid language sql stable as $$ select nullif(current_setting('test.tenant', true), '')::uuid $$;
    create function public.current_silo() returns public.silo language sql stable as $$ select coalesce(nullif(current_setting('test.silo', true), ''), 'Ethekwini')::public.silo $$;
    create function public.role_in(variadic roles text[]) returns boolean language sql stable as $$ select current_setting('test.role', true) = any(roles) $$;
    create function public.require_role(variadic roles text[]) returns void language plpgsql as $$ begin
      if auth.uid() is null or not public.role_in(variadic roles) then raise exception 'Role refused' using errcode='42501'; end if;
    end $$;
    create function public.is_global() returns boolean language sql stable as $$
      select current_setting('test.role', true) in ('SystemAdmin','SuperAdmin','Dispatcher','Operator','ControlRoom','IncidentLogger','Viewer','System','SystemController') $$;

    create table public.profiles(id uuid primary key, tenant_id uuid, role text, silo public.silo, full_name text, deactivated_at timestamptz);
    create table public.apparatus(id uuid primary key default gen_random_uuid(), tenant_id uuid, unit_number text);
    create table public.personnel(id uuid primary key default gen_random_uuid(), user_id uuid, tenant_id uuid, silo public.silo,
      rank text, first_name text, last_name text, is_on_duty boolean default false, assigned_apparatus_id uuid);
    create table public.incidents(
      id uuid primary key, tenant_id uuid not null default public.current_tenant(), silo public.silo not null,
      dispatched_silos public.silo[] not null default '{}', incident_number text not null, source text default 'Master',
      incident_type text not null default 'Robbery', incident_severity public.incident_severity not null default 'High',
      location_address text not null default '1 Smith St', status public.incident_status not null,
      call_timestamp timestamptz not null default now(), dispatch_time timestamptz, arrived_timestamp timestamptz,
      accepted_by uuid, accepted_at timestamptz, assigned_to uuid, assigned_to_name text, unit_id uuid,
      responding_officer text, acceptance boolean not null default false, unit_status text,
      dispatched_by_id uuid, report_filed_at timestamptz, resolved_at timestamptz, resolved_by uuid,
      closed_at timestamptz, created_by uuid, updated_at timestamptz not null default now());
    create table public.incident_responders(id uuid primary key default gen_random_uuid(), tenant_id uuid, incident_id uuid,
      user_id uuid, silo public.silo, name text, unit_id uuid, role text, status public.incident_status,
      joined_at timestamptz, updated_at timestamptz default now(), unique (incident_id, user_id));
    create table public.incident_updates(id uuid primary key default gen_random_uuid(), tenant_id uuid default public.current_tenant(),
      silo public.silo, incident_id uuid, message text, created_by uuid, created_by_name text, timestamp timestamptz default now());
    create table public.audit_logs(id uuid primary key default gen_random_uuid(), tenant_id uuid default public.current_tenant(),
      silo public.silo, user_id uuid, user_name text, department text, action_type text, entity_type text, entity_id text,
      details text, timestamp timestamptz default now());
    create table public.alerts(id uuid primary key default gen_random_uuid(), tenant_id uuid default public.current_tenant(),
      silo public.silo not null, target_user_id uuid, kind text not null, severity text, title text not null, body text,
      incident_id uuid, link text, presentation text, requires_ack boolean, created_by uuid, created_by_name text,
      created_at timestamptz default now());

    create function public.my_apparatus_id() returns uuid language sql stable security definer set search_path = public as $$
      select assigned_apparatus_id from public.personnel where user_id = auth.uid() and tenant_id = public.current_tenant() limit 1 $$;
    create function public.is_responder(p_incident_id uuid) returns boolean language sql stable security definer set search_path = public as $$
      select exists (select 1 from public.incident_responders where incident_id = p_incident_id and user_id = auth.uid()) $$;

    -- Row security as the hosted database has it (0002, 0042, 0030).
    alter table incidents enable row level security;
    create policy incidents_read on incidents for select using (
      silo = public.current_silo() or public.is_global() or public.current_silo() = any(dispatched_silos));
    create policy incidents_assigned_read on incidents for select to authenticated using (
      accepted_by = auth.uid() or assigned_to = auth.uid() or public.is_responder(id));
    create policy tenant_isolation on incidents as restrictive for all to authenticated
      using (tenant_id = public.current_tenant()) with check (tenant_id = public.current_tenant());
    alter table audit_logs enable row level security;
    create policy audit_logs_read on audit_logs for select using (silo = public.current_silo() or public.is_global());
    create policy tenant_isolation on audit_logs as restrictive for all to authenticated
      using (tenant_id = public.current_tenant()) with check (tenant_id = public.current_tenant());

    grant usage on schema auth, public to authenticated, anon;
    grant select on incidents, audit_logs, alerts, incident_updates, incident_responders to authenticated;
  `);
  await db.exec(functionSql(sql('0039_police_dispatch_response.sql'), 'try_uuid'));

  // The migration under test, twice: it must be safe to re-run.
  await db.exec(sql('0061_case_review_and_close.sql'));
  await db.exec(sql('0061_case_review_and_close.sql'));

  for (const [uid, tenant, role, silo, name] of PEOPLE) {
    await db.query('insert into profiles(id, tenant_id, role, silo, full_name) values ($1,$2,$3,$4,$5)', [uid, tenant, role, silo, name]);
  }
  const unit = (await one("insert into apparatus(tenant_id, unit_number) values ($1, 'POL-01') returning id", [T1])).id;
  for (const [uid, silo, first] of [[U.officer, 'MetroPolice', 'Sipho'], [U.officer2, 'MetroPolice', 'Bheki'], [U.captain, 'MetroPolice', 'Themba'], [U.medic, 'Medical', 'Priya']]) {
    await db.query('insert into personnel(user_id, tenant_id, silo, rank, first_name, last_name, is_on_duty, assigned_apparatus_id) values ($1,$2,$3,$4,$5,$6,true,$7)',
      [uid, T1, silo, 'Const.', first, 'Test', uid === U.officer ? unit : null]);
  }
  const incident = (incId, tenant, silo, sent, s, number) => db.query(
    `insert into incidents(id, tenant_id, silo, dispatched_silos, status, incident_number, dispatch_time, dispatched_by_id)
     values ($1,$2,$3,$4,$5::public.incident_status,$6,$7,$8)`,
    [incId, tenant, silo, sent, s, number, s === 'Pending Dispatch' ? null : new Date().toISOString(), U.dispatcher]);
  await incident(INC.policeLogged, T1, 'Ethekwini', '{MetroPolice}', 'Dispatched', 'INC-ETH-1');
  await incident(INC.policeOwned, T1, 'MetroPolice', '{MetroPolice}', 'Dispatched', 'INC-POL-1');
  await incident(INC.fire, T1, 'MetroFire', '{MetroFire}', 'Dispatched', 'INC-FIR-1');
  await incident(INC.ems, T1, 'Medical', '{Medical}', 'Dispatched', 'INC-EMS-1');
  await incident(INC.pending, T1, 'Ethekwini', '{}', 'Pending Dispatch', 'INC-ETH-2');
  await incident(INC.other, T2, 'MetroPolice', '{MetroPolice}', 'Resolved', 'INC-OTH-1');
  await db.exec('begin');

  /** Take a police call to Resolved the way file_incident_report() leaves it. */
  const reported = async (incId) => {
    await as(U.officer);
    await status(incId, 'En Route');
    await status(incId, 'On Scene');
    await asOwner();
    await db.query("update incidents set status = 'Resolved', report_filed_at = now(), resolved_at = now(), resolved_by = $2 where id = $1", [incId, U.officer]);
  };

  // ── Who can see a case ────────────────────────────────────────────────────

  await scenario('a control-room case manager sees every department\'s cases in their tenant, and no other tenant\'s', async () => {
    await as(U.cmEth);
    for (const incId of [INC.policeLogged, INC.policeOwned, INC.fire, INC.ems, INC.pending]) assert.equal(await visible(incId), 1, incId);
    assert.equal(await visible(INC.other), 0, 'another tenant');
    assert.equal(await scalar('select can_work_incident($1) as value', [INC.policeOwned]), true, 'and its timeline, evidence and report');
  });
  await scenario('a department case manager keeps their department only', async () => {
    await as(U.cmPolice);
    assert.equal(await visible(INC.policeOwned), 1);
    assert.equal(await visible(INC.policeLogged), 1, 'a control-room call sent to Metro Police');
    assert.equal(await visible(INC.fire), 0);
    assert.equal(await scalar('select can_work_incident($1) as value', [INC.fire]), false);
    await as(U.cmOther);
    assert.equal(await visible(INC.policeOwned), 0, 'another tenant\'s case manager sees nothing here');
  });

  // ── Responding and the report rule ────────────────────────────────────────

  await scenario('an officer responds and leads; Resolved without the report is refused', async () => {
    await as(U.officer);
    await status(INC.policeLogged, 'En Route');
    await status(INC.policeLogged, 'On Scene');
    await refused(() => status(INC.policeLogged, 'Resolved'), /File the incident report to resolve INC-ETH-1/);
    await asOwner();
    const row = await one('select status, accepted_by from incidents where id = $1', [INC.policeLogged]);
    assert.equal(row.status, 'On Scene');
    assert.equal(row.accepted_by, U.officer);
  });
  await scenario('the desk cannot resolve a police or fire call without its report, nor close anything by status', async () => {
    await as(U.dispatcher);
    await refused(() => status(INC.policeOwned, 'Resolved'), /File the incident report to resolve INC-POL-1/);
    await refused(() => status(INC.fire, 'Resolved'), /File the incident report to resolve INC-FIR-1/);
    await refused(() => status(INC.ems, 'Closed'), /Close INC-EMS-1 from its case file/);
    await status(INC.policeOwned, 'On Scene'); // a radioed-in correction still works
    await asOwner();
    assert.equal(await scalar('select status::text as value from incidents where id = $1', [INC.policeOwned]), 'On Scene');
  });
  await scenario('a finished call stays finished, for the desk and the field alike', async () => {
    await reported(INC.policeOwned);
    await as(U.dispatcher);
    await refused(() => status(INC.policeOwned, 'On Scene'), /INC-POL-1 is already resolved/);
    await as(U.officer);
    await refused(() => status(INC.policeOwned, 'On Scene'), /already resolved/);
  });
  await scenario('a Captain responding from the phone becomes the accepting officer, so their report can be filed', async () => {
    await as(U.captain);
    await status(INC.policeOwned, 'En Route');
    await asOwner();
    const row = await one('select accepted_by, responding_officer from incidents where id = $1', [INC.policeOwned]);
    assert.equal(row.accepted_by, U.captain);
    assert.equal(await scalar("select role as value from incident_responders where incident_id = $1 and user_id = $2", [INC.policeOwned, U.captain]), 'lead');
    await as(U.captain);
    await refused(() => status(INC.policeOwned, 'Resolved'), /File the incident report/, 'and the report rule binds them too');
  });
  await scenario('EMS resolves through the ladder, and resolving stamps when and who', async () => {
    await as(U.medic);
    for (const s of ['En Route', 'Arrived', 'On Scene', 'Transporting', 'Resolved']) await status(INC.ems, s);
    await asOwner();
    const row = await one('select status::text, resolved_at, resolved_by from incidents where id = $1', [INC.ems]);
    assert.equal(row.status, 'Resolved');
    assert.ok(row.resolved_at, 'resolved_at stamped');
    assert.equal(row.resolved_by, U.medic);
  });

  // ── Closing after review ──────────────────────────────────────────────────

  await scenario('the case manager closes a reported case; the officers, dispatcher, command and other case managers are told', async () => {
    await reported(INC.policeLogged);
    await as(U.cmEth);
    const closed = (await close(INC.policeLogged, 'Report complete; statement on file')).rows[0];
    assert.equal(closed.status, 'Closed');
    assert.equal(closed.close_kind, 'Reviewed');
    assert.equal(closed.closed_by, U.cmEth);
    assert.equal(closed.closed_by_name, 'Ayanda Case');
    assert.equal(closed.close_reason, 'Report complete; statement on file');
    assert.ok(closed.closed_at);
    await asOwner();
    // One transaction: every now() is the same instant, so find the entry by what it says.
    assert.match(
      await scalar("select message as value from incident_updates where incident_id = $1 and message like '[CLOSED]%'", [INC.policeLogged]),
      /^\[CLOSED\] Case reviewed and closed by Ayanda Case — Report complete; statement on file$/,
    );
    assert.equal(await scalar("select count(*)::int as value from audit_logs where entity_id = $1 and action_type = 'CASE_CLOSED'", [INC.policeLogged]), 1);
    assert.equal(await alertsFor(U.officer, INC.policeLogged, 'closed'), 1, 'the officer who filed the report');
    assert.equal(await alertsFor(U.dispatcher, INC.policeLogged, 'closed'), 1, 'the dispatcher');
    assert.equal(await alertsFor(U.supervisor, INC.policeLogged, 'closed'), 1, 'Metro Police command');
    assert.equal(await alertsFor(U.cmEth2, INC.policeLogged, 'closed'), 1, 'the other control-room case manager');
    assert.equal(await alertsFor(U.cmEth, INC.policeLogged, 'closed'), 0, 'not the person who closed it');
    assert.equal(await alertsFor(U.cmFire, INC.policeLogged, 'closed'), 0, 'not a Fire case manager');
  });
  await scenario('a review note is optional, and a closed case cannot be closed again', async () => {
    await reported(INC.policeOwned);
    await as(U.cmPolice);
    const closed = (await close(INC.policeOwned)).rows[0];
    assert.equal(closed.close_kind, 'Reviewed');
    assert.equal(closed.close_reason, null);
    await refused(() => close(INC.policeOwned, 'again please'), /INC-POL-1 is already closed/);
  });

  // ── Cancelling a live call ────────────────────────────────────────────────

  await scenario('the case manager does not cancel a live call; that is the desk\'s decision', async () => {
    await as(U.cmEth);
    await refused(() => close(INC.policeOwned, 'Looks like a duplicate call'), /case managers close resolved cases/);
  });
  await scenario('the desk cancels a live call only with a reason, and the responding officers are told to stand down', async () => {
    await as(U.officer);
    await status(INC.policeOwned, 'En Route');
    await as(U.dispatcher);
    await refused(() => close(INC.policeOwned), /Say why INC-POL-1 is being closed without a report/);
    await refused(() => close(INC.policeOwned, 'hoax'), /at least 10 characters/);
    const closed = (await close(INC.policeOwned, 'Caller confirmed a false alarm')).rows[0];
    assert.equal(closed.status, 'Closed');
    assert.equal(closed.close_kind, 'Cancelled');
    await asOwner();
    assert.equal(await scalar('select title as value from alerts where target_user_id = $1 and incident_id = $2', [U.officer, INC.policeOwned]), 'INC-POL-1 cancelled: stand down');
    assert.equal(await scalar("select count(*)::int as value from audit_logs where entity_id = $1 and action_type = 'CALL_CANCELLED'", [INC.policeOwned]), 1);
    // The officer is released: the call no longer holds them.
    assert.equal(await scalar("select count(*)::int as value from incidents where accepted_by = $1 and status not in ('Resolved','Closed')", [U.officer]), 0);
  });
  await scenario('a call that was never dispatched can be cancelled by the desk', async () => {
    await as(U.dispatcher);
    const closed = (await close(INC.pending, 'Duplicate of INC-ETH-1, same caller')).rows[0];
    assert.equal(closed.close_kind, 'Cancelled');
  });

  // ── Who may not close ─────────────────────────────────────────────────────

  await scenario('the call-taker, the viewer and the officer never close a case', async () => {
    await reported(INC.policeOwned);
    for (const uid of [U.logger, U.viewer, U.officer]) {
      await as(uid);
      await refused(() => close(INC.policeOwned, 'Trying to close this'), /Role refused/, who[uid].role);
    }
  });
  await scenario('a department Admin cannot close another department\'s case by its id, nor another tenant', async () => {
    await reported(INC.policeOwned);
    await as(U.fireAdmin);
    await refused(() => close(INC.policeOwned, 'Not my department at all'), /not found/);
    await as(U.cmOther);
    await refused(() => close(INC.policeOwned), /not found/);
  });
  await scenario('nobody signed out can close a case', async () => {
    assert.equal(await scalar("select has_function_privilege('anon', 'public.close_case(uuid, text)', 'EXECUTE') as value"), false);
  });

  // ── Who hears a report land, and who reads the trail ──────────────────────

  await scenario('case managers hear when a report lands for review; only resolved and closed reach them', async () => {
    await asOwner();
    await db.query("select set_config('test.user', $1, true), set_config('test.tenant', $2, true)", [U.officer, T1]);
    await db.query("select notify_incident_chain(i, 'resolved', 'INC resolved', 'report filed') from incidents i where id = $1", [INC.policeLogged]);
    await db.query("select notify_incident_chain(i, 'responding', 'INC responding', 'en route') from incidents i where id = $1", [INC.policeLogged]);
    for (const uid of [U.cmEth, U.cmEth2, U.cmPolice]) assert.equal(await alertsFor(uid, INC.policeLogged, 'resolved'), 1, who[uid].silo);
    assert.equal(await alertsFor(U.cmFire, INC.policeLogged, 'resolved'), 0, 'a Fire case manager');
    assert.equal(await alertsFor(U.cmEth, INC.policeLogged, 'responding'), 0, 'not every step of the call');
    await db.query('update profiles set deactivated_at = now() where id = $1', [U.cmEth2]);
    await db.query("select notify_incident_chain(i, 'closed', 'INC closed', '') from incidents i where id = $1", [INC.policeLogged]);
    assert.equal(await alertsFor(U.cmEth2, INC.policeLogged, 'closed'), 0, 'a deactivated account hears nothing');
  });
  await scenario('the case audit trail is readable by its reviewer whichever department wrote it', async () => {
    await asOwner();
    await db.query(`insert into audit_logs(tenant_id, silo, action_type, entity_type, entity_id, details) values
      ($1, 'MetroPolice', 'REPORT_FILED', 'incidents', $2, 'report'),
      ($1, 'MetroPolice', 'RoleChanged', 'profiles', $3, 'not a case')`, [T1, INC.policeOwned, U.officer]);
    await as(U.cmEth);
    assert.equal(await scalar("select count(*)::int as value from audit_logs where action_type = 'REPORT_FILED'"), 1, 'the case\'s own trail');
    assert.equal(await scalar("select count(*)::int as value from audit_logs where action_type = 'RoleChanged'"), 0, 'nothing that is not a case');
    await as(U.medic);
    assert.equal(await scalar("select count(*)::int as value from audit_logs where action_type = 'REPORT_FILED'"), 0, 'a paramedic does not read police audit');
    await as(U.cmFire);
    assert.equal(await scalar("select count(*)::int as value from audit_logs where action_type = 'REPORT_FILED'"), 0, 'nor a Fire case manager');
  });

  console.log(`${checks} database scenarios passed; 0061 applied twice.`);
} finally { await db.close(); }
