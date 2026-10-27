import { test } from 'node:test';
import assert from 'node:assert/strict';
import { councillorRows } from './councillors.ts';

/** The office's own spreadsheet, whatever its headings, gives the desk its councillors. */

test('finds the columns by their headings, below a title row', () => {
  const { rows, missing } = councillorRows([
    ['eThekwini councillors 2026'],
    ['Ward No', 'Councillor', 'Party', 'Cell', 'E-mail'],
    ['Ward 1', 'Thandi Mkhize', 'X', '082 123 4567', 'thandi@durban.gov.za'],
    ['', 'Sipho Ndlovu', 'Y', '083 765 4321', ''],
    ['', '', '', '', ''],
  ]);
  assert.deepEqual(missing, []);
  assert.deepEqual(rows, [
    { ward: '1', name: 'Thandi Mkhize', phone: '082 123 4567', email: 'thandi@durban.gov.za' },
    { ward: '', name: 'Sipho Ndlovu', phone: '083 765 4321', email: '' },
  ]);
});

test('says which columns it could not find', () => {
  assert.deepEqual(councillorRows([['Name', 'Notes'], ['A Person', 'x']]).missing, ['ward', 'phone']);
  assert.deepEqual(councillorRows([['Ward', 'Cell']]).missing, ['name']);
});
