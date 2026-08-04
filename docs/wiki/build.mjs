#!/usr/bin/env node
/**
 * Build the Criticomm Operations & Engineering Manual.
 *
 *   node docs/wiki/build.mjs
 *
 * Three stages, and the middle one is the reason this is not a one-liner:
 *
 *   1. ASSEMBLE  style.css + front matter + the content sections into one
 *      document, adding hanging section numbers as it goes.
 *
 *   2. RENDER PER UNIT  each volume divider and each chapter is rendered to
 *      its own PDF. That looks wasteful — it is roughly fifty Chrome
 *      invocations — but it is what makes real running heads possible. No
 *      browser implements CSS `string-set` / running elements, so the only way
 *      to print "Chapter 14 · Metro Police Officer" at the top of every page of
 *      chapter 14 is to know which pages belong to it. Rendering unit by unit
 *      gives exactly that.
 *
 *   3. STAMP  merge the units and draw the furniture: folio on the outer edge,
 *      running head with a hairline, mirrored for recto and verso. Chrome's own
 *      --print-to-pdf-header-footer is deliberately not used; it prints the
 *      source URL and the system date, which is not something you hand to a
 *      municipality.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const here = path.dirname(fileURLToPath(import.meta.url));
const work = path.join(here, '.build');
const output = path.join(here, '..', 'Criticomm-Operations-Manual.pdf');

const SECTIONS = [
  'front.html',
  'platform.html',
  'roles.html',
  'tasks.html',
  'mobile-admin.html',
  'running-ref.html',
];

/* ── Chrome ─────────────────────────────────────────────────────────── */

const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean).find((c) => existsSync(c));

if (!CHROME) {
  console.error('No Chrome or Edge found. Set CHROME_PATH to a Chromium binary.');
  process.exit(1);
}

