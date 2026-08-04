#!/usr/bin/env node
/**
 * Render the solution wiki to PDF.
 *
 * Headless Chrome rather than a PDF library: the document is 40-odd pages of
 * tables, callouts and code, and CSS paged media handles that far better than
 * hand-placed draw calls would. Chrome or Edge is present on every machine this
 * repo gets worked on, so there is nothing to install.
 *
 *   node docs/wiki/build.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(here, 'criticom-v5-wiki.html');
const output = path.join(here, '..', 'Criticom-V5-Solution-Wiki.pdf');

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const chrome = CANDIDATES.find((candidate) => existsSync(candidate));
if (!chrome) {
  console.error('No Chrome or Edge found. Set CHROME_PATH to a Chromium binary.');
  process.exit(1);
}

// file:// URLs want forward slashes on every platform.
const sourceUrl = `file:///${source.split(path.sep).join('/')}`;

execFileSync(chrome, [
  '--headless',
  '--disable-gpu',
  '--no-sandbox',
  // Chrome's own header/footer carries the page numbers.
  '--print-to-pdf-header-footer',
  `--print-to-pdf=${output}`,
  sourceUrl,
], { stdio: 'inherit' });

console.log(`${output} — ${(statSync(output).size / 1024).toFixed(0)} KB`);
