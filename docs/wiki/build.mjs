#!/usr/bin/env node
/**
 * Build the Criticomm Operations & Engineering Manual.
 *
 *   pnpm docs:build        (or: node docs/wiki/build.mjs)
 *
 * Four stages:
 *
 *   1. ASSEMBLE  style.css + the source sections. Two transforms run here so
 *      the sources stay readable: section numbers are wrapped for styling, and
 *      every procedure header gains a breadcrumb showing where in the console
 *      or the app the task lives — derived from the route in its own metadata,
 *      so the trail cannot disagree with the procedure it sits on.
 *
 *   2. RENDER PER UNIT  each volume divider and chapter renders to its own
 *      PDF. Roughly fifty Chrome invocations, and the price is worth it: no
 *      browser implements CSS running elements, so the only way to print
 *      "14 · Metro Police Officer" on every page of chapter 14 is to know
 *      which pages belong to it.
 *
 *   3. MERGE  the units into one document, tracking each page's chapter.
 *
 *   4. STAMP  the furniture with pdf-lib: running head with a hairline, and
 *      the folio in a filled square on the outer edge, mirrored recto/verso.
 *      Chrome's own header/footer is never used — it prints the source URL
 *      and the system date.
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
    '--no-pdf-header-footer',
    `--print-to-pdf=${pdfPath}`,
    `file:///${htmlPath.split(path.sep).join('/')}`,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
}

/* ── Breadcrumbs ────────────────────────────────────────────────────── */

/**
 * Route → where it lives in the console navigation. Longest prefix wins, so
 * `/dispatch/assign/[id]` is tried before `/dispatch`.
 */
const NAV = {
  '/dispatch/log-call': ['Console', 'Dispatch', 'Log Incoming Call'],
  '/dispatch/pending': ['Console', 'Dispatch', 'Pending Queue'],
  '/dispatch/assign': ['Console', 'Dispatch', 'Pending Queue', 'Assign'],
  '/dispatch/kpi': ['Console', 'Dispatch', 'KPI'],
  '/dispatch/ptt': ['Console', 'Dispatch', 'PTT Console'],
  '/incidents/map': ['Console', 'Incidents', 'Live Map'],
  '/incidents/[id]': ['Console', 'Incidents', 'Incident Detail'],
  '/incidents': ['Console', 'Incidents'],
  '/responder': ['Console', 'Responder', 'My Incidents'],
  '/shift/mental-check': ['Console', 'Responder', 'Start of Shift'],
  '/shift/vehicle-selection': ['Console', 'Responder', 'Start of Shift', 'Vehicle'],
  '/shift/vehicle-checklist': ['Console', 'Responder', 'Start of Shift', 'Inspection'],
  '/shift/unit-compliance': ['Console', 'Responder', 'Unit Compliance'],
  '/police/reports/new': ['Console', 'Police', 'Reports', 'New'],
  '/police/firearms/new': ['Console', 'Police', 'Firearms', 'New'],
  '/police/firearms': ['Console', 'Police', 'Firearms'],
  '/police/security/new': ['Console', 'Police', 'Security', 'New'],
  '/police/security': ['Console', 'Police', 'Security'],
  '/police/crime-hotspots': ['Console', 'Police', 'Crime Hotspots'],
  '/fire/reports/new': ['Console', 'Fire & Rescue', 'Reports', 'New'],
  '/fire/pir': ['Console', 'Fire & Rescue', 'PIR'],
  '/fire/hydrants': ['Console', 'Fire & Rescue', 'Hydrants'],
  '/medical/pcr/new': ['Console', 'EMS', 'PCR', 'New'],
  '/medical/pcr': ['Console', 'EMS', 'PCR'],
  '/medical/restock': ['Console', 'EMS', 'Restock'],
  '/disaster/dispatch': ['Console', 'Disaster', 'Dispatch'],
  '/disaster/partners': ['Console', 'Disaster', 'Partners'],
  '/disaster/post-mortem': ['Console', 'Disaster', 'Post-mortem'],
  '/disaster': ['Console', 'Disaster', 'Monitor'],
  '/roster/allocation': ['Console', 'Roster', 'Allocation'],
  '/roster/duty-sheet': ['Console', 'Roster', 'Duty Sheet'],
  '/roster/mine': ['Console', 'Roster', 'My Schedule'],
  '/roster': ['Console', 'Roster'],
  '/leave': ['Console', 'Leave'],
  '/hr': ['Console', 'HR Command Centre'],
  '/training': ['Console', 'Training'],
  '/performance/kpis': ['Console', 'Performance', 'KPIs'],
  '/performance/plans': ['Console', 'Performance', 'Plans'],
  '/performance/operational': ['Console', 'Performance', 'Operational'],
  '/report-hub': ['Console', 'Report Hub'],
  '/reports/builder': ['Console', 'Reports', 'Builder'],
  '/cameras/footage': ['Console', 'Cameras', 'Footage'],
  '/cameras': ['Console', 'Cameras'],
  '/hierarchy/person': ['Console', 'Hierarchy', 'Person'],
  '/admin/automations': ['Console', 'Admin', 'Automations'],
  '/admin/operations': ['Console', 'Admin', 'Operations Settings'],
  '/admin/integrations': ['Console', 'Admin', 'Integrations'],
  '/admin/departments': ['Console', 'Admin', 'Departments'],
  '/admin/personnel': ['Console', 'Admin', 'Personnel'],
  '/admin/operators': ['Console', 'Admin', 'Operators'],
  '/admin/vehicles': ['Console', 'Admin', 'Fleet'],
  '/admin/devices': ['Console', 'Admin', 'Devices'],
  '/admin/config': ['Console', 'Admin', 'Configuration'],
  '/admin/status': ['Console', 'Admin', 'System Status'],
  '/admin': ['Console', 'Admin', 'Users & Roles'],
  '/profile': ['Console', 'Profile'],
  '/search': ['Console', 'Search'],
  '/analytics': ['Console', 'Analytics'],
  '/case-manager': ['Console', 'Case Manager'],
};

