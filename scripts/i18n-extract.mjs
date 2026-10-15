/** List every sentence the apps show, for the translators (packages/db/src/i18n/source.ts).
 * Run after changing any wording:
 *
 *   node --experimental-strip-types scripts/i18n-extract.mjs
 *
 * The tests fail while the list is out of date.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { extractSource } = await import(new URL('../packages/db/src/i18n/extract.ts', import.meta.url).href);
const { entries, templates } = extractSource(root);
if (templates.length) {
  console.error(`t(\`…\`) can't be translated; use t('… {name} …', { name }) in:\n  ${templates.join('\n  ')}`);
  process.exit(1);
}
const out = `/**
 * Every sentence the apps show, for the translators. Written by
 * scripts/i18n-extract.mjs: do not edit by hand.
 */
import type { SourceEntry } from './index.ts';

export const SOURCE: readonly SourceEntry[] = ${JSON.stringify(entries, null, 1)};
`;
writeFileSync(path.join(root, 'packages/db/src/i18n/source.ts'), out);
console.log(`${entries.length} sentences`);
