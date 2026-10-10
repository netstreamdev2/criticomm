import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noteText } from './note.ts';

test('a note filed from the phone reads without its outbox id', () => {
  const id = '4f1c2a9e-8b7d-4c3e-9a1f-2b3c4d5e6f70';
  assert.equal(noteText(`Suspect left on foot, heading north\u200B${id}`), 'Suspect left on foot, heading north');
  assert.equal(noteText(`🎙️ Voice note captured 10:42 (voice-note-1.m4a)\u200B${id}`), '🎙️ Voice note captured 10:42 (voice-note-1.m4a)');
  // Older builds used ids like this one.
  assert.equal(noteText('On scene\u200Blzx3k-abc12345'), 'On scene');
});

test('notes typed on the console are left exactly as written', () => {
  assert.equal(noteText('Caller called back: suspect wearing a red jacket'), 'Caller called back: suspect wearing a red jacket');
  assert.equal(noteText('Plate ND 123-456 seen'), 'Plate ND 123-456 seen', 'an ordinary trailing word is not a marker');
  assert.equal(noteText(null), '');
});