/** Phone screens are named by phrase in the metadata, not by route. */
const APP_SCREENS = [
  ['scene evidence', ['App', 'Incident', 'Scene Evidence']],
  ['incident detail', ['App', 'Incidents', 'Incident Detail']],
  ['incidents tab', ['App', 'Incidents']],
  ['alerts tab', ['App', 'Alerts']],
  ['shift tab', ['App', 'Shift']],
  ['profile tab', ['App', 'Profile']],
  ['profile → apply for leave', ['App', 'Profile', 'Leave']],
  ['profile → ask criti', ['App', 'Profile', 'Criti']],
  ['profile', ['App', 'Profile']],
  ['login', ['App', 'Login']],
  ['sos button', ['App', 'SOS']],
  ['phone', ['App']],
];

function trailFor(meta) {
  const seg = /<b>Screens?<\/b>\s*([^·&<]*)/.exec(meta)?.[1]?.trim().toLowerCase() ?? '';
  if (!seg) return null;
  if (seg.startsWith('/')) {
    const route = seg.split(/[,\s]/)[0];
    const key = Object.keys(NAV)
      .sort((a, b) => b.length - a.length)
      .find((k) => route.startsWith(k));
    return key ? NAV[key] : null;
  }
  const hit = APP_SCREENS.find(([phrase]) => seg.includes(phrase));
  return hit ? hit[1] : null;
}

/** Add a breadcrumb trail to every procedure whose metadata names a screen. */
function addBreadcrumbs(html) {
  let added = 0;
  const out = html.split('<div class="proc">').map((chunk, i) => {
    if (i === 0) return chunk;
    const meta = /<div class="m">([\s\S]*?)<\/div>/.exec(chunk)?.[1];
    const trail = meta ? trailFor(meta) : null;
    if (!trail) return '<div class="proc">' + chunk;
    added += 1;
    const chips = trail.map((t) => `<span>${t}</span>`).join('<i>&#9656;</i>');
    return '<div class="proc">' + chunk.replace(
      /(<div class="t">[^<]*<\/div>)/,
      `$1<div class="path">${chips}</div>`,
    );
  }).join('');
  console.log(`Breadcrumbs on ${added} procedures`);
  return out;
}

/* ── Stage 1 — assemble ─────────────────────────────────────────────── */

const css = readFileSync(path.join(here, 'style.css'), 'utf8');
let body = SECTIONS.map((f) => readFileSync(path.join(here, 'src', f), 'utf8')).join('\n');

// Hang the "9.3" out of headings so the stylesheet can colour it.
body = body.replace(
  /<(h2|h3)>((?:\d+\.\d+|[A-H])\s*(?:—\s*)?)\s/g,
  (_m, tag, num) => `<${tag}><span class="hn">${num.trim()}</span>`,
);

body = addBreadcrumbs(body);

