/** Run the disposition migration (0098) against in-memory Postgres (PGlite):
 * the lead closes on scene with an outcome from the list, the desk closes for
 * a crew with one, a phone not yet updated still closes without, and an
 * outcome not on the list is refused with nothing changed.
 *
 * CASE_PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node scripts/test-close-disposition.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.CASE_PGLITE_MODULE || '@electric-sql/pglite');

const migration = readFileSync(new URL('../supabase/migrations/0098_close_disposition.sql', import.meta.url), 'utf8');
const db = new PGlite();
let checks = 0;

const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = '20000000-0000-4000-8000-000000000001';
const U = { lead: id(1), desk: id(2), medic: id(3) };
const CALL = id(100);

async function as(uid, role, silo) {
  await db.query('reset role');
  await db.query("select set_config('test.user', $1, true), set_config('test.role', $2, true), set_config('test.silo', $3, true)", [uid, role, silo]);
  await db.query('set local role authenticated');
}
async function scenario(label, work) {
  await db.query('reset role');
  await db.query('savepoint scenario');
  try { await work(); checks++; console.log(`PASS ${label}`); }
  catch (e) { console.log(`FAIL ${label}`); throw e; }
  finally { await db.query('rollback to savepoint scenario'); await db.query('reset role'); }
}
const part = async (silo) => (await db.query('select disposition, closed_at, close_note from public.incident_departments where silo = $1', [silo])).rows[0];
const lastUpdate = async () => (await db.query('select message from public.incident_updates order by seq desc limit 1')).rows[0]?.message;
const refused = async (work, code) => {
  await db.query('savepoint try');
  try { await work(); } catch (e) { await db.query('rollback to savepoint try'); assert.equal(e.code, code, e.message); return; }
  throw new Error('expected a refusal');
};

try {
  await db.exec(`
    create role authenticated nologin; create role anon nologin; create role service_role nologin;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user', true), '')::uuid $$;
    create type public.silo as enum ('MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster', 'Ethekwini');
    create function public.current_tenant() returns uuid language sql stable as $$ select '${T}'::uuid $$;
    create function public.current_silo() returns public.silo language sql stable as $$ select current_setting('test.silo', true)::public.silo $$;
    create function public.role_in(variadic roles text[]) returns boolean language sql stable as $$ select current_setting('test.role', true) = any (roles) $$;
    create function public.require_role(variadic roles text[]) returns void language plpgsql as $$
      begin if not (current_setting('test.role', true) = any (roles)) then raise exception 'role' using errcode = '42501'; end if; end $$;
    create function public.can_work_incident(p uuid) returns boolean language sql stable as $$ select true $$;
    create function public.can_direct_department(p public.silo) returns boolean language sql stable as $$ select true $$;
    create function public.department_label(s public.silo) returns text language sql immutable as $$
      select case s when 'MetroPolice' then 'Metro Police' when 'Medical' then 'EMS' else s::text end $$;
    create function public.department_open(s text) returns boolean language sql immutable as $$
      select s in ('Waiting', 'Dispatched', 'En Route', 'Arrived', 'On Scene', 'Transporting') $$;
    create table public.profiles (id uuid primary key, full_name text, tenant_id uuid default '${T}', silo public.silo, deactivated_at timestamptz);
    create table public.personnel (user_id uuid, tenant_id uuid default '${T}', silo public.silo);
    create table public.incidents (id uuid primary key, tenant_id uuid default '${T}', silo public.silo, incident_number text, status text,
      incident_type text, location_address text, incident_severity text, dispatched_by_id uuid, updated_at timestamptz);
    create table public.incident_departments (id uuid primary key default gen_random_uuid(), incident_id uuid, silo public.silo, status text,
      lead_id uuid, report_filed_at timestamptz, closed_at timestamptz, closed_by uuid, closed_by_name text, close_note text,
      dispatched_by uuid, updated_at timestamptz);
    create table public.incident_updates (seq bigint generated always as identity, silo public.silo, incident_id uuid, message text,
      created_by uuid, created_by_name text, timestamp timestamptz default now());
    create table public.audit_logs (tenant_id uuid, silo public.silo, user_id uuid, user_name text, department text, action_type text,
      entity_type text, entity_id text, details text);
    create table public.alerts (tenant_id uuid, silo public.silo, target_user_id uuid, kind text, severity text, title text, body text,
      incident_id uuid, link text, presentation text, requires_ack boolean, created_by uuid, created_by_name text);
    create table public.chain (kind text, title text, body text);
    create function public.notify_incident_chain(i public.incidents, k text, t text, b text) returns void language sql as $$
      insert into public.chain values (k, t, b) $$;
    -- 0074's other functions grant on these; the stand-in grants are enough.
    grant usage on schema public, auth to authenticated;
    grant select on all tables in schema public to authenticated;
    insert into public.profiles (id, full_name) values ('${U.lead}', 'Const. Khumalo'), ('${U.desk}', 'Nomsa Metro'), ('${U.medic}', 'Medic Naidoo');
    insert into public.personnel (user_id, silo) values ('${U.lead}', 'MetroPolice'), ('${U.medic}', 'Medical');
    insert into public.incidents values ('${CALL}', '${T}', 'Ethekwini', 'ETK-MP-MD-20261022-0900-0001', 'Resolved', 'Assault', '10 Village Road', 'High', null, now());
    insert into public.incident_departments (incident_id, silo, status, lead_id, report_filed_at) values
      ('${CALL}', 'MetroPolice', 'Resolved', '${U.lead}', now() - interval '5 minutes'),
      ('${CALL}', 'Medical', 'Resolved', '${U.medic}', now() - interval '5 minutes');
  `);
  await db.exec(migration);
  await db.exec(migration); // safe to re-run
  await db.query('begin');

  await scenario('the lead closes on scene with an outcome: kept, on the timeline, audited, told', async () => {
    await as(U.lead, 'Police', 'MetroPolice');
    await db.query("select public.close_department_part($1, p_disposition => 'ARREST')", [CALL]);
    await db.query('reset role');
    assert.equal((await part('MetroPolice')).disposition, 'ARREST');
    assert.match(await lastUpdate(), /Metro Police closed by Const\. Khumalo\. Outcome: Arrest made\./);
    assert.match((await db.query('select details from public.audit_logs')).rows[0].details, /\(Arrest made\)/);
    assert.match((await db.query('select body from public.chain')).rows[0].body, /Arrest made/);
  });

  await scenario('the code is read forgivingly: lower case and spaces', async () => {
    await as(U.lead, 'Police', 'MetroPolice');
    await db.query("select public.close_department_part($1, p_disposition => '  report ')", [CALL]);
    await db.query('reset role');
    assert.equal((await part('MetroPolice')).disposition, 'REPORT');
  });

  await scenario('a phone not yet updated still closes, with no outcome', async () => {
    await as(U.lead, 'Police', 'MetroPolice');
    await db.query('select public.close_department_part($1, null, null)', [CALL]);
    await db.query('reset role');
    const p = await part('MetroPolice');
    assert.ok(p.closed_at);
    assert.equal(p.disposition, null);
    assert.doesNotMatch(await lastUpdate(), /Outcome/);
  });

  await scenario('an outcome not on the list is refused, and nothing closes', async () => {
    await as(U.lead, 'Police', 'MetroPolice');
    await refused(() => db.query("select public.close_department_part($1, p_disposition => 'SHOT_HIM')", [CALL]), '22023');
    await db.query('reset role');
    assert.equal((await part('MetroPolice')).closed_at, null);
  });

  await scenario('the desk closes for a crew on the radio, with its outcome', async () => {
    await as(U.desk, 'Dispatcher', 'Ethekwini');
    await db.query("select public.close_department_part_from_desk($1, 'Medical', null, 'TRANSPORTED')", [CALL]);
    await db.query('reset role');
    assert.equal((await part('Medical')).disposition, 'TRANSPORTED');
    assert.match(await lastUpdate(), /EMS closed from the desk by Nomsa Metro\. Outcome: Patient taken to hospital\./);
  });

  await scenario('the table itself refuses an outcome not on the list', async () => {
    await refused(() => db.query("update public.incident_departments set disposition = 'NOPE'"), '23514');
  });

  await scenario('the list and its words', async () => {
    const r = (await db.query("select public.disposition_label('GOA') as g, public.disposition_label(null) as n, cardinality(public.disposition_codes()) as c")).rows[0];
    assert.deepEqual(r, { g: 'Gone on arrival', n: null, c: 17 });
  });

  await db.query('rollback');
  console.log(`\n${checks} scenarios passed; 0098 applied twice.`);
} finally {
  await db.close();
}
