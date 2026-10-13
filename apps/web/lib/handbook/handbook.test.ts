import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { findHandbookPage, HANDBOOK, renderHandbookPage, SELF_HOSTED_FONTS } from './index.ts';

const opts = { themeKey: 'criticom:theme', defaultTheme: 'criticom-dark', lightThemes: ['criticom-light'] };

test('only registered pages are served', () => {
  assert.ok(findHandbookPage('staff-onboarding'));
  for (const slug of ['nope', '../middleware', 'staff-onboarding.html', '', '..%2Fpackage.json']) {
    assert.equal(findHandbookPage(slug), null, slug);
  }
});

test('every registered page has its file, with the font markers the app replaces', () => {
  for (const page of HANDBOOK) {
    const html = readFileSync(path.join(import.meta.dirname, '../../handbook', page.file), 'utf8');
    assert.match(html, /<!-- handbook:fonts/, `${page.file} opens the font block`);
    assert.match(html, /<!-- \/handbook:fonts -->/, `${page.file} closes the font block`);
    assert.match(html, /<title>[^<]+<\/title>/, `${page.file} has a title`);
  }
});

test('in the app the page loads no third-party fonts, follows the console theme, and links back', () => {
  const fragment = '<title>T</title>\n<!-- handbook:fonts x -->\n<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Rubik">\n<!-- /handbook:fonts -->\n<div class="page">Hello</div>';
  const html = renderHandbookPage(fragment, opts);
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(!html.includes('fonts.googleapis.com'), 'no Google Fonts request');
  assert.ok(html.includes(SELF_HOSTED_FONTS));
  assert.ok(html.includes("localStorage.getItem(\"criticom:theme\")"));
  assert.ok(html.includes('["criticom-light"]'));
  assert.ok(html.includes('href="/admin/handbook"'));
  assert.ok(html.includes('<div class="page">Hello</div>'));
});

test('the real handbook renders without any third-party request', () => {
  const page = findHandbookPage('staff-onboarding')!;
  const html = renderHandbookPage(
    readFileSync(path.join(import.meta.dirname, '../../handbook', page.file), 'utf8'), opts,
  );
  assert.ok(!/https:\/\/fonts\.(googleapis|gstatic)\.com/.test(html));
  assert.ok(!/<script[^>]+src=/.test(html), 'no external scripts');
});

test('the public guides are only the guides, never an administrators’ page', async () => {
  const { PUBLIC_GUIDES, findPublicGuide, guideIndexFragment } = await import('./index.ts');
  assert.deepEqual(PUBLIC_GUIDES.map((p) => p.slug), ['incident-police', 'incident-fire', 'incident-ems', 'incident-disaster']);
  assert.equal(findPublicGuide('staff-onboarding'), null, 'the onboarding design stays for administrators');
  assert.equal(findPublicGuide('../handbook/staff-onboarding'), null);
  const style = readFileSync(path.join(import.meta.dirname, '../../handbook', 'incident-police.html'), 'utf8');
  const index = guideIndexFragment(style, PUBLIC_GUIDES);
  for (const g of PUBLIC_GUIDES) assert.ok(index.includes(`href="/guide/${g.slug}"`));
  const html = renderHandbookPage(index, { ...opts, audience: 'public' });
  assert.ok(html.includes('href="/guide"'), 'links back to the guides');
  assert.ok(!html.includes('/admin'), 'no way into Admin from a public page');
});

test('every guide is built from its source and names only example people', () => {
  for (const page of HANDBOOK.filter((p) => p.public)) {
    const html = readFileSync(path.join(import.meta.dirname, '../../handbook', page.file), 'utf8');
    assert.match(html, /Built by apps\/web\/handbook\/src\/build\.mjs/, `${page.file} is built, not hand-edited`);
    assert.match(html, /Example data/, `${page.file} says its data is made up`);
    assert.ok(!/Test123|@criticom\.gov\.za/.test(html), `${page.file} holds no test credentials`);
  }
});
