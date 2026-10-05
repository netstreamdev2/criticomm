import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkFirearmList, checkVehicleList, FIREARM_COLUMNS, firearmTypeFrom, normalisePlate, parseSheetDate, VEHICLE_COLUMNS,
  vehicleTypeFrom, type FirearmEntry, type VehicleEntry,
} from './assets.ts';
import { mapSheetHeaders, matchKey, sheetRowsFromTable } from './sheet.ts';

test('armoury and fleet headings, however they were written', () => {
  const f = mapSheetHeaders(['Serial No.', 'Manufacturer', 'Model', 'Caliber', 'Weapon type', 'Dept', 'Armoury', 'Licence holder'], FIREARM_COLUMNS);
  assert.deepEqual(f.columns, { serial_number: 0, make: 1, model: 2, calibre: 3, firearm_type: 4, department: 5, station: 6 });
  assert.deepEqual(f.ignored, ['Licence holder']);
  const v = mapSheetHeaders(['Fleet No', 'Vehicle Type', 'Department', 'Reg No', 'Chassis Number', 'Depot', 'Licence Disc Expiry'], VEHICLE_COLUMNS);
  assert.deepEqual(v.columns, { unit_number: 0, type: 1, department: 2, license_plate: 3, vin: 4, station_number: 5, disc_expiry: 6 });
  assert.deepEqual(v.missing, []);
  assert.deepEqual(mapSheetHeaders(['Make', 'Model'], FIREARM_COLUMNS).missing, ['serial_number', 'department']);
});

test('firearm and vehicle types as people write them', () => {
  assert.equal(firearmTypeFrom('Pistol'), 'Sidearm');
  assert.equal(firearmTypeFrom(''), 'Sidearm', 'blank means a sidearm');
  assert.equal(firearmTypeFrom('R5'), 'Rifle');
  assert.equal(firearmTypeFrom('TASER'), 'Less-lethal');
  assert.equal(firearmTypeFrom('cannon'), null);
  assert.equal(vehicleTypeFrom('fire truck'), 'Fire engine');
  assert.equal(vehicleTypeFrom('Bakkie'), 'Patrol vehicle');
  assert.equal(vehicleTypeFrom('Hazmat trailer'), 'Hazmat trailer', 'anything else is kept as typed');
  assert.equal(normalisePlate('  nd  123-456 '), 'ND 123-456');
  assert.equal(matchKey('mp 01'), 'MP01');
});

test('dates as people and Excel write them', () => {
  assert.equal(parseSheetDate('2027-03-31'), '2027-03-31');
  assert.equal(parseSheetDate('31/03/2027'), '2027-03-31', 'day first, as South Africa writes it');
  assert.equal(parseSheetDate('31 Mar 2027'), '2027-03-31');
  assert.equal(parseSheetDate('46477'), '2027-03-31', 'Excel’s own day number');
  assert.equal(parseSheetDate('31/02/2027'), null, 'no 31 February');
  assert.equal(parseSheetDate('next year'), null);
  assert.equal(parseSheetDate(''), null);
});

const firearm = (over: Partial<FirearmEntry>): FirearmEntry => ({
  id: 'f1', serial_number: 'SN-100', make: 'Glock', model: '17', calibre: '9mm', firearm_type: 'Sidearm', silo: 'MetroPolice',
  station: 'Durban Central', notes: null, status: 'Available', ...over,
});

