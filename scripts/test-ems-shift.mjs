/** Run the real EMS migration (0060) and the shift gates it changes against in-memory Postgres (PGlite).
 * No credentials, no hosted database. Fire (0056) and Police (187c) are checked for regressions.
 * EMS_PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node scripts/test-ems-shift.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// EMS_PGLITE_MODULE points at @electric-sql/pglite when it is installed outside this repo.
const { PGlite } = await import(process.env.EMS_PGLITE_MODULE || '@electric-sql/pglite');

const ROOT = new URL('../supabase/migrations/', import.meta.url);
const sql = (name) => readFileSync(new URL(name, ROOT), 'utf8');
const functionSql = (source, name) => {
  const match = source.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`, 'i'));
  assert.ok(match, `function ${name} exists`);
  return match[0];
};
const db = new PGlite();
let checks = 0;
const scalar = async (query, args) => (await db.query(query, args)).rows[0]?.value;

const medic = '10000000-0000-4000-8000-000000000001';
const fireUser = '10000000-0000-4000-8000-000000000002';
const policeUser = '10000000-0000-4000-8000-000000000003';
const tenant = '20000000-0000-4000-8000-000000000001';
const otherTenant = '20000000-0000-4000-8000-000000000002';
const amb = '30000000-0000-4000-8000-000000000001';
const fireUnit = '30000000-0000-4000-8000-000000000002';
const policeUnit = '30000000-0000-4000-8000-000000000003';
const amb2 = '30000000-0000-4000-8000-000000000004';
const essential = ['lights_functional', 'tires_condition_ok', 'equipment_stocked', 'comms_working', 'brakes_responsive'];
const fireEquipment = ['scba_checked', 'water_tank_full', 'pump_operational', 'hoses_and_nozzles_stocked', 'ladders_secured', 'turnout_gear_complete'];
const stock = ['oxygen_full', 'aed_battery_ok', 'suction_functional', 'bvm_masks_ok', 'jump_bag_stocked', 'iv_fluids_stocked', 'drug_box_sealed', 'gloves_ppe_stocked'];
const items67 = Object.fromEntries(Array.from({ length: 67 }, (_, i) => [String(i), 'ok']));

async function asUser(silo = 'Medical', id = medic, role = 'Paramedic', tenantId = tenant) {
  await db.query('reset role');
  await db.query("select set_config('test.user', $1, true), set_config('test.silo', $2, true), set_config('test.role', $3, true), set_config('test.tenant', $4, true)", [id, silo, role, tenantId]);
  await db.query('set local role authenticated');
}
async function insert(row) {
  const columns = Object.keys(row);
  return (await db.query(`insert into vehicle_checklists (${columns.join(',')}) values (${columns.map((_, i) => `$${i + 1}`).join(',')}) returning *`, Object.values(row))).rows[0];
}
const ems = (patch = {}) => insert({
  user_id: medic, tenant_id: tenant, silo: 'Medical', apparatus_id: amb, form_version: 'ems-v1', fuel_level: 'Full',
  officer_submitted: true, declaration_accepted: true, fault_remarks: '', requires_cleaning: false,
  ...Object.fromEntries([...essential, ...stock].map((k) => [k, true])), ...patch,
});
const fire = (patch = {}) => insert({
  user_id: fireUser, tenant_id: tenant, silo: 'MetroFire', apparatus_id: fireUnit, form_version: 'fire-v1', fuel_level: 'Full',
  officer_submitted: true, declaration_accepted: true, signature_svg: '<svg><path d="M10 10L20 20"/></svg>', fault_remarks: '',
  ...Object.fromEntries([...essential, ...fireEquipment].map((k) => [k, true])), ...patch,
});
async function scenario(label, work) {
  await db.query('reset role');
  await db.query('savepoint scenario');
  try { await asUser(); await work(); checks++; console.log(`PASS ${label}`); }
  // A refused insert aborts the transaction; only the rollback may run after it.
  finally { await db.query('rollback to savepoint scenario'); }
}
const asAdmin = () => db.query('reset role');

try {
  await db.exec(`
    create role authenticated nologin; create role anon nologin;
    create schema auth;
    create type public.silo as enum ('MetroFire','MetroPolice','Ethekwini','Medical','EthekwiniDisaster');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user', true), '')::uuid $$;
    create function public.current_tenant() returns uuid language sql stable as $$ select nullif(current_setting('test.tenant', true), '')::uuid $$;
    create function public.current_silo() returns public.silo language sql stable as $$ select nullif(current_setting('test.silo', true), '')::public.silo $$;
    create function public.role_in(variadic roles text[]) returns boolean language sql stable as $$ select current_setting('test.role', true) = any(roles) $$;
    create function public.require_role(variadic roles text[]) returns void language plpgsql as $$ begin
      if auth.uid() is null or not public.role_in(variadic roles) then raise exception 'Role refused' using errcode='42501'; end if;
    end $$;
    create table public.personnel(id uuid primary key default gen_random_uuid(), user_id uuid, tenant_id uuid, silo public.silo,
      rank text, first_name text, last_name text, assigned_apparatus_id uuid, is_on_duty boolean default false,
      latitude float8, longitude float8, last_login timestamptz);
    create table public.apparatus(id uuid primary key, tenant_id uuid, silo public.silo, status text, unit_number text,
      last_inspection_id uuid, last_inspection_at timestamptz, last_inspection_result text, mileage int default 0,
      status_note text, status_changed_at timestamptz, status_changed_by_name text);
    create table public.mental_checks(id uuid primary key default gen_random_uuid(), tenant_id uuid default public.current_tenant(),
      user_id uuid not null, silo public.silo not null, timestamp timestamptz default now(),
      memory_recall boolean, judgment boolean, situational_awareness boolean, not_under_influence boolean, anger_check boolean, reflexes boolean);
    create table public.vehicle_checklists(id uuid primary key default gen_random_uuid(), tenant_id uuid default public.current_tenant(),
      user_id uuid not null, silo public.silo not null, apparatus_id uuid references public.apparatus, checked_at timestamptz default now(),
      fuel_level text not null, ${essential.map((key) => `${key} boolean not null`).join(',')});
    create table public.audit_logs(tenant_id uuid, silo public.silo, user_id uuid, user_name text, action_type text, entity_type text, entity_id text, details text);
    create table public.test_alerts(tenant_id uuid, silo public.silo, title text, body text, severity text);
    create function public.notify_command(t uuid, s public.silo, title text, body text, severity text, href text) returns void
      language sql as $$ insert into public.test_alerts values(t,s,title,body,severity) $$;
    alter table mental_checks enable row level security;
    alter table vehicle_checklists enable row level security;
    create policy tenant_isolation on mental_checks as restrictive for all to authenticated
      using(tenant_id = public.current_tenant()) with check(tenant_id = public.current_tenant());
    create policy tenant_isolation on vehicle_checklists as restrictive for all to authenticated
      using(tenant_id = public.current_tenant()) with check(tenant_id = public.current_tenant());
    grant usage on schema auth, public to authenticated, anon;
    grant select on personnel, apparatus to authenticated;
    grant select, insert, update, delete on mental_checks, vehicle_checklists to authenticated;
  `);
  const m36 = sql('0036_shift_readiness_accountability.sql');
  const m37 = sql('0037_start_of_shift_187c_firearms.sql');
  await db.exec(m36.split('-- A client must not choose')[0]);
  await db.exec(m37.slice(m37.indexOf('alter table public.vehicle_checklists'), m37.indexOf('-- ── 2. Armoury')));
  for (const name of ['sa_today_start', 'shift_readiness_passed_today', 'shift_vehicle_passed_today', 'shift_requires_firearm']) await db.exec(functionSql(m37, name));
  await db.exec(`
    insert into apparatus(id,tenant_id,silo,status,unit_number) values
      ('${amb}','${tenant}','Medical','In Use','M-401'), ('${fireUnit}','${tenant}','MetroFire','In Use','FIRE-01'),
      ('${policeUnit}','${tenant}','MetroPolice','In Use','POL-01'), ('${amb2}','${tenant}','Medical','Available','M-402');
    insert into personnel(user_id,tenant_id,silo,rank,first_name,last_name,assigned_apparatus_id) values
      ('${medic}','${tenant}','Medical','Paramedic','Thandi','Pillay','${amb}'),
      ('${fireUser}','${tenant}','MetroFire','FF','Test','Firefighter','${fireUnit}'),
      ('${policeUser}','${tenant}','MetroPolice','Constable','Test','Officer','${policeUnit}');
    insert into mental_checks(tenant_id,user_id,silo,memory_recall,judgment,situational_awareness,not_under_influence,anger_check,reflexes) values
      ('${tenant}','${medic}','Medical',true,true,true,true,true,true),
      ('${tenant}','${fireUser}','MetroFire',true,true,true,true,true,true),
      ('${tenant}','${policeUser}','MetroPolice',true,true,true,true,true,true);
    create function public.shift_firearm_resolved_today() returns boolean language sql as $$ select current_setting('test.firearm',true) = 'true' $$;
    create function public.shift_requires_bodycam() returns boolean language sql as $$ select public.current_silo() in ('MetroPolice','Ethekwini') $$;
    create function public.shift_bodycam_resolved_today() returns boolean language sql as $$ select current_setting('test.bodycam',true) = 'true' $$;
  `);
  await db.exec(functionSql(sql('0054_bodycams.sql'), 'has_completed_shift_start_today'));
  await db.exec(functionSql(m36, 'toggle_duty'));
  await db.exec(functionSql(m36, 'stamp_vehicle_checklist'));
  await db.exec('create trigger stamp_vehicle_checklist_insert before insert on vehicle_checklists for each row execute function stamp_vehicle_checklist()');
  await db.exec(functionSql(sql('0051_armoury_fleet_end_of_shift.sql'), 'apply_vehicle_inspection'));
  await db.exec('create trigger apply_vehicle_inspection after insert on vehicle_checklists for each row execute function apply_vehicle_inspection()');
  await db.exec(sql('0056_fire_start_of_shift.sql'));
  await db.exec(sql('0060_ems_start_of_shift.sql'));
  await db.exec(sql('0060_ems_start_of_shift.sql')); // re-run safety
  await db.exec('begin');

  await scenario('all 13 checks, clean: filed, stamped, clears EMS without firearm/bodycam, puts on duty', async () => {
    const id = '40000000-0000-4000-8000-000000000001';
    const row = await ems({ id, inspector_name: 'Forged name', items_ok: 999, checked_at: '2000-01-01' });
    assert.equal(row.id, id, 'client-chosen id kept for lost-response recovery');
    assert.equal(row.items_ok, 13); assert.equal(row.items_fault, 0);
    assert.equal(row.inspector_name, 'Paramedic Thandi Pillay'); assert.match(row.inspection_ref, /^EMS-\d{8}-40000000$/);
    assert.ok(new Date(row.checked_at).getFullYear() >= 2026);
    assert.equal(await scalar('select shift_vehicle_passed_today() as value'), true);
    assert.equal(await scalar('select has_completed_shift_start_today() as value'), true);
    assert.equal(await scalar('select (toggle_duty(true)).is_on_duty as value'), true);
    await asAdmin();
    assert.equal(await scalar('select last_inspection_result as value from apparatus where id=$1', [amb]), 'pass');
    assert.equal(await scalar('select count(*)::int as value from audit_logs where action_type=$1', ['EmsShiftCheckFiled']), 1);
    assert.equal(await scalar('select count(*)::int as value from test_alerts'), 0, 'a clean pass tells nobody');
  });

  for (const key of essential) await scenario(`failed vehicle check ${key}: off road, crew released, command alerted`, async () => {
    const row = await ems({ [key]: false, fault_remarks: 'Fault found during test' });
    assert.equal(row.items_fault, 1);
    assert.equal(await scalar('select has_completed_shift_start_today() as value'), false);
    await asAdmin();
    assert.equal(await scalar('select status as value from apparatus where id=$1', [amb]), 'Out of Service');
    assert.equal(await scalar('select last_inspection_result as value from apparatus where id=$1', [amb]), 'fail');
    assert.equal(await scalar('select assigned_apparatus_id as value from personnel where user_id=$1', [medic]), null);
    assert.equal(await scalar("select count(*)::int as value from test_alerts where silo='Medical' and severity='High'"), 1);
  });

  await scenario('requires cleaning: off road for cleaning even when everything passed', async () => {
    await ems({ requires_cleaning: true });
    assert.equal(await scalar('select shift_vehicle_passed_today() as value'), false);
    await asAdmin();
    assert.equal(await scalar('select status as value from apparatus where id=$1', [amb]), 'Out of Service');
    assert.match(await scalar('select status_note as value from apparatus where id=$1', [amb]), /Off road for cleaning/);
    assert.equal(await scalar('select assigned_apparatus_id as value from personnel where user_id=$1', [medic]), null);
    assert.match(await scalar('select title as value from test_alerts'), /off road for cleaning: M-401/);
  });

  for (const key of stock) await scenario(`stock short ${key}: keeps the ambulance, not cleared, restock and re-file clears`, async () => {
    const row = await ems({ [key]: false, fault_remarks: 'Short at station' });
    assert.equal(row.items_fault, 1);
    assert.equal(await scalar('select shift_vehicle_passed_today() as value'), false);
    await asAdmin();
    assert.equal(await scalar('select status as value from apparatus where id=$1', [amb]), 'In Use');
    assert.equal(await scalar('select assigned_apparatus_id::text as value from personnel where user_id=$1', [medic]), amb);
    assert.equal(await scalar('select last_inspection_result as value from apparatus where id=$1', [amb]), 'faults');
    assert.equal(await scalar("select count(*)::int as value from test_alerts where severity='Medium' and title like 'Ambulance stock short%'"), 1);
    // One test transaction shares now(); in use the re-check is a later transaction.
    await db.query("update vehicle_checklists set checked_at = checked_at - interval '5 minutes' where id=$1", [row.id]);
    await asUser();
    await ems();
    assert.equal(await scalar('select shift_vehicle_passed_today() as value'), true, 'latest check counts');
  });

  for (const key of [...stock, 'requires_cleaning']) await scenario(`unanswered ${key} refused`, async () => {
    await assert.rejects(ems({ [key]: null }), /Record every|requires cleaning/);
  });
  for (const [label, patch, pattern] of [
    ['no declaration', { declaration_accepted: false }, /declaration/],
    ['no fuel', { fuel_level: '' }, /fuel/],
    ['vehicle failure without notes', { brakes_responsive: false }, /Describe/],
    ['stock short without notes', { drug_box_sealed: false }, /Describe/],
    ['other tenant', { tenant_id: otherTenant }, /department|policy/],
    ['other user', { user_id: fireUser }, /department|policy/],
    ['ambulance not held', { apparatus_id: amb2 }, /Select|policy/],
  ]) await scenario(`${label} refused`, async () => { await assert.rejects(ems(patch), pattern); });

  await scenario('a firefighter cannot file an EMS check', async () => {
    await asUser('MetroFire', fireUser, 'Firefighter');
    await assert.rejects(ems({ user_id: fireUser, apparatus_id: fireUnit }), /Role refused|department|policy/);
  });
  await scenario('failed readiness cannot check', async () => {
    await asAdmin(); await db.query('update mental_checks set reflexes=false where user_id=$1', [medic]);
    await asUser(); await assert.rejects(ems(), /readiness/);
  });
  await scenario('filed checks cannot be edited or deleted by their author', async () => {
    const row = await ems();
    assert.equal((await db.query('update vehicle_checklists set oxygen_full=false where id=$1', [row.id])).affectedRows ?? 0, 0);
    assert.equal((await db.query('delete from vehicle_checklists where id=$1', [row.id])).affectedRows ?? 0, 0);
    await asAdmin();
    assert.equal(await scalar('select oxygen_full as value from vehicle_checklists where id=$1', [row.id]), true);
  });
  await scenario('another tenant cannot read a check or be cleared by it', async () => {
    await ems(); await asUser('Medical', medic, 'Paramedic', otherTenant);
    assert.equal(await scalar('select count(*)::int as value from vehicle_checklists'), 0);
    assert.equal(await scalar('select shift_vehicle_passed_today() as value'), false);
  });
  await scenario('a 187(c) sheet does not stand in for the EMS checks', async () => {
    await insert({ user_id: medic, tenant_id: tenant, silo: 'Medical', apparatus_id: amb, form_version: '187c', fuel_level: 'Full',
      officer_submitted: true, declaration_accepted: true, signature_svg: 'x', ndm_number: 'M-01', mileage_km: 100, shift_type: 'DAY',
      items: items67, ...Object.fromEntries(essential.map((k) => [k, true])) });
    assert.equal(await scalar('select shift_vehicle_passed_today() as value'), false);
  });
  await scenario('old day and released ambulance do not clear EMS', async () => {
    const row = await ems();
    await asAdmin(); await db.query("update vehicle_checklists set checked_at=now()-interval '1 day' where id=$1", [row.id]);
    await asUser(); assert.equal(await scalar('select shift_vehicle_passed_today() as value'), false);
    await asAdmin(); await db.query('update vehicle_checklists set checked_at=now() where id=$1', [row.id]);
    await db.query('update personnel set assigned_apparatus_id=null where user_id=$1', [medic]);
    await asUser(); assert.equal(await scalar('select shift_vehicle_passed_today() as value'), false);
  });

  // Regressions: Fire and Police behave exactly as before 0060.
  await scenario('Fire still clears on fire-v1 and is still pulled off the road on a fault', async () => {
    await asUser('MetroFire', fireUser, 'Firefighter');
    const row = await fire();
    assert.match(row.inspection_ref, /^FIRE-/); assert.equal(row.items_ok, 11);
    assert.equal(await scalar('select has_completed_shift_start_today() as value'), true);
    await fire({ pump_operational: false, fault_remarks: 'Pump will not prime' });
    await asAdmin();
    assert.equal(await scalar('select status as value from apparatus where id=$1', [fireUnit]), 'Out of Service');
    assert.equal(await scalar("select count(*)::int as value from audit_logs where action_type='EmsShiftCheckFiled'"), 0);
  });
  await scenario('Police still requires 187(c), then firearm and bodycam', async () => {
    await asUser('MetroPolice', policeUser, 'Police');
    assert.equal(await scalar('select shift_vehicle_passed_today() as value'), false);
    await insert({ user_id: policeUser, tenant_id: tenant, silo: 'MetroPolice', apparatus_id: policeUnit, form_version: '187c', fuel_level: 'Full',
      officer_submitted: true, declaration_accepted: true, signature_svg: 'x', ndm_number: 'P-01', mileage_km: 100, shift_type: 'DAY',
      items: items67, ...Object.fromEntries(essential.map((k) => [k, true])) });
    assert.equal(await scalar('select shift_vehicle_passed_today() as value'), true);
    await db.query("select set_config('test.firearm','true',true), set_config('test.bodycam','false',true)");
    assert.equal(await scalar('select has_completed_shift_start_today() as value'), false);
    await db.query("select set_config('test.bodycam','true',true)");
    assert.equal(await scalar('select has_completed_shift_start_today() as value'), true);
  });
  await scenario('an EMS-shaped row filed by Police is not an EMS check', async () => {
    await asUser('MetroPolice', policeUser, 'Police');
    await assert.rejects(ems({ user_id: policeUser, silo: 'MetroPolice', apparatus_id: policeUnit }), /Role refused/);
  });

  console.log(`${checks} database scenarios passed; 0060 applied twice.`);
} finally { await db.close(); }
