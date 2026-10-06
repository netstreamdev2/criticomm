/**
 * Execute the real Fire migration and shift gates against an isolated Postgres.
 * No Supabase/project credentials. All fixtures and DDL roll back afterwards.
 * FIRE_TEST_DB_URL=postgres://postgres@127.0.0.1:55456/criticomm_fire_test node scripts/test-fire-shift.mjs
 * The fixture models only the shift tables; this supplements CI's full migration chain.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const url = new URL(process.env.FIRE_TEST_DB_URL ?? 'postgres://postgres@127.0.0.1:55456/criticomm_fire_test');
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/criticomm_fire_test') {
  throw new Error('Use a dedicated local criticomm_fire_test database. Hosted databases are not permitted.');
}
const db = new pg.Client({ connectionString: url.toString() });
await db.connect();
let checks = 0;
const sql = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const functionSql = (source, name) => {
  const match = source.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`, 'i'));
  assert.ok(match, `function ${name} exists`);
  return match[0];
};
const scalar = async (query, args) => (await db.query(query, args)).rows[0]?.value;
const fireUser = '10000000-0000-4000-8000-000000000001';
const policeUser = '10000000-0000-4000-8000-000000000002';
const tenant = '20000000-0000-4000-8000-000000000001';
const otherTenant = '20000000-0000-4000-8000-000000000002';
const unit = '30000000-0000-4000-8000-000000000001';
const policeUnit = '30000000-0000-4000-8000-000000000002';
const essential = ['lights_functional','tires_condition_ok','equipment_stocked','comms_working','brakes_responsive'];
const equipment = ['scba_checked','water_tank_full','pump_operational','hoses_and_nozzles_stocked','ladders_secured','turnout_gear_complete'];
async function asUser(silo = 'MetroFire', id = fireUser, role = 'Firefighter', tenantId = tenant) {
  await db.query('reset role');
  await db.query("select set_config('test.user', $1, true), set_config('test.silo', $2, true), set_config('test.role', $3, true), set_config('test.tenant', $4, true)", [id, silo, role, tenantId]);
  await db.query('set local role authenticated');
}
async function inspect(patch = {}) {
  const row = { user_id: fireUser, tenant_id: tenant, silo: 'MetroFire', apparatus_id: unit,
    form_version: 'fire-v1', fuel_level: 'Full', officer_submitted: true, declaration_accepted: true,
    signature_svg: '<svg><path d="M10 10L20 20"/></svg>', fault_remarks: '',
    ...Object.fromEntries([...essential, ...equipment].map((key) => [key, true])), ...patch };
  const columns = Object.keys(row);
  return (await db.query(`insert into vehicle_checklists (${columns.join(',')}) values (${columns.map((_, i) => `$${i + 1}`).join(',')}) returning *`, Object.values(row))).rows[0];
}
async function scenario(label, work) {
  await db.query('reset role');
  await db.query('savepoint scenario');
  try { await asUser(); await work(); checks++; console.log(`PASS ${label}`); }
  finally { await db.query('rollback to savepoint scenario'); }
}

try {
  await db.query('begin');
  await db.query(`
    do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
    do $$ begin create role anon; exception when duplicate_object then null; end $$;
    create schema auth;
    create type public.silo as enum ('MetroFire','MetroPolice','Ethekwini','Medical','EthekwiniDisaster');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user', true), '')::uuid $$;
    create function public.current_tenant() returns uuid language sql stable as $$ select nullif(current_setting('test.tenant', true), '')::uuid $$;
    create function public.current_silo() returns public.silo language sql stable as $$ select current_setting('test.silo', true)::public.silo $$;
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
    create table public.test_alerts(tenant_id uuid, silo public.silo, title text, body text);
    create function public.notify_command(t uuid, s public.silo, title text, body text, severity text, href text) returns void
      language sql as $$ insert into public.test_alerts values(t,s,title,body) $$;
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
  // Real policies/stamps from 0036; real 187(c) validation and old gate from 0037.
  const m36 = sql('0036_shift_readiness_accountability.sql');
  const m37 = sql('0037_start_of_shift_187c_firearms.sql');
  await db.query(m36.split('-- A client must not choose')[0]);
  await db.query(m37.slice(m37.indexOf('alter table public.vehicle_checklists'), m37.indexOf('-- ── 2. Armoury')));
  for (const name of ['sa_today_start','shift_readiness_passed_today','shift_vehicle_passed_today','shift_requires_firearm']) await db.query(functionSql(m37, name));
  await db.query(`
    insert into apparatus(id,tenant_id,silo,status,unit_number) values
      ('${unit}','${tenant}','MetroFire','In Use','FIRE-LAD-01'), ('${policeUnit}','${tenant}','MetroPolice','In Use','POL-01');
    insert into personnel(user_id,tenant_id,silo,rank,first_name,last_name,assigned_apparatus_id) values
      ('${fireUser}','${tenant}','MetroFire','FF','Test','Firefighter','${unit}'),
      ('${policeUser}','${tenant}','MetroPolice','Constable','Test','Officer','${policeUnit}');
    insert into mental_checks(tenant_id,user_id,silo,memory_recall,judgment,situational_awareness,not_under_influence,anger_check,reflexes) values
      ('${tenant}','${fireUser}','MetroFire',true,true,true,true,true,true),
      ('${tenant}','${policeUser}','MetroPolice',true,true,true,true,true,true);
    create function public.shift_firearm_resolved_today() returns boolean language sql as $$ select current_setting('test.firearm',true) = 'true' $$;
    create function public.shift_requires_bodycam() returns boolean language sql as $$ select public.current_silo() in ('MetroPolice','Ethekwini') $$;
    create function public.shift_bodycam_resolved_today() returns boolean language sql as $$ select current_setting('test.bodycam',true) = 'true' $$;
  `);
  await db.query(functionSql(sql('0054_bodycams.sql'), 'has_completed_shift_start_today'));
  await db.query(functionSql(m36, 'toggle_duty'));
  await db.query(functionSql(m36, 'stamp_vehicle_checklist'));
  await db.query('create trigger stamp_vehicle_checklist_insert before insert on vehicle_checklists for each row execute function stamp_vehicle_checklist()');
  // 0051's original Police side effects are also present, proving both triggers coexist.
  await db.query(functionSql(sql('0051_armoury_fleet_end_of_shift.sql'), 'apply_vehicle_inspection'));
  await db.query('create trigger apply_vehicle_inspection after insert on vehicle_checklists for each row execute function apply_vehicle_inspection()');
  await db.query(sql('0056_fire_start_of_shift.sql'));
  await db.query(sql('0056_fire_start_of_shift.sql')); // re-run safety

  await scenario('all 11 checks plus signature file and unlock Fire without firearm/bodycam', async () => {
    const row = await inspect({ inspector_name: 'Forged name', items_ok: 999, checked_at: '2000-01-01' });
    assert.equal(row.items_ok, 11); assert.equal(row.items_fault, 0);
    assert.equal(row.inspector_name, 'FF Test Firefighter'); assert.match(row.inspection_ref, /^FIRE-/);
    assert.ok(new Date(row.checked_at).getFullYear() >= 2026);
    assert.equal(await scalar('select has_completed_shift_start_today() as value'), true);
    assert.equal(await scalar('select (toggle_duty(true)).is_on_duty as value'), true);
    await db.query('reset role');
    assert.equal(await scalar('select count(*)::int as value from audit_logs'), 1);
  });
  for (const key of [...essential, ...equipment]) await scenario(`failed ${key} blocks duty, releases appliance, alerts command`, async () => {
    const row = await inspect({ [key]: false, fault_remarks: 'Defect found during test' });
    assert.equal(row.items_fault, 1);
    assert.equal(await scalar('select has_completed_shift_start_today() as value'), false);
    assert.equal(await scalar('select status as value from apparatus where id=$1', [unit]), 'Out of Service');
    assert.equal(await scalar('select assigned_apparatus_id as value from personnel where user_id=$1', [fireUser]), null);
    await db.query('reset role');
    assert.equal(await scalar('select count(*)::int as value from test_alerts where tenant_id=$1 and silo=$2', [tenant, 'MetroFire']), 1);
  });
  for (const key of equipment) await scenario(`unanswered ${key} refused`, async () => {
    await assert.rejects(inspect({ [key]: null }), /Answer every/);
  });
  for (const [label, patch, pattern] of [
    ['unsigned', { signature_svg: '' }, /sign/], ['blank path', { signature_svg: '<svg><path d=""/></svg>' }, /sign/],
    ['no declaration', { declaration_accepted: false }, /declaration/], ['no fuel', { fuel_level: '' }, /fuel/],
    ['failure without notes', { scba_checked: false }, /Describe/],
    ['other tenant', { tenant_id: otherTenant }, /department|policy/],
    ['other officer', { user_id: policeUser }, /department|policy/],
    ['other appliance', { apparatus_id: policeUnit }, /Select/],
  ]) await scenario(`${label} refused`, async () => { await assert.rejects(inspect(patch), pattern); });
  await scenario('Fire role cannot be borrowed by Police', async () => {
    await asUser('MetroPolice', policeUser, 'Police');
    await assert.rejects(inspect(), /Role refused/);
  });
  await scenario('failed readiness cannot inspect', async () => {
    await db.query('reset role'); await db.query('update mental_checks set reflexes=false where user_id=$1', [fireUser]);
    await asUser(); await assert.rejects(inspect(), /readiness/);
  });
  await scenario('filed records cannot be edited or deleted by their author', async () => {
    const row = await inspect();
    assert.equal((await db.query('update vehicle_checklists set scba_checked=false where id=$1', [row.id])).rowCount, 0);
    assert.equal((await db.query('delete from vehicle_checklists where id=$1', [row.id])).rowCount, 0);
  });
  await scenario('another tenant cannot read an inspection', async () => {
    await inspect(); await asUser('MetroFire', fireUser, 'Firefighter', otherTenant);
    assert.equal(await scalar('select count(*)::int as value from vehicle_checklists'), 0);
    assert.equal(await scalar('select shift_vehicle_passed_today() as value'), false);
  });
  await scenario('legacy 187(c) does not stand in for Fire equipment checks', async () => {
    await inspect({ form_version: '187c', ndm_number: 'F-01', mileage_km: 100, shift_type: 'DAY', items: Object.fromEntries(Array.from({ length: 67 }, (_, i) => [String(i), 'ok'])) });
    assert.equal(await scalar('select shift_vehicle_passed_today() as value'), false);
  });
  await scenario('Police still requires 187(c), then firearm and bodycam', async () => {
    await asUser('MetroPolice', policeUser, 'Police');
    assert.equal(await scalar('select shift_vehicle_passed_today() as value'), false);
    await inspect({ user_id: policeUser, silo: 'MetroPolice', apparatus_id: policeUnit, form_version: '187c', ndm_number: 'P-01', mileage_km: 100, shift_type: 'DAY', items: Object.fromEntries(Array.from({ length: 67 }, (_, i) => [String(i), 'ok'])) });
    assert.equal(await scalar('select shift_vehicle_passed_today() as value'), true);
    await db.query("select set_config('test.firearm','false',true), set_config('test.bodycam','false',true)");
    assert.equal(await scalar('select has_completed_shift_start_today() as value'), false);
    await db.query("select set_config('test.firearm','true',true)");
    assert.equal(await scalar('select has_completed_shift_start_today() as value'), false);
    await db.query("select set_config('test.bodycam','true',true)");
    assert.equal(await scalar('select has_completed_shift_start_today() as value'), true);
    assert.equal(await scalar('select last_inspection_result as value from apparatus where id=$1', [policeUnit]), 'pass');
  });
  await scenario('old day and unassigned appliance do not clear Fire', async () => {
    const row = await inspect();
    await db.query('reset role'); await db.query("update vehicle_checklists set checked_at=now()-interval '1 day' where id=$1", [row.id]);
    await asUser(); assert.equal(await scalar('select shift_vehicle_passed_today() as value'), false);
    await db.query('reset role'); await db.query('update vehicle_checklists set checked_at=now() where id=$1', [row.id]);
    await db.query('update personnel set assigned_apparatus_id=null where user_id=$1', [fireUser]);
    await asUser(); assert.equal(await scalar('select shift_vehicle_passed_today() as value'), false);
  });
  console.log(`${checks} database scenarios passed; migration applied twice. Rolling back the test fixture.`);
} finally { await db.query('rollback'); await db.end(); }
