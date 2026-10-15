/** Run the real languages migration (0078) against in-memory Postgres (PGlite):
 * a person's language, who translates what, Criti's drafts, a translator's
 * approval, and who may read drafts.
 *
 * CASE_PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node scripts/test-languages.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.CASE_PGLITE_MODULE || '@electric-sql/pglite');

const migration = readFileSync(new URL('../supabase/migrations/0078_languages.sql', import.meta.url), 'utf8');
const db = new PGlite();
let checks = 0;
const one = async (q, args) => (await db.query(q, args)).rows[0];
const rows = async (q, args) => (await db.query(q, args)).rows;

const T = '20000000-0000-4000-8000-000000000001';
const T2 = '20000000-0000-4000-8000-000000000002';
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const U = { admin: id(1), zulu: id(2), logger: id(3), owner: id(4), elsewhere: id(5), afrikaans: id(6) };
const PEOPLE = [
  [U.admin, 'SystemAdmin', T], [U.zulu, 'Viewer', T], [U.logger, 'IncidentLogger', T],
  [U.owner, 'SuperAdmin', T], [U.elsewhere, 'Viewer', T2], [U.afrikaans, 'Viewer', T],
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
const save = (key, lang, text, approve = false) =>
  one('select * from public.save_translation($1, $2, $3, $4)', [key, lang, text, approve]);
const drafts = (lang, list) => one('select public.save_translation_drafts($1, $2::jsonb) as n', [lang, JSON.stringify(list)]).then((r) => r.n);
/** What the person can read, as the app reads it (row security applies). */
async function visible(uid, lang) {
  await as(uid);
  await db.query('set role authenticated');
  const r = await rows('select key, status from public.translations where lang = $1 order by key', [lang]);
  await db.query('reset role');
  return r;
}

