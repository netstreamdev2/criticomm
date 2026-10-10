/** Run the real signed-in-only migration (0069) against in-memory Postgres
 * (PGlite): a visitor with no sign-in reads nothing, signed-in users keep
 * exactly what their own rules give them, and database functions still work.
 *
 * CASE_PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node scripts/test-no-anonymous.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.CASE_PGLITE_MODULE || '@electric-sql/pglite');

const migration = readFileSync(new URL('../supabase/migrations/0069_no_anonymous_reads.sql', import.meta.url), 'utf8');
const db = new PGlite();
let checks = 0;
const count = async (q) => (await db.query(q)).rows[0].n;

async function refused(sql, pattern, message) {
  await db.query('savepoint refused');
  try { await assert.rejects(db.query(sql), pattern, message); }
  finally { await db.query('rollback to savepoint refused'); }
}
async function scenario(label, work) {
  await db.query('reset role');
  await db.query('savepoint scenario');
  try { await work(); checks++; console.log(`PASS ${label}`); }
  finally { await db.query('reset role'); await db.query('rollback to savepoint scenario'); }
}

try {
  await db.exec(`
    create role authenticated nologin; create role anon nologin;
    -- As before 0069: a rule a visitor with no sign-in also passes.
    create table public.incidents (id serial primary key, silo text not null);
    alter table public.incidents enable row level security;
    create policy incidents_read on public.incidents for select using (silo = coalesce(current_setting('test.silo', true), 'Ethekwini'));
    create table public.hydrants (id serial primary key);
    alter table public.hydrants enable row level security;
    create policy hydrants_read on public.hydrants for select using (true);
    -- A table with no row security at all.
    create table public.app_notes (id serial primary key);
    insert into public.incidents (silo) values ('Ethekwini'), ('MetroPolice');
    insert into public.hydrants default values;
    insert into public.app_notes default values;
    grant usage on schema public to anon, authenticated;
    grant select, insert on all tables in schema public to anon, authenticated;
    create function public.citizen_ping() returns int language sql security definer as $$ select count(*)::int from public.incidents $$;
    grant execute on function public.citizen_ping() to anon;
  `);

  await db.exec('begin');
  await scenario('before 0069: a visitor with no sign-in reads control-room calls', async () => {
    await db.query('set local role anon');
    assert.equal(await count('select count(*)::int as n from public.incidents'), 1);
  });

  await db.exec(migration);
  await db.exec(migration); // safe to re-run

  await scenario('after 0069: a visitor reads nothing, from any table', async () => {
    await db.query('set local role anon');
    assert.equal(await count('select count(*)::int as n from public.incidents'), 0);
    assert.equal(await count('select count(*)::int as n from public.hydrants'), 0, 'not even an open-to-all table');
    await refused('select count(*) from public.app_notes', /permission denied/, 'a table without row security is withdrawn');
  });

  await scenario('a visitor cannot write either', async () => {
    await db.query('set local role anon');
    await refused("insert into public.incidents (silo) values ('Ethekwini')", /row-level security|permission denied/);
  });

  await scenario('signed-in users keep exactly what their rules give them', async () => {
    await db.query('set local role authenticated');
    assert.equal(await count('select count(*)::int as n from public.incidents'), 1);
    assert.equal(await count('select count(*)::int as n from public.hydrants'), 1);
    assert.equal(await count('select count(*)::int as n from public.app_notes'), 1);
  });

  await scenario('database functions a visitor may call still work', async () => {
    await db.query('set local role anon');
    assert.equal((await db.query('select public.citizen_ping() as n')).rows[0].n, 2);
  });

  await db.exec('rollback');
  console.log(`\n${checks} scenarios passed`);
} catch (e) {
  console.error(e);
  process.exit(1);
}
