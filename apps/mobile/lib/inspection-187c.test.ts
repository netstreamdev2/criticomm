import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ITEM_KEYS, TABS, TOTAL_ITEMS, buildReportCsv, buildReportHtml, countItems, inspectionRef,
  type ItemMap,
} from './inspection-187c.ts';

/**
 * The server refuses a 187(c) sheet with fewer than 67 items, so the item list
 * here and the trigger in migration 0037 must agree exactly.
 */

test('the sheet has the 67 V4 items, each key unique', () => {
  assert.equal(TOTAL_ITEMS, 67);
  assert.equal(new Set(ITEM_KEYS).size, 67);
});

test('every item belongs to exactly one tab', () => {
  const fromTabs = TABS.flatMap((t) => t.sections.flatMap((s) => s.items.map(([k]) => `${s.id}.${k}`)));
  assert.deepEqual([...fromTabs].sort(), [...ITEM_KEYS].sort());
});

test('counts ignore keys outside the sheet', () => {
  const items: ItemMap = { 'ext_lights.brake': 'ok', 'grids.rear_canopy': 'fault', 'other.reflectors': 'nil', 'bogus.key': 'ok' };
  assert.deepEqual(countItems(items), { ok: 1, fault: 1, nil: 1, done: 3 });
});

test('reference follows DMPS-<NDM>-<YYYYMMDD> in SA time', () => {
  // 23:30 UTC on 30 Sep is already 1 Oct in Johannesburg.
  assert.equal(inspectionRef(' nd 112-233 ', new Date('2026-09-30T23:30:00Z')), 'DMPS-ND112233-20261001');
  assert.equal(inspectionRef('', new Date('2026-10-01T08:00:00Z')), 'DMPS-NA-20261001');
});

const record = {
  readiness: null,
  firearm: null,
  inspection: {
    inspection_ref: 'DMPS-7374646-20261001',
    ndm_number: '7374646',
    mileage_km: 900,
    shift_type: 'DAY',
    checked_at: '2026-10-01T08:00:00Z',
    inspection_date: '2026-10-01',
    fuel_level: 'Full',
    lights_functional: true,
    tires_condition_ok: true,
    equipment_stocked: true,
    comms_working: true,
    brakes_responsive: true,
    declaration_accepted: true,
    items: Object.fromEntries(ITEM_KEYS.map((k) => [k, 'ok'])),
    fault_remarks: 'Cracked, "left" lens',
    inspector_name: 'Const <Wayne>',
    signature_svg: '<svg></svg>',
    photo_paths: [],
    licence_disk_path: null,
    licence_photo_path: null,
    apparatus: { unit_number: 'METRO-P01', name: 'Patrol Alpha 1', make: 'BMW', model: '320d', license_plate: 'ND 112-233' },
  },
} as unknown as Parameters<typeof buildReportCsv>[0]['record'];

test('CSV quotes commas and quotes, one row per item', () => {
  const csv = buildReportCsv({ record, officerName: 'x' });
  assert.match(csv, /"Cracked, ""left"" lens"/);
  assert.match(csv, /External Lights,Brake,OK/);
  assert.equal(csv.split('\r\n').filter((r) => r.endsWith(',OK') || r.endsWith(',FAULT') || r.endsWith(',NIL')).length, 67);
});

test('HTML escapes officer-entered text', () => {
  const html = buildReportHtml({ record, officialName: 'Durban Metropolitan Police Service', shortName: 'DMPS', logoUrl: null, officerName: 'x' });
  assert.ok(html.includes('Const &lt;Wayne&gt;'));
  assert.ok(!html.includes('Const <Wayne>'));
  assert.ok(html.includes('VEHICLE PASSED INSPECTION'));
});
