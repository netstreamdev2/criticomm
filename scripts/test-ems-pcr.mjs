/** Run the real EMS incident-flow migration (0063) against in-memory Postgres
 * (PGlite), on the real patient-care tables from 0001. No credentials, no
 * hosted database. It covers who may file, what the report must say, what
 * filing does to the incident and the ambulance, the replay from the phone,
 * the guard on a bare Resolved, who may read it, and the record rules.
 *
 * CASE_PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node scripts/test-ems-pcr.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.CASE_PGLITE_MODULE || '@electric-sql/pglite');

const read = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const init = read('0001_init.sql');
const start = init.indexOf('create table public.medical_histories');
const end = init.indexOf('create table public.legal_handovers');
assert.ok(start > 0 && end > start, 'PCR tables found in 0001');
const pcrTables = init.slice(start, end);
const migration = read('0063_ems_incident_flow.sql');

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
      foreach t in array array['medical_histories','assessment_findings','vital_signs','interventions','paramedic_reports'] loop
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

  // The migration under test, twice: it must be safe to re-run.
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

  // ── Who may file ──────────────────────────────────────────────────────────

  await scenario('only the EMS crew member leading the call files, once on scene', async () => {
    await as(U.medic2);
    await refused(() => file(INC.onScene, good()), /Only the crew member leading/);
    await as(U.medic);
    await refused(() => file(INC.enRoute, good()), /Mark yourself on scene/);
    await as(U.police);
    await refused(() => file(INC.onScene, good()), /Role refused/);
    await as(U.fire);
    await refused(() => file(INC.onScene, good()), /Role refused/);
    await as(U.other);
    await refused(() => file(INC.onScene, good()), /not found/, 'another tenant');
  });

  // ── What it must say ──────────────────────────────────────────────────────

  await scenario('the report needs the complaint, care level, outcome, signature and cleaning answer', async () => {
    await as(U.medic);
    await refused(() => file(INC.onScene, good({ chief_complaint: ' ' })), /Chief Complaint/);
    await refused(() => file(INC.onScene, good({ level_of_care: 'XLS' })), /Care Level/);
    await refused(() => file(INC.onScene, good({ patient_response: '' })), /Patient Response/);
    await refused(() => file(INC.onScene, good({ responder_signature_image_base64: 'scribble' })), /must sign/);
    await refused(() => file(INC.onScene, good({ requires_cleaning: undefined })), /requires cleaning/);
    await refused(() => file(INC.onScene, good({ destination_hospital: '' })), /destination facility/);
    await refused(() => file(INC.onScene, good({ departure_time: '7pm' })), /HH:MM/);
    await refused(() => file(INC.onScene, good({ pain_scale: '12' })), /Pain Scale/);
    await refused(() => file(INC.onScene, good({ secondary_patients_json: '{not json' })), /casualties/);
    await refused(() => file(INC.onScene, good({ doctor_signature_image_base64: 'x' })), /signature could not be read/);
  });

  // ── What filing does ──────────────────────────────────────────────────────

  await scenario('filing records the PCR with its clinical records and resolves the call', async () => {
    await as(U.medic);
    const r = (await file(INC.onScene, good())).rows[0];
    assert.equal(r.report_number, 'PCR-INC-20261009-0001');
    assert.equal(r.ambulance_id, amb);
    assert.equal(r.patient_name, 'Thandi Zulu');
    assert.equal(r.paramedic_names, 'Priya Pillay', 'the crew defaults to the filer');
    assert.ok(Number(r.total_response_seconds) >= 1190, 'from dispatch');
    assert.equal(r.secondary_patients_json[0].triage, 'Red (Immediate)');
    assert.ok(r.time_of_arrival, 'time on scene from the incident');
    await db.query('reset role');
    const v = await one('select * from vital_signs where id = $1', [r.vitals_id]);
    assert.equal(v.glasgow_coma_scale, '15');
    assert.equal(v.blood_pressure, '120/80');
    const h = await one('select * from medical_histories where id = $1', [r.medical_history_id]);
    assert.equal(h.chronic_conditions, 'Hypertension');
    const i = await one('select * from interventions where id = $1', [r.interventions_id]);
    assert.equal(i.medication_admin, 'Aspirin');
    const inc = await incidentRow(INC.onScene);
    assert.equal(inc.status, 'Resolved');
    assert.ok(inc.report_filed_at);
    assert.match((await one('select message from incident_updates where incident_id = $1', [INC.onScene])).message, /PCR-INC-20261009-0001 filed by Priya Pillay · patient to Addington Hospital/);
    assert.equal(await scalar("select count(*)::int as value from sent where kind = 'resolved'"), 1, 'dispatch and command told');
    assert.equal(await scalar("select count(*)::int as value from sent where kind = 'command'"), 0, 'clean and fully stocked: nothing for command');
    assert.equal((await one('select status from apparatus where id = $1', [amb])).status, 'In Use');
  });

  await scenario('a replay from the phone returns the report already filed', async () => {
    await as(U.medic);
    const a = (await file(INC.onScene, good())).rows[0];
    const b = (await file(INC.onScene, good({ chief_complaint: 'Changed' }))).rows[0];
    assert.equal(a.id, b.id);
    assert.equal(b.chief_complaint, 'Chest pain');
    await db.query('reset role');
    assert.equal(await scalar('select count(*)::int as value from paramedic_reports'), 1);
  });

  await scenario('"Requires cleaning" puts the ambulance off road and releases the crew', async () => {
    await as(U.medic);
    await file(INC.onScene, good({ requires_cleaning: 'true' }));
    await db.query('reset role');
    const a = await one('select * from apparatus where id = $1', [amb]);
    assert.equal(a.status, 'Out of Service');
    assert.match(a.status_note, /Off road for cleaning \(PCR-INC-20261009-0001\)/);
    const p = await one('select * from personnel where user_id = $1', [U.medic]);
    assert.equal(p.assigned_apparatus_id, null);
    assert.equal(p.is_on_duty, false);
    assert.equal(await scalar("select severity as value from sent where title like 'Ambulance off road%'"), 'High');
  });

  await scenario('stock left unticked tells command the ambulance is short', async () => {
    await as(U.medic);
    await file(INC.onScene, good({ inv_ppe: 'false', inv_drugs: 'false' }));
    await db.query('reset role');
    const s = await one("select * from sent where title like 'Ambulance stock short%'");
    assert.equal(s.severity, 'Medium');
    assert.equal((await one('select status from apparatus where id = $1', [amb])).status, 'In Use', 'stays in service');
  });

  await scenario('a doctor leading a call files the same report; private transport needs no destination', async () => {
    await as(U.doctor);
    const r = (await file(INC.doctor, good({ transport_mode: 'Private Transport', destination_hospital: '' }))).rows[0];
    assert.equal(r.destination_hospital, null);
    assert.equal(r.ambulance_id, amb, 'the ambulance on the call');
  });

  await scenario('a call shared with Police, led by the paramedic, is closed by the PCR', async () => {
    await as(U.medic);
    await file(INC.shared, good());
    await db.query('reset role');
    assert.equal((await incidentRow(INC.shared)).status, 'Resolved');
  });

  // ── The guard ─────────────────────────────────────────────────────────────

  await scenario('a paramedic cannot close an EMS call with a bare Resolved', async () => {
    await as(U.medic);
    await refused(() => db.query("update incidents set status = 'Resolved' where id = $1", [INC.onScene]), /File the patient report/);
    await as(U.dispatcher);
    await db.query("update incidents set status = 'Resolved' where id = $1", [INC.enRoute]);
    await db.query('reset role');
    assert.equal((await incidentRow(INC.enRoute)).status, 'Resolved', 'the desk keeps its own close rules');
  });

  // ── Who reads it ──────────────────────────────────────────────────────────

  await scenario('the crew, EMS and case managers read the PCR and its vitals; Police and another tenant do not', async () => {
    await as(U.medic);
    const r = (await file(INC.onScene, good())).rows[0];
    const sees = async (uid) => {
      await as(uid);
      return {
        pcr: Number(await scalar('select count(*)::int as value from paramedic_reports where id = $1', [r.id])),
        vitals: Number(await scalar('select count(*)::int as value from vital_signs where id = $1', [r.vitals_id])),
      };
    };
    assert.deepEqual(await sees(U.medic2), { pcr: 1, vitals: 1 }, 'EMS');
    assert.deepEqual(await sees(U.caseManager), { pcr: 1, vitals: 1 }, 'case manager');
    assert.deepEqual(await sees(U.police), { pcr: 0, vitals: 0 }, 'police did not work it');
    assert.deepEqual(await sees(U.other), { pcr: 0, vitals: 0 }, 'another tenant');
  });

  // ── Record rules ──────────────────────────────────────────────────────────

  await scenario('a filed PCR can be corrected until the case closes, never deleted or re-linked', async () => {
    await as(U.medic);
    const r = (await file(INC.onScene, good())).rows[0];
    await db.query("update paramedic_reports set treatment_narrative = 'Corrected' where id = $1", [r.id]);
    await refused(() => db.query('update paramedic_reports set incident_id = $2 where id = $1', [r.id, INC.enRoute]), /keeps its incident/);
    await refused(() => db.query('update paramedic_reports set report_number = $2 where id = $1', [r.id, 'X']), /keeps its incident/);
    await refused(() => db.query('delete from paramedic_reports where id = $1', [r.id]), /cannot be deleted/);
    await db.query('reset role');
    await db.query("update incidents set status = 'Closed' where id = $1", [INC.onScene]);
    await as(U.medic);
    await refused(() => db.query("update paramedic_reports set treatment_narrative = 'Late' where id = $1", [r.id]), /case is closed/);
  });

  console.log(`\n${checks} scenarios passed`);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}