try {
  await db.exec(`
    create role authenticated nologin; create role anon nologin; create role service_role nologin;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;
    create type public.silo as enum ('Ethekwini', 'MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster');
    create type public.user_role as enum ('SystemAdmin', 'SuperAdmin', 'Admin', 'Viewer', 'IncidentLogger');
    create table public.profiles (id uuid primary key, tenant_id uuid, role public.user_role, silo public.silo default 'Ethekwini',
      full_name text, deactivated_at timestamptz);
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
    grant execute on all functions in schema public to authenticated;
    create table public.audit_logs (id uuid primary key default gen_random_uuid(), silo public.silo, user_id uuid,
      user_name text, department text, action_type text, entity_type text, entity_id text, details text);
  `);
  for (const [uid, role, tenant] of PEOPLE) {
    await db.query('insert into public.profiles (id, tenant_id, role, full_name) values ($1, $2, $3, $4)', [uid, tenant, role, `Person ${uid.slice(-1)}`]);
  }
  await db.exec(migration);
  await db.exec(migration);
  await db.query('begin');

  await scenario('a person chooses their language; English is no choice at all', async () => {
    await as(U.logger);
    await db.query("select public.set_my_language('zu')");
    assert.equal((await one('select language from public.profiles where id = $1', [U.logger])).language, 'zu');
    await db.query("select public.set_my_language('en')");
    assert.equal((await one('select language from public.profiles where id = $1', [U.logger])).language, null);
    await refused(() => db.query("select public.set_my_language('fr')"), /not offered/);
    await as('');
    await refused(() => db.query("select public.set_my_language('zu')"), /Sign in first/);
  });

  await scenario('an administrator makes someone in their organisation a translator', async () => {
    await as(U.admin);
    const p = await one("select * from public.set_translator_langs($1, '{zu,zu}')", [U.zulu]);
    assert.deepEqual(p.translator_langs, ['zu']);
    await refused(() => db.query("select public.set_translator_langs($1, '{zu}')", [U.elsewhere]), /No such person in your organisation/);
    await refused(() => db.query("select public.set_translator_langs($1, '{en}')", [U.zulu]), /not offered/);
    const log = await one("select details from public.audit_logs where action_type = 'TRANSLATOR_SET' order by id desc limit 1");
    assert.match(log.details, /translates: zu/);
    await as(U.owner);
    assert.deepEqual((await one("select * from public.set_translator_langs($1, '{af}')", [U.elsewhere])).translator_langs, ['af'], 'the platform owner, anywhere');
    await as(U.logger);
    await refused(() => db.query("select public.set_translator_langs($1, '{zu}')", [U.logger]), /Not permitted/);
  });

  await scenario('Criti drafts; a person’s draft and an approved translation are never overwritten', async () => {
    await as(U.admin);
    await db.query("select public.set_translator_langs($1, '{zu}')", [U.zulu]);
    assert.equal(await drafts('zu', [
      { key: 'Send to dispatch', text: 'Thumela' },
      { key: 'Sent to {desks}', text: 'Kuthunyelwe' },
      { key: 'Close', text: '  ' },
    ]), 1, 'a draft that lost {desks}, and an empty one, are skipped');
    await save('Severity', 'zu', 'Ubucayi');
    await as(U.zulu);
    await save('Critical', 'zu', 'Kubucayi kakhulu', true);
    await as(U.admin);
    assert.equal(await drafts('zu', [
      { key: 'Send to dispatch', text: 'Thumela manje' },
      { key: 'Severity', text: 'Criti says' },
      { key: 'Critical', text: 'Criti says' },
    ]), 1, 'only Criti’s own draft is replaced');
    const r = await rows("select key, text, status, drafted_by from public.translations where lang = 'zu' order by key");
    assert.deepEqual(r.map((x) => [x.key, x.text, x.status, x.drafted_by]), [
      ['Critical', 'Kubucayi kakhulu', 'approved', 'person'],
      ['Send to dispatch', 'Thumela manje', 'draft', 'criti'],
      ['Severity', 'Ubucayi', 'draft', 'person'],
    ]);
    await refused(() => drafts('zu', Array.from({ length: 201 }, (_, i) => ({ key: `k${i}`, text: 'x' }))), /at most 200/);
    await as(U.logger);
    await refused(() => drafts('zu', [{ key: 'Close', text: 'Vala' }]), /Only translators and administrators/);
  });

  await scenario('only a translator for the language approves, keeping every {name}', async () => {
    await as(U.admin);
    await db.query("select public.set_translator_langs($1, '{zu}')", [U.zulu]);
    await save('Send to dispatch', 'zu', 'Thumela');
    await refused(() => save('Send to dispatch', 'zu', 'Thumela', true), /Only a translator for this language approves/);
    await as(U.zulu);
    const ok = await save('Send to dispatch', 'zu', '  Thumela kwi-dispatch ', true);
    assert.equal(ok.status, 'approved');
    assert.equal(ok.text, 'Thumela kwi-dispatch');
    assert.equal(ok.approved_by, U.zulu);
    await refused(() => save('Sent to {desks}', 'zu', 'Kuthunyelwe', true), /Keep every \{name\}/);
    assert.equal((await save('Sent to {desks}', 'zu', 'Kuthunyelwe ku-{desks}', true)).status, 'approved');
    assert.equal((await save(`button${String.fromCharCode(4)}{count} more`, 'zu', 'abanye abangu-{count}', true)).status, 'approved', 'a context is not part of the English');
    await refused(() => save('Close', 'af', 'Maak toe', true), /Only a translator for this language approves/, 'not their language');
    await as(U.admin);
    await refused(() => save('Send to dispatch', 'zu', 'Something else'), /changes an approved translation/);
    await as(U.zulu);
    const back = await save('Send to dispatch', 'zu', 'Thumela kwi-dispatch', false);
    assert.equal(back.status, 'draft', 'a translator can take an approval back');
    assert.equal(back.approved_by, null);
    const log = await rows("select action_type from public.audit_logs where entity_type = 'translations' order by id");
    assert.ok(log.some((x) => x.action_type === 'TRANSLATION_APPROVED') && log.some((x) => x.action_type === 'TRANSLATION_WITHDRAWN'));
  });

  await scenario('everyone reads approved translations; drafts only translators and administrators', async () => {
    await as(U.admin);
    await db.query("select public.set_translator_langs($1, '{zu}')", [U.zulu]);
    await db.query("select public.set_translator_langs($1, '{af}')", [U.afrikaans]);
    await drafts('zu', [{ key: 'Severity', text: 'Ubucayi' }]);
    await drafts('af', [{ key: 'Severity', text: 'Erns' }]);
    await as(U.zulu);
    await save('Critical', 'zu', 'Kubucayi kakhulu', true);
    assert.deepEqual((await visible(U.logger, 'zu')).map((x) => x.key), ['Critical'], 'a call logger sees only what is approved');
    assert.deepEqual((await visible(U.zulu, 'zu')).map((x) => x.key), ['Critical', 'Severity'], 'the translator sees the drafts');
    assert.deepEqual((await visible(U.zulu, 'af')).map((x) => x.key), [], 'but not another language’s drafts');
    assert.deepEqual((await visible(U.admin, 'af')).map((x) => x.key), ['Severity'], 'an administrator sees every draft');
    await db.query('set role authenticated');
    await refused(() => db.query("insert into public.translations (key, lang, text, status) values ('x', 'zu', 'y', 'approved')"), /permission denied/);
    await refused(() => db.query("update public.translations set text = 'z'"), /permission denied/);
    await db.query('reset role');
  });

  await scenario('visitors read and write nothing', async () => {
    assert.equal((await one("select has_table_privilege('anon', 'public.translations', 'select') as ok")).ok, false);
    for (const fn of ['public.set_my_language(text)', 'public.set_translator_langs(uuid, text[])',
      'public.save_translation(text, text, text, boolean)', 'public.save_translation_drafts(text, jsonb)']) {
      assert.equal((await one(`select has_function_privilege('anon', '${fn}', 'execute') as ok`)).ok, false, `anon cannot call ${fn}`);
    }
  });

  await db.query('rollback');
  console.log(`\n${checks} scenarios passed; 0078 applied twice.`);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}
