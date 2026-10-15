import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callChannelText, patientText, readPatients } from './call-facts.ts';

test('how the call came in, in words', () => {
  assert.equal(callChannelText('WhatsApp'), 'WhatsApp');
  assert.equal(callChannelText('Other', 'Radio from a guard'), 'Other: Radio from a guard');
  assert.equal(callChannelText(null), null);
});

test('patients read as the database keeps them', () => {
  assert.deepEqual(readPatients([{ name: ' Sipho ', severity: 'Low' }, 'x', { severity: 'Bad', caller: true }]), [
    { name: 'Sipho', severity: 'Low', caller: false },
    { name: null, severity: 'Unknown', caller: true },
  ]);
  assert.deepEqual(readPatients(null), []);
  assert.equal(readPatients(Array.from({ length: 30 }, () => ({}))).length, 20);
  assert.equal(patientText({ name: 'Thabo', severity: 'Medium', caller: true }), 'Thabo (the caller) · Medium');
  assert.equal(patientText({ name: null, severity: 'Critical', caller: false }), 'Name not given · Critical');
});