const page = (inner, opts = {}) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Criticomm — Operations &amp; Engineering Manual</title>
<style>${css}${opts.coverFirst ? '@page :first { margin: 0; }' : ''}</style></head><body>
${inner}
</body></html>`;

/* ── Stage 2 — split into units and render ──────────────────────────── */

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

function titleOf(chunk, kind) {
  if (kind !== 'part') return null;
  const num = /<div class="cnum">([^<]+)<\/div>/.exec(chunk)?.[1] ?? '';
  const name = /<h1>([\s\S]*?)<\/h1>/.exec(chunk)?.[1] ?? '';
  const clean = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
  const n = clean(num).replace(/^Chapter\s+/i, '').replace(/^Appendix\s+/i, '').replace(/^Appendices\s+/i, '');
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
  writeFileSync(htmlPath, page(unit.html, { coverFirst: unit.kind === 'front' }));
  renderToPdf(htmlPath, pdfPath);
  rendered.push({ ...unit, pdfPath });
  if (i % 8 === 0) process.stdout.write('.');
});
process.stdout.write(' done\n');

/* ── Stages 3 & 4 — merge and stamp ─────────────────────────────────── */

const book = await PDFDocument.create();
book.setTitle('Criticomm — Operations & Engineering Manual');
book.setSubject('Emergency dispatch, response and command platform');
book.setAuthor('eThekwini Emergency Services');
book.setProducer('Criticomm document pipeline');

const heads = [];
const opener = [];
for (const unit of rendered) {
  const doc = await PDFDocument.load(readFileSync(unit.pdfPath));
  const pages = await book.copyPages(doc, doc.getPageIndices());
  pages.forEach((p, pi) => {
    book.addPage(p);
    heads.push(unit.kind === 'part' ? unit.title : null);
    opener.push(unit.kind === 'part' && pi === 0);
  });
}

const sans = await book.embedFont(StandardFonts.Helvetica);
const sansBold = await book.embedFont(StandardFonts.HelveticaBold);

const MM = 2.83465;
const INK = rgb(0.055, 0.067, 0.086);
const MUTED = rgb(0.42, 0.44, 0.50);
const RULE = rgb(0.86, 0.88, 0.90);
const RED = rgb(0.753, 0.063, 0.188);
const WHITE = rgb(1, 1, 1);

// Folios start at the first content page; front matter stays unnumbered.
const firstContent = heads.findIndex((h) => h !== null);
let folio = 0;

book.getPages().forEach((p, i) => {
  const head = heads[i];
  const { width, height } = p.getSize();

  if (i < firstContent) return;
  folio += 1;
  if (head === null) return;   // volume dividers stay clean

  const recto = folio % 2 === 1;
  const isOpener = opener[i];

  // ── Running head (not on chapter openers — the band is the heading) ──
  if (!isOpener) {
  const label = 'CRITICOMM';
  const chapter = head.toUpperCase();
  const y = height - 14 * MM;
  const chapW = sans.widthOfTextAtSize(chapter, 6.4);
  const labelW = sansBold.widthOfTextAtSize(label, 6.4);

  if (recto) {
    p.drawText(label, { x: 20 * MM, y, size: 6.4, font: sansBold, color: RED, characterSpacing: 1.6 });
    p.drawText(chapter, { x: width - 16 * MM - chapW, y, size: 6.4, font: sans, color: MUTED, characterSpacing: 0.8 });
  } else {
    p.drawText(chapter, { x: 20 * MM, y, size: 6.4, font: sans, color: MUTED, characterSpacing: 0.8 });
    p.drawText(label, { x: width - 16 * MM - labelW, y, size: 6.4, font: sansBold, color: RED, characterSpacing: 1.6 });
  }
  p.drawLine({
    start: { x: 20 * MM, y: y - 2.2 * MM },
    end: { x: width - 16 * MM, y: y - 2.2 * MM },
    thickness: 0.4, color: RULE,
  });
  }

  // ── Folio in a filled square, outer bottom corner ──
  const n = String(folio);
  const sq = 6.4 * MM;
  const sx = recto ? width - 16 * MM - sq : 20 * MM;
  const sy = 9.5 * MM;
  p.drawRectangle({ x: sx, y: sy, width: sq, height: sq, color: INK });
  const nW = sansBold.widthOfTextAtSize(n, 8.2);
  p.drawText(n, {
    x: sx + (sq - nW) / 2, y: sy + 2.1 * MM,
    size: 8.2, font: sansBold, color: WHITE,
  });
});

writeFileSync(output, await book.save());
rmSync(work, { recursive: true, force: true });

console.log(
  `${path.basename(output)} — ${book.getPageCount()} pages, `
  + `${(statSync(output).size / 1024 / 1024).toFixed(1)} MB`,
);
