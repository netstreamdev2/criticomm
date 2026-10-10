import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pdfSafe, saStamp } from './pdf-text.ts';

test('a phone-typed narrative never breaks the case PDF', () => {
  assert.equal(pdfSafe('Suspect fled → north 🚗💨'), 'Suspect fled ? north ??');
  assert.equal(pdfSafe('Dlamini – “Sipho” … €50'), 'Dlamini – “Sipho” … €50', 'WinAnsi punctuation is kept');
  assert.equal(pdfSafe('Ngcobo, Zoë, Őrs, Łukasz'), 'Ngcobo, Zoë, Ors, ?ukasz');
  assert.equal(pdfSafe('line one\r\nline\ttwo'), 'line one\nline two');
  assert.equal(pdfSafe(null), '');
  assert.equal(pdfSafe(42), '42');
});

test('the PDF stamps its time in South Africa', () => {
  // 22:30 UTC is 00:30 the next day in Durban.
  assert.match(saStamp(new Date('2026-10-07T22:30:00Z')), /2026\/10\/08.*00:30/);
});
