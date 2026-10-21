/** Run the ETK numbering migration (0096) against in-memory Postgres (PGlite):
 * a call logged in one go has its departments at once; a call sent early has
 * the date and time alone until the logger finishes; a department added later
 * goes in; nothing comes out; older numbers are left as they are.
 *
 * CASE_PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node scripts/test-etk-numbers.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.CASE_PGLITE_MODULE || '@electric-sql/pglite');

const migration = readFileSync(new URL('../supabase/migrations/0096_etk_incident_numbers.sql', import.meta.url), 'utf8');
const db = new PGlite();
let checks = 0;
const T = '20000000-0000-4000-8000-000000000001';

async function scenario(label, work) {
  await db.query('savepoint scenario');
  try { await work(); checks++; console.log(`PASS ${label}`); }
  catch (e) { console.log(`FAIL ${label}`); throw e; }
  finally { await db.query('rollback to savepoint scenario'); }
}
/** Log a call as the intake functions do: the number from next_incident_number(). */
async function log({ silo = 'Ethekwini', tags = [], finished = true, at = '2026-10-21T10:06:00Z' } = {}) {
  const r = await db.query(
    `insert into public.incidents (silo, tagged_silos, intake_complete, incident_number)
     values ($1::silo, $2::silo[], $3, public.next_incident_number($1::silo, $2::silo[], $4::timestamptz))
     returning id, incident_number`, [silo, `{${tags.join(',')}}`, finished, at]);
  return r.rows[0];
}
const numberOf = async (id) => (await db.query('select incident_number from public.incidents where id = $1', [id])).rows[0].incident_number;

try {
  await db.exec(`
    create role authenticated nologin; create role anon nologin; create role service_role nologin;
    create function public.current_tenant() returns uuid language sql stable as $$ select '${T}'::uuid $$;
    create type public.silo as enum ('MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster', 'Ethekwini');
    create table public.incident_day_counters (tenant_id uuid, day date, last_seq integer not null default 0, primary key (tenant_id, day));
    create table public.incidents (
      id uuid primary key default gen_random_uuid(), tenant_id uuid default '${T}', incident_number text not null,
      silo public.silo not null, tagged_silos public.silo[] not null default '{}', dispatched_silos public.silo[] not null default '{}',
      intake_complete boolean not null default true, status text default 'Pending');
  `);
  await db.exec(migration);
  await db.exec(migration); // safe to re-run
  await db.query('begin');

  await scenario('a call logged in one go has its departments at once, in order, with dashes', async () => {
    const c = await log({ tags: ['Medical', 'MetroPolice'] });
    // 10:06 UTC is 12:06 in South Africa.
    assert.equal(c.incident_number, 'ETK-MP-MD-20261021-1206-0001');
  });

  await scenario('sent early: the date and time alone, then the departments when the logger finishes', async () => {
    const c = await log({ tags: ['MetroPolice'], finished: false });
    assert.equal(c.incident_number, 'ETK-20261021-1206-0001');
    // Fire added while it is still being logged: still no departments.
    await db.query("update public.incidents set tagged_silos = tagged_silos || '{MetroFire}' where id = $1", [c.id]);
    assert.equal(await numberOf(c.id), 'ETK-20261021-1206-0001');
    await db.query('update public.incidents set intake_complete = true where id = $1', [c.id]);
    assert.equal(await numberOf(c.id), 'ETK-MP-FD-20261021-1206-0001');
  });

  await scenario('a department added later goes in; the date, time and number never change', async () => {
    const c = await log({ tags: ['MetroPolice', 'Medical'] });
    await db.query("update public.incidents set dispatched_silos = '{EthekwiniDisaster}' where id = $1", [c.id]);
    assert.equal(await numberOf(c.id), 'ETK-MP-MD-DM-20261021-1206-0001');
    await db.query("update public.incidents set tagged_silos = tagged_silos || '{MetroFire}' where id = $1", [c.id]);
    assert.equal(await numberOf(c.id), 'ETK-MP-FD-MD-DM-20261021-1206-0001');
  });

  await scenario('a department once in the number stays in it', async () => {
    const c = await log({ tags: ['MetroPolice', 'Medical'] });
    await db.query("update public.incidents set tagged_silos = '{MetroPolice}' where id = $1", [c.id]);
    assert.equal(await numberOf(c.id), 'ETK-MP-MD-20261021-1206-0001');
  });

  await scenario('no department named: CR, until one is', async () => {
    const c = await log({ silo: 'Ethekwini', tags: [] });
    assert.equal(c.incident_number, 'ETK-CR-20261021-1206-0001');
    await db.query("update public.incidents set dispatched_silos = '{MetroPolice}' where id = $1", [c.id]);
    assert.equal(await numberOf(c.id), 'ETK-MP-20261021-1206-0001');
  });

  await scenario('an officer SOS numbers by its department', async () => {
    const c = await log({ silo: 'MetroPolice', tags: ['MetroPolice'] });
    assert.equal(c.incident_number, 'ETK-MP-20261021-1206-0001');
  });

  await scenario('the number of the day counts on; the time is South African; midnight rolls the day', async () => {
    const a = await log({ tags: ['MetroPolice'] });
    const b = await log({ tags: ['Medical'], at: '2026-10-21T10:30:00Z' });
    const c = await log({ tags: ['Medical'], at: '2026-10-21T22:30:00Z' });
    assert.deepEqual([a.incident_number, b.incident_number, c.incident_number],
      ['ETK-MP-20261021-1206-0001', 'ETK-MD-20261021-1230-0002', 'ETK-MD-20261022-0030-0001']);
  });

  await scenario('calls numbered before 0096 keep their numbers', async () => {
    for (const old of ['MPFD-MD-20261016-1317-0002', 'INC-20261002-0003', 'MP-20261015-1251-0002']) {
      const r = await db.query(
        "insert into public.incidents (silo, tagged_silos, incident_number) values ('MetroPolice', '{MetroPolice,Medical}', $1) returning id, incident_number", [old]);
      assert.equal(r.rows[0].incident_number, old);
      await db.query("update public.incidents set dispatched_silos = '{MetroFire}' where id = $1", [r.rows[0].id]);
      assert.equal(await numberOf(r.rows[0].id), old);
    }
  });

  await db.query('rollback');
  console.log(`\n${checks} scenarios passed; 0096 applied twice.`);
} finally {
  await db.close();
}