test('checking an armoury list against the register', () => {
  const table = [
    ['Armoury stocktake'],
    ['Serial number', 'Make', 'Model', 'Calibre', 'Type', 'Department', 'Station'],
    ['SN-500', 'Glock', '19', '9mm', 'Pistol', 'Metro Police', 'Umlazi'],
    ['sn 100', 'Glock', '17', '9mm', '', 'Metro Police', ''],
    ['SN-200', 'Beretta', '92', '9mm', '', 'Metro Police', 'Pinetown'],
    ['SN-300', 'Glock', '17', '9mm', 'Sidearm', 'Metro Police', 'Durban Central'],
    ['SN-600', 'Colt', 'M4', '5.56', 'Cannon', 'Metro Police', ''],
    ['', 'Glock', '17', '', '', 'Metro Police', ''],
    ['SN-500', 'Glock', '19', '9mm', 'Pistol', 'Metro Police', 'Umlazi'],
  ];
  const parsed = sheetRowsFromTable(table, FIREARM_COLUMNS, 'armoury');
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  const register = [
    firearm({}),
    firearm({ id: 'f2', serial_number: 'SN-200', make: 'Glock' }),
    firearm({ id: 'f3', serial_number: 'SN-300', status: 'Issued' }),
  ];
  const res = checkFirearmList(parsed.rows, register);
  const at = (line: number) => res.rows.find((r) => r.line === line)!;
  assert.equal(at(3).outcome, 'add');
  assert.equal(at(3).item.firearm_type, 'Sidearm');
  assert.equal(at(4).outcome, 'unchanged', 'a serial matches however it was typed; blank cells never erase');
  assert.equal(at(5).outcome, 'attention', 'a different make on the same serial needs a person to look');
  assert.match(at(5).issues[0]?.message ?? '', /on the register as a Glock 17/);
  assert.equal(at(6).outcome, 'unchanged');
  assert.match(at(6).notes[0] ?? '', /Booked out right now/);
  assert.equal(at(7).issues[0]?.code, 'unknown-type');
  assert.equal(at(8).issues[0]?.code, 'no-serial');
  assert.equal(at(9).outcome, 'merged');
  assert.deepEqual(res.counts, { add: 1, update: 0, unchanged: 2, merged: 1, attention: 3, skipped: 0 });

  const fixed = checkFirearmList(parsed.rows, register, { 5: { acceptMatch: true }, 7: { firearmType: 'Rifle' }, 8: { skip: true } });
  assert.equal(fixed.rows.find((r) => r.line === 5)?.outcome, 'update');
  assert.deepEqual(fixed.rows.find((r) => r.line === 5)?.changes.map((c) => c.label), ['Make', 'Model', 'Station']);
  assert.equal(fixed.rows.find((r) => r.line === 7)?.outcome, 'add');
  assert.equal(fixed.counts.attention, 0);
  assert.equal(fixed.toImport.length, 5);
});

const vehicle = (over: Partial<VehicleEntry>): VehicleEntry => ({
  id: 'v1', unit_number: 'MP-01', name: 'Patrol 1', type: 'Patrol vehicle', silo: 'MetroPolice', make: 'Toyota', model: 'Corolla',
  year: 2021, license_plate: 'ND 555-111', vin: null, station_number: 'Durban Central', fuel_type: 'Petrol', disc_expiry: null,
  status: 'Available', ...over,
});

test('checking a fleet list against the register', () => {
  const table = [
    ['Fleet No', 'Type', 'Department', 'Make', 'Model', 'Year', 'Reg No', 'Licence disc expiry'],
    ['MP-10', 'Patrol car', 'Metro Police', 'Toyota', 'Corolla', '2023', 'nd 123-456', '31/03/2027'],
    ['mp 01', 'Patrol vehicle', 'Metro Police', '', '', '', 'ND 555-111', '46477'],
    ['MP-02', 'Patrol vehicle', 'Metro Police', '', '', '', 'ND 999-000', ''],
    ['MP-11', 'Patrol vehicle', 'Metro Police', '', '', '1900', '', 'whenever'],
    ['MP-12', 'Patrol vehicle', 'Metro Police', '', '', '', 'ND 555-111', ''],
    ['FR-01', 'Fire truck', 'Fire & Rescue', '', '', '', '', ''],
  ];
  const parsed = sheetRowsFromTable(table, VEHICLE_COLUMNS, 'fleet');
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  const register = [vehicle({}), vehicle({ id: 'v2', unit_number: 'MP-02', license_plate: 'ND 222-333', status: 'Out of Service' })];
  const res = checkVehicleList(parsed.rows, register);
  const at = (line: number) => res.rows.find((r) => r.line === line)!;
  assert.equal(at(2).outcome, 'add');
  assert.equal(at(2).item.name, 'Patrol vehicle MP-10', 'a blank name uses the type and unit');
  assert.equal(at(2).item.disc_expiry, '2027-03-31');
  assert.equal(at(2).item.license_plate, 'ND 123-456');
  assert.equal(at(3).outcome, 'update');
  assert.deepEqual(at(3).changes.map((c) => c.label), ['Name', 'Licence disc expiry']);
  assert.equal(at(4).outcome, 'attention', 'a different plate on the same unit needs a person to look');
  assert.deepEqual(at(5).issues.map((i) => i.code), ['bad-year', 'bad-date']);
  assert.equal(at(6).issues[0]?.code, 'plate-elsewhere', 'the same plate on another unit is a typing slip somewhere');
  assert.equal(at(7).outcome, 'add', 'FR-01 is new in Fire & Rescue');
  assert.equal(at(7).item.silo, 'MetroFire');

  const fixed = checkVehicleList(parsed.rows, register, { 4: { acceptMatch: true }, 5: { dropValue: true }, 6: { skip: true } });
  const f = (line: number) => fixed.rows.find((r) => r.line === line)!;
  assert.equal(f(4).outcome, 'update');
  assert.match(f(4).notes[0] ?? '', /Currently Out of Service/);
  assert.equal(f(5).outcome, 'add');
  assert.equal(f(5).item.year, null);
  assert.equal(fixed.counts.attention, 0);
});

