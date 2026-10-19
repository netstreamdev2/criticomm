// Work list for the next translation round: every sentence the apps show that
// <lang> has no translation for yet, in the word list's order, in batches of 300.
//   node --experimental-strip-types plan.mjs <work dir> <repo> <lang>
// Languages that are at the same point share one work dir and one build.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [dir, repo, lang = 'zu'] = process.argv.slice(2);
const { SOURCE } = await import(pathToFileURL(join(repo, 'packages/db/src/i18n/source.ts')).href);
const have = (await import(pathToFileURL(join(repo, 'packages/db/src/i18n/locales', `${lang}.ts`)).href)).default;

// Nothing to translate: no letters once the {names} are taken out.
const words = (s) => /[A-Za-z]{2,}/.test(s.replace(/\{[a-zA-Z][a-zA-Z0-9_]*\}/g, ''));
const work = SOURCE.filter((e) => words(e.text) && !(e.key in have)).map((e) => ({ key: e.key, text: e.text, context: e.context }));
mkdirSync(join(dir, 'batches'), { recursive: true });
writeFileSync(join(dir, 'work.json'), JSON.stringify(work));
for (let b = 0; b * 300 < work.length; b++) {
  const lines = work.slice(b * 300, (b + 1) * 300).map((e, i) =>
    `${b * 300 + i}\t${e.text.replace(/\n/g, '\\n')}${e.context ? `\t[${e.context}]` : ''}`);
  writeFileSync(join(dir, 'batches', `${String(b).padStart(2, '0')}.txt`), lines.join('\n'));
}
console.log(`${lang}: ${Object.keys(have).length} translated, ${work.length} to go, ${Math.ceil(work.length / 300)} batches`);
