import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DISPOSITIONS, DISPOSITION_CODES, dispositionLabel, dispositionsFor } from './dispositions.ts';

test('each department has its own short list of outcomes, no code twice in a list', () => {
  for (const [silo, list] of Object.entries(DISPOSITIONS)) {
    assert.ok(list.length >= 4 && list.length <= 8, silo);
    assert.equal(new Set(list.map((d) => d.code)).size, list.length, silo);
  }
  assert.equal(dispositionsFor('Ethekwini'), DISPOSITIONS.MetroPolice, 'control room field officers use the police list');
  assert.equal(dispositionsFor('Medical')[0]?.code, 'TRANSPORTED');
});

test('the words for a code, and a code that is not ours', () => {
  assert.equal(dispositionLabel('ARREST'), 'Arrest made');
  assert.equal(dispositionLabel('GOA'), 'Gone on arrival');
  assert.equal(dispositionLabel(null), null);
  assert.equal(dispositionLabel('OLD'), 'OLD');
});

test('the database allows exactly these codes (0098)', () => {
  const sql = readFileSync(new URL('../../../supabase/migrations/0098_close_disposition.sql', import.meta.url), 'utf8');
  const list = /select array\[([^\]]+)\]::text\[\]/.exec(sql)?.[1] ?? '';
  const inDb = list.split(',').map((s) => s.trim().replace(/'/g, ''));
  assert.deepEqual([...inDb].sort(), [...DISPOSITION_CODES].sort());
});
