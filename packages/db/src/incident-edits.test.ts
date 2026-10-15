import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asLogged, dispatchEditors, editLines, editValueText, type IncidentEdit } from './incident-edits.ts';

test('values read as words', () => {
  assert.equal(editValueText('is_caller_patient', true), 'Yes');
  assert.equal(editValueText('is_caller_patient', null), '—');
  assert.equal(editValueText('location', { address: '112 Florida Road', lat: -29.84, lng: 31.01 }), '112 Florida Road (-29.84000, 31.01000)');
  assert.equal(editValueText('details', { premises: 'A home', taken: ['Cellphone', 'TV'], 'q:Gate open?': 'Yes' }),
    'Where: A home; What was taken: Cellphone, TV; Gate open?: Yes');
  assert.equal(editValueText('details', {}), '—');
  assert.equal(editValueText('injuries', ['Burns']), 'Burns');
  assert.equal(editValueText('notes', ''), '—');
  assert.equal(editValueText('number_of_victims', 0), '0');
});

test('an edit reads in the order the call does', () => {
  const lines = editLines({
    notes: { before: null, after: 'Gate code 4471' },
    call_description: { before: 'Glass breaking', after: 'Two men broke in' },
    incident_severity: { before: 'Medium', after: 'High' },
  });
  assert.deepEqual(lines.map((l) => l.label), ['Severity', 'Description', 'Dispatch notes']);
  assert.deepEqual(lines[2], { field: 'notes', label: 'Dispatch notes', before: '—', after: 'Gate code 4471' });
});

test('the dispatchers who edited, each once', () => {
  const e = (kind: 'intake' | 'dispatch', name: string | null) => ({ kind, edited_by_name: name }) as IncidentEdit;
  assert.deepEqual(dispatchEditors([e('intake', 'Lerato'), e('dispatch', 'Sgt. Naidoo'), e('dispatch', null), e('dispatch', 'Sgt. Naidoo')]),
    ['Sgt. Naidoo', 'A dispatcher']);
});

test('the call as it was logged: each field before its first change', () => {
  const e = (at: string, changes: IncidentEdit['changes']) => ({ edited_at: at, changes }) as IncidentEdit;
  const logged = asLogged([
    e('2026-10-15T08:05:00Z', { call_description: { before: 'Second', after: 'Third' } }),
    e('2026-10-15T08:01:00Z', { call_description: { before: 'First', after: 'Second' }, incident_severity: { before: 'Medium', after: 'High' } }),
  ]);
  assert.deepEqual(logged, [
    { field: 'incident_severity', label: 'Severity', value: 'Medium' },
    { field: 'call_description', label: 'Description', value: 'First' },
  ]);
});