test('a list typed in capitals changes nothing that is already right', () => {
  const register: FirearmEntry[] = [{
    id: 'f1', serial_number: 'SN-48812', make: 'Glock', model: '17 Gen 5', calibre: '9mm', firearm_type: 'Sidearm',
    silo: 'MetroPolice', station: 'Durban Central', notes: null, status: 'Available',
  }];
  const rows = [
    { line: 2, serial_number: 'sn 48812', make: 'GLOCK', model: '17 GEN 5', calibre: '9MM', firearm_type: 'PISTOL', department: 'METRO POLICE', station: 'DURBAN CENTRAL', notes: '' },
    { line: 3, serial_number: 'R5-0091', make: 'VEKTOR', model: 'R5', calibre: '5.56', firearm_type: 'R5', department: 'Metro Police', station: 'PINETOWN', notes: '' },
    { line: 4, serial_number: 'R5 0091', make: 'Vektor', model: 'R5', calibre: '5.56', firearm_type: 'Rifle', department: 'Metro Police', station: 'Pinetown', notes: '' },
  ];
  const check = checkFirearmList(rows as never, register);
  assert.deepEqual(check.counts, { add: 1, update: 0, unchanged: 1, merged: 1, attention: 0, skipped: 0 });
  assert.equal(check.toImport.find((r) => r.line === 2)?.make, 'Glock', 'the register keeps its own spelling');
  assert.equal(check.toImport.find((r) => r.line === 3)?.make, 'Vektor', 'capitals read as a name');
  assert.equal(check.toImport.find((r) => r.line === 3)?.station, 'Pinetown');
});

test('one number plate on two vehicles in the same file is a slip', () => {
  const rows = [
    { line: 2, unit_number: 'MP-12', type: 'Patrol', department: 'Metro Police', license_plate: 'nd 123-456' },
    { line: 3, unit_number: 'MP-14', type: 'Patrol', department: 'Metro Police', license_plate: 'ND123456' },
    { line: 4, unit_number: 'MP 12', type: 'Patrol', department: 'Metro Police', license_plate: 'ND 123 456' },
  ];
  const check = checkVehicleList(rows as never, []);
  const issues = (line: number) => check.rows.find((r) => r.line === line)!.issues.map((i) => i.code);
  assert.deepEqual(issues(2), ['plate-in-file']);
  assert.deepEqual(issues(3), ['plate-in-file']);
  assert.equal(check.rows.find((r) => r.line === 4)!.outcome, 'merged', 'the same unit twice is one vehicle');
  const fixed = checkVehicleList(rows as never, [], { 3: { skip: true } });
  assert.equal(fixed.counts.attention, 0, 'skipping one of them clears the other');
  assert.equal(fixed.toImport.length, 1);
});
