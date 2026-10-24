/** Run the fire safety site inspections (0106) on top of 0066 against
 * in-memory Postgres (PGlite): the checklist the server keeps matches the
 * app's word for word; a clean visit is compliant and next due after the
 * risk's months; a fault makes a compliance notice with the server's own
 * sections and dates; an instruction and a notice not complied with reach
 * fire command; a replay files nothing twice; and the tables take no writes
 * except through the functions.
 *
 * CASE_PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node --experimental-strip-types scripts/test-fire-inspections.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.CASE_PGLITE_MODULE || '@electric-sql/pglite');
const spec = await import(new URL('../packages/db/src/fire-inspection.ts', import.meta.url).href);

const base = readFileSync(new URL('../supabase/migrations/0066_fire_safety_inspections.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/0106_fire_site_inspections.sql', import.meta.url), 'utf8');
const db = new PGlite();
let checks = 0;

const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = '20000000-0000-4000-8000-000000000001';
const U = { ff: id(1), chief: id(2), cop: id(3) };
let refs = 100;
const ref = () => id(refs++);
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

async function as(uid, role = 'Firefighter', silo = 'MetroFire') {
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
async function refused(work, pattern) {
  await db.query('savepoint r');
  await assert.rejects(work(), pattern);
  await db.query('rollback to savepoint r');
}
const allYes = () => Object.fromEntries(spec.FIRE_INSPECTION_ITEMS.map((i) => [i.key, 'yes']));
const newSite = (over = {}) => ({
  name: 'Skyline Mall', address: '12 Smith Street, Durban', occupancy: 'Shopping centre', risk: 'High', kind: 'Routine',
  checklist: allYes(), notice: [], ...over,
});
const file = async (fields, clientRef = ref(), uid = U.ff, role = 'Firefighter') => {
  await as(uid, role);
  return (await db.query('select * from public.file_fire_inspection($1, $2::jsonb)', [clientRef, JSON.stringify(fields)])).rows[0];
};
const premises = async () => { await db.query('reset role'); return (await db.query('select * from public.fire_premises order by created_at')).rows; };
const told = async () => { await db.query('reset role'); return (await db.query('select title, body, severity from public.told')).rows; };
const day = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

try {
  await db.exec(`
    create role authenticated nologin; create role anon nologin; create role service_role nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user', true), '')::uuid $$;
    create type public.silo as enum ('MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster', 'Ethekwini');
    create function public.current_tenant() returns uuid language sql stable as $$ select '${T}'::uuid $$;
    create function public.current_silo() returns public.silo language sql stable as $$ select current_setting('test.silo', true)::public.silo $$;
    create function public.role_in(variadic roles text[]) returns boolean language sql stable as $$ select current_setting('test.role', true) = any (roles) $$;
    create function public.is_global() returns boolean language sql stable as $$ select current_setting('test.role', true) in ('ControlRoom', 'SystemAdmin') $$;
    create function public.require_role(variadic roles text[]) returns void language plpgsql as $$
      begin if not (current_setting('test.role', true) = any (roles)) then raise exception 'role' using errcode = '42501'; end if; end $$;
    create table public.profiles (id uuid primary key, full_name text);
    create table public.personnel (user_id uuid, tenant_id uuid default '${T}', first_name text, last_name text);
    create table public.audit_logs (tenant_id uuid, silo public.silo, user_id uuid, user_name text, department text, action_type text,
      entity_type text, entity_id text, details text);
    create table public.told (tenant uuid, silo public.silo, title text, body text, severity text, link text);
    create function public.notify_command(t uuid, s public.silo, title text, body text, sev text, link text) returns void language sql as $$
      insert into public.told values (t, s, title, body, sev, link) $$;
    grant usage on schema public, auth to authenticated;
    grant select on public.profiles, public.personnel to authenticated;
    insert into auth.users values ('${U.ff}'), ('${U.chief}'), ('${U.cop}');
    insert into public.profiles values ('${U.ff}', 'FF Naidoo'), ('${U.chief}', 'Chief Mkhize'), ('${U.cop}', 'Const. Dube');
    insert into public.personnel (user_id, first_name, last_name) values ('${U.ff}', 'Priya', 'Naidoo');
  `);
  await db.exec(base);
  await db.exec(migration);
  await db.exec(migration); // safe to re-run
  await db.query('begin');

  await scenario('the server keeps the same checklist as the apps, word for word', async () => {
    const rows = (await db.query('select * from public.fire_inspection_items()')).rows;
    assert.deepEqual(
      rows.map((r) => ({ key: r.key, label: r.label, section: r.section, na: r.na, days: r.days, remedy: r.remedy })),
      spec.FIRE_INSPECTION_ITEMS.map((i) => ({ key: i.key, label: i.label, section: i.section, na: i.na, days: i.days, remedy: i.remedy })),
    );
    const occ = (await db.query('select public.fire_occupancies() as o')).rows[0].o;
    assert.deepEqual(occ, [...spec.OCCUPANCIES]);
  });

  await scenario('a clean visit to a new site: on the register, compliant, next due in six months (high risk)', async () => {
    const row = await file(newSite());
    assert.equal(row.outcome, 'Compliant');
    assert.equal(row.result, 'PASS');
    assert.match(row.inspection_ref, /^INSP-\d{8}-0001$/);
    assert.equal(row.inspector_name, 'Priya Naidoo');
    assert.equal(row.comply_by, null);
    const [p] = await premises();
    assert.equal(p.name, 'Skyline Mall');
    assert.equal(p.interval_months, 6);
    assert.equal(p.last_outcome, 'Compliant');
    assert.equal(day(p.next_due), spec.addMonths(today, 6));
    assert.equal(p.last_inspection_id, row.id);
  });

  await scenario('a replay files nothing twice', async () => {
    const r = ref();
    const a = await file(newSite(), r);
    const b = await file(newSite({ name: 'Something else' }), r);
    assert.equal(a.id, b.id);
    await db.query('reset role');
    assert.equal((await db.query('select count(*)::int as n from public.fire_safety_inspections')).rows[0].n, 1);
  });

  await scenario('faults make a compliance notice with the server\'s sections, the inspector\'s days, and the date to come back', async () => {
    const row = await file(newSite({
      checklist: { ...allYes(), extinguishers: 'no', exit_signs: 'no', sprinklers: 'na' },
      notice: [{ key: 'extinguishers', days: 7 }, { key: 'exit_signs', days: 14 }, { key: 'nope', days: 90 }],
      served: 'Handed over', person_in_charge: 'T. Govender',
    }));
    assert.equal(row.outcome, 'Compliance notice');
    assert.equal(row.result, 'FAIL');
    assert.equal(row.extinguishers, 'No');
    assert.deepEqual(row.notice_items.map((n) => [n.key, n.section, n.days]), [['exit_signs', 's.18(4)', 14], ['extinguishers', 's.25, s.31', 7]]);
    assert.equal(row.notice_items[1].label, 'Fire extinguishers in place, serviced in the last 12 months');
    assert.equal(day(row.comply_by), spec.addDays(today, 14));
    assert.equal(day(row.reinspect_on), spec.addDays(today, 14));
    assert.match(row.notes, /Not compliant: Exit signs show the way out \(s\.18\(4\)\); Fire extinguishers/);
    assert.equal(row.contact_person, 'T. Govender');
    const [p] = await premises();
    assert.equal(p.last_outcome, 'Compliance notice');
    assert.equal(day(p.next_due), spec.addDays(today, 14));
    assert.deepEqual(await told(), [], 'a first notice does not trouble command');
  });

  await scenario('blocked exits: put right immediately, the inspector is back tomorrow', async () => {
    const row = await file(newSite({ checklist: { ...allYes(), escape_routes_clear: 'no' }, served: 'Affixed to the premises' }));
    assert.equal(row.exits, 'No');
    assert.equal(day(row.comply_by), today);
    assert.equal(day(row.reinspect_on), spec.addDays(today, 1));
    assert.equal(row.contact_person, 'Not given');
  });

  await scenario('back again and the same fault is still there: command is told (consider s.79)', async () => {
    await file(newSite({ checklist: { ...allYes(), housekeeping: 'no' }, served: 'Handed over', person_in_charge: 'T. Govender' }));
    const [p] = await premises();
    const again = await file({ premises_id: p.id, kind: 'Re-inspection', checklist: { ...allYes(), housekeeping: 'no' }, served: 'Refused to sign', person_in_charge: 'T. Govender' });
    assert.equal(again.repeat_failure, true);
    assert.ok(again.previous_id);
    const t = await told();
    assert.equal(t.length, 1);
    assert.match(t[0].title, /Notice not complied with: Skyline Mall/);
    // Put right at the next visit: compliant, the register is up to date again.
    const fixed = await file({ premises_id: p.id, kind: 'Re-inspection', checklist: allYes() });
    assert.equal(fixed.outcome, 'Compliant');
    assert.equal(fixed.repeat_failure, false);
    const [after] = await premises();
    assert.equal(after.last_outcome, 'Compliant');
    assert.equal(day(after.next_due), spec.addMonths(today, 6));
  });

  await scenario('an instruction needs its reason and reaches fire command at once', async () => {
    await refused(() => file(newSite({ instruction: 'Close the premises', instruction_reason: 'gas', served: 'Handed over', person_in_charge: 'T. G' })), /Say why the instruction/);
    const row = await file(newSite({
      checklist: { ...allYes(), lpg: 'no' }, instruction: 'Evacuate the premises',
      instruction_reason: 'Gas leaking in the kitchen with people inside', served: 'Handed over', person_in_charge: 'T. Govender',
    }));
    assert.equal(row.outcome, 'Instruction');
    assert.equal(row.instruction, 'Evacuate the premises');
    const [t] = await told();
    assert.equal(t.severity, 'High');
    assert.match(t.title, /Evacuate the premises: Skyline Mall/);
  });

  await scenario('the checklist is checked: every item, known items only, N/A only where it may be, the days offered', async () => {
    await refused(() => file(newSite({ checklist: { ...allYes(), sprinklers: undefined } })), /Answer every check: Sprinklers/);
    await refused(() => file(newSite({ checklist: { ...allYes(), escape_routes_clear: 'na' } })), /Answer every check: Escape routes/);
    await refused(() => file(newSite({ checklist: { ...allYes(), made_up: 'yes' } })), /Unknown check: made_up/);
    await refused(() => file(newSite({ checklist: { ...allYes(), lpg: 'no' }, notice: [{ key: 'lpg', days: 5 }], served: 'Affixed to the premises' })), /time to put it right/);
    await refused(() => file(newSite({ kind: 'Because' })), /why you are inspecting/);
  });

  await scenario('a notice needs how it was served, and who was in charge unless fixed to the premises', async () => {
    await refused(() => file(newSite({ checklist: { ...allYes(), lpg: 'no' } })), /how the notice was served/);
    await refused(() => file(newSite({ checklist: { ...allYes(), lpg: 'no' }, served: 'Handed over' })), /person in charge/);
  });

  await scenario('a new site needs its name, address, use and risk; the same name and address is the same site', async () => {
    await refused(() => file(newSite({ name: ' ' })), /name of the business/);
    await refused(() => file(newSite({ occupancy: 'Spaceport' })), /what the premises are used for/);
    await refused(() => file(newSite({ risk: 'Extreme' })), /Choose the risk/);
    await file(newSite());
    await file(newSite({ name: 'skyline mall', address: ' 12 smith street, durban ' }));
    assert.equal((await premises()).length, 1);
    await refused(() => file({ premises_id: id(999), kind: 'Routine', checklist: allYes() }), /not on the register/);
  });

  await scenario('only Fire & Rescue files; a police officer cannot', async () => {
    await refused(() => file(newSite(), ref(), U.cop, 'Police'), /role/);
    await as(U.ff, 'Firefighter', 'MetroPolice');
    await refused(() => db.query('select public.file_fire_inspection($1, $2::jsonb)', [ref(), JSON.stringify(newSite())]), /Only Fire & Rescue/);
    await refused(() => file(newSite(), null), /no reference/);
  });

  await scenario('the tables take no writes except through the functions', async () => {
    await as(U.ff);
    await refused(() => db.query("insert into public.fire_premises (name, address, occupancy) values ('X', 'Y', 'Other')"), /permission denied/);
    await refused(() => db.query("insert into public.fire_safety_inspections (business_name, address, contact_person, extinguishers, exits, result) values ('X', 'Y', 'Z', 'Yes', 'Yes', 'PASS')"), /permission denied/);
    const row = await file(newSite());
    await db.query('reset role');
    await refused(() => db.query('update public.fire_safety_inspections set notes = $2 where id = $1', [row.id, 'changed']), /cannot be changed/);
  });

  await scenario('command keeps the register: adds a site before its first visit, changes its risk', async () => {
    await as(U.ff);
    await refused(() => db.query("select public.save_fire_premises(null, $1::jsonb)", [JSON.stringify({ name: 'A', address: 'B', occupancy: 'Other', risk: 'Low' })]), /role/);
    await as(U.chief, 'FireChief');
    const added = (await db.query("select * from public.save_fire_premises(null, $1::jsonb)", [JSON.stringify({ name: 'Addington Hospital', address: 'Erskine Terrace', occupancy: 'Hospital or clinic', risk: 'High', contact_number: '031 327 2000' })])).rows[0];
    assert.equal(added.interval_months, 6);
    assert.equal(added.next_due, null, 'never inspected: due now');
    await refused(() => db.query("select public.save_fire_premises(null, $1::jsonb)", [JSON.stringify({ name: 'addington hospital', address: 'erskine terrace', occupancy: 'Hospital or clinic', risk: 'High' })]), /already on the register/);
    // Inspected and compliant, then the risk drops: the next routine visit moves out.
    await file({ premises_id: added.id, kind: 'Routine', checklist: allYes() });
    await as(U.chief, 'FireChief');
    const changed = (await db.query("select * from public.save_fire_premises($1, $2::jsonb)", [added.id, JSON.stringify({ name: 'Addington Hospital', address: 'Erskine Terrace', occupancy: 'Hospital or clinic', risk: 'Low' })])).rows[0];
    assert.equal(changed.interval_months, 24);
    assert.equal(day(changed.next_due), spec.addMonths(today, 24));
  });

  await db.query('rollback');
  console.log(`\n${checks} scenarios passed; 0106 applied twice.`);
} finally {
  await db.close();
}