function renderToPdf(htmlPath, pdfPath) {
  execFileSync(CHROME, [
    '--headless', '--disable-gpu', '--no-sandbox',
    // No header/footer: the furniture is drawn in stage 3.
    '--no-pdf-header-footer',
    `--print-to-pdf=${pdfPath}`,
    `file:///${htmlPath.split(path.sep).join('/')}`,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
}

/* ── Stage 1 — assemble ─────────────────────────────────────────────── */

const css = readFileSync(path.join(here, 'style.css'), 'utf8');
let body = SECTIONS.map((f) => readFileSync(path.join(here, 'src', f), 'utf8')).join('\n');

/**
 * Pull the leading "9.3" out of a heading so the stylesheet can hang it in the
 * gutter. Done here rather than in the source so the source stays readable.
 */
body = body.replace(
  /<(h2|h3)>((?:\d+\.\d+|[A-H])\s*(?:—\s*)?)\s/g,
  (_m, tag, num) => `<${tag}><span class="hn">${num.trim()}</span>`,
);

const page = (inner) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Criticomm — Operations &amp; Engineering Manual</title>
<style>${css}</style></head><body>
${inner}
</body></html>`;

/* ── Stage 2 — split into units and render each ─────────────────────── */

/**
 * Units are top-level blocks: the front matter, each volume divider, and each
 * chapter. Splitting on the opening tags is safe because both always start at
 * the beginning of a line in the sources.
 */
function splitUnits(html) {
  const marks = [...html.matchAll(/^<div class="(volume|part)"[^>]*>/gm)]
    .map((m) => ({ index: m.index, kind: m[1] }));

  const units = [];
  if (marks.length === 0) return [{ kind: 'front', title: null, html }];

  const front = html.slice(0, marks[0].index).trim();
  if (front) units.push({ kind: 'front', title: null, html: front });

  marks.forEach((mark, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].index : html.length;
    const chunk = html.slice(mark.index, end);
    units.push({ kind: mark.kind, title: titleOf(chunk, mark.kind), html: chunk });
  });
  return units;
}

/** The running head for a chapter: "14 · Metro Police Officer". */
function titleOf(chunk, kind) {
  if (kind !== 'part') return null;
  const num = /<div class="cnum">([^<]+)<\/div>/.exec(chunk)?.[1] ?? '';
  const name = /<h1>([\s\S]*?)<\/h1>/.exec(chunk)?.[1] ?? '';
  const clean = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
  const n = clean(num).replace(/^Chapter\s+/i, '');
  return n ? `${n} · ${clean(name)}` : clean(name);
}

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const units = splitUnits(body);
process.stdout.write(`Rendering ${units.length} units`);

const rendered = [];
units.forEach((unit, i) => {
  const htmlPath = path.join(work, `u${String(i).padStart(3, '0')}.html`);
  const pdfPath = path.join(work, `u${String(i).padStart(3, '0')}.pdf`);
  writeFileSync(htmlPath, page(unit.html));
  renderToPdf(htmlPath, pdfPath);
  rendered.push({ ...unit, pdfPath });
  if (i % 8 === 0) process.stdout.write('.');
});
process.stdout.write(' done\n');

/* ── Stage 3 — merge and stamp ──────────────────────────────────────── */

const book = await PDFDocument.create();
book.setTitle('Criticomm — Operations & Engineering Manual');
book.setSubject('Emergency dispatch, response and command platform');
book.setAuthor('eThekwini Emergency Services');
book.setProducer('Criticomm document pipeline');

/** Which running head each merged page carries; null = no furniture. */
const heads = [];

for (const unit of rendered) {
  const doc = await PDFDocument.load(readFileSync(unit.pdfPath));
  const pages = await book.copyPages(doc, doc.getPageIndices());
  for (const p of pages) {
    book.addPage(p);
    heads.push(unit.kind === 'part' ? unit.title : null);
  }
}

const roman = await book.embedFont(StandardFonts.Helvetica);
const romanBold = await book.embedFont(StandardFonts.HelveticaBold);

const MM = 2.83465;
const INK = rgb(0.09, 0.10, 0.13);
const MUTED = rgb(0.50, 0.53, 0.58);
const RULE = rgb(0.84, 0.86, 0.88);
const CRIMSON = rgb(0.62, 0.08, 0.15);

/**
 * Folio numbering starts at the first content page — the cover and contents are
 * front matter and are not numbered, which is the convention and also means the
 * printed number matches "page N of the manual" as a reader would count it.
 */
const firstContent = heads.findIndex((h) => h !== null);
let folio = 0;

book.getPages().forEach((p, i) => {
  const head = heads[i];
  const { width, height } = p.getSize();

  // Front matter and volume dividers stay clean.
  if (i < firstContent) return;
  folio += 1;
  if (head === null) return;

  const recto = folio % 2 === 1;
  const outer = recto ? width - 20 * MM : 24 * MM;

  // ── Running head ──
  const label = 'CRITICOMM';
  const chapter = head.toUpperCase();
  const y = height - 15 * MM;

  const labelW = romanBold.widthOfTextAtSize(label, 6.4);
  const chapW = roman.widthOfTextAtSize(chapter, 6.4);

  if (recto) {
    p.drawText(chapter, {
      x: width - 20 * MM - chapW, y, size: 6.4, font: roman, color: MUTED,
      characterSpacing: 0.8,
    });
    p.drawText(label, {
      x: 24 * MM, y, size: 6.4, font: romanBold, color: CRIMSON, characterSpacing: 1.4,
    });
  } else {
    p.drawText(chapter, {
      x: 24 * MM, y, size: 6.4, font: roman, color: MUTED, characterSpacing: 0.8,
    });
    p.drawText(label, {
      x: width - 20 * MM - labelW, y, size: 6.4, font: romanBold, color: CRIMSON,
      characterSpacing: 1.4,
    });
  }

  p.drawLine({
    start: { x: 24 * MM, y: y - 2.4 * MM },
    end: { x: width - 20 * MM, y: y - 2.4 * MM },
    thickness: 0.4, color: RULE,
  });

  // ── Folio ──
  const n = String(folio);
  const nW = romanBold.widthOfTextAtSize(n, 8.5);
  p.drawText(n, {
    x: recto ? outer - nW : outer,
    y: 13 * MM, size: 8.5, font: romanBold, color: INK,
  });

  // A short rule beside the folio, on the outer edge — quiet, but it makes the
  // page feel set rather than printed.
  const rx = recto ? outer - nW - 4 * MM : outer + nW + 4 * MM;
  p.drawLine({
    start: { x: rx, y: 14.2 * MM },
    end: { x: recto ? rx - 8 * MM : rx + 8 * MM, y: 14.2 * MM },
    thickness: 0.6, color: CRIMSON,
  });
});

writeFileSync(output, await book.save());
rmSync(work, { recursive: true, force: true });

console.log(
  `${path.basename(output)} — ${book.getPageCount()} pages, `
  + `${(statSync(output).size / 1024 / 1024).toFixed(1)} MB`,
);
