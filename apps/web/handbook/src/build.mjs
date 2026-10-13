/**
 * Builds the incident guides: each one standalone HTML file in apps/web/handbook/
 * (served at /guide/<slug> and in Admin → Handbook), made from
 *   - the handbook's look: fonts and styles from staff-onboarding.html,
 *   - the guide additions in guide.css,
 *   - the guide's own content, <slug>.body.html.
 *
 * Run after editing any of them:  node apps/web/handbook/src/build.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const here = new URL('./', import.meta.url);
const out = new URL('../', import.meta.url);

const GUIDES = [
  ['incident-police', 'HikTech · A police call, start to finish'],
  ['incident-fire', 'HikTech · A fire call, start to finish'],
  ['incident-ems', 'HikTech · A medical call, start to finish'],
  ['incident-disaster', 'HikTech · A disaster call, start to finish'],
];

const base = readFileSync(new URL('staff-onboarding.html', out), 'utf8');
const end = base.indexOf('</style>');
if (end < 0) throw new Error('staff-onboarding.html has no <style> block');
// Title, fonts block and the handbook's styles, without the closing tag.
const head = base.slice(0, end).replace(/<title>[^<]*<\/title>/, '');
const extra = readFileSync(new URL('guide.css', here), 'utf8');

for (const [slug, title] of GUIDES) {
  const bodyFile = new URL(`${slug}.body.html`, here);
  if (!existsSync(bodyFile)) continue;
  const body = readFileSync(bodyFile, 'utf8');
  const html = `<title>${title}</title>\n<!-- Built by apps/web/handbook/src/build.mjs from ${slug}.body.html. Edit the source, then rebuild. -->\n`
    + `${head.trimStart()}\n${extra}</style>\n\n${body}`;
  writeFileSync(new URL(`${slug}.html`, out), html);
  console.log(`built ${slug}.html (${Math.round(html.length / 1024)} KB)`);
}
