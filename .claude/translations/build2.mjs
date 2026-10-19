// Merge the new translations (tr2/out/<lang>/NN.lines, line i = sentence
// NN*300+i of tr2/work.json, "=" keeps the English) into the apps' locale
// files and the database seeds. Starts from what the locale files already
// hold, keeps only sentences the apps still show, checks every {placeholder}
// and the button length rule the i18n test enforces. Safe on partial progress.
//   node --experimental-strip-types build2.mjs <tr2 dir> <repo>
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [dir, repo] = process.argv.slice(2);
const LANGS = ['zu', 'xh', 'af', 'nso', 'tn', 'st', 'ts', 'ss', 've', 'nr'];
const NAMES = { zu: 'isiZulu', xh: 'isiXhosa', af: 'Afrikaans', nso: 'Sepedi', tn: 'Setswana', st: 'Sesotho', ts: 'Xitsonga', ss: 'siSwati', ve: 'Tshivenḓa', nr: 'isiNdebele' };
const { SOURCE } = await import(pathToFileURL(join(repo, 'packages/db/src/i18n/source.ts')).href);
const source = new Map(SOURCE.map((e) => [e.key, e]));
const work = JSON.parse(readFileSync(join(dir, 'work.json'), 'utf8'));
const PH = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;
const names = (s) => [...new Set([...s.matchAll(PH)].map((m) => m[1]))];
const sq = (s) => `'${s.replace(/'/g, "''")}'`;

let problems = 0;
const summary = [];
const seeds = [];
for (const lang of LANGS) {
  const before = (await import(pathToFileURL(join(repo, 'packages/db/src/i18n/locales', `${lang}.ts`)).href)).default;
  const dict = {};
  for (const [k, v] of Object.entries(before)) if (source.has(k)) dict[k] = v;
  const had = Object.keys(dict).length;
  const issues = [];
  const folder = join(dir, 'out', lang);
  if (existsSync(folder)) {
    for (const f of readdirSync(folder).filter((x) => x.endsWith('.lines')).sort()) {
      const b = Number(f.slice(0, 2));
      const want = readFileSync(join(dir, 'batches', `${f.slice(0, 2)}.txt`), 'utf8').split(/\r?\n/).filter(Boolean).length;
      const lines = readFileSync(join(folder, f), 'utf8').split(/\r?\n/);
      while (lines.length && lines.at(-1) === '') lines.pop();
      if (lines.length !== want) { issues.push(`${f}: ${lines.length} lines, batch has ${want}`); continue; }
      lines.forEach((raw, i) => {
        const n = b * 300 + i;
        const e = work[n];
        const text = raw.replace(/\\n/g, '\n');
        if (!e || text.trim() === '=') return;
        const s = source.get(e.key);
        if (!s) return;
        const missing = names(s.text).filter((p) => !text.includes(`{${p}}`));
        const extra = names(text).filter((p) => !names(s.text).includes(p));
        if (missing.length || extra.length) { issues.push(`${n} lost {${missing.join(',')}} added {${extra.join(',')}}: ${s.text} => ${text}`); return; }
        if (!text.trim() || text.length > 2000) { issues.push(`${n} empty or long`); return; }
        if (s.context === 'button' && text.length > Math.max(s.text.length * 1.8, s.text.length + 12)) {
          issues.push(`${n} too long for its button: ${s.text} => ${text}`); return;
        }
        dict[e.key] = text;
      });
    }
  }
  problems += issues.length;
  writeFileSync(join(dir, `issues-${lang}.txt`), issues.join('\n'));

  const keys = Object.keys(dict).sort();
  const body = keys.map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(dict[k])},`).join('\n');
  writeFileSync(join(repo, 'packages/db/src/i18n/locales', `${lang}.ts`), `/**
 * Approved translations (${lang}). Written by Admin → Translations → Download
 * approved file; only approved sentences belong here. The key is the English.
 *
 * ${keys.length} sentences translated by Claude and approved on the owner's
 * instruction (docs/23). A speaker's correction in Admin → Translations
 * replaces any of them.
 */
const dictionary: Record<string, string> = {
${body}
};
export default dictionary;
`);

  const rows = keys.map((k) => `(${sq(k)}, '${lang}', ${sq(dict[k])})`);
  const chunks = [];
  for (let i = 0; i < rows.length; i += 500) chunks.push(rows.slice(i, i + 500));
  const seed = `-- ${NAMES[lang]}: ${keys.length} translations by Claude, approved on the
-- owner's instruction. Run after 0078, in the SQL editor. Safe to re-run: a
-- translation a person approved is left as it is.
begin;
${chunks.map((c) => `insert into public.translations as t (key, lang, text, status, drafted_by, updated_by_name, updated_at, approved_by_name, approved_at)
select v.key, v.lang, v.text, 'approved', 'criti', 'Claude', now(), 'Claude (auto-approved)', now()
from (values
${c.join(',\n')}
) as v(key, lang, text)
on conflict (key, lang) do update
   set text = excluded.text, status = 'approved', drafted_by = 'criti', updated_by_name = excluded.updated_by_name,
       updated_at = now(), approved_by = null, approved_by_name = excluded.approved_by_name, approved_at = now()
 where not (t.status = 'approved' and t.drafted_by = 'person');`).join('\n\n')}
commit;
`;
  writeFileSync(join(repo, 'supabase/seed', `translations-${lang}.sql`), seed);
  seeds.push(seed);
  summary.push(`${lang} ${keys.length} (+${keys.length - had})${issues.length ? ` ${issues.length} rejected` : ''}`);
}
const total = Math.round(seeds.reduce((n, s) => n + (s.match(/^\('/gm) ?? []).length, 0) / LANGS.length);
writeFileSync(join(repo, 'supabase/seed/translations-all.sql'), `-- All 10 languages (about ${total.toLocaleString('en-ZA')} sentences each): Claude's translations,
-- approved on the owner's instruction. Run in the Supabase SQL editor after 0078.
-- Safe to re-run; it never overwrites a translation a person approved.

${seeds.join('\n')}`);
console.log(summary.join('\n'));
console.log(problems ? `${problems} rejected: see issues-*.txt` : 'no problems');
