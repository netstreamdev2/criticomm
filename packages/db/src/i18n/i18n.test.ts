import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LANGUAGES, TARGET_LANGS, bestLang, interpolate, keyOf, makeTranslator, placeholders, splitKey,
} from './index.ts';
import { BUNDLED } from './locales/index.ts';
import { SOURCE } from './source.ts';
import { GLOSSARY } from './glossary.ts';
import { extractSource } from './extract.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

test('a sentence shows its approved translation, or the English', () => {
  const { t, tc } = makeTranslator({
    'Send to dispatch': 'Thumela kwi-dispatch',
    [keyOf('Close', 'button')]: 'Vala',
    '{count} people hurt': 'Abantu abangu-{count} balimele',
    'Sent to {desks}': 'Kuthunyelwe',
  });
  assert.equal(t('Send to dispatch'), 'Thumela kwi-dispatch');
  assert.equal(t('Not translated yet'), 'Not translated yet');
  assert.equal(tc('button', 'Close'), 'Vala');
  assert.equal(t('Close'), 'Close', 'another meaning of the word is its own sentence');
  assert.equal(t('{count} people hurt', { count: 3 }), 'Abantu abangu-3 balimele');
  assert.equal(t('Sent to {desks}', { desks: 'EMS' }), 'Sent to EMS', 'a translation that lost {desks} is not used');
  assert.equal(interpolate('Hello {name}, {missing}', { name: 'Thabo' }), 'Hello Thabo, {missing}');
  assert.deepEqual(placeholders('{a} and {b} and {a}'), ['a', 'b']);
  assert.deepEqual(splitKey(keyOf('Close', 'button')), { context: 'button', text: 'Close' });
  assert.deepEqual(splitKey('Close'), { context: null, text: 'Close' });
});

test('the phone’s own language is used when we have it', () => {
  assert.equal(bestLang(['zu-ZA', 'en-ZA']), 'zu');
  assert.equal(bestLang(['fr-FR', 'af_ZA']), 'af');
  assert.equal(bestLang(['nso-ZA']), 'nso');
  assert.equal(bestLang(['de-DE']), 'en');
  assert.equal(LANGUAGES.length, 11, 'the eleven written languages');
  assert.equal(TARGET_LANGS.length, 10);
});

test('the list of sentences for the translators is up to date', () => {
  const { entries, templates } = extractSource(ROOT);
  assert.deepEqual(templates, [], 't(`…`) can’t be translated: use t(\'… {name} …\', { name })');
  assert.deepEqual(
    SOURCE.map((e) => [e.key, e.where.join(',')]),
    entries.map((e) => [e.key, e.where.join(',')]),
    'run: node --experimental-strip-types scripts/i18n-extract.mjs',
  );
  for (const g of GLOSSARY) assert.ok(SOURCE.some((e) => e.key === g.text), `glossary: ${g.text}`);
});

test('only approved, whole translations ship in the apps', () => {
  const keys = new Map(SOURCE.map((e) => [e.key, e]));
  for (const lang of TARGET_LANGS) {
    for (const [key, text] of Object.entries(BUNDLED[lang as keyof typeof BUNDLED])) {
      const e = keys.get(key);
      assert.ok(e, `${lang}: "${key}" is a sentence the apps show`);
      assert.ok(text.trim(), `${lang}: "${key}" is not empty`);
      for (const p of placeholders(e.text)) assert.ok(text.includes(`{${p}}`), `${lang}: "${key}" keeps {${p}}`);
      if (e.context === 'button') {
        assert.ok(text.length <= Math.max(e.text.length * 1.8, e.text.length + 12), `${lang}: "${key}" fits its button`);
      }
    }
  }
});
