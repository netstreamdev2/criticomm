/** Run the real hospital-handover migration (0064, after 0063) against
 * in-memory Postgres (PGlite), on the real patient-care and handover tables
 * from 0001. It covers what a handover must hold, the legal handover record
 * kept in step with its report, the doctor's read-only role, and who reads it.
 *
 * CASE_PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node scripts/test-ems-handover.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.CASE_PGLITE_MODULE || '@electric-sql/pglite');

const read = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const init = read('0001_init.sql');
const start = init.indexOf('create table public.medical_histories');
const end = init.indexOf('create table', init.indexOf('create table public.ambulance_restocks') + 10);
assert.ok(start > 0 && end > start, 'PCR tables found in 0001');
const pcrTables = init.slice(start, end);
const migration0063 = read('0063_ems_incident_flow.sql');
const migration = read('0064_hospital_handover.sql');

const db = new PGlite();
let checks = 0;
const one = async (q, args) => (await db.query(q, args)).rows[0];
const scalar = async (q, args) => (await one(q, args))?.value;

const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T1 = '20000000-0000-4000-8000-000000000001';
const T2 = '20000000-0000-4000-8000-000000000002';
const U = { medic: id(1), medic2: id(2), police: id(3), dispatcher: id(4), caseManager: id(5), fire: id(6), other: id(7), doctor: id(8) };
const PEOPLE = [
  [U.medic, T1, 'Paramedic', 'Medical', 'Priya Pillay'],
  [U.medic2, T1, 'Paramedic', 'Medical', 'Sizwe Dlamini'],
  [U.doctor, T1, 'Doctor', 'Medical', 'Dale Naidoo'],
  [U.police, T1, 'Police', 'MetroPolice', 'Sipho Khumalo'],
  [U.dispatcher, T1, 'Dispatcher', 'Ethekwini', 'Naledi Dispatch'],
  [U.caseManager, T1, 'CaseManager', 'Ethekwini', 'Ayanda Case'],
  [U.fire, T1, 'Firefighter', 'MetroFire', 'Thabo Fire'],
  [U.other, T2, 'Paramedic', 'Medical', 'Other Tenant'],
];
const who = Object.fromEntries(PEOPLE.map(([uid, tenant, role, silo]) => [uid, { tenant, role, silo }]));

async function as(uid) {
  const p = who[uid];
  await db.query('reset role');
  await db.query(
    "select set_config('test.user', $1, true), set_config('test.silo', $2, true), set_config('test.role', $3, true), set_config('test.tenant', $4, true)",
    [uid, p.silo, p.role, p.tenant],
  );
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
  finally { await db.query('rollback to savepoint scenario'); }
}

const SIG = 'data:image/png;base64,iVBORw0KGgo=';
const good = (extra = {}) => ({
  patient_name: 'Thandi Zulu', chief_complaint: 'Chest pain', level_of_care: 'ALS', patient_response: 'Improved',
  transport_mode: 'Ambulance (Ground)', destination_hospital: 'Addington Hospital',
  gcs_eye: '4 - Spontaneously', gcs_verbal: '5 - Oriented', gcs_motor: '6 - Obeys Commands',
  blood_pressure: '120/80', allergies: 'NKDA', medical_history: 'Hypertension', current_medications: 'Amlodipine',
  airway_management: 'OPA/NPA', medication_admin: 'Aspirin', departure_time: '14:05', arrival_time: '14:30',
  responder_signature_image_base64: SIG, requires_cleaning: 'false',
  handover_doctor_name: 'Dr Dale Naidoo', handover_patient_status: 'Stable, GCS 15', doctor_signature_image_base64: SIG,
  secondary_patients_json: JSON.stringify([{ name: 'Driver', age: '40', gender: 'Male', triage: 'Red (Immediate)', injuries: 'Head wound' }]),
  inv_oxygen: 'true', inv_bvm: 'true', inv_suction: 'true', inv_iv: 'true', inv_bandages: 'true',
  inv_aed: 'true', inv_drugs: 'true', inv_sharps: 'true', inv_ppe: 'true',
  ...extra,
});
const file = (incident, fields) => db.query('select * from file_pcr($1, $2::jsonb)', [incident, JSON.stringify(fields)]);
const incidentRow = (incident) => one('select * from incidents where id = $1', [incident]);

try {
  await db.exec(`
    create role authenticated nologin; create role anon nologin;
    create schema auth; create table auth.users(id uuid primary key);
    create function public.uuid_generate_v4() returns uuid language sql as $$ select gen_random_uuid() $$;
    create type public.silo as enum ('Ethekwini','MetroPolice','MetroFire','Medical','EthekwiniDisaster');
    create type public.incident_status as enum ('Pending Dispatch','Dispatched','En Route','Arrived','On Scene','Transporting','Resolved','Closed');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user', true), '')::uuid $$;
    create function public.current_tenant() returns uuid language sql stable as $$ select nullif(current_setting('test.tenant', true), '')::uuid $$;
    create function public.current_silo() returns public.silo language sql stable as $$ select coalesce(nullif(current_setting('test.silo', true), ''), 'Ethekwini')::public.silo $$;
    create function public.role_in(variadic roles text[]) returns boolean language sql stable as $$ select current_setting('test.role', true) = any(roles) $$;
    create function public.is_global() returns boolean language sql stable as $$ select current_setting('test.role', true) in ('Dispatcher','SystemAdmin','SuperAdmin') $$;
    create function public.require_role(variadic roles text[]) returns void language plpgsql as $$ begin
      if auth.uid() is null or not public.role_in(variadic roles) then raise exception 'Role refused' using errcode='42501'; end if;
    end $$;

    create table public.profiles(id uuid primary key, full_name text);
    create table public.apparatus(id uuid primary key default gen_random_uuid(), tenant_id uuid, silo public.silo, unit_number text,
      status text not null default 'In Use', status_note text, status_changed_at timestamptz, status_changed_by_name text);
    create table public.personnel(id uuid primary key default gen_random_uuid(), user_id uuid, tenant_id uuid, silo public.silo,
      rank text, first_name text, last_name text, is_on_duty boolean default true, assigned_apparatus_id uuid);
    create table public.incidents(
      id uuid primary key, tenant_id uuid not null, silo public.silo not null, dispatched_silos public.silo[] not null default '{}',
      incident_number text not null, incident_type text default 'Medical', location_address text default '1 Smith St',
      status public.incident_status not null, call_timestamp timestamptz default now(), incident_created_at timestamptz default now(),
      dispatch_time timestamptz default now() - interval '20 minutes', arrived_timestamp timestamptz, accepted_by uuid, unit_id uuid,
      unit_status text, responding_officer text, report_filed_at timestamptz, resolved_at timestamptz, resolved_by uuid,
      updated_at timestamptz default now());
    create table public.incident_updates(id uuid primary key default gen_random_uuid(), silo public.silo, incident_id uuid,
      message text, created_by uuid, created_by_name text);
    create table public.audit_logs(id uuid primary key default gen_random_uuid(), tenant_id uuid, silo public.silo, user_id uuid,
      user_name text, department text, action_type text, entity_type text, entity_id text, details text);
    create table public.sent(kind text, tenant_id uuid, title text, severity text);
    create function public.notify_incident_chain(p_incident public.incidents, p_kind text, p_title text, p_body text) returns void
      language sql as $$ insert into public.sent values (p_kind, p_incident.tenant_id, p_title, null) $$;
    create function public.notify_command(p_tenant uuid, p_silo public.silo, p_title text, p_body text, p_severity text, p_link text) returns void
      language sql as $$ insert into public.sent values ('command', p_tenant, p_title, p_severity) $$;
    create function public.can_work_incident(p_incident_id uuid) returns boolean language sql stable as $$
      select exists (select 1 from public.incidents i where i.id = p_incident_id and i.accepted_by = auth.uid()) $$;
  `);
  await db.exec(pcrTables);
  // Tenant walls and the original row rules (0002, 0030).
  await db.exec(`
    do $$ declare t text; begin
      foreach t in array array['medical_histories','assessment_findings','vital_signs','interventions','paramedic_reports','legal_handovers','ambulance_restocks'] loop
        execute format('alter table public.%I add column tenant_id uuid not null default public.current_tenant()', t);
        execute format('alter table public.%I enable row level security', t);
        execute format('create policy tenant_isolation on public.%I as restrictive for all to authenticated using (tenant_id = public.current_tenant()) with check (tenant_id = public.current_tenant())', t);
      end loop;
    end $$;
    create policy paramedic_reports_read on public.paramedic_reports for select using (silo = public.current_silo() or public.is_global());
    create policy paramedic_reports_write on public.paramedic_reports for all
      using (silo = public.current_silo() and public.role_in('Paramedic','Doctor','Supervisor','SystemAdmin','SuperAdmin','Admin','CaseManager'))
      with check (silo = public.current_silo());
    create policy vital_signs_rw on public.vital_signs for all
      using (silo = public.current_silo() and public.role_in('Paramedic','Doctor','Supervisor','SystemAdmin','SuperAdmin','Admin'))
      with check (silo = public.current_silo());
    alter table public.incidents enable row level security;
    create policy incidents_all on public.incidents for all using (true) with check (true);
    grant usage on schema auth, public to authenticated;
    grant select, insert, update, delete on all tables in schema public to authenticated;
  `);

  // 0063 first, then the migration under test, twice: it must be safe to re-run.
  await db.exec(migration0063);
  await db.exec(migration);
  await db.exec(migration);

  for (const [uid, tenant, , silo, name] of PEOPLE) {
    await db.query('insert into auth.users values ($1)', [uid]);
    await db.query('insert into profiles values ($1, $2)', [uid, name]);
    const [first, last] = name.split(' ');
    await db.query('insert into personnel(user_id, tenant_id, silo, rank, first_name, last_name) values ($1,$2,$3,$4,$5,$6)', [uid, tenant, silo, 'EMT', first, last]);
  }
  const amb = (await one("insert into apparatus(tenant_id, silo, unit_number) values ($1, 'Medical', 'AMB-01') returning id", [T1])).id;
  await db.query('update personnel set assigned_apparatus_id = $1 where user_id = $2', [amb, U.medic]);
  const INC = { onScene: id(101), enRoute: id(102), shared: id(103), other: id(104), doctor: id(105) };
  const incident = (incId, tenant, silo, sent, status, lead, number) => db.query(
    `insert into incidents(id, tenant_id, silo, dispatched_silos, status, accepted_by, incident_number, arrived_timestamp, unit_id)
     values ($1,$2,$3,$4,$5::incident_status,$6,$7, case when $5 in ('On Scene','Transporting') then now() - interval '5 minutes' end, $8)`,
    [incId, tenant, silo, sent, status, lead, number, amb]);
  await incident(INC.onScene, T1, 'Medical', '{Medical}', 'On Scene', U.medic, 'INC-20261009-0001');
  await incident(INC.enRoute, T1, 'Medical', '{Medical}', 'En Route', U.medic, 'INC-20261009-0002');
  await incident(INC.shared, T1, 'Ethekwini', '{MetroPolice,Medical}', 'Transporting', U.medic, 'INC-20261009-0003');
  await incident(INC.other, T2, 'Medical', '{Medical}', 'On Scene', U.other, 'INC-20261009-0004');
  await incident(INC.doctor, T1, 'Medical', '{Medical}', 'On Scene', U.doctor, 'INC-20261009-0005');
  await db.exec('begin');

  const handoverOf = async (pcrId) => one('select * from legal_handovers where pcr_id = $1', [pcrId]);

  // ── What a handover must hold ─────────────────────────────────────────────

  await scenario('a patient taken to hospital needs the time, receiving doctor, condition and the doctor\'s signature', async () => {
    await as(U.medic);
    await refused(() => file(INC.onScene, good({ handover_doctor_name: '' })), /Receiving Doctor is required/);
    await refused(() => file(INC.onScene, good({ arrival_time: '' })), /Handover Time is required/);
    await refused(() => file(INC.onScene, good({ handover_patient_status: ' ' })), /Patient Status at Handover is required/);
    await refused(() => file(INC.onScene, good({ doctor_signature_image_base64: '' })), /receiving doctor must sign/);
    await refused(() => file(INC.onScene, good({ handover_patient_status: 'x'.repeat(501) })), /too long/);
    await refused(() => file(INC.onScene, good({ transport_mode: 'HEMS (Airlift)', handover_doctor_name: '' })), /Receiving Doctor/, 'by air too');
  });

  // ── The record ────────────────────────────────────────────────────────────

  await scenario('filing records the handover on the report and as its legal handover record', async () => {
    await as(U.medic);
    const r = (await file(INC.onScene, good())).rows[0];
    assert.equal(r.handover_doctor_name, 'Dr Dale Naidoo');
    assert.equal(r.handover_patient_status, 'Stable, GCS 15');
    await db.query('reset role');
    const h = await handoverOf(r.id);
    assert.equal(h.incident_id, INC.onScene);
    assert.equal(h.receiving_hosp, 'Addington Hospital');
    assert.equal(h.doctor_name, 'Dr Dale Naidoo');
    assert.equal(h.patient_status_at_handover, 'Stable, GCS 15');
    assert.equal(h.signature_base64, SIG);
    assert.equal(new Date(h.time_of_handover).getTime(), new Date(r.arrival_time).getTime(), 'handover time is the hospital arrival time');
    assert.match((await one('select message from incident_updates where incident_id = $1', [INC.onScene])).message,
      /patient handed over to Dr Dale Naidoo at Addington Hospital, 14:30/);
  });

  await scenario('treated on scene or private transport: no handover asked for or kept', async () => {
    await as(U.medic);
    const r = (await file(INC.onScene, good({ transport_mode: 'Private Transport', destination_hospital: '' }))).rows[0];
    assert.equal(r.handover_doctor_name, null, 'not stored when there is no handover');
    await db.query('reset role');
    assert.equal(await handoverOf(r.id), undefined);
  });

  await scenario('a replay keeps one report and one handover', async () => {
    await as(U.medic);
    const a = (await file(INC.onScene, good())).rows[0];
    const b = (await file(INC.onScene, good({ handover_doctor_name: 'Someone Else' }))).rows[0];
    assert.equal(a.id, b.id);
    await db.query('reset role');
    assert.equal(await scalar('select count(*)::int as value from legal_handovers'), 1);
    assert.equal((await handoverOf(a.id)).doctor_name, 'Dr Dale Naidoo');
  });

  await scenario('a correction to the report corrects the handover, until the case is closed', async () => {
    await as(U.medic);
    const r = (await file(INC.onScene, good())).rows[0];
    await db.query("update paramedic_reports set handover_doctor_name = 'Dr P. Moodley' where id = $1", [r.id]);
    await db.query('reset role');
    assert.equal((await handoverOf(r.id)).doctor_name, 'Dr P. Moodley');
    await as(U.medic);
    // Not taken to hospital after all: the handover goes with it.
    await db.query("update paramedic_reports set transport_mode = 'Private Transport', destination_hospital = null, handover_doctor_name = null where id = $1", [r.id]);
    await db.query('reset role');
    assert.equal(await handoverOf(r.id), undefined);
    await db.query("update incidents set status = 'Closed' where id = $1", [INC.onScene]);
    await as(U.medic);
    await refused(() => db.query("update paramedic_reports set handover_doctor_name = 'Late' where id = $1", [r.id]), /case is closed/);
  });

  await scenario('nobody writes the handover record directly', async () => {
    await as(U.medic);
    const r = (await file(INC.onScene, good())).rows[0];
    await refused(() => db.query("update legal_handovers set doctor_name = 'Forged' where pcr_id = $1", [r.id]), /changed from its patient report/);
    await refused(() => db.query('delete from legal_handovers where pcr_id = $1', [r.id]), /changed from its patient report/);
    await refused(() => db.query(
      "insert into legal_handovers (incident_id, receiving_hosp, doctor_name) values ($1, 'X', 'Y')", [INC.enRoute]), /changed from its patient report/);
  });

  // ── The doctor ────────────────────────────────────────────────────────────

  await scenario('the doctor reads reports and handovers but files and changes nothing', async () => {
    await as(U.medic);
    const r = (await file(INC.onScene, good())).rows[0];
    await as(U.doctor);
    await refused(() => file(INC.doctor, good()), /Role refused/, 'a doctor does not file the report');
    assert.equal(Number(await scalar('select count(*)::int as value from paramedic_reports where id = $1', [r.id])), 1, 'reads the report');
    assert.equal(Number(await scalar('select count(*)::int as value from legal_handovers where pcr_id = $1', [r.id])), 1, 'reads the handover');
    assert.equal(Number(await scalar('select count(*)::int as value from vital_signs where id = $1', [r.vitals_id])), 1, 'reads the vitals');
    const upd = await db.query("update paramedic_reports set chief_complaint = 'Changed' where id = $1", [r.id]);
    assert.equal(upd.affectedRows ?? 0, 0, 'cannot change the report');
    await refused(() => db.query("insert into paramedic_reports (silo, patient_name) values ('Medical', 'X')"), /row-level security|violates/);
  });

  // ── Who reads it ──────────────────────────────────────────────────────────

  await scenario('case managers read the handover; Police and another tenant do not', async () => {
    await as(U.medic);
    const r = (await file(INC.onScene, good())).rows[0];
    const sees = async (uid) => {
      await as(uid);
      return Number(await scalar('select count(*)::int as value from legal_handovers where pcr_id = $1', [r.id]));
    };
    assert.equal(await sees(U.caseManager), 1);
    assert.equal(await sees(U.police), 0);
    assert.equal(await sees(U.other), 0);
  });

  console.log(`\n${checks} scenarios passed`);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}
